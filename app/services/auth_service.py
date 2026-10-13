"""Authentication service: credentials, lockout, MFA (TOTP + backup codes).

Flow
----
1. ``authenticate()`` verifies username/password, enforces the lockout policy
   and returns a *challenge* describing what must happen next.
2. When MFA is enabled the caller receives a short-lived ``mfa_token`` and must
   complete the second step through ``/api/auth/mfa/verify``.
3. On success ``complete_login()`` issues an access token (15 min) plus a
   rotated refresh token and logs the event in the audit trail.

Backup codes are stored peppered-hashed and are consumed on use.
"""

from __future__ import annotations

import base64
import io
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import (
    check_password_policy,
    consume_backup_code,
    create_access_token,
    decode_token,
    generate_backup_codes,
    generate_totp_secret,
    hash_backup_code,
    hash_password,
    hash_needs_rehash,
    build_totp_uri,
    verify_password,
    verify_totp,
)
from app.db.repository import fetch_all, fetch_one, insert_row, update_rows
from app.db.tables import SystemUsers
from app.security.permissions import is_known_role, load_permissions
from app.services import token_service

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Result types
# --------------------------------------------------------------------------- #
@dataclass
class AuthenticatedUser:
    """User record used by the request pipeline."""

    user_id: int
    username: str
    role: str
    department: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    mfa_enabled: bool = False
    must_change_password: bool = False
    permissions: List[str] = field(default_factory=list)

    def to_public_dict(self) -> Dict[str, Any]:
        """Safe representation returned to the frontend."""
        return {
            "user_id": self.user_id,
            "username": self.username,
            "role": self.role,
            "department": self.department,
            "email": self.email,
            "full_name": self.full_name or self.username,
            "mfa_enabled": self.mfa_enabled,
            "must_change_password": self.must_change_password,
            "permissions": self.permissions,
        }


@dataclass
class LoginChallenge:
    """Outcome of the first authentication step."""

    success: bool
    user: Optional[AuthenticatedUser] = None
    mfa_required: bool = False
    mfa_token: Optional[str] = None
    error: Optional[str] = None
    error_code: Optional[str] = None


class AuthError(RuntimeError):
    """Authentication failure with a safe, user-facing message."""

    def __init__(self, message: str, *, code: str = "invalid_credentials", status_code: int = 401) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def find_user(session: Session, *, username: str) -> Optional[Dict[str, Any]]:
    """Fetch a user row by username (case-insensitive)."""
    return fetch_one(
        session,
        """
        SELECT * FROM SystemUsers
        WHERE LOWER(Username) = LOWER(:u) AND (IsDeleted = 0 OR IsDeleted IS NULL)
        """,
        {"u": username},
        operation="auth.find_user",
    )


def find_user_by_id(session: Session, *, user_id: int) -> Optional[Dict[str, Any]]:
    """Fetch a user row by primary key."""
    return fetch_one(
        session,
        "SELECT * FROM SystemUsers WHERE UserID = :u",
        {"u": user_id},
        operation="auth.find_user_id",
    )


def _build_principal(session: Session, row: Dict[str, Any]) -> AuthenticatedUser:
    """Map a DB row + its permissions into an :class:`AuthenticatedUser`."""
    permission_set = load_permissions(str(row["Role"]))
    return AuthenticatedUser(
        user_id=int(row["UserID"]),
        
        username=str(row["Username"]),
        role=str(row["Role"]),
        department=str(row.get("AllowedDepartment") or "ALL"),
        email=row.get("Email"),
        full_name=row.get("FullName"),
        mfa_enabled=bool(row.get("MfaEnabled")),
        must_change_password=bool(row.get("MustChangePassword")),
        permissions=permission_set.as_list(),
    )


def _is_locked(row: Dict[str, Any]) -> bool:
    """True when the account is inside its lockout window."""
    locked_until = row.get("LockedUntil")
    return isinstance(locked_until, datetime) and locked_until > _now()


# --------------------------------------------------------------------------- #
# Step 1 — credentials
# --------------------------------------------------------------------------- #
def authenticate(session: Session, *, username: str, password: str) -> LoginChallenge:
    """Verify credentials and decide whether MFA is required.

    The function never reveals whether the username exists: callers receive the
    same generic error in both cases, and every attempt is auditable by the
    route layer.
    """
    settings = get_settings()
    row = find_user(session, username=username)

    if not row:
        return LoginChallenge(success=False, error="اسم المستخدم أو كلمة المرور غير صحيحة", error_code="user_not_found")

    user_id = int(row["UserID"])

    if not bool(row.get("IsActive", True)):
        return LoginChallenge(success=False, error="هذا الحساب معطل", error_code="inactive_account")

    if _is_locked(row):
        return LoginChallenge(success=False, error="تم قفل الحساب مؤقتاً بسبب محاولات دخول فاشلة", error_code="locked")

    if not verify_password(password, str(row.get("PasswordHash") or "")):
        _register_failed_attempt(session, row)
        return LoginChallenge(success=False, error="اسم المستخدم أو كلمة المرور غير صحيحة", error_code="bad_password")

    # Successful password step → transparently upgrade weak hashes
    if hash_needs_rehash(str(row.get("PasswordHash") or "")):
        update_rows(session, SystemUsers,
                    {"PasswordHash": hash_password(password)}, [SystemUsers.c.UserID == user_id])

    update_rows(
        session,
        SystemUsers,
        {"FailedLoginAttempts": 0, "LockedUntil": None},
        [SystemUsers.c.UserID == user_id],
    )

    principal = _build_principal(session, row)

    if settings.MFA_ENABLED and bool(row.get("MfaEnabled")) and row.get("MfaSecretEncrypted"):
        return LoginChallenge(
            success=False,
            user=principal,
            mfa_required=True,
            mfa_token=create_access_token(
                principal.username,
                role=principal.role,
                
                user_id=principal.user_id,
                department=principal.department,
                expires_delta=timedelta(minutes=5),
                extra_claims={"type": "mfa", "scope": "mfa_challenge"},
            ),
        )

    return LoginChallenge(success=True, user=principal)


def _register_failed_attempt(session: Session, row: Dict[str, Any]) -> int:
    """Increment the failure counter and lock the account on threshold."""
    settings = get_settings()

    attempts = int(row.get("FailedLoginAttempts") or 0) + 1
    values: Dict[str, Any] = {"FailedLoginAttempts": attempts}
    if attempts >= settings.MAX_FAILED_LOGIN_ATTEMPTS:
        values["LockedUntil"] = _now() + timedelta(minutes=settings.LOCKOUT_MINUTES)
        logger.warning("Account locked after %s failed attempts: user_id=%s", attempts, row.get("UserID"))
    update_rows(session, SystemUsers, values, [SystemUsers.c.UserID == int(row["UserID"])])
    return attempts


# --------------------------------------------------------------------------- #
# Step 2 — MFA
# --------------------------------------------------------------------------- #
def verify_mfa_challenge(session: Session, *, mfa_token: str, code: str) -> AuthenticatedUser:
    """Complete the login by verifying a TOTP code or a backup code."""
    try:
        payload = decode_token(mfa_token, expected_type="mfa")
    except Exception as exc:
        raise AuthError("انتهت صلاحية خطوة التحقق، برجاء تسجيل الدخول من جديد", code="mfa_token_invalid") from exc


    row = find_user_by_id(session, user_id=int(payload["user_id"]))
    if not row:
        raise AuthError("المستخدم غير موجود", code="user_not_found")

    secret = _decrypt_mfa_secret(row.get("MfaSecretEncrypted"))
    if secret and verify_totp(secret, code):
        update_rows(
            session,
            SystemUsers,
            {"LastMfaVerifiedAt": _now()},
            [SystemUsers.c.UserID == int(row["UserID"])],
        )
        return _build_principal(session, row)

    # Backup-code path (single use)
    stored = _load_backup_codes(row)
    matched = consume_backup_code(code, stored)
    if matched:
        remaining = [c for c in stored if c != matched]
        update_rows(
            session,
            SystemUsers,
            {"MfaBackupCodes": json.dumps(remaining), "LastMfaVerifiedAt": _now()},
            [SystemUsers.c.UserID == int(row["UserID"])],
        )
        logger.warning("Backup code used by user_id=%s (%d remaining)", row["UserID"], len(remaining))
        return _build_principal(session, row)

    raise AuthError("رمز التحقق الثنائي غير صحيح", code="invalid_mfa_code")


def _encrypt_mfa_secret(secret: str) -> str:
    """Encrypt a TOTP secret with the vault cipher before persisting it."""
    from app.core.security import get_vault_cipher

    return get_vault_cipher().encrypt(secret)


def _decrypt_mfa_secret(encrypted: Optional[str]) -> Optional[str]:
    """Decrypt a stored TOTP secret (returns ``None`` when unreadable)."""
    if not encrypted:
        return None
    try:
        from app.core.security import get_vault_cipher

        return get_vault_cipher().decrypt(str(encrypted))
    except Exception as exc:  # pragma: no cover - key rotation edge case
        logger.error("Unable to decrypt MFA secret: %s", exc)
        return None


def _load_backup_codes(row: Dict[str, Any]) -> List[str]:
    """Parse the stored backup-code hashes."""
    raw = row.get("MfaBackupCodes")
    if not raw:
        return []
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else raw
        return [str(item) for item in parsed]
    except (TypeError, ValueError):
        return []


def begin_mfa_setup(session: Session, *, user_id: int) -> Dict[str, Any]:
    """Generate a TOTP secret + provisioning QR code for the current user.

    The secret is stored encrypted but **not yet active**: ``MfaEnabled`` only
    flips to true after the user proves possession through
    :func:`confirm_mfa_setup`.
    """
    row = find_user_by_id(session, user_id=user_id)
    if not row:
        raise AuthError("المستخدم غير موجود", code="user_not_found", status_code=404)

    secret = generate_totp_secret()
    uri = build_totp_uri(secret, account_name=str(row["Username"]))


    update_rows(
        session,
        SystemUsers,
        {"MfaSecretEncrypted": _encrypt_mfa_secret(secret), "MfaEnabled": False},
        [SystemUsers.c.UserID == user_id],
    )

    return {
        "secret": secret,
        "otpauth_url": uri,
        "qr_code_png_base64": _qr_png_base64(uri),
        "manual_entry_key": secret,
        "issuer": get_settings().MFA_ISSUER,
        "account": str(row["Username"]),
    }


def _qr_png_base64(payload: str) -> Optional[str]:
    """Render a QR code as a base64 PNG (returns ``None`` if qrcode missing)."""
    try:
        import qrcode

        image = qrcode.make(payload)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")
    except Exception as exc:  # pragma: no cover - optional dependency
        logger.warning("QR generation unavailable: %s", exc)
        return None


def confirm_mfa_setup(session: Session, *, user_id: int, code: str) -> List[str]:
    """Activate MFA after the user verifies the first TOTP code.

    Returns the freshly generated backup codes (shown exactly once).
    """
    row = find_user_by_id(session, user_id=user_id)
    if not row:
        raise AuthError("المستخدم غير موجود", code="user_not_found", status_code=404)

    secret = _decrypt_mfa_secret(row.get("MfaSecretEncrypted"))
    if not secret:
        raise AuthError("لم يتم بدء إعداد التحقق الثنائي", code="mfa_not_started", status_code=400)

    if not verify_totp(secret, code):
        raise AuthError("رمز التحقق غير صحيح — تأكد من ضبط الساعة على التطبيق", code="invalid_mfa_code", status_code=400)

    settings = get_settings()
    backup_codes = generate_backup_codes(settings.MFA_BACKUP_CODES)

    update_rows(
        session,
        SystemUsers,
        {
            "MfaEnabled": True,
            "MfaEnrolledAt": _now(),
            "MfaBackupCodes": json.dumps([hash_backup_code(c) for c in backup_codes]),
        },
        [SystemUsers.c.UserID == user_id],
    )
    logger.info("MFA enrolled for user_id=%s", user_id)
    return backup_codes


def disable_mfa(session: Session, *, user_id: int, password: str) -> None:
    """Disable MFA — requires the current password (re-authentication)."""
    row = find_user_by_id(session, user_id=user_id)
    if not row or not verify_password(password, str(row.get("PasswordHash") or "")):
        raise AuthError("كلمة المرور غير صحيحة", code="bad_password", status_code=400)


    update_rows(
        session,
        SystemUsers,
        {"MfaEnabled": False, "MfaSecretEncrypted": None, "MfaBackupCodes": None},
        [SystemUsers.c.UserID == user_id],
    )


def regenerate_backup_codes(session: Session, *, user_id: int, password: str) -> List[str]:
    """Issue a new set of backup codes (invalidating the previous set)."""
    row = find_user_by_id(session, user_id=user_id)
    if not row or not verify_password(password, str(row.get("PasswordHash") or "")):
        raise AuthError("كلمة المرور غير صحيحة", code="bad_password", status_code=400)
    if not bool(row.get("MfaEnabled")):
        raise AuthError("التحقق الثنائي غير مُفعّل", code="mfa_not_enabled", status_code=400)

    codes = generate_backup_codes(get_settings().MFA_BACKUP_CODES)

    update_rows(
        session,
        SystemUsers,
        {"MfaBackupCodes": json.dumps([hash_backup_code(c) for c in codes])},
        [SystemUsers.c.UserID == user_id],
    )
    return codes


# --------------------------------------------------------------------------- #
# Session completion
# --------------------------------------------------------------------------- #
def complete_login(
    session: Session,
    principal: AuthenticatedUser,
    *,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> Dict[str, Any]:
    """Issue access + refresh tokens and record the login timestamp."""

    access_token = create_access_token(
        principal.username,
        role=principal.role,
        
        user_id=principal.user_id,
        department=principal.department,
    )
    issued = token_service.issue_refresh_token(
        session,
        user_id=principal.user_id,
        
        username=principal.username,
        ip_address=ip_address,
        user_agent=user_agent,
    )

    update_rows(
        session,
        SystemUsers,
        {"LastLoginDate": _now()},
        [SystemUsers.c.UserID == principal.user_id],
    )

    return {
        "access_token": access_token,
        "refresh_token": issued.raw_token,
        "token_type": "bearer",
        "expires_in": get_settings().ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "session_id": issued.token_id,
        "user": principal.to_public_dict(),
    }


def refresh_session(
    session: Session,
    *,
    raw_refresh_token: str,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> Dict[str, Any]:
    """Rotate a refresh token and mint a new access token."""
    try:
        payload = decode_token(raw_refresh_token, expected_type="refresh")
    except Exception as exc:
        raise AuthError("الجلسة منتهية، برجاء تسجيل الدخول من جديد", code="refresh_invalid") from exc

    username = str(payload.get("sub") or "")
    row = find_user(session, username=username)
    if not row or not bool(row.get("IsActive", True)):
        raise AuthError("الحساب غير متاح", code="inactive_account", status_code=403)

    try:
        issued, _previous = token_service.rotate_refresh_token(
            session, raw_refresh_token, username=username, ip_address=ip_address, user_agent=user_agent
        )
    except token_service.TokenError as exc:
        # Unknown / expired / revoked / reused refresh token (e.g. a stale
        # browser cookie against a fresh database) is a client auth failure,
        # never a server error.  Reuse detection (family revocation) has
        # already run inside token_service before this is raised.
        raise AuthError("الجلسة منتهية، برجاء تسجيل الدخول من جديد", code="refresh_invalid", status_code=401) from exc
    principal = _build_principal(session, row)
    access_token = create_access_token(
        principal.username,
        role=principal.role,
        
        user_id=principal.user_id,
        department=principal.department,
    )
    return {
        "access_token": access_token,
        "refresh_token": issued.raw_token,
        "token_type": "bearer",
        "expires_in": get_settings().ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "session_id": issued.token_id,
        "user": principal.to_public_dict(),
    }


def load_principal(session: Session, *, user_id: int) -> Optional[AuthenticatedUser]:
    """Load a principal by id (used by every authenticated request)."""
    row = find_user_by_id(session, user_id=user_id)
    if not row or not bool(row.get("IsActive", True)) or _is_locked(row):
        return None
    return _build_principal(session, row)


def _check_password_history(session: Session, *, user_id: int, new_password: str) -> None:
    """Reject reuse of the last ``PASSWORD_HISTORY_SIZE`` passwords."""

    size = int(get_settings().PASSWORD_HISTORY_SIZE or 5)
    if size <= 0:
        return
    rows = fetch_all(
        session,
        "SELECT PasswordHash FROM PasswordHistory WHERE UserID = :u ORDER BY HistoryID DESC",
        {"u": user_id},
        operation="auth.password_history",
    )[:size]
    for row in rows:
        if verify_password(new_password, str(row.get("PasswordHash") or "")):
            raise AuthError("لا يمكن إعادة استخدام كلمة مرور سابقة", code="password_reused", status_code=400)


def _record_password_history(session: Session, *, user_id: int, password_hash: str) -> None:
    from app.db.tables import PasswordHistory

    insert_row(session, PasswordHistory, {"UserID": user_id, "PasswordHash": password_hash})


# --------------------------------------------------------------------------- #
# User administration
# --------------------------------------------------------------------------- #
def create_user(
    session: Session,
    *,
    
    username: str,
    password: str,
    role: str,
    department: str = "ALL",
    email: Optional[str] = None,
    full_name: Optional[str] = None,
    must_change_password: bool = False,
) -> int:
    """Create a user with policy/enumeration validation."""
    if not is_known_role(role):
        raise AuthError(f"الدور '{role}' غير معروف", code="invalid_role", status_code=400)

    policy = check_password_policy(password)
    if not policy.ok:
        raise AuthError(policy.message, code="weak_password", status_code=400)

    if find_user(session, username=username):
        raise AuthError("اسم المستخدم مستخدم بالفعل", code="duplicate_username", status_code=400)


    _hash = hash_password(password)
    _uid = int(
        insert_row(
            session,
            SystemUsers,
            {
                "Username": username,
                "Email": email,
                "FullName": full_name or username,
                "PasswordHash": _hash,
                "Role": role,
                "AllowedDepartment": department or "ALL",
                "IsActive": True,
                "FailedLoginAttempts": 0,
                "MustChangePassword": must_change_password,
            },
        )
    )
    _record_password_history(session, user_id=_uid, password_hash=_hash)
    return _uid


def change_password(
    session: Session,
    *,
    user_id: int,
    
    current_password: str,
    new_password: str,
    keep_current_session_token_id: Optional[int] = None,
) -> None:
    """Change a password, enforce the policy and revoke all other sessions."""
    row = find_user_by_id(session, user_id=user_id)
    if not row or not verify_password(current_password, str(row.get("PasswordHash") or "")):
        raise AuthError("كلمة المرور الحالية غير صحيحة", code="bad_password", status_code=400)

    policy = check_password_policy(new_password)
    if not policy.ok:
        raise AuthError(policy.message, code="weak_password", status_code=400)
    if verify_password(new_password, str(row.get("PasswordHash") or "")):
        raise AuthError("كلمة المرور الجديدة مطابقة للحالية", code="same_password", status_code=400)
    _check_password_history(session, user_id=user_id, new_password=new_password)

    new_hash = hash_password(new_password)
    update_rows(
        session,
        SystemUsers,
        {"PasswordHash": new_hash, "MustChangePassword": False, "PasswordChangedAt": _now()},
        [SystemUsers.c.UserID == user_id],
    )
    _record_password_history(session, user_id=user_id, password_hash=new_hash)
    token_service.revoke_all_for_user(session, user_id=user_id, reason="password_changed")


def list_users(session: Session, *, limit: int = 200) -> List[Dict[str, Any]]:
    """List users (never returns password hashes)."""
    rows = fetch_all(
        session,
        """
        SELECT UserID, Username, Email, FullName, Role, AllowedDepartment, IsActive, MfaEnabled,
               FailedLoginAttempts, LockedUntil, LastLoginDate, CreatedAt
        FROM SystemUsers
        WHERE (IsDeleted = 0 OR IsDeleted IS NULL)
        ORDER BY Username
        """,
        {},
        operation="auth.list_users",
    )
    return rows


def set_user_active(session: Session, *, user_id: int, is_active: bool) -> int:
    """Enable/disable a user (soft governance action)."""

    affected = update_rows(
        session, SystemUsers, {"IsActive": is_active}, [SystemUsers.c.UserID == user_id]
    )
    if not is_active:
        token_service.revoke_all_for_user(session, user_id=user_id, reason="account_disabled")
    return affected


def soft_delete_user(session: Session, *, user_id: int) -> int:
    """Logically delete a user (retention friendly, never breaks audit joins)."""

    affected = update_rows(
        session,
        SystemUsers,
        {"IsDeleted": True, "DeletedAt": _now(), "IsActive": False},
        [SystemUsers.c.UserID == user_id],
    )
    token_service.revoke_all_for_user(session, user_id=user_id, reason="account_deleted")
    return affected
