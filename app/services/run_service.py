"""Bot run ingestion & query service.

This service closes the loop that the original platform was missing: **writing**
run telemetry.  Bots (or vendor synchronisers) report lifecycle events through
idempotent endpoints and every KPI/ROI/SLA number is then derived from real
executions instead of manual SQL.

Lifecycle
---------
``POST /api/runs/start``     → create a ``Running`` row (idempotent per key)
``POST /api/runs/{id}/complete`` → finalise status, duration, transactions, savings
``POST /api/runs/{id}/progress`` → live transaction counter (long running jobs)

Financials are computed **server side** from ``ProcessConfig`` so bots cannot
inflate savings, and every transition is auditable.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.metrics import RUNS_INGESTED
from app.db.dialect import get_flavor
from app.db.repository import fetch_all, fetch_one, insert_row, update_rows
from app.db.tables import  ProcessRuns

logger = logging.getLogger(__name__)

VALID_STATUSES = {"Running", "Completed", "Failed", "Stopped", "Suspended", "Pending"}
TERMINAL_STATUSES = {"Completed", "Failed", "Stopped"}


class RunError(RuntimeError):
    """Raised for invalid ingestion payloads / illegal state transitions."""


@dataclass
class CostModel:
    """Per-transaction economics pulled from the process configuration."""

    emp_minutes_per_request: float = 15.0
    emp_cost_per_request: float = 10.0
    bot_cost_per_request: float = 0.5

    def time_saved_hours(self, transactions: int) -> float:
        return round(transactions * self.emp_minutes_per_request / 60.0, 2)

    def cost_saved(self, transactions: int) -> float:
        return round(transactions * (self.emp_cost_per_request - self.bot_cost_per_request), 2)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(Decimal(str(value)))
    except Exception:
        return default


def load_cost_model(session: Session, *, process_name: str) -> CostModel:
    """Load the ROI parameters used to compute savings on write."""
    row = fetch_one(
        session,
        """
        SELECT EmpMinutesPerRequest, EmpCostPerRequest, BotCostPerRequest
        FROM ProcessConfig WHERE ProcessName = :p
        """,
        {"p": process_name},
        operation="runs.cost_model",
    ) or {}
    return CostModel(
        emp_minutes_per_request=_to_float(row.get("EmpMinutesPerRequest"), 15.0),
        emp_cost_per_request=_to_float(row.get("EmpCostPerRequest"), 10.0),
        bot_cost_per_request=_to_float(row.get("BotCostPerRequest"), 0.5),
    )


def start_run(
    session: Session,
    *,
    
    process_name: str,
    request_id: Optional[str] = None,
    idempotency_key: Optional[str] = None,
    machine_name: Optional[str] = None,
    robot_name: Optional[str] = None,
    provider: str = "generic_sql",
    provider_run_id: Optional[str] = None,
    trigger: str = "api",
    triggered_by: Optional[str] = None,
    trigger_reason: Optional[str] = None,
    started_at: Optional[datetime] = None,
) -> Tuple[int, bool]:
    """Register the start of a run.

    Returns ``(run_id, created)`` — replaying the same ``idempotency_key``
    returns the existing run instead of duplicating data (critical when bots
    retry after network failures).
    """
    if idempotency_key:
        existing = fetch_one(
            session,
            "SELECT RunID FROM ProcessRuns WHERE IdempotencyKey = :k",
            {"k": idempotency_key[:120]},
            operation="runs.idempotency_lookup",
        )
        if existing:
            return int(existing["RunID"]), False

    values: Dict[str, Any] = {
        "ProcessName": process_name[:100],
        "RequestID": (request_id or "")[:100] or None,
        "Status": "Running",
        "StartTime": started_at or _now(),
        "TransactionsCount": 0,
        "SuccessCount": 0,
        "FailedCount": 0,
        "TimeSavedHours": 0,
        "CostSaved": 0,
        "IdempotencyKey": (idempotency_key or "")[:120] or None,
        "MachineName": (machine_name or "")[:100] or None,
        "RobotName": (robot_name or "")[:100] or None,
        "Provider": provider[:40],
        "ProviderRunId": (provider_run_id or "")[:200] or None,
        "Trigger": (trigger or "api")[:40],
        "TriggeredBy": (triggered_by or "")[:100] or None,
        "TriggerReason": (trigger_reason or "")[:300] or None,
    }

    try:
        run_id = insert_row(session, ProcessRuns, values)
    except IntegrityError:
        # Concurrent duplicate — return the winner
        existing = fetch_one(
            session,
            "SELECT RunID FROM ProcessRuns WHERE IdempotencyKey = :k",
            {"k": idempotency_key or ""},
            operation="runs.idempotency_race",
        )
        if existing:
            return int(existing["RunID"]), False
        raise

    RUNS_INGESTED.labels(event="start", status="Running").inc()
    logger.info("Run started: %s (id=%s, machine=%s)", process_name, run_id, machine_name)
    return int(run_id), True


def complete_run(
    session: Session,
    *,
    
    run_id: int,
    status: str = "Completed",
    transactions_count: Optional[int] = None,
    success_count: Optional[int] = None,
    failed_count: Optional[int] = None,
    failure_reason: Optional[str] = None,
    exit_code: Optional[str] = None,
    finished_at: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Finalise a run, computing duration and realised savings."""
    from app.core.cache import get_cache

    if status not in VALID_STATUSES:
        raise RunError(f"حالة غير صالحة: {status}")

    row = fetch_one(
        session,
        "SELECT * FROM ProcessRuns WHERE RunID = :id",
        {"id": run_id},
        operation="runs.get_for_complete",
    )
    if not row:
        raise RunError("التشغيلة غير موجودة")

    if str(row.get("Status")) in TERMINAL_STATUSES:
        # Idempotent completion: return the stored state instead of failing
        return {
            "run_id": run_id,
            "status": row.get("Status"),
            "already_completed": True,
            "duration_minutes": _to_float(row.get("DurationMinutes")),
            "cost_saved": _to_float(row.get("CostSaved")),
        }

    end = finished_at or _now()
    start = row.get("StartTime") or end
    duration_minutes = round(max(0.0, (end - start).total_seconds() / 60.0), 2)
    transactions = int(transactions_count if transactions_count is not None else (row.get("TransactionsCount") or 0))
    cost_model = load_cost_model(session, process_name=str(row["ProcessName"]))

    values: Dict[str, Any] = {
        "Status": status,
        "EndTime": end,
        "DurationMinutes": duration_minutes,
        "TransactionsCount": max(0, transactions),
        "SuccessCount": max(0, int(success_count if success_count is not None else transactions)),
        "FailedCount": max(0, int(failed_count or 0)),
        "TimeSavedHours": cost_model.time_saved_hours(transactions) if status == "Completed" else 0,
        "CostSaved": cost_model.cost_saved(transactions) if status == "Completed" else 0,
        "FailureReason": (failure_reason or "")[:500] or None,
        "ExitCode": (exit_code or "")[:40] or None,
        "UpdatedAt": _now(),
    }
    update_rows(session, ProcessRuns, values, [ProcessRuns.c.RunID == run_id])

    RUNS_INGESTED.labels(event="complete", status=status).inc()
    get_cache().delete_prefix("dash:v4:")
    get_cache().delete_prefix("capacity:v4:")

    logger.info("Run finalised: id=%s status=%s transactions=%s", run_id, status, transactions)
    return {
        "run_id": run_id,
        "status": status,
        "duration_minutes": duration_minutes,
        "transactions_count": values["TransactionsCount"],
        "time_saved_hours": values["TimeSavedHours"],
        "cost_saved": values["CostSaved"],
        "already_completed": False,
    }


def update_progress(
    session: Session, *, run_id: int, transactions_count: int, failure_reason: Optional[str] = None
) -> Dict[str, Any]:
    """Live progress update for long-running jobs (also refreshes ``EndTime``)."""
    row = fetch_one(
        session,
        "SELECT Status, StartTime FROM ProcessRuns WHERE RunID = :id",
        {"id": run_id},
        operation="runs.get_for_progress",
    )
    if not row:
        raise RunError("التشغيلة غير موجودة")
    if str(row.get("Status")) in TERMINAL_STATUSES:
        raise RunError("لا يمكن تحديث تشغيلة منتهية")

    values: Dict[str, Any] = {
        "TransactionsCount": max(0, int(transactions_count)),
        "UpdatedAt": _now(),
    }
    if failure_reason is not None:
        values["FailureReason"] = failure_reason[:500]
    update_rows(session, ProcessRuns, values, [ProcessRuns.c.RunID == run_id])
    return {"run_id": run_id, "transactions_count": values["TransactionsCount"]}


def reap_stale_runs(session: Session, *, older_than_hours: int = 24) -> int:
    """Mark abandoned ``Running`` rows as ``Stopped`` (agent crash recovery)."""
    flavor = get_flavor()
    stale = fetch_all(
        session,
        f"""
        SELECT RunID, ProcessName, StartTime FROM ProcessRuns
        WHERE Status = 'Running' AND StartTime < {flavor.days_ago(1)}
        """,
        {},
        operation="runs.stale",
    )
    count = 0
    for row in stale:
        update_rows(
            session,
            ProcessRuns,
            {
                "Status": "Stopped",
                "EndTime": _now(),
                "FailureReason": "Abandoned run auto-closed by the Control Room (no completion event)",
                "UpdatedAt": _now(),
            },
            [ProcessRuns.c.RunID == int(row["RunID"])],
        )
        count += 1
    if count:
        logger.warning("Reaped %s stale running jobs", count)
    return count


def list_runs(
    session: Session,
    *,
    
    department_scope: str = "ALL",
    process_name: Optional[str] = None,
    status: Optional[str] = None,
    machine_name: Optional[str] = None,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    limit: int = 200,
    offset: int = 0,
) -> Dict[str, Any]:
    """Paginated run history with filters (used by the Runs explorer)."""
    flavor = get_flavor()
    where = [f"r.IsDeleted = {flavor.false_literal}"]
    params: Dict[str, Any] = {"limit": int(min(limit, 1000)), "offset": int(offset)}

    if department_scope and department_scope.upper() != "ALL":
        where.append("c.Department = :dept")
        params["dept"] = department_scope
    if process_name:
        where.append("r.ProcessName = :process")
        params["process"] = process_name
    if status:
        where.append("r.Status = :status")
        params["status"] = status
    if machine_name:
        where.append("r.MachineName = :machine")
        params["machine"] = machine_name
    if since:
        where.append("r.StartTime >= :since")
        params["since"] = since
    if until:
        where.append("r.StartTime <= :until")
        params["until"] = until

    rows = fetch_all(
        session,
        f"""
        SELECT r.RunID, r.ProcessName, r.RequestID, r.Status, r.StartTime, r.EndTime, r.DurationMinutes,
               r.TransactionsCount, r.SuccessCount, r.FailedCount, r.TimeSavedHours, r.CostSaved,
               r.FailureReason, r.MachineName, r.RobotName, r.{flavor.quote_ident('Trigger')} AS {flavor.quote_ident('Trigger')}, r.TriggeredBy, r.ExitCode,
               c.Department, c.Criticality
        FROM ProcessRuns r
        JOIN ProcessConfig c ON c.ProcessName = r.ProcessName
        WHERE {' AND '.join(where)}
        ORDER BY r.StartTime DESC, r.RunID DESC
        {flavor.paginate(params['limit'], params['offset'])}
        """,
        params,
        operation="runs.list",
    )

    count_row = fetch_one(
        session,
        f"""
        SELECT COUNT(1) AS total FROM ProcessRuns r
        JOIN ProcessConfig c ON c.ProcessName = r.ProcessName
        WHERE {' AND '.join(where)}
        """,
        {k: v for k, v in params.items() if k not in ("limit", "offset")},
        operation="runs.count",
    )

    return {"items": rows, "total": int((count_row or {}).get("total") or 0), "limit": params["limit"], "offset": params["offset"]}


def top_failure_reasons(session: Session, *, days: int = 7, limit: int = 10) -> List[Dict[str, Any]]:
    """Most frequent failure reasons — drives targeted fixes."""
    flavor = get_flavor()
    return fetch_all(
        session,
        f"""
        SELECT {flavor.top(int(limit))}
               COALESCE(NULLIF(r.FailureReason, ''), 'Unknown') AS reason,
               COUNT(1) AS occurrences,
               COUNT(DISTINCT r.ProcessName) AS processes,
               MAX(r.StartTime) AS last_seen
        FROM ProcessRuns r
        WHERE r.Status IN ('Failed','Stopped') AND r.StartTime >= {flavor.days_ago(int(days))}
        GROUP BY COALESCE(NULLIF(r.FailureReason, ''), 'Unknown')
        ORDER BY occurrences DESC{flavor.limit(int(limit))}
        """,
        {},
        operation="runs.top_failures",
    )


def run_statistics(session: Session, *, days: int = 30) -> Dict[str, Any]:
    """Hourly/daily distribution statistics for the insights panel."""
    flavor = get_flavor()
    daily = fetch_all(
        session,
        f"""
        SELECT {flavor.cast_date('StartTime')} AS day,
               COUNT(1) AS runs,
               COALESCE(SUM(CASE WHEN Status = 'Completed' THEN 1 ELSE 0 END), 0) AS completed,
               COALESCE(SUM(CASE WHEN Status IN ('Failed','Stopped') THEN 1 ELSE 0 END), 0) AS failed
        FROM ProcessRuns
        WHERE StartTime >= {flavor.days_ago(int(days))}
        GROUP BY {flavor.cast_date('StartTime')}
        ORDER BY 1
        """,
        {},
        operation="runs.daily_stats",
    )
    return {
        "daily": [
            {
                "date": row["day"].strftime("%Y-%m-%d") if isinstance(row.get("day"), datetime) else str(row.get("day")),
                "runs": int(row.get("runs") or 0),
                "completed": int(row.get("completed") or 0),
                "failed": int(row.get("failed") or 0),
            }
            for row in daily
        ],
        "window_days": int(days),
    }


def heartbeat_run(
    session: Session, *, run_id: int, transactions_count: int = 0, failure_reason: Optional[str] = None
) -> Dict[str, Any]:
    """Record a liveness heartbeat for a running job."""
    result = update_progress(session, run_id=run_id, transactions_count=transactions_count, failure_reason=failure_reason)
    update_rows(session, ProcessRuns, {"LastHeartbeatAt": _now()}, [ProcessRuns.c.RunID == run_id])
    result["last_heartbeat_at"] = _now().isoformat() + "Z"
    return result
