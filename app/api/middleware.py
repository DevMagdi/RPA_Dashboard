"""HTTP middleware stack (security, observability, tenancy hygiene).

Order matters — the stack is registered bottom-up in :mod:`app.main`:

1. :class:`CorrelationIdMiddleware` — assigns/propagates a request id
2. :class:`SecurityHeadersMiddleware` — HSTS, CSP, frame/nosniff/referrer policies
3. :class:`IPAllowlistMiddleware` — optional corporate network restriction
4. :class:`CSRFMiddleware` — double-submit cookie validation
5. :class:`MetricsMiddleware` — Prometheus counters + latency histogram
"""

from __future__ import annotations

import ipaddress
import logging
import time
from typing import Callable, Iterable, List, Optional

from fastapi import Request, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from app.core.config import get_settings
from app.core.logging import set_correlation_id
from app.core.metrics import HTTP_LATENCY, HTTP_REQUESTS, normalize_path
from app.core.security import CSRF_COOKIE_NAME, CSRF_HEADER_NAME, CSRF_SAFE_METHODS, csrf_tokens_match

logger = logging.getLogger(__name__)

CORRELATION_HEADER = "X-Correlation-ID"


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    """Attach a correlation id to every request and log its outcome."""

    async def dispatch(self, request: Request, call_next: Callable):
        incoming = request.headers.get(CORRELATION_HEADER)
        correlation_id = set_correlation_id(incoming)
        request.state.correlation_id = correlation_id
        started = time.perf_counter()

        try:
            response = await call_next(request)
        except Exception:
            duration_ms = (time.perf_counter() - started) * 1000
            logger.exception(
                "Unhandled error",
                extra={
                    "path": request.url.path,
                    "method": request.method,
                    "duration_ms": round(duration_ms, 2),
                },
            )
            raise

        duration_ms = (time.perf_counter() - started) * 1000
        response.headers[CORRELATION_HEADER] = correlation_id
        response.headers["X-Response-Time-ms"] = f"{duration_ms:.1f}"

        log = logger.info if request.url.path not in ("/health", "/metrics") else logger.debug
        log(
            "request",
            extra={
                "path": request.url.path,
                "method": request.method,
                "status_code": response.status_code,
                "duration_ms": round(duration_ms, 2),
            },
        )
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Emit the security headers a bank's penetration test will look for."""

    def __init__(self, app: ASGIApp, csp: Optional[str] = None) -> None:
        super().__init__(app)
        settings = get_settings()
        self._settings = settings
        self._csp = csp or (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; "
            "font-src 'self' data:; "
            "connect-src 'self'; "
            "frame-ancestors 'none'; "
            "base-uri 'self'; "
            "form-action 'self'; "
            "object-src 'none'"
        )

    async def dispatch(self, request: Request, call_next: Callable):
        response = await call_next(request)
        headers = response.headers

        headers.setdefault("X-Content-Type-Options", "nosniff")
        headers.setdefault("X-Frame-Options", "DENY")
        headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
        headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")

        # API responses are JSON — a strict CSP is safe and prevents content sniffing
        if request.url.path.startswith(("/api", "/ws")):
            headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        else:
            headers.setdefault("Content-Security-Policy", self._csp)

        if self._settings.cookie_secure or self._settings.is_prod:
            headers.setdefault("Strict-Transport-Security", f"max-age={self._settings.HSTS_MAX_AGE}; includeSubDomains")

        return response


class IPAllowlistMiddleware(BaseHTTPMiddleware):
    """Optional network restriction (``IP_ALLOWLIST=10.0.0.0/8,192.168.1.15``)."""

    def __init__(self, app: ASGIApp, allowlist: Optional[Iterable[str]] = None) -> None:
        super().__init__(app)
        raw = list(allowlist if allowlist is not None else get_settings().ip_allowlist_list)
        self._networks: List[ipaddress._BaseNetwork] = []
        self._raw = raw
        for entry in raw:
            try:
                self._networks.append(ipaddress.ip_network(entry.strip(), strict=False))
            except ValueError:
                logger.warning("Ignoring invalid IP_ALLOWLIST entry: %s", entry)

    def _allowed(self, ip: Optional[str]) -> bool:
        if not self._networks:
            return True
        if not ip:
            return False
        try:
            address = ipaddress.ip_address(ip.split("%")[0])
        except ValueError:
            return False
        return any(address in network for network in self._networks)

    async def dispatch(self, request: Request, call_next: Callable):
        if request.url.path in ("/health", "/metrics"):
            return await call_next(request)

        from app.api.deps import client_ip

        if not self._allowed(client_ip(request)):
            logger.warning("Blocked request from non-allowlisted IP %s", client_ip(request))
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"detail": "الوصول من هذه الشبكة غير مسموح"},
            )
        return await call_next(request)


class CSRFMiddleware(BaseHTTPMiddleware):
    """Double-submit cookie CSRF protection.

    Only requests that authenticate with the ``HttpOnly`` refresh cookie (or
    another cookie-based flow listed in ``CSRF_PROTECTED_PATHS``) can be forged
    cross-site — bearer-token requests cannot, and pre-authentication endpoints
    such as ``/api/auth/login`` merely *carry* a stale cookie.  Scope is
    therefore path-based, which keeps Swagger, the agent bus and the SPA's JSON
    calls working while still blocking forged cookie requests.
    """

    async def dispatch(self, request: Request, call_next: Callable):
        settings = get_settings()
        if not settings.CSRF_ENABLED or request.method.upper() in CSRF_SAFE_METHODS:
            return await call_next(request)

        path = request.url.path
        protected = any(path == prefix or path.startswith(prefix) for prefix in settings.csrf_protected_paths)
        if not protected:
            return await call_next(request)

        # Cookie-based flows never send an Authorization header; when a bearer
        # token is present the request is not forgeable by a third-party site.
        if "authorization" in request.headers:
            return await call_next(request)

        cookie_token = request.cookies.get(CSRF_COOKIE_NAME)
        header_token = request.headers.get(CSRF_HEADER_NAME)
        if not csrf_tokens_match(cookie_token, header_token):
            logger.warning("CSRF validation failed for %s %s", request.method, request.url.path)
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"detail": "فشل تحقق CSRF — أعد تحميل الصفحة وحاول مرة أخرى"},
            )
        return await call_next(request)


class MetricsMiddleware(BaseHTTPMiddleware):
    """Prometheus instrumentation (path labels are bucketed to stay bounded)."""

    async def dispatch(self, request: Request, call_next: Callable):
        settings = get_settings()
        if not settings.METRICS_ENABLED or request.url.path == "/metrics":
            return await call_next(request)

        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            HTTP_REQUESTS.labels(method=request.method, path="exception", status="500").inc()
            raise

        duration = time.perf_counter() - started
        path = normalize_path(request.url.path, known=("/api/", "/ws/"))
        HTTP_LATENCY.labels(method=request.method, path=path).observe(duration)
        HTTP_REQUESTS.labels(method=request.method, path=path, status=str(response.status_code)).inc()
        return response
