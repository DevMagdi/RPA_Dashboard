"""SLA & workload service (queue health, breach prediction, backlog trend)."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.db.dialect import get_flavor
from app.db.repository import fetch_all, fetch_one, insert_row, update_rows
from app.db.tables import ProcessQueues, QueueSnapshots

logger = logging.getLogger(__name__)

STATUS_HEALTHY = "Healthy"
STATUS_WARNING = "Warning"
STATUS_BREACH = "Breach_Risk"
STATUS_UNKNOWN = "Unknown"


def _classify(estimated_minutes: float, sla_minutes: float, warning_ratio: float = 0.75) -> str:
    """Map a predicted drain time onto an SLA verdict."""
    if sla_minutes <= 0:
        return STATUS_UNKNOWN
    if estimated_minutes >= sla_minutes:
        return STATUS_BREACH
    if estimated_minutes >= sla_minutes * warning_ratio:
        return STATUS_WARNING
    return STATUS_HEALTHY


def get_workload(
    session: Session, *, department_scope: str = "ALL", process_name: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Queue workload with predicted completion and SLA verdict per process."""
    flavor = get_flavor()
    where = [f"q.IsDeleted = {flavor.false_literal}", f"c.IsDeleted = {flavor.false_literal}"]
    params: Dict[str, Any] = {}

    if department_scope and department_scope.upper() != "ALL":
        where.append("c.Department = :dept")
        params["dept"] = department_scope
    if process_name and process_name not in ("All", "ALL", ""):
        where.append("q.ProcessName = :process")
        params["process"] = process_name

    rows = fetch_all(
        session,
        f"""
        SELECT q.ProcessName, q.PendingItems, q.ActiveItems, q.AvgItemProcessingSeconds,
               q.LastUpdatedAt, c.SLATargetMinutes, c.SLAWarningRatio, c.Department, c.Criticality,
               c.ExpectedRunsPerDay, c.BotName
        FROM ProcessQueues q
        JOIN ProcessConfig c ON q.ProcessName = c.ProcessName
        WHERE {' AND '.join(where)}
        ORDER BY q.PendingItems DESC
        """,
        params,
        operation="sla.workload",
    )

    # Online runner count per process drives realistic drain estimates
    runners = fetch_all(
        session,
        f"""
        SELECT AssignedProcess AS process_name, COUNT(1) AS online
        FROM BotInfrastructure
        WHERE Status = 'Online' AND IsDeleted = {flavor.false_literal}
        GROUP BY AssignedProcess
        """,
        {},
        operation="sla.runners",
    )
    online_by_process = {str(r.get("process_name") or ""): int(r.get("online") or 0) for r in runners}

    result: List[Dict[str, Any]] = []
    for row in rows:
        process = str(row["ProcessName"])
        pending = int(row.get("PendingItems") or 0)
        active = int(row.get("ActiveItems") or 0)
        avg_seconds = float(row.get("AvgItemProcessingSeconds") or 30)
        sla = int(row.get("SLATargetMinutes") or 0)
        warning_ratio = float(row.get("SLAWarningRatio") or 0.75)
        parallel = max(1, online_by_process.get(process, 0))

        estimated = round((pending * avg_seconds / 60.0) / parallel, 1)
        status = _classify(estimated, sla, warning_ratio)

        result.append(
            {
                "ProcessName": process,
                "Department": row.get("Department"),
                "Criticality": row.get("Criticality"),
                "PendingItems": pending,
                "ActiveItems": active,
                "AvgItemProcessingSeconds": avg_seconds,
                "SLATargetMinutes": sla,
                "EstimatedCompletionMinutes": estimated,
                "ParallelRunners": parallel,
                "SLAStatus": status,
                "BacklogTrend": "up" if pending > active * 3 else "stable",
                "LastUpdatedAt": row.get("LastUpdatedAt"),
                "QueuedWorkHours": round(pending * avg_seconds / 3600.0, 2),
            }
        )
    return result


def update_queue_telemetry(
    session: Session,
    *,
    
    process_name: str,
    pending_items: int,
    active_items: int,
    avg_item_processing_seconds: Optional[int] = None,
    write_snapshot: bool = True,
) -> Dict[str, Any]:
    """Upsert queue depth (called by the queues telemetry API or the sync job)."""
    existing = fetch_one(
        session,
        "SELECT QueueID FROM ProcessQueues WHERE ProcessName = :p",
        {"p": process_name},
        operation="sla.queue_lookup",
    )

    values: Dict[str, Any] = {
        "PendingItems": max(0, int(pending_items)),
        "ActiveItems": max(0, int(active_items)),
        "LastUpdatedAt": datetime.utcnow(),
    }
    if avg_item_processing_seconds is not None:
        values["AvgItemProcessingSeconds"] = max(1, int(avg_item_processing_seconds))

    if existing:
        update_rows(
            session,
            ProcessQueues,
            values,
            [ProcessQueues.c.ProcessName == process_name],
        )
    else:
        insert_row(session, ProcessQueues, {"ProcessName": process_name, **values})

    if write_snapshot:
        insert_row(
            session,
            QueueSnapshots,
            {
                "ProcessName": process_name,
                "PendingItems": values["PendingItems"],
                "ActiveItems": values["ActiveItems"],
            },
        )

    logger.debug("Queue telemetry updated: %s pending=%s", process_name, values["PendingItems"])
    return {"process_name": process_name, **values}


def backlog_trend(
    session: Session, *, process_name: Optional[str] = None, hours: int = 48
) -> List[Dict[str, Any]]:
    """Backlog trend from queue snapshots (used by the workload chart)."""
    flavor = get_flavor()
    where = [f"CapturedAt >= {flavor.days_ago(2)}"]
    params: Dict[str, Any] = {}
    if process_name:
        where.append("ProcessName = :p")
        params["p"] = process_name

    rows = fetch_all(
        session,
        f"""
        SELECT {flavor.cast_date('CapturedAt')} AS day,
               AVG(PendingItems) AS pending,
               AVG(ActiveItems) AS active,
               COUNT(1) AS samples
        FROM QueueSnapshots
        WHERE {' AND '.join(where)}
        GROUP BY {flavor.cast_date('CapturedAt')}
        ORDER BY 1
        """,
        params,
        operation="sla.backlog_trend",
    )
    return [
        {
            "date": row["day"].strftime("%Y-%m-%d") if isinstance(row.get("day"), datetime) else str(row.get("day")),
            "pending": round(float(row.get("pending") or 0), 1),
            "active": round(float(row.get("active") or 0), 1),
        }
        for row in rows
    ]


def sla_summary(session: Session, *, department_scope: str = "ALL") -> Dict[str, Any]:
    """Headline SLA numbers for dashboard widgets."""
    workloads = get_workload(session, department_scope=department_scope)
    return {
        "processes": len(workloads),
        "healthy": len([w for w in workloads if w["SLAStatus"] == STATUS_HEALTHY]),
        "warning": len([w for w in workloads if w["SLAStatus"] == STATUS_WARNING]),
        "breach_risk": len([w for w in workloads if w["SLAStatus"] == STATUS_BREACH]),
        "unknown": len([w for w in workloads if w["SLAStatus"] == STATUS_UNKNOWN]),
        "total_pending_items": sum(w["PendingItems"] for w in workloads),
        "total_queued_hours": round(sum(w["QueuedWorkHours"] for w in workloads), 1),
        "longest_wait_minutes": max([w["EstimatedCompletionMinutes"] for w in workloads], default=0),
    }
