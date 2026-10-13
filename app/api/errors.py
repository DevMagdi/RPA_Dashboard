"""Uniform error handling.

Every failure leaves the API in the same envelope so the frontend can render a
consistent experience — and so no internal detail (SQL, stack traces, vendor
messages) ever leaks to a browser::

    {"error": {"code": "not_found", "message": "…", "request_id": "…"}}

Handled cases: domain errors, validation errors, auth failures, rate limiting,
database/repository failures and truly unexpected exceptions.
"""

from __future__ import annotations

import logging
from typing import Any, Dict

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.core.logging import get_correlation_id
from app.db.repository import RepositoryError
from app.platforms.base import PlatformAdapter
from app.platforms.http_base import PlatformAuthError, PlatformUnavailable
from app.services.auth_service import AuthError
from app.services.capacity_service import SEVERITY_CRITICAL
from app.services.token_service import TokenError

logger = logging.getLogger(__name__)


def _envelope(code: str, message: str, *, request: Request | None = None, details: Any = None) -> Dict[str, Any]:
    """Build the standard error payload."""
    payload: Dict[str, Any] = {
        "error": {
            "code": code,
            "message": message,
            "request_id": get_correlation_id(),
        }
    }
    if request is not None:
        payload["error"]["path"] = request.url.path
    if details is not None:
        payload["error"]["details"] = details
    return payload


def register_exception_handlers(app: FastAPI) -> None:
    """Attach every handler to the application (called from the factory)."""

    @app.exception_handler(AuthError)
    async def _auth_error(request: Request, exc: AuthError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(exc.code, str(exc), request=request),
        )

    @app.exception_handler(TokenError)
    async def _token_error(request: Request, exc: TokenError) -> JSONResponse:
        # Defense in depth: any token-validation path that escapes the
        # service-layer translation is still a 401, never a 500.  The
        # internal reason (unknown / expired / reused) is not leaked.
        logger.warning("Invalid refresh token on %s: %s", request.url.path, exc)
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content=_envelope("refresh_invalid", "الجلسة منتهية، برجاء تسجيل الدخول من جديد", request=request),
        )

    @app.exception_handler(HTTPException)
    async def _http_error(request: Request, exc: HTTPException) -> JSONResponse:
        code = {
            status.HTTP_401_UNAUTHORIZED: "unauthorized",
            status.HTTP_403_FORBIDDEN: "forbidden",
            status.HTTP_404_NOT_FOUND: "not_found",
            status.HTTP_409_CONFLICT: "conflict",
            status.HTTP_429_TOO_MANY_REQUESTS: "rate_limited",
        }.get(exc.status_code, "http_error")
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(code, str(exc.detail), request=request),
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        problems = [
            {
                "field": ".".join(str(part) for part in error.get("loc", []) if part not in ("body", "query")),
                "message": error.get("msg"),
            }
            for error in exc.errors()[:20]
        ]
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=_envelope("validation_error", "البيانات المُرسلة غير صحيحة", request=request, details=problems),
        )

    @app.exception_handler(IntegrityError)
    async def _integrity_error(request: Request, exc: IntegrityError) -> JSONResponse:
        logger.warning("Integrity error on %s: %s", request.url.path, exc)
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content=_envelope(
                "conflict",
                "هذه العملية تتعارض مع بيانات موجودة (سجل مكرر أو ارتباط غير صالح)",
                request=request,
            ),
        )

    @app.exception_handler(RepositoryError)
    async def _repository_error(request: Request, exc: RepositoryError) -> JSONResponse:
        logger.error("Repository failure on %s: %s", request.url.path, exc)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=_envelope("database_error", "حدث خطأ في قاعدة البيانات، برجاء المحاولة لاحقاً", request=request),
        )

    @app.exception_handler(SQLAlchemyError)
    async def _sqlalchemy_error(request: Request, exc: SQLAlchemyError) -> JSONResponse:
        logger.error("Database error on %s: %s", request.url.path, exc)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=_envelope("database_error", "حدث خطأ في قاعدة البيانات، برجاء المحاولة لاحقاً", request=request),
        )

    @app.exception_handler(PlatformAuthError)
    async def _platform_auth_error(request: Request, exc: PlatformAuthError) -> JSONResponse:
        logger.error("Platform credentials rejected: %s", exc)
        return JSONResponse(
            status_code=status.HTTP_502_BAD_GATEWAY,
            content=_envelope(
                "platform_auth_error",
                "فشل الاتصال بمنصة الأتمتة: بيانات الاعتماد مرفوضة (راجع إعدادات المزوّد)",
                request=request,
            ),
        )

    @app.exception_handler(PlatformUnavailable)
    async def _platform_unavailable(request: Request, exc: PlatformUnavailable) -> JSONResponse:
        logger.error("Platform unavailable: %s", exc)
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content=_envelope(
                "platform_unavailable", "منصة الأتمتة غير متاحة حالياً، برجاء المحاولة لاحقاً", request=request
            ),
        )

    @app.exception_handler(NotImplementedError)
    async def _unsupported(request: Request, exc: NotImplementedError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            content=_envelope("not_supported", str(exc) or "هذه العملية غير مدعومة للمزوّد الحالي", request=request),
        )

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=_envelope("internal_error", "حدث خطأ غير متوقع، تم تسجيل التفاصيل للفريق الفني", request=request),
        )


__all__ = ["register_exception_handlers", "SEVERITY_CRITICAL", "PlatformAdapter"]
