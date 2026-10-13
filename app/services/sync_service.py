"""Platform synchronisation service.

Pulls telemetry from the tenant's configured RPA platform (UiPath Orchestrator,
Automation Anywhere, …) into the Control Room database so that KPIs, ROI, SLA
and the Capacity Advisor all work from a single normalised model.

Key properties
--------------
* **Idempotent** — runs are matched by ``ProviderRunId`` (unique per tenant) so
  repeated syncs never duplicate history.
* **Incremental** — each sync only asks the vendor for data since the last
  successful sync (watermark stored in ``PlatformSyncLog``).
* **Non-destructive** — the native (``generic_sql``) provider is skipped, since
  its data already *is* the database.
* **Observable** — every sync writes duration, counts and errors, and the
  result is surfaced on the Control Room health page.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.db.repository import fetch_all, fetch_one, insert_row, update_rows
from app.db.session import session_scope
from app.db.tables import BotInfrastructure, PlatformSyncLog, ProcessConfig, ProcessRuns
from app.platforms.base import MachineRecord, ProcessDefinition, RunRecord
from app.platforms.registry import get_adapter_for_tenant

logger = logging.getLogger(__name__)

SYNC_INTERVAL_MINUTES = 3
DEFAULT_LOOKBACK_DAYS = 2


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _last_successful_sync(tenant_id: int, provider: str) -> Optional[datetime]:
    """Watermark: when did we last pull data successfully for this provider?"""
    with session_scope() as session:
        row = fetch_one(
            session,
            """
            SELECT StartedAt FROM PlatformSyncLog
            WHERE TenantID = :t AND Provider = :p AND Status = 'Success'
            ORDER BY StartedAt DESC
            """,
            {"t": tenant_id, "p": provider},
            operation="sync.watermark",
        )
    return row.get("StartedAt") if row else None


def _log_sync(
    tenant_id: int,
    *,
    provider: str,
    operation: str,
    status: str,
    items: int = 0,
    duration_ms: Optional[int] = None,
    error: Optional[str] = None,
) -> None:
    """Record the outcome of a sync operation (never raises)."""
    try:
        with session_scope() as session:
            insert_row(
                session,
                PlatformSyncLog,
                {
                    "TenantID": tenant_id,
                    "Provider": provider[:40],
                    "Operation": operation[:60],
                    "Status": status[:20],
                    "ItemsSynced": int(items),
                    "DurationMs": duration_ms,
                    "Error": (error or "")[:500] or None,
                },
            )
    except Exception as exc:  # pragma: no cover
        logger.error("Failed to log platform sync: %s", exc)


# --------------------------------------------------------------------------- #
# Mapping helpers
# --------------------------------------------------------------------------- #
def upsert_process(session, tenant_id: int, provider: str, definition: ProcessDefinition) -> int:
    """Create/refresh a ProcessConfig row from a vendor process definition."""
    from app.db.repository import insert_row as _insert

    existing = fetch_one(
        session,
        "SELECT ConfigID, PlatformProcessKey FROM ProcessConfig WHERE TenantID = :t AND ProcessName = :p",
        {"t": tenant_id, "p": definition.name[:100]},
        operation="sync.process_lookup",
    )
    if existing:
        update_rows(
            session,
            ProcessConfig,
            {
                "Provider": provider[:40],
                "PlatformProcessKey": definition.key[:200],
                "IsActive": definition.is_active,
                "UpdatedAt": _now(),
            },
            [ProcessConfig.c.ConfigID == int(existing["ConfigID"])],
        )
        return int(existing["ConfigID"])

    return int(
        _insert(
            session,
            ProcessConfig,
            {
                "TenantID": tenant_id,
                "ProcessName": definition.name[:100],
                "Department": (definition.department or "Operations")[:50],
                "Provider": provider[:40],
                "PlatformProcessKey": definition.key[:200],
                "IsActive": definition.is_active,
                "ExpectedRunsPerDay": 0,
                "SLATargetMinutes": 0,
                "Criticality": "Medium",
                "Notes": definition.description,
            },
        )
    )


def upsert_run(session, tenant_id: int, provider: str, process_name: str, run: RunRecord) -> bool:
    """Insert a vendor run once (matched by ``ProviderRunId``)."""
    existing = fetch_one(
        session,
        """
        SELECT RunID FROM ProcessRuns
        WHERE TenantID = :t AND Provider = :p AND ProviderRunId = :pid
        """,
        {"t": tenant_id, "p": provider, "pid": str(run.external_id)[:200]},
        operation="sync.run_lookup",
    )
    if existing:
        # Refresh status/duration for runs that were still executing
        update_rows(
            session,
            ProcessRuns,
            {
                "Status": run.status.value,
                "EndTime": run.finished_at,
                "DurationMinutes": run.computed_duration(),
                "TransactionsCount": run.transactions_count,
                "FailureReason": run.failure_reason,
                "UpdatedAt": _now(),
            },
            [ProcessRuns.c.RunID == int(existing["RunID"])],
        )
        return False

    cost_model = _cost_model(session, tenant_id, process_name)
    transactions = int(run.transactions_count or 0)
    is_success = run.status.value == "Completed"
    time_saved = round(transactions * cost_model["emp_minutes"] / 60.0, 2) if is_success else 0.0
    cost_saved = round(transactions * (cost_model["emp_cost"] - cost_model["bot_cost"]), 2) if is_success else 0.0
    insert_row(
        session,
        ProcessRuns,
        {
            "TenantID": tenant_id,
            "ProcessName": process_name[:100],
            "RequestID": (run.external_id or "")[:100],
            "Status": run.status.value,
            "StartTime": run.started_at or _now(),
            "EndTime": run.finished_at,
            "DurationMinutes": run.computed_duration(),
            "TransactionsCount": transactions,
            "SuccessCount": int(run.success_count or transactions),
            "FailedCount": int(run.failed_count or 0),
            "FailureReason": (run.failure_reason or "")[:500] or None,
            "TimeSavedHours": time_saved,
            "CostSaved": cost_saved,
            "MachineName": (run.machine_name or "")[:100] or None,
            "RobotName": (run.robot_name or "")[:100] or None,
            "Provider": provider[:40],
            "ProviderRunId": str(run.external_id)[:200],
            "ExitCode": run.exit_code,
            "Trigger": "platform_sync",
            "IdempotencyKey": f"{provider}:{run.external_id}"[:120],
        },
    )
    return True


def _cost_model(session, tenant_id: int, process_name: str) -> Dict[str, float]:
    """Load the ROI parameters used to price synced runs (server-side maths)."""
    row = fetch_one(
        session,
        """
        SELECT EmpMinutesPerRequest, EmpCostPerRequest, BotCostPerRequest
        FROM ProcessConfig WHERE TenantID = :t AND ProcessName = :p
        """,
        {"t": tenant_id, "p": process_name},
        operation="sync.cost_model",
    ) or {}

    def _f(value: Any, default: float) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    return {
        "emp_minutes": _f(row.get("EmpMinutesPerRequest"), 15.0),
        "emp_cost": _f(row.get("EmpCostPerRequest"), 10.0),
        "bot_cost": _f(row.get("BotCostPerRequest"), 0.5),
    }


def upsert_machine(session, tenant_id: int, provider: str, machine: MachineRecord) -> bool:
    """Create/refresh a runner record from vendor telemetry."""
    existing = fetch_one(
        session,
        "SELECT MachineID FROM BotInfrastructure WHERE TenantID = :t AND MachineName = :m",
        {"t": tenant_id, "m": machine.name[:100]},
        operation="sync.machine_lookup",
    )
    values = {
        "Status": machine.status,
        "CPU_Usage": machine.cpu_usage,
        "RAM_Usage": machine.ram_usage,
        "HDD_Usage": machine.hdd_usage,
        "TotalRAM_GB": machine.total_ram_gb,
        "TotalHDD_GB": machine.total_hdd_gb,
        "RunnerType": machine.runner_type,
        "Platform": provider[:40],
        "RobotCapacity": machine.robot_capacity,
        "LastPing": machine.last_ping or _now(),
        "OSName": (machine.os_name or "")[:64] or None,
        "AgentVersion": (machine.agent_version or "")[:40] or None,
        "LastIP": (machine.ip_address or "")[:64] or None,
        "UpdatedAt": _now(),
    }
    if existing:
        update_rows(session, BotInfrastructure, values, [BotInfrastructure.c.MachineID == int(existing["MachineID"])])
        return False
    insert_row(session, BotInfrastructure, {"TenantID": tenant_id, "MachineName": machine.name[:100], **values})
    return True


# --------------------------------------------------------------------------- #
# Sync orchestration
# --------------------------------------------------------------------------- #
def sync_tenant(tenant_id: int, *, lookback_days: int = DEFAULT_LOOKBACK_DAYS, force: bool = False) -> Dict[str, Any]:
    """Synchronise one tenant from its configured platform."""
    adapter = get_adapter_for_tenant(tenant_id)
    provider = adapter.name

    if provider == "generic_sql":
        return {"ok": True, "provider": provider, "skipped": "native provider — data already local"}

    started = _now()
    watermark = _last_successful_sync(tenant_id, provider)
    since = watermark - timedelta(minutes=5) if watermark and not force else _now() - timedelta(days=lookback_days)

    summary: Dict[str, Any] = {"ok": True, "provider": provider, "since": since.isoformat(), "processes": 0, "runs_created": 0, "machines_created": 0}

    # 1) Processes
    try:
        processes = adapter.get_processes()
        with session_scope() as session:
            for definition in processes:
                upsert_process(session, tenant_id, provider, definition)
        summary["processes"] = len(processes)
        _log_sync(tenant_id, provider=provider, operation="processes", status="Success", items=len(processes))
    except Exception as exc:
        summary["ok"] = False
        summary["process_error"] = str(exc)[:200]
        _log_sync(tenant_id, provider=provider, operation="processes", status="Failed", error=str(exc))

    # 2) Runs (incremental)
    try:
        runs = adapter.get_runs(since=since, limit=500)
        created = 0
        with session_scope() as session:
            for run in runs:
                process_name = _resolve_process_name(session, tenant_id, run.process_key)
                if process_name and upsert_run(session, tenant_id, provider, process_name, run):
                    created += 1
        summary["runs_created"] = created
        summary["runs_seen"] = len(runs)
        _log_sync(tenant_id, provider=provider, operation="runs", status="Success", items=created)
    except Exception as exc:
        summary["ok"] = False
        summary["runs_error"] = str(exc)[:200]
        _log_sync(tenant_id, provider=provider, operation="runs", status="Failed", error=str(exc))

    # 3) Machines
    try:
        machines = adapter.get_machines()
        created = 0
        with session_scope() as session:
            for machine in machines:
                if upsert_machine(session, tenant_id, provider, machine):
                    created += 1
        summary["machines_created"] = created
        summary["machines_seen"] = len(machines)
        _log_sync(tenant_id, provider=provider, operation="machines", status="Success", items=created)
    except Exception as exc:
        summary["ok"] = False
        summary["machines_error"] = str(exc)[:200]
        _log_sync(tenant_id, provider=provider, operation="machines", status="Failed", error=str(exc))

    # 4) Queues
    try:
        from app.services.sla_service import update_queue_telemetry

        queues = adapter.get_queue_stats()
        with session_scope() as session:
            for stats in queues:
                process_name = _resolve_process_name(session, tenant_id, stats.process_key)
                if not process_name:
                    continue
                update_queue_telemetry(
                    session,
                    tenant_id=tenant_id,
                    process_name=process_name,
                    pending_items=stats.pending,
                    active_items=stats.active,
                    avg_item_processing_seconds=int(stats.avg_processing_seconds or 30),
                )
        summary["queues_synced"] = len(queues)
        _log_sync(tenant_id, provider=provider, operation="queues", status="Success", items=len(queues))
    except Exception as exc:
        summary["ok"] = False
        summary["queues_error"] = str(exc)[:200]
        _log_sync(tenant_id, provider=provider, operation="queues", status="Failed", error=str(exc))

    summary["duration_ms"] = int((_now() - started).total_seconds() * 1000)
    logger.info("Platform sync finished for tenant %s: %s", tenant_id, summary)
    return summary


def _resolve_process_name(session, tenant_id: int, process_key: str) -> Optional[str]:
    """Map a vendor process key to the local ``ProcessName`` (identity first)."""
    row = fetch_one(
        session,
        """
        SELECT ProcessName FROM ProcessConfig
        WHERE TenantID = :t AND (PlatformProcessKey = :k OR ProcessName = :k)
        """,
        {"t": tenant_id, "k": str(process_key)[:200]},
        operation="sync.resolve_process",
    )
    return row.get("ProcessName") if row else None


def sync_history(tenant_id: int, limit: int = 20) -> List[Dict[str, Any]]:
    """Recent sync operations (health page / diagnostics)."""
    from app.db.dialect import get_flavor

    flavor = get_flavor()
    with session_scope() as session:
        return fetch_all(
            session,
            f"""
            SELECT {flavor.top(int(limit))} SyncID, Provider, Operation, Status, ItemsSynced, DurationMs, Error, StartedAt
            FROM PlatformSyncLog
            WHERE TenantID = :t
            ORDER BY StartedAt DESC{flavor.limit(int(limit))}
            """,
            {"t": tenant_id},
            operation="sync.history",
        )
