"""Health, readiness and metrics endpoints for the Control Room itself."""

from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.core.cache import get_cache
from app.core.config import get_settings
from app.core.metrics import metrics_available, render_metrics
from app.core.secrets import get_secret_store
from app.db.bootstrap import schema_report
from app.db.session import check_database_health
from app.platforms.registry import available_providers
from app.services.auth_service import AuthenticatedUser
from app.services.realtime import hub
from app.services.scheduler import scheduler

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Health"])

STARTED_AT = time.time()


@router.get("/health", summary="Liveness probe")
def health() -> Dict[str, Any]:
    """Cheap liveness endpoint (no database access) for load balancers."""
    settings = get_settings()
    return {
        "status": "healthy",
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "environment": settings.ENV,
        "uptime_seconds": round(time.time() - STARTED_AT, 1),
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


@router.get("/health/ready", summary="Readiness probe")
def readiness(db: Session = Depends(get_db)) -> Response:
    """Fails (503) when the database is unreachable — used by Kubernetes/IIS."""
    database = check_database_health()
    payload = {"status": "ready" if database["ok"] else "degraded", "database": database}
    status_code = 200 if database["ok"] else 503
    return Response(
        content=__import__("json").dumps(payload),
        media_type="application/json",
        status_code=status_code,
    )


@router.get("/health/detail", summary="Deep health report")
def health_detail(
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("*")),
) -> Dict[str, Any]:
    """Control Room self-monitoring: database, cache, secrets, agents, scheduler.

    This is the *"who monitors the monitor"* screen: it reports the components
    the platform itself depends on, plus schema drift.
    """
    settings = get_settings()
    database = check_database_health()
    cache = get_cache().health()
    secret_store = get_secret_store().health()

    providers: List[Dict[str, Any]] = []
    try:
        from app.platforms.registry import platform_health

        providers.append(platform_health(principal.tenant_id))
    except Exception as exc:  # pragma: no cover - vendor dependent
        providers.append({"ok": False, "error": str(exc)[:200]})

    return {
        "service": {
            "name": settings.APP_NAME,
            "version": settings.APP_VERSION,
            "environment": settings.ENV,
            "uptime_seconds": round(time.time() - STARTED_AT, 1),
        },
        "database": database,
        "schema": schema_report(),
        "cache": cache,
        "secrets": secret_store,
        "realtime": hub.snapshot(),
        "scheduler": scheduler.status(),
        "platforms": providers,
        "available_providers": available_providers(),
        "security": {
            "mfa_enabled": settings.MFA_ENABLED,
            "csrf_enabled": settings.CSRF_ENABLED,
            "cookie_secure": settings.cookie_secure,
            "ip_allowlist": settings.ip_allowlist_list,
            "access_token_minutes": settings.ACCESS_TOKEN_EXPIRE_MINUTES,
            "refresh_token_days": settings.REFRESH_TOKEN_EXPIRE_DAYS,
            "security_problems": settings.validate_security(),
        },
        "features": {
            "metrics": settings.METRICS_ENABLED and metrics_available(),
            "opentelemetry": settings.OTEL_ENABLED,
            "notifications": settings.NOTIFY_ENABLED,
            "multi_vendor": True,
            "multi_tenant": True,
        },
    }


@router.get("/metrics", summary="Prometheus metrics")
def metrics() -> Response:
    """Prometheus exposition endpoint (disabled by ``METRICS_ENABLED=false``)."""
    settings = get_settings()
    if not settings.METRICS_ENABLED:
        return Response(status_code=404, content="metrics disabled")
    payload, content_type = render_metrics()
    return Response(content=payload, media_type=content_type)
