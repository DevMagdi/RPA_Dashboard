"""FastAPI dependencies: authentication, permissions, rate limiting.

Every protected route resolves its context through these helpers:

* :func:`current_principal` — validated JWT → :class:`AuthenticatedUser`
* :func:`require_permission` — role/permission guard usable as a dependency
* :func:`rate_limit` — per-endpoint token bucket backed by Redis/memory
* :func:`request_meta` — IP + user agent for audit records
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Callable, Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.cache import get_cache
from app.core.config import get_settings
from app.core.logging import get_correlation_id, set_request_actor
from app.core.metrics import AUTH_EVENTS
from app.db.session import get_session_factory
from app.security.permissions import PermissionSet, load_permissions
from app.services.auth_service import AuthenticatedUser, decode_token, load_principal

logger = logging.getLogger(__name__)

bearer_scheme = HTTPBearer(auto_error=False, description="JWT access token")


# --------------------------------------------------------------------------- #
# Request metadata
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class RequestMeta:
    """Client information captured for audit & rate limiting."""

    ip_address: Optional[str]
    user_agent: Optional[str]
    correlation_id: str
    method: str
    path: str


def client_ip(request: Request) -> Optional[str]:
    """Best-effort real client IP (proxy aware when TrustedHost is configured)."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()[:64]
    return request.client.host if request.client else None


def request_meta(request: Request) -> RequestMeta:
    """Dependency returning the request metadata bundle."""
    return RequestMeta(
        ip_address=client_ip(request),
        user_agent=(request.headers.get("user-agent") or "")[:400] or None,
        correlation_id=get_correlation_id(),
        method=request.method,
        path=request.url.path,
    )


# --------------------------------------------------------------------------- #
# Database session
# --------------------------------------------------------------------------- #
def get_db() -> Session:
    """Yield a transactional SQLAlchemy session (committed on success)."""
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# --------------------------------------------------------------------------- #
# Authentication & authorisation
# --------------------------------------------------------------------------- #
def _unauthorized(detail: str = "بيانات الاعتماد غير صالحة") -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail, headers={"WWW-Authenticate": "Bearer"})


def authenticate_bearer(
    request: Request,
    db: Session,
    credentials: Optional[HTTPAuthorizationCredentials] = None,
) -> AuthenticatedUser:
    """Authenticate a request from its bearer token **or** raise ``401``.

    Kept separate from :func:`current_principal` so it can also be called from
    plain (non-dependency) helpers — e.g. the run-ingestion endpoints, which
    accept either an enrolled agent token or a normal user JWT.
    """
    token = credentials.credentials if credentials and credentials.credentials else None
    if not token:
        header = request.headers.get("authorization") or ""
        if header.lower().startswith("bearer "):
            token = header[7:].strip() or None
    if not token:
        raise _unauthorized("مطلوب تسجيل الدخول")

    try:
        payload = decode_token(token, expected_type="access")
    except Exception:
        AUTH_EVENTS.labels(event="access_token", result="invalid").inc()
        raise _unauthorized("انتهت صلاحية الجلسة أو التوكن غير صالح")

    user_id = int(payload.get("user_id") or 0)
    if not user_id:
        raise _unauthorized("التوكن لا يحتوي على بيانات المستخدم")

    principal = load_principal(db, user_id=user_id)
    if principal is None:
        AUTH_EVENTS.labels(event="access_token", result="inactive").inc()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="الحساب غير متاح أو معطل")

    # Bind actor context so every subsequent log line is attributable
    set_request_actor(username=principal.username)
    request.state.principal = principal
    return principal


def current_principal(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> AuthenticatedUser:
    """Resolve the authenticated user from the ``Authorization`` header."""
    return authenticate_bearer(request, db, credentials)


def current_permissions(principal: AuthenticatedUser = Depends(current_principal), db: Session = Depends(get_db)) -> PermissionSet:
    """Resolved permission set for the current role."""
    return load_permissions(principal.role)


def require_permission(*required: str) -> Callable[..., AuthenticatedUser]:
    """Dependency factory enforcing one or more permissions.

    ``require_permission("roi:write")`` or ``require_permission("audit:read",
    "export:read")`` (any-of semantics, wildcard aware).
    """

    def _checker(
        principal: AuthenticatedUser = Depends(current_principal),
        db: Session = Depends(get_db),
    ) -> AuthenticatedUser:
        permissions = load_permissions(principal.role)
        if not permissions.has_any(required):
            AUTH_EVENTS.labels(event="permission", result="denied").inc()
            logger.warning(
                "Permission denied: user=%s role=%s required=%s", principal.username, principal.role, required
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"ليس لديك صلاحية للقيام بهذا الإجراء ({', '.join(required)})",
            )
        return principal

    return _checker


# --------------------------------------------------------------------------- #
# Organization administrator guard (single-organization installation)
# --------------------------------------------------------------------------- #
def require_organization_admin(
    principal: AuthenticatedUser = Depends(current_principal),
) -> AuthenticatedUser:
    """Guard for installation-wide settings (reserved for SuperAdmin)."""
    if principal.role != "SuperAdmin":
        AUTH_EVENTS.labels(event="permission", result="organization_admin_denied").inc()
        logger.warning("Organization-admin denied: user=%s role=%s", principal.username, principal.role)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="هذا الإجراء مخصص لمسؤول النظام فقط",
        )
    return principal


# --------------------------------------------------------------------------- #
# SSE authentication (EventSource cannot send headers)
# --------------------------------------------------------------------------- #
def current_principal_sse(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> AuthenticatedUser:
    """Authenticate an SSE subscription.

    Browsers' ``EventSource`` API cannot set an ``Authorization`` header, so
    the realtime endpoint additionally accepts the access token as a
    ``?token=`` query parameter.  The header always wins when present; the
    query token is only a fallback and is validated exactly like a bearer
    token (same signature/expiry/principal checks).
    """
    if credentials is None or not credentials.credentials:
        query_token = request.query_params.get("token")
        if query_token:
            credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=query_token)
    return authenticate_bearer(request, db, credentials)


def require_roles(*roles: str) -> Callable[..., AuthenticatedUser]:
    """Backward-compatible role guard (prefer :func:`require_permission`)."""

    def _checker(principal: AuthenticatedUser = Depends(current_principal)) -> AuthenticatedUser:
        if principal.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="ليس لديك صلاحية للقيام بهذا الإجراء")
        return principal

    return _checker


def optional_principal(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> Optional[AuthenticatedUser]:
    """Resolve the user when a token is present, without failing otherwise."""
    if credentials is None or not credentials.credentials:
        if not (request.headers.get("authorization") or "").lower().startswith("bearer "):
            return None
    try:
        return authenticate_bearer(request, db, credentials)
    except HTTPException:
        return None


# --------------------------------------------------------------------------- #
# Rate limiting
# --------------------------------------------------------------------------- #
def rate_limit(limit: int, window_seconds: int = 60, scope: str = "default") -> Callable[..., None]:
    """Per-client, per-endpoint token bucket.

    ``rate_limit(5, 60, "login")`` allows 5 requests per minute per IP
    (and per username when the caller provides one through the request body
    handler).  Backed by Redis so limits hold across API workers.
    """

    def _dependency(request: Request, meta: RequestMeta = Depends(request_meta)) -> None:
        settings = get_settings()
        if settings.is_test:
            return  # keep the test-suite deterministic
        identifier = meta.ip_address or "unknown"
        principal = getattr(request.state, "principal", None)
        if principal is not None:
            identifier = f"user:{principal.user_id}"
        key = f"rl:{scope}:{identifier}:{request.url.path}"
        count = get_cache().incr_with_ttl(key, window_seconds)
        if count > limit:
            retry_after = max(1, window_seconds)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="تم تجاوز الحد المسموح من الطلبات، برجاء المحاولة لاحقاً",
                headers={"Retry-After": str(retry_after), "X-RateLimit-Limit": str(limit)},
            )

    return _dependency
