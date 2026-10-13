"""Prometheus metrics for the Control Room.

Exposed on ``GET /metrics`` (guarded by ``METRICS_ENABLED``).  The metric set is
deliberately small but covers the SLOs owned by the platform:

* ``rpa_http_requests_total`` / ``rpa_http_request_duration_seconds`` (p95 < 200 ms)
* ``rpa_dashboard_build_seconds`` (dashboard payload build < 1.5 s)
* ``rpa_agent_connected`` — live gauge of connected runner agents
* ``rpa_recommendations_total`` — capacity recommendations by severity
* ``rpa_notifications_total`` — outbound notifications by channel/status
"""

from __future__ import annotations

from typing import Iterable, Optional

try:  # pragma: no cover - prometheus_client is optional at runtime
    from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest

    _AVAILABLE = True
except Exception:  # pragma: no cover
    _AVAILABLE = False
    CONTENT_TYPE_LATEST = "text/plain"

    class _Noop:  # minimal fallback so imports never fail
        def __init__(self, *a, **k) -> None:
            pass

        def labels(self, *a, **k) -> "_Noop":
            return self

        def inc(self, *a, **k) -> None:
            pass

        def dec(self, *a, **k) -> None:
            pass

        def set(self, *a, **k) -> None:
            pass

        def observe(self, *a, **k) -> None:
            pass

        def time(self):  # pragma: no cover
            import contextlib

            return contextlib.nullcontext()

    Counter = Gauge = Histogram = _Noop  # type: ignore[misc,assignment]

    def generate_latest(*_a, **_k) -> bytes:  # type: ignore[misc]
        return b"# prometheus_client not installed\n"


HTTP_REQUESTS = Counter(
    "rpa_http_requests_total",
    "Total HTTP requests processed",
    ["method", "path", "status"],
)
HTTP_LATENCY = Histogram(
    "rpa_http_request_duration_seconds",
    "HTTP request latency",
    ["method", "path"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1.0, 2.0, 5.0),
)
DASHBOARD_BUILD = Histogram(
    "rpa_dashboard_build_seconds",
    "Time to build the dashboard payload",
    buckets=(0.05, 0.1, 0.25, 0.5, 0.75, 1.0, 1.5, 3.0),
)
AGENTS_CONNECTED = Gauge("rpa_agent_connected", "Currently connected runner agents")
RUNS_INGESTED = Counter("rpa_runs_ingested_total", "Bot run lifecycle events ingested", ["event", "status"])
RECOMMENDATIONS = Counter("rpa_recommendations_total", "Capacity recommendations generated", ["severity", "kind"])
NOTIFICATIONS = Counter("rpa_notifications_total", "Notifications dispatched", ["channel", "status"])
AUTH_EVENTS = Counter("rpa_auth_events_total", "Authentication events", ["event", "result"])
DB_QUERY_LATENCY = Histogram(
    "rpa_db_query_seconds",
    "Database query latency",
    ["operation"],
    buckets=(0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0),
)


def metrics_available() -> bool:
    """True when prometheus_client is importable."""
    return _AVAILABLE


def render_metrics() -> tuple[bytes, str]:
    """Return ``(payload, content_type)`` for the ``/metrics`` endpoint."""
    return generate_latest(), CONTENT_TYPE_LATEST


def track_agent_count(delta: int = 0, absolute: Optional[int] = None) -> None:
    """Update the connected-agent gauge."""
    if absolute is not None:
        AGENTS_CONNECTED.set(absolute)
    elif delta:
        AGENTS_CONNECTED.inc(delta) if delta > 0 else AGENTS_CONNECTED.dec(abs(delta))


def normalize_path(path: str, known: Iterable[str] = ()) -> str:
    """Bucket dynamic path segments to keep label cardinality bounded."""
    for candidate in known:
        if path.startswith(candidate):
            return candidate
    parts = [p for p in path.split("/") if p]
    if len(parts) >= 2:
        return "/" + "/".join(parts[:2]) + ("/…" if len(parts) > 2 else "")
    return path or "/"
