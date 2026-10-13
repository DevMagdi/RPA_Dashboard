"""FastAPI composition root — the RPA CoE Control Room API.

Start-up sequence
-----------------
1. ``bootstrap_logging_and_validate()`` configures structured JSON logging and
   refuses to boot a *production* process with insecure configuration.
2. The database schema is created (idempotently) when ``DB_AUTO_BOOTSTRAP``.
3. The background scheduler starts (platform sync, capacity advisor, stale-run
   reaper, retention purge, realtime tick).
4. The Redis realtime bridge starts so multi-worker deployments fan events out
   across processes.

Middleware order (outermost → innermost)
---------------------------------------
``Correlation-ID → TrustedHost → CORS → IP-allowlist → Security headers →
CSRF → Metrics``

The order matters and is deliberate: correlation ids must exist before anything
logs, host/origin validation must happen before authentication work, and the
security headers must still be applied to responses produced by the CSRF and
metrics layers.  Compression is intentionally **not** enabled here (it breaks
SSE streaming and hides timing signals); terminate TLS + gzip at the reverse
proxy (IIS/NGINX) as documented in ``docs/DEPLOYMENT_ON_PREM.md``.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.api import register_routers
from app.api.errors import register_exception_handlers
from app.api.middleware import (
    CorrelationIdMiddleware,
    CSRFMiddleware,
    IPAllowlistMiddleware,
    MetricsMiddleware,
    SecurityHeadersMiddleware,
)
from app.core.config import bootstrap_logging_and_validate, get_settings
from app.core.tracing import configure_tracing
from app.db.bootstrap import bootstrap_database
from app.services.realtime import hub, start_redis_bridge, stop_redis_bridge
from app.services.scheduler import scheduler

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[1]


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Boot and shutdown hooks (database, scheduler, realtime bridge)."""
    settings = get_settings()
    logger.info(
        "Starting %s v%s (env=%s, dialect=%s, version=%s)",
        settings.APP_NAME,
        settings.APP_VERSION,
        settings.ENV,
        settings.DB_DIALECT,
        __version__,
    )

    if settings.DB_AUTO_BOOTSTRAP:
        try:
            summary = bootstrap_database(create_demo=settings.DB_SEED_DEMO or settings.is_test)
            logger.info("Database ready: %s", summary)
        except Exception as exc:  # pragma: no cover - surfaced to the operator
            logger.error("Database bootstrap failed: %s", exc, exc_info=True)
            if settings.is_prod:
                raise
    else:
        logger.info("DB_AUTO_BOOTSTRAP=false — assuming a DBA-managed schema (run Alembic migrations)")

    if settings.SCHEDULER_ENABLED:
        try:
            await scheduler.start()
        except Exception as exc:  # pragma: no cover - never block the API
            logger.error("Scheduler failed to start: %s", exc, exc_info=True)

    if settings.REALTIME_ENABLED:
        start_redis_bridge()
    else:
        logger.info("Realtime publishing disabled (REALTIME_ENABLED=false)")

    yield

    logger.info("Shutting down %s", settings.APP_NAME)
    try:
        await scheduler.stop()
    except Exception:  # pragma: no cover
        logger.debug("Scheduler shutdown error", exc_info=True)
    stop_redis_bridge()
    await hub.close_all()


def _mount_frontend(app: FastAPI) -> None:
    """Serve the Vite build from the same process (single-container deployments)."""
    settings = get_settings()
    if not settings.SERVE_FRONTEND:
        logger.info("Serving API only (SERVE_FRONTEND=false)")
        return

    dist = Path(settings.FRONTEND_DIST)
    if not dist.is_absolute():
        dist = REPO_ROOT / dist

    if not dist.exists():
        logger.info("Frontend build not found at %s — API-only mode (run `npm run build` in rpa-dashboard/)", dist)
        return

    assets = dist / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=str(assets)), name="assets")

    index_file = dist / "index.html"
    if not index_file.exists():  # pragma: no cover - mis-built artefact
        logger.warning("No index.html in %s — static hosting disabled", dist)
        return

    @app.get("/", include_in_schema=False)
    async def spa_root() -> FileResponse:
        """Serve the SPA shell for the dashboard."""
        return FileResponse(str(index_file))

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str, request: Request) -> Response:
        """Serve static files, falling back to the SPA shell for client routes.

        Unknown ``/api`` paths must stay 404 JSON so the client's error handling
        is not confused by an HTML payload.
        """
        if full_path.startswith(("api/", "ws/", "health", "metrics")):
            return JSONResponse(
                status_code=404,
                content={"error": {"code": "not_found", "message": "المسار غير موجود", "path": request.url.path}},
            )
        candidate = (dist / full_path).resolve()
        if dist.resolve() in candidate.parents and candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(index_file))


def create_app() -> FastAPI:
    """Application factory (used by uvicorn ``--factory`` and the test-suite)."""
    settings = get_settings()
    bootstrap_logging_and_validate()

    docs_enabled = (not settings.is_prod) or settings.EXPOSE_DOCS
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        description=(
            "Multi-tenant, multi-vendor Intelligent Automation Control Room. "
            "Vendor-neutral API over UiPath Orchestrator, Automation Anywhere A360, "
            "Blue Prism and in-house SQL-based RPA estates."
        ),
        lifespan=lifespan,
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
        contact={"name": "RPA CoE Platform Team"},
        license_info={"name": "Proprietary — bank-internal use"},
    )

    # --- middleware (added innermost first: the last added ends up outermost) ---
    app.add_middleware(MetricsMiddleware)
    app.add_middleware(CSRFMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(IPAllowlistMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "X-CSRF-Token",
            "X-Tenant-Key",
            "X-Correlation-ID",
            "X-Agent-Token",
        ],
        expose_headers=["X-Correlation-ID", "X-Response-Time-ms", "Content-Disposition"],
        max_age=600,
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts_list)
    app.add_middleware(CorrelationIdMiddleware)

    register_exception_handlers(app)
    register_routers(app)

    @app.get("/api/version", tags=["Health"], summary="API version + feature flags")
    async def api_version() -> dict:
        """Machine-readable capability discovery (used by the SPA on boot)."""
        return {
            "name": settings.APP_NAME,
            "version": settings.APP_VERSION,
            "api_version": "3.0.0",
            "environment": settings.ENV,
            "features": {
                "mfa": settings.MFA_ENABLED,
                "multi_tenant": True,
                "multi_vendor": True,
                "capacity_advisor": True,
                "realtime": settings.REALTIME_ENABLED,
                "exports": True,
                "notifications": settings.NOTIFY_ENABLED,
                "lifecycle_governance": True,
                "metrics": settings.METRICS_ENABLED,
            },
            "providers": settings.DB_DIALECT,
        }

    configure_tracing(app)
    _mount_frontend(app)
    return app


app = create_app()


if __name__ == "__main__":  # pragma: no cover - developer convenience
    import uvicorn

    _settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=int(__import__("os").environ.get("PORT", "8000")),
        reload=not _settings.is_prod,
        log_config=None,
    )
