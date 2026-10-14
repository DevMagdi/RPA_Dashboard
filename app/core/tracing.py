"""Optional OpenTelemetry tracing (distributed tracing across API ↔ agents).

Tracing is strictly opt-in (``OTEL_ENABLED=true``) and fails soft: the sandbox,
an air-gapped bank cluster without a collector, or an installation that simply
did not install the OTel packages all keep working — they just produce no spans.
"""

from __future__ import annotations

import logging
from importlib.util import find_spec
from typing import Any, Optional

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_configured = False


def tracing_available() -> bool:
    """Return ``True`` when the OpenTelemetry API packages are importable."""
    try:
        return find_spec("opentelemetry") is not None and find_spec("opentelemetry.trace") is not None
    except (ImportError, ModuleNotFoundError, ValueError):
        return False


def configure_tracing(app: Optional[Any] = None) -> bool:
    """Instrument FastAPI (+ SQLAlchemy when present) with OTLP exporters.

    Returns ``True`` when instrumentation was installed.  Never raises.
    """
    global _configured

    settings = get_settings()
    if not settings.OTEL_ENABLED:
        return False
    if _configured:
        return True

    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except Exception as exc:  # pragma: no cover - optional dependency
        logger.warning("OTEL_ENABLED=true but the OpenTelemetry SDK is missing (%s)", exc)
        return False

    resource = Resource.create(
        {
            "service.name": settings.OTEL_SERVICE_NAME,
            "service.version": settings.APP_VERSION,
            "deployment.environment": settings.ENV,
        }
    )
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{settings.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces"))
    )
    trace.set_tracer_provider(provider)

    if app is not None:
        try:
            from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

            FastAPIInstrumentor.instrument_app(app, excluded_urls="health,health/ready,metrics")
        except Exception as exc:  # pragma: no cover
            logger.warning("FastAPI auto-instrumentation unavailable: %s", exc)

    try:
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

        from app.db.session import get_engine

        SQLAlchemyInstrumentor().instrument(engine=get_engine())
    except Exception as exc:  # pragma: no cover
        logger.debug("SQLAlchemy instrumentation unavailable: %s", exc)

    _configured = True
    logger.info("OpenTelemetry tracing enabled → %s", settings.OTEL_EXPORTER_OTLP_ENDPOINT)
    return True


def current_trace_id() -> Optional[str]:
    """Return the active trace id (used to correlate logs with traces)."""
    try:
        from opentelemetry import trace

        span = trace.get_current_span()
        ctx = span.get_span_context() if span else None
        if ctx and ctx.is_valid:
            return format(ctx.trace_id, "032x")
    except Exception:  # pragma: no cover - tracing disabled
        return None
    return None
