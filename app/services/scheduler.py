"""Background maintenance tasks (in-process scheduler).

A Control Room must keep working without an external cron: this module runs the
platform's periodic duties on a single asyncio task started by the FastAPI
lifespan.

Jobs
----
======================  =========  ==================================================
Job                     Interval   Purpose
======================  =========  ==================================================
capacity refresh        5 min      recompute the Capacity Advisor + notify on critical
realtime tick           10 s       push a KPI snapshot to dashboard subscribers
stale runs reaper       15 min     close ``Running`` rows abandoned by crashed agents
command timeout sweep   1 min      mark unacknowledged runner commands as ``Timeout``
retention purge         24 h       enforce the organization data-retention policy
session housekeeping    6 h        purge expired refresh tokens
platform sync           config     pull telemetry from UiPath / Automation Anywhere
======================  =========  ==================================================

Every job is wrapped so one failure can never kill the scheduler, and each run
is logged with its duration.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from datetime import datetime
from typing import Any, Callable, Dict, List

from app.core.config import get_settings
from app.db.repository import fetch_all
from app.db.session import session_scope
from app.services import notification_service
from app.services.capacity_service import generate_recommendations
from app.services.dashboard_service import build_dashboard_payload
from app.services.infra_service import timeout_stale_commands
from app.services.realtime import hub
from app.services.run_service import reap_stale_runs
from app.services.organization_service import purge_organization_data

logger = logging.getLogger(__name__)


class Scheduler:
    """Tiny cooperative scheduler (no external dependencies)."""

    def __init__(self) -> None:
        self._tasks: List[asyncio.Task] = []
        self._running = False
        self._last_runs: Dict[str, Dict[str, Any]] = {}

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #
    async def start(self) -> None:
        """Start every background loop."""
        if self._running:
            return
        self._running = True
        settings = get_settings()

        self._tasks = [
            asyncio.create_task(self._loop("realtime_tick", settings.REALTIME_TICK_SECONDS, self._realtime_tick)),
            asyncio.create_task(
                self._loop("capacity_refresh", settings.SCHEDULER_CAPACITY_MINUTES * 60, self._capacity_refresh)
            ),
            asyncio.create_task(self._loop("stale_runs_reaper", settings.SCHEDULER_REAPER_MINUTES * 60, self._reap_runs)),
            asyncio.create_task(self._loop("command_timeouts", 60, self._sweep_commands)),
            asyncio.create_task(self._loop("session_housekeeping", 21600, self._housekeeping)),
            asyncio.create_task(self._loop("retention_purge", 86400, self._retention)),
        ]
        if settings.DB_DIALECT != "sqlite" and not settings.is_test:  # platform sync is pointless in tests
            self._tasks.append(
                asyncio.create_task(self._loop("platform_sync", settings.SCHEDULER_SYNC_MINUTES * 60, self._platform_sync))
            )
        logger.info("Scheduler started with %s jobs", len(self._tasks))

    async def stop(self) -> None:
        """Cancel every loop (shutdown)."""
        self._running = False
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        self._tasks.clear()
        logger.info("Scheduler stopped")

    # ------------------------------------------------------------------ #
    # Runner
    # ------------------------------------------------------------------ #
    async def _loop(self, name: str, interval: int, job: Callable[[], Any]) -> None:
        """Run ``job`` every ``interval`` seconds, swallowing failures."""
        await asyncio.sleep(3)  # let the app finish starting
        while self._running:
            started = time.perf_counter()
            try:
                result = job()
                if asyncio.iscoroutine(result):
                    result = await result
                self._last_runs[name] = {
                    "last_run": datetime.utcnow().isoformat() + "Z",
                    "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                    "result": result if isinstance(result, (int, float, str, dict, list, type(None))) else str(result),
                }
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # pragma: no cover - resilience by design
                logger.error("Scheduler job %s failed: %s", name, exc, exc_info=True)
                self._last_runs[name] = {
                    "last_run": datetime.utcnow().isoformat() + "Z",
                    "error": str(exc)[:300],
                }
            await asyncio.sleep(max(5, interval))

    def status(self) -> Dict[str, Any]:
        """Scheduler state for the health page."""
        return {
            "running": self._running,
            "jobs": len(self._tasks),
            "last_runs": self._last_runs,
        }

    # ------------------------------------------------------------------ #
    # Jobs
    # ------------------------------------------------------------------ #
    async def _realtime_tick(self) -> Dict[str, Any]:
        """Push a light KPI snapshot to every connected dashboard."""
        if hub.subscriber_count() == 0:
            return {"skipped": "no subscribers"}
        try:
            with session_scope() as session:
                payload = build_dashboard_payload(session, department_scope="ALL", days=30, include_capacity=False)
            delivered = await hub.publish(
                "kpi_update",
                {
                    "kpis": payload.get("kpis", {}),
                    "sidebarStats": payload.get("sidebarStats", {}),
                    "meta": payload.get("meta", {}),
                },
            )
            return {"delivered": delivered}
        except Exception as exc:  # pragma: no cover
            logger.debug("Realtime tick failed: %s", exc)
            return {"delivered": 0}

    async def _capacity_refresh(self) -> Dict[str, Any]:
        """Recompute the Capacity Advisor and push critical insights out."""
        settings = get_settings()
        try:
            with session_scope() as session:
                recommendations = generate_recommendations(session, persist=True)
                if settings.NOTIFY_ENABLED:
                    to_send = [
                        {
                            "id": getattr(r, "recommendation_id", None),
                            "severity": r.severity,
                            "title": r.title,
                            "detail": r.detail,
                        }
                        for r in recommendations
                        if r.severity == "Critical"
                    ]
                    notification_service.notify_capacity_recommendations(session, recommendations=to_send)
            await hub.publish(
                "capacity_update",
                {
                    "critical": len([r for r in recommendations if r.severity == "Critical"]),
                    "warning": len([r for r in recommendations if r.severity == "Warning"]),
                    "generated": len(recommendations),
                },
            )
            # Alerting engine evaluation (agent offline / SLA / failure rules)
            try:
                from app.services.alert_service import evaluate_alerts

                with session_scope() as session:
                    alerts = evaluate_alerts(session)
            except Exception as exc:  # pragma: no cover
                logger.error("Alert evaluation failed: %s", exc)
                alerts = []
            return {"generated": len(recommendations), "alerts": len(alerts)}
        except Exception as exc:  # pragma: no cover
            logger.error("Capacity refresh failed: %s", exc)
            return {"generated": 0}

    def _reap_runs(self) -> Dict[str, int]:
        """Close abandoned Running rows."""
        try:
            with session_scope() as session:
                return {"reaped": reap_stale_runs(session)}
        except Exception as exc:  # pragma: no cover
            logger.error("Run reaper failed: %s", exc)
            return {"reaped": 0}

    def _sweep_commands(self) -> Dict[str, int]:
        """Timeout commands that were never acknowledged."""
        try:
            with session_scope() as session:
                return {"swept": timeout_stale_commands(session)}
        except Exception as exc:  # pragma: no cover
            logger.error("Command sweep failed: %s", exc)
            return {"swept": 0}

    def _housekeeping(self) -> Dict[str, int]:
        """Purge expired refresh tokens."""
        from app.services import token_service

        purged: Dict[str, int] = {}
        try:
            with session_scope() as session:
                purged["refresh_tokens"] = token_service.purge_expired(session, older_than_days=30)
        except Exception as exc:  # pragma: no cover
            logger.error("Session housekeeping failed: %s", exc)
        return purged

    def _retention(self) -> Dict[str, Any]:
        """Enforce the organization data-retention policy."""
        try:
            with session_scope() as session:
                row = fetch_all(
                    session,
                    "SELECT COALESCE(DataRetentionDays, 730) AS days FROM Organization WHERE IsActive = 1",
                    operation="scheduler.organization",
                )
                days = int(row[0]["days"]) if row else 730
                return purge_organization_data(session, retention_days=days)
        except Exception as exc:  # pragma: no cover
            logger.error("Retention job failed: %s", exc)
            return {}

    async def _platform_sync(self) -> Dict[str, Any]:
        """Pull telemetry from the configured RPA platform (UiPath / AA / Blue Prism)."""
        from app.services.sync_service import sync_organization

        try:
            return await asyncio.to_thread(sync_organization)
        except Exception as exc:  # pragma: no cover - vendor dependent
            logger.warning("Platform sync failed: %s", exc)
            return {"ok": False, "error": str(exc)[:200]}


scheduler = Scheduler()
