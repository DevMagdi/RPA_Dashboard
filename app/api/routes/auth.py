"""Authentication, MFA, session and user-administration endpoints.

Endpoints
---------
``POST /api/auth/login``            — password step (returns MFA challenge when required)
``POST /api/auth/mfa/verify``       — TOTP / backup-code step → tokens
``POST /api/auth/mfa/setup``        — start enrolment (secret + QR code)
``POST /api/auth/mfa/confirm``      — activate MFA and return backup codes
``POST /api/auth/mfa/disable``      — disable MFA (password required)
``POST /api/auth/mfa/backup-codes`` — regenerate backup codes
``POST /api/auth/refresh``          — rotate refresh token → new access token
``POST /api/auth/logout``           — revoke the current session
``GET  /api/auth/me``               — current principal + permissions
``POST /api/auth/change-password``  — change own password (revokes other sessions)
``GET  /api/auth/sessions``         — active devices
``DELETE /api/auth/sessions/{id}``  — remote logout
``GET/POST /api/users``             — user administration (SuperAdmin)
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.api.deps import (
    current_principal,
    get_db,
    rate_limit,
    request_meta,
    require_permission,
)
from app.core.config import get_settings
from app.core.metrics import AUTH_EVENTS
from app.core.security import CSRF_COOKIE_NAME, generate_csrf_token
from app.security.permissions import KNOWN_ROLES
from app.services import audit_service, auth_service, token_service
from app.services.auth_service import AuthenticatedUser, AuthError

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["Authentication"])
users_router = APIRouter(prefix="/api/users", tags=["Users"])


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class MfaVerifyRequest(BaseModel):
    """Second authentication step."""

    mfa_token: str = Field(..., min_length=10)
    code: str = Field(..., min_length=4, max_length=20)


class MfaCodeRequest(BaseModel):
    """A single TOTP/backup code."""

    code: str = Field(..., min_length=4, max_length=20)


class PasswordRequest(BaseModel):
    """Password re-authentication payload."""

    password: str = Field(..., min_length=1, max_length=256)


class ChangePasswordRequest(BaseModel):
    """Self-service password change."""

    current_password: str = Field(..., min_length=1, max_length=256)
    new_password: str = Field(..., min_length=8, max_length=256)


class RefreshRequest(BaseModel):
    """Optional explicit refresh token (cookie flow uses none)."""

    refresh_token: Optional[str] = None


class UserCreateRequest(BaseModel):
    """User provisioning payload."""

    username: str = Field(..., min_length=3, max_length=50, pattern=r"^[A-Za-z0-9._-]+$")
    password: Optional[str] = Field(None, min_length=8, max_length=256)
    role: str = Field(..., description=f"one of {', '.join(KNOWN_ROLES)}")
    department: str = Field("ALL", max_length=50)
    email: Optional[EmailStr] = None
    full_name: Optional[str] = Field(None, max_length=200)
    must_change_password: bool = False


class UserActiveRequest(BaseModel):
    """Enable/disable a user."""

    is_active: bool


class LoginCredentials(BaseModel):
    """First-factor credentials.

    The SPA posts JSON, Swagger UI and the legacy frontend post form data; both
    are accepted so no client has to change in lockstep with this upgrade.
    """

    username: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=1, max_length=512)
    tenant_key: Optional[str] = Field(None, max_length=50)
    remember: bool = False


async def login_credentials(request: Request) -> LoginCredentials:
    """Parse the login body from JSON **or** ``application/x-www-form-urlencoded``."""
    content_type = (request.headers.get("content-type") or "").lower()

    if "application/json" in content_type:
        try:
            data = await request.json()
        except Exception as exc:  # noqa: BLE001 - malformed body
            raise AuthError("صيغة الطلب غير صحيحة", code="invalid_request") from exc
        if not isinstance(data, dict):
            raise AuthError("صيغة الطلب غير صحيحة", code="invalid_request")
        username = str(data.get("username") or data.get("Username") or "").strip()
        password = str(data.get("password") or data.get("Password") or "")
        tenant_key = data.get("tenant_key") or data.get("TenantKey") or request.headers.get("x-tenant-key")
        remember = bool(data.get("remember"))
    else:
        form = await request.form()
        username = str(form.get("username") or form.get("Username") or "").strip()
        password = str(form.get("password") or form.get("Password") or "")
        tenant_key = form.get("tenant_key") or request.headers.get("x-tenant-key")
        remember = str(form.get("remember") or "").lower() in ("1", "true", "yes", "on")

    if not username or not password:
        raise AuthError("اسم المستخدم وكلمة المرور مطلوبان", code="missing_credentials")

    return LoginCredentials(
        username=username, password=password, tenant_key=str(tenant_key) if tenant_key else None, remember=remember
    )


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
REFRESH_COOKIE = "refresh_token"


def _set_auth_cookies(response: Response, refresh_token: str) -> None:
    """Store the refresh token in an HttpOnly cookie + CSRF companion cookie."""
    settings = get_settings()
    max_age = settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600
    response.set_cookie(
        REFRESH_COOKIE,
        refresh_token,
        max_age=max_age,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/api/auth",
        domain=settings.COOKIE_DOMAIN,
    )
    response.set_cookie(
        CSRF_COOKIE_NAME,
        generate_csrf_token(),
        max_age=max_age,
        httponly=False,  # must be readable by the SPA to echo in the header
        secure=settings.cookie_secure,
        samesite="strict",
        path="/",
        domain=settings.COOKIE_DOMAIN,
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth")
    response.delete_cookie(CSRF_COOKIE_NAME, path="/")


# --------------------------------------------------------------------------- #
# Login flow
# --------------------------------------------------------------------------- #
@router.post("/login", summary="First authentication step (password)")
def login(
    request: Request,
    response: Response,
    credentials: LoginCredentials = Depends(login_credentials),
    db: Session = Depends(get_db),
    meta=Depends(request_meta),
    _limit=Depends(rate_limit(10, 60, "login")),
) -> Dict[str, Any]:
    """Verify the password and either issue tokens or an MFA challenge."""
    from app.db.repository import fetch_one

    tenant_key = credentials.tenant_key or request.headers.get("x-tenant-key") or "default"
    tenant = fetch_one(
        db,
        "SELECT TenantID, TenantKey, Name FROM Tenants WHERE TenantKey = :k AND IsActive = 1",
        {"k": tenant_key},
        operation="auth.tenant_lookup",
    )
    if not tenant:
        # Fall back to the first active tenant so a fresh install still works
        tenant = fetch_one(
            db,
            "SELECT TenantID, TenantKey, Name FROM Tenants WHERE IsActive = 1 ORDER BY TenantID",
            operation="auth.default_tenant",
        )
    if not tenant:
        raise AuthError("لم يتم تهيئة النظام بعد — راجع مسؤول المنصة", code="no_tenant", status_code=503)

    tenant_id = int(tenant["TenantID"])
    challenge = auth_service.authenticate(
        db, tenant_id=tenant_id, username=credentials.username, password=credentials.password
    )

    # MFA challenge — the password was correct but a second factor is required.
    # Checked *before* the error branch: a challenge carries the correct
    # credentials with ``success=False`` and no error message, so it must never
    # fall through to token issuance.
    if challenge.mfa_required:
        AUTH_EVENTS.labels(event="login", result="mfa_challenge").inc()
        audit_service.record_standalone(
            tenant_id=tenant_id,
            action_type="Login_MFA_Challenge",
            user_id=challenge.user.user_id if challenge.user else None,
            new_values={"username": credentials.username},
            ip_address=meta.ip_address,
            user_agent=meta.user_agent,
        )
        return {
            "mfa_required": True,
            "mfa_token": challenge.mfa_token,
            "message": "أدخل رمز التحقق الثنائي لإكمال الدخول",
            "user": challenge.user.to_public_dict() if challenge.user else None,
        }

    if challenge.error:
        audit_service.record_standalone(
            tenant_id=tenant_id,
            action_type="Login_Failed" if challenge.error_code not in ("locked",) else "Login_Locked",
            user_id=challenge.user.user_id if challenge.user else None,
            new_values={"username": credentials.username, "reason": challenge.error_code},
            ip_address=meta.ip_address,
            user_agent=meta.user_agent,
            is_success=False,
        )
        AUTH_EVENTS.labels(event="login", result=challenge.error_code or "failed").inc()
        raise AuthError(challenge.error, code=challenge.error_code or "invalid_credentials")

    principal = challenge.user
    assert principal is not None
    tokens = auth_service.complete_login(
        db, principal, ip_address=meta.ip_address, user_agent=meta.user_agent
    )
    _set_auth_cookies(response, tokens.pop("refresh_token"))
    audit_service.record(
        db,
        tenant_id=tenant_id,
        action_type="Login_Success",
        user_id=principal.user_id,
        new_values={"role": principal.role, "mfa": principal.mfa_enabled},
        ip_address=meta.ip_address,
        user_agent=meta.user_agent,
    )
    AUTH_EVENTS.labels(event="login", result="success").inc()
    tokens["mfa_required"] = False
    tokens["tenant"] = {"key": tenant["TenantKey"], "name": tenant["Name"]}
    return tokens


@router.post("/mfa/verify", summary="Second authentication step (MFA)")
def verify_mfa(
    request: Request,
    response: Response,
    payload: MfaVerifyRequest,
    db: Session = Depends(get_db),
    meta=Depends(request_meta),
    _limit=Depends(rate_limit(20, 60, "mfa_verify")),
) -> Dict[str, Any]:
    """Complete the login with a TOTP or backup code."""
    try:
        from app.core.security import decode_token

        claims = decode_token(payload.mfa_token, expected_type="mfa")
    except Exception as exc:
        raise AuthError("انتهت صلاحية خطوة التحقق، أعد تسجيل الدخول", code="mfa_token_invalid") from exc

    tenant_id = int(claims.get("tenant_id") or 0)
    try:
        principal = auth_service.verify_mfa_challenge(
            db, tenant_id=tenant_id, mfa_token=payload.mfa_token, code=payload.code
        )
    except AuthError as exc:
        audit_service.record_standalone(
            tenant_id=tenant_id,
            action_type="MFA_Failed",
            user_id=int(claims.get("user_id") or 0) or None,
            new_values={"reason": exc.code},
            ip_address=meta.ip_address,
            user_agent=meta.user_agent,
            is_success=False,
        )
        AUTH_EVENTS.labels(event="mfa", result="failed").inc()
        raise

    tokens = auth_service.complete_login(db, principal, ip_address=meta.ip_address, user_agent=meta.user_agent)
    _set_auth_cookies(response, tokens.pop("refresh_token"))
    audit_service.record(
        db,
        tenant_id=tenant_id,
        action_type="Login_Success",
        user_id=principal.user_id,
        new_values={"role": principal.role, "mfa": True},
        ip_address=meta.ip_address,
        user_agent=meta.user_agent,
    )
    AUTH_EVENTS.labels(event="mfa", result="success").inc()
    tokens["mfa_required"] = False
    return tokens


@router.post("/refresh", summary="Rotate the refresh token")
def refresh(
    response: Response,
    request: Request,
    payload: Optional[RefreshRequest] = None,
    db: Session = Depends(get_db),
    meta=Depends(request_meta),
    _limit=Depends(rate_limit(60, 60, "refresh")),
) -> Dict[str, Any]:
    """Exchange a valid refresh token for a new access token (rotation)."""
    token = (payload.refresh_token if payload else None) or request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise AuthError("لا توجد جلسة صالحة", code="no_refresh_token")

    tokens = auth_service.refresh_session(
        db, raw_refresh_token=token, ip_address=meta.ip_address, user_agent=meta.user_agent
    )
    _set_auth_cookies(response, tokens.pop("refresh_token"))
    return tokens


@router.post("/logout", summary="Terminate the current session")
def logout(
    response: Response,
    request: Request,
    db: Session = Depends(get_db),
    meta=Depends(request_meta),
    principal: Optional[AuthenticatedUser] = Depends(current_principal),
) -> Dict[str, Any]:
    """Revoke the refresh token and clear cookies."""
    token = request.cookies.get(REFRESH_COOKIE)
    revoked = token_service.revoke_token(db, token, reason="logout") if token else 0
    _clear_auth_cookies(response)
    if principal:
        audit_service.record(
            db,
            tenant_id=principal.tenant_id,
            action_type="Logout",
            user_id=principal.user_id,
            ip_address=meta.ip_address,
            user_agent=meta.user_agent,
        )
    AUTH_EVENTS.labels(event="logout", result="success").inc()
    return {"status": "success", "revoked_sessions": revoked}


# --------------------------------------------------------------------------- #
# MFA management
# --------------------------------------------------------------------------- #
@router.post("/mfa/setup", summary="Start MFA enrolment (QR code)")
def mfa_setup(
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(current_principal),
    _limit=Depends(rate_limit(10, 300, "mfa_setup")),
) -> Dict[str, Any]:
    """Generate a TOTP secret and a provisioning QR code for the current user."""
    return auth_service.begin_mfa_setup(db, user_id=principal.user_id, tenant_id=principal.tenant_id)


@router.post("/mfa/confirm", summary="Activate MFA and get backup codes")
def mfa_confirm(
    payload: MfaCodeRequest,
    request: Request,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(current_principal),
    meta=Depends(request_meta),
) -> Dict[str, Any]:
    """Verify the first code, enable MFA and return one-time backup codes."""
    codes = auth_service.confirm_mfa_setup(
        db, user_id=principal.user_id, tenant_id=principal.tenant_id, code=payload.code
    )
    audit_service.record(
        db,
        tenant_id=principal.tenant_id,
        action_type="MFA_Enabled",
        user_id=principal.user_id,
        ip_address=meta.ip_address,
        user_agent=meta.user_agent,
    )
    return {
        "status": "success",
        "mfa_enabled": True,
        "backup_codes": codes,
        "message": "احفظ أكواد الاسترداد في مكان آمن — لن تُعرض مرة أخرى",
    }


@router.post("/mfa/disable", summary="Disable MFA (password required)")
def mfa_disable(
    payload: PasswordRequest,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(current_principal),
    meta=Depends(request_meta),
) -> Dict[str, Any]:
    """Turn MFA off after re-authenticating with the account password."""
    auth_service.disable_mfa(db, user_id=principal.user_id, tenant_id=principal.tenant_id, password=payload.password)
    audit_service.record(
        db,
        tenant_id=principal.tenant_id,
        action_type="MFA_Disabled",
        user_id=principal.user_id,
        ip_address=meta.ip_address,
        user_agent=meta.user_agent,
    )
    return {"status": "success", "mfa_enabled": False}


@router.post("/mfa/backup-codes", summary="Regenerate backup codes")
def mfa_backup_codes(
    payload: PasswordRequest,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(current_principal),
    meta=Depends(request_meta),
) -> Dict[str, Any]:
    """Issue a fresh set of recovery codes (previous set is invalidated)."""
    codes = auth_service.regenerate_backup_codes(
        db, user_id=principal.user_id, tenant_id=principal.tenant_id, password=payload.password
    )
    audit_service.record(
        db,
        tenant_id=principal.tenant_id,
        action_type="MFA_BackupCodes_Regenerated",
        user_id=principal.user_id,
        ip_address=meta.ip_address,
        user_agent=meta.user_agent,
    )
    return {"status": "success", "backup_codes": codes}


# --------------------------------------------------------------------------- #
# Profile & sessions
# --------------------------------------------------------------------------- #
@router.get("/me", summary="Current user profile and permissions")
def me(principal: AuthenticatedUser = Depends(current_principal)) -> Dict[str, Any]:
    """Return the authenticated principal with its effective permissions."""
    return {
        **principal.to_public_dict(),
        "session_count": token_service.count_active_sessions(principal.tenant_id, principal.user_id),
    }


@router.post("/change-password", summary="Change own password")
def change_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(current_principal),
    meta=Depends(request_meta),
) -> Dict[str, Any]:
    """Change the password and revoke all other sessions."""
    auth_service.change_password(
        db,
        user_id=principal.user_id,
        tenant_id=principal.tenant_id,
        current_password=payload.current_password,
        new_password=payload.new_password,
    )
    audit_service.record(
        db,
        tenant_id=principal.tenant_id,
        action_type="Password_Changed",
        user_id=principal.user_id,
        ip_address=meta.ip_address,
        user_agent=meta.user_agent,
    )
    return {"status": "success", "message": "تم تغيير كلمة المرور وإنهاء الجلسات الأخرى"}


@router.get("/sessions", summary="Active sessions / devices")
def sessions(
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(current_principal),
) -> List[Dict[str, Any]]:
    """List the user's active refresh-token sessions."""
    return token_service.list_active_sessions(db, tenant_id=principal.tenant_id, user_id=principal.user_id)


@router.delete("/sessions/{session_id}", summary="Remote logout a device")
def revoke_session(
    session_id: int,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(current_principal),
    meta=Depends(request_meta),
) -> Dict[str, Any]:
    """Revoke a specific session (stolen laptop, shared device…)."""
    revoked = token_service.revoke_session_by_id(
        db, tenant_id=principal.tenant_id, user_id=principal.user_id, token_id=session_id
    )
    audit_service.record(
        db,
        tenant_id=principal.tenant_id,
        action_type="Session_Revoked",
        user_id=principal.user_id,
        entity_type="RefreshToken",
        entity_id=str(session_id),
        ip_address=meta.ip_address,
        user_agent=meta.user_agent,
        is_success=bool(revoked),
    )
    return {"status": "success", "revoked": revoked}


# --------------------------------------------------------------------------- #
# User administration
# --------------------------------------------------------------------------- #
@users_router.get("", summary="List users (admin)")
def list_users(
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("users:read")),
) -> List[Dict[str, Any]]:
    """Return every user of the tenant (no password material)."""
    return auth_service.list_users(db, tenant_id=principal.tenant_id)


@users_router.post("", status_code=status.HTTP_201_CREATED, summary="Create a user (admin)")
def create_user(
    payload: UserCreateRequest,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("users:write", "*")),
    meta=Depends(request_meta),
) -> Dict[str, Any]:
    """Provision a user with a policy-compliant password."""
    from secrets import token_urlsafe

    password = payload.password or token_urlsafe(12) + "Aa1!"
    user_id = auth_service.create_user(
        db,
        tenant_id=principal.tenant_id,
        username=payload.username,
        password=password,
        role=payload.role,
        department=payload.department,
        email=str(payload.email) if payload.email else None,
        full_name=payload.full_name,
        must_change_password=payload.must_change_password or payload.password is None,
    )
    audit_service.record(
        db,
        tenant_id=principal.tenant_id,
        action_type="Create_User",
        user_id=principal.user_id,
        entity_type="SystemUsers",
        entity_id=str(user_id),
        new_values={"username": payload.username, "role": payload.role, "department": payload.department},
        ip_address=meta.ip_address,
        user_agent=meta.user_agent,
    )
    response: Dict[str, Any] = {"status": "success", "user_id": user_id, "username": payload.username}
    if payload.password is None:
        response["temporary_password"] = password
        response["message"] = "تم إنشاء المستخدم — سلّم كلمة المرور المؤقتة له وسيُطلب تغييرها عند أول دخول"
    return response


@users_router.patch("/{user_id}/active", summary="Enable/disable a user (admin)")
def set_user_active(
    user_id: int,
    payload: UserActiveRequest,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("users:write", "*")),
    meta=Depends(request_meta),
) -> Dict[str, Any]:
    """Activate or suspend an account (suspension revokes its sessions)."""
    if user_id == principal.user_id and not payload.is_active:
        raise AuthError("لا يمكنك تعطيل حسابك الحالي", code="self_disable", status_code=400)

    affected = auth_service.set_user_active(
        db, tenant_id=principal.tenant_id, user_id=user_id, is_active=payload.is_active
    )
    audit_service.record(
        db,
        tenant_id=principal.tenant_id,
        action_type="User_Activation_Changed",
        user_id=principal.user_id,
        entity_type="SystemUsers",
        entity_id=str(user_id),
        new_values={"is_active": payload.is_active},
        ip_address=meta.ip_address,
        user_agent=meta.user_agent,
        is_success=bool(affected),
    )
    return {"status": "success", "affected": affected}


@users_router.delete("/{user_id}", summary="Soft delete a user (admin)")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("users:write", "*")),
    meta=Depends(request_meta),
) -> Dict[str, Any]:
    """Logically delete a user while preserving the audit trail."""
    if user_id == principal.user_id:
        raise AuthError("لا يمكنك حذف حسابك الحالي", code="self_delete", status_code=400)

    affected = auth_service.soft_delete_user(db, tenant_id=principal.tenant_id, user_id=user_id)
    audit_service.record(
        db,
        tenant_id=principal.tenant_id,
        action_type="Delete_User",
        user_id=principal.user_id,
        entity_type="SystemUsers",
        entity_id=str(user_id),
        ip_address=meta.ip_address,
        user_agent=meta.user_agent,
        is_success=bool(affected),
    )
    return {"status": "success", "affected": affected}
