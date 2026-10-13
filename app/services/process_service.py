"""Process catalogue & ROI configuration service.

Preserves the original endpoints/behaviour (keyset pagination, ROI upsert,
department scoping) while adding:

* multi-vendor process mapping (``Provider`` / ``PlatformProcessKey``)
* soft delete + retention support
* strict validation and audit hooks
* a single source of truth used by both the REST API and the sync service
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.db.dialect import get_flavor
from app.db.repository import fetch_all, fetch_one, insert_row, update_rows
from app.db.tables import ProcessConfig

logger = logging.getLogger(__name__)

SORTABLE_COLUMNS = {
    "ProcessName",
    "Department",
    "ExpectedRunsPerDay",
    "SLATargetMinutes",
    "Criticality",
    "CreatedAt",
}

VALID_CRITICALITIES = ("Low", "Medium", "High", "Critical")


def _escape_like(value: str) -> str:
    """Escape LIKE wildcards so ``%``/``_`` in a search term behave literally."""
    return (
        value.replace("\\", "\\\\")
        .replace("%", "\\%")
        .replace("_", "\\_")
        .replace("[", "\\[")
    )


def _normalise_department(value: Optional[str]) -> str:
    """Trim legacy values such as ``"UAT (comment)"`` down to the department."""
    if not value:
        return "Operations"
    return str(value).strip().split("(")[0].strip()[:50] or "Operations"


def list_processes(
    session: Session,
    *,
    tenant_id: int,
    department_scope: str = "ALL",
    search: Optional[str] = None,
    department: Optional[str] = None,
    after: Optional[str] = None,
    page_size: int = 200,
    sort_by: str = "ProcessName",
    sort_dir: str = "asc",
    include_total: bool = False,
    include_inactive: bool = False,
) -> Dict[str, Any]:
    """Keyset-paginated process list (stable under concurrent inserts)."""
    flavor = get_flavor()
    where = ["c.TenantID = :tenant", f"c.IsDeleted = {flavor.false_literal}"]
    params: Dict[str, Any] = {"tenant": tenant_id}

    if not include_inactive:
        where.append(f"c.IsActive = {flavor.true_literal}")

    if department_scope and department_scope.upper() != "ALL":
        where.append("c.Department = :dept_scope")
        params["dept_scope"] = department_scope
    elif department:
        where.append("c.Department = :dept")
        params["dept"] = department

    if search:
        where.append("c.ProcessName LIKE :search ESCAPE '\\'")
        params["search"] = f"%{_escape_like(search.strip())}%"

    if after:
        # Keyset pagination always walks the (ProcessName) key
        if sort_dir.lower() == "desc":
            where.append("c.ProcessName < :after")
        else:
            where.append("c.ProcessName > :after")
        params["after"] = after

    where_sql = " AND ".join(where)

    total = None
    if include_total:
        row = fetch_one(
            session,
            f"SELECT COUNT(1) AS total FROM ProcessConfig c WHERE {where_sql}",
            params,
            operation="processes.count",
        )
        total = int((row or {}).get("total") or 0)

    sort_column = sort_by if sort_by in SORTABLE_COLUMNS else "ProcessName"
    direction = "DESC" if str(sort_dir).lower() == "desc" else "ASC"
    top_n = int(page_size) + 1

    rows = fetch_all(
        session,
        f"""
        SELECT {flavor.top(top_n)}
            c.ConfigID, c.ProcessName, c.Department, c.BotName, c.Provider, c.PlatformProcessKey,
            c.ExpectedRunsPerDay, c.SLATargetMinutes, c.Criticality, c.IsActive, c.Notes,
            c.EmpMinutesPerRequest, c.EmpCostPerRequest, c.BotCostPerRequest, c.SLAWarningRatio,
            c.CreatedAt, c.UpdatedAt
        FROM ProcessConfig c
        WHERE {where_sql}
        ORDER BY c.{sort_column} {direction}, c.ProcessName {direction}{flavor.limit(top_n)}
        """,
        params,
        operation="processes.list",
    )

    has_more = len(rows) > int(page_size)
    items = rows[: int(page_size)]
    next_cursor = items[-1]["ProcessName"] if has_more and items else None

    return {
        "page_size": int(page_size),
        "total": total,
        "next_cursor": next_cursor,
        "has_more": has_more,
        "items": items,
    }


def get_process(session: Session, *, tenant_id: int, process_name: str) -> Optional[Dict[str, Any]]:
    """Fetch one process configuration."""
    return fetch_one(
        session,
        """
        SELECT * FROM ProcessConfig
        WHERE TenantID = :t AND ProcessName = :p AND (IsDeleted = 0 OR IsDeleted IS NULL)
        """,
        {"t": tenant_id, "p": process_name},
        operation="processes.get",
    )


def process_exists(session: Session, *, tenant_id: int, process_name: str) -> bool:
    """Cheap existence check used for authorisation and validation."""
    row = fetch_one(
        session,
        "SELECT 1 AS x FROM ProcessConfig WHERE TenantID = :t AND ProcessName = :p",
        {"t": tenant_id, "p": process_name},
        operation="processes.exists",
    )
    return bool(row)


def ensure_process(
    session: Session,
    *,
    tenant_id: int,
    process_name: str,
    department: str = "Operations",
    bot_name: Optional[str] = None,
    provider: str = "generic_sql",
    defaults: Optional[Dict[str, Any]] = None,
) -> Tuple[int, bool]:
    """Return ``(config_id, created)`` — create the process when missing.

    Used by ROI/version creation paths that historically relied on an upsert.
    """
    existing = get_process(session, tenant_id=tenant_id, process_name=process_name)
    if existing:
        return int(existing["ConfigID"]), False

    values: Dict[str, Any] = {
        "TenantID": tenant_id,
        "ProcessName": process_name[:100],
        "Department": _normalise_department(department),
        "BotName": bot_name,
        "Provider": provider,
        "IsActive": True,
        "ExpectedRunsPerDay": 0,
        "EmpMinutesPerRequest": 15,
        "EmpCostPerRequest": 10,
        "BotCostPerRequest": 0.5,
        "Criticality": "Medium",
    }
    values.update(defaults or {})
    config_id = insert_row(session, ProcessConfig, values)
    logger.info("Process created: %s (tenant=%s)", process_name, tenant_id)
    return int(config_id), True


def update_roi(
    session: Session,
    *,
    tenant_id: int,
    process_name: str,
    emp_minutes_per_request: float,
    emp_cost_per_request: float,
    bot_cost_per_request: float,
    expected_runs_per_day: int,
    department: Optional[str] = None,
    bot_name: Optional[str] = None,
    criticality: Optional[str] = None,
    updated_by: Optional[int] = None,
) -> Dict[str, Any]:
    """Create or update the ROI configuration of a process."""
    if emp_minutes_per_request < 0 or emp_cost_per_request < 0 or bot_cost_per_request < 0:
        raise ValueError("قيم ROI لا يمكن أن تكون سالبة")
    if expected_runs_per_day < 0:
        raise ValueError("عدد التشغيلات المتوقعة لا يمكن أن يكون سالبًا")
    if criticality and criticality not in VALID_CRITICALITIES:
        raise ValueError(f"الأهمية يجب أن تكون إحدى: {', '.join(VALID_CRITICALITIES)}")

    existing = get_process(session, tenant_id=tenant_id, process_name=process_name)
    payload = {
        "EmpMinutesPerRequest": emp_minutes_per_request,
        "EmpCostPerRequest": emp_cost_per_request,
        "BotCostPerRequest": bot_cost_per_request,
        "ExpectedRunsPerDay": int(expected_runs_per_day),
        "UpdatedAt": datetime.now(timezone.utc).replace(tzinfo=None),
    }
    if department:
        payload["Department"] = _normalise_department(department)
    if bot_name:
        payload["BotName"] = bot_name[:100]
    if criticality:
        payload["Criticality"] = criticality

    if not existing:
        config_id, _ = ensure_process(
            session, tenant_id=tenant_id, process_name=process_name, department=department or "Operations"
        )
        update_rows(session, ProcessConfig, payload, [ProcessConfig.c.ConfigID == config_id])
        session.flush()
        updated = get_process(session, tenant_id=tenant_id, process_name=process_name) or {}
        return {
            "created": True,
            "before": None,
            "after": updated,
        }

    before = {
        "EmpMinutesPerRequest": float(existing.get("EmpMinutesPerRequest") or 0),
        "EmpCostPerRequest": float(existing.get("EmpCostPerRequest") or 0),
        "BotCostPerRequest": float(existing.get("BotCostPerRequest") or 0),
        "ExpectedRunsPerDay": int(existing.get("ExpectedRunsPerDay") or 0),
        "Department": existing.get("Department"),
        "BotName": existing.get("BotName"),
        "Criticality": existing.get("Criticality"),
    }
    update_rows(session, ProcessConfig, payload, [ProcessConfig.c.ProcessName == process_name, ProcessConfig.c.TenantID == tenant_id])
    session.flush()
    after = get_process(session, tenant_id=tenant_id, process_name=process_name) or {}
    return {"created": False, "before": before, "after": after}


def update_sla(
    session: Session,
    *,
    tenant_id: int,
    process_name: str,
    sla_target_minutes: int,
    avg_item_processing_seconds: int,
    warning_ratio: float = 0.75,
) -> Dict[str, Any]:
    """Update SLA targets and the queue's processing-time estimate."""
    if sla_target_minutes <= 0:
        raise ValueError("زمن الـ SLA يجب أن يكون أكبر من صفر")
    if avg_item_processing_seconds <= 0:
        raise ValueError("زمن معالجة العنصر يجب أن يكون أكبر من صفر")
    if not 0.1 <= warning_ratio <= 1.0:
        raise ValueError("نسبة التحذير يجب أن تكون بين 0.1 و 1.0")

    existing = get_process(session, tenant_id=tenant_id, process_name=process_name)
    if not existing:
        raise ValueError("العملية غير موجودة في الإعدادات")

    before_sla = int(existing.get("SLATargetMinutes") or 0)
    queue_before = fetch_one(
        session,
        "SELECT AvgItemProcessingSeconds FROM ProcessQueues WHERE TenantID = :t AND ProcessName = :p",
        {"t": tenant_id, "p": process_name},
        operation="processes.queue_before",
    )

    update_rows(
        session,
        ProcessConfig,
        {
            "SLATargetMinutes": int(sla_target_minutes),
            "SLAWarningRatio": float(warning_ratio),
            "UpdatedAt": datetime.now(timezone.utc).replace(tzinfo=None),
        },
        [ProcessConfig.c.ProcessName == process_name, ProcessConfig.c.TenantID == tenant_id],
    )

    if queue_before:
        from app.db.tables import ProcessQueues

        update_rows(
            session,
            ProcessQueues,
            {"AvgItemProcessingSeconds": int(avg_item_processing_seconds), "LastUpdatedAt": datetime.utcnow()},
            [ProcessQueues.c.ProcessName == process_name, ProcessQueues.c.TenantID == tenant_id],
        )
    else:
        from app.db.tables import ProcessQueues

        insert_row(
            session,
            ProcessQueues,
            {
                "TenantID": tenant_id,
                "ProcessName": process_name,
                "PendingItems": 0,
                "ActiveItems": 0,
                "AvgItemProcessingSeconds": int(avg_item_processing_seconds),
            },
        )

    return {
        "before": {
            "SLATargetMinutes": before_sla,
            "AvgItemProcessingSeconds": int((queue_before or {}).get("AvgItemProcessingSeconds") or 0),
        },
        "after": {
            "SLATargetMinutes": int(sla_target_minutes),
            "AvgItemProcessingSeconds": int(avg_item_processing_seconds),
            "SLAWarningRatio": float(warning_ratio),
        },
    }


def set_active(session: Session, *, tenant_id: int, process_name: str, is_active: bool) -> int:
    """Enable/disable a process (pauses scheduling without losing history)."""
    return update_rows(
        session,
        ProcessConfig,
        {"IsActive": is_active, "UpdatedAt": datetime.utcnow()},
        [ProcessConfig.c.ProcessName == process_name, ProcessConfig.c.TenantID == tenant_id],
    )


def soft_delete_process(session: Session, *, tenant_id: int, process_name: str) -> int:
    """Logically delete a process (history & audit remain intact)."""
    return update_rows(
        session,
        ProcessConfig,
        {"IsDeleted": True, "DeletedAt": datetime.utcnow(), "IsActive": False},
        [ProcessConfig.c.ProcessName == process_name, ProcessConfig.c.TenantID == tenant_id],
    )


def department_stats(session: Session, *, tenant_id: int) -> List[Dict[str, Any]]:
    """Aggregated process counts per department (sidebar tree)."""
    flavor = get_flavor()
    return fetch_all(
        session,
        f"""
        SELECT Department AS department,
               COUNT(1) AS processes,
               COALESCE(SUM(ExpectedRunsPerDay), 0) AS target_runs,
               COALESCE(SUM(CASE WHEN Criticality IN ('High','Critical') THEN 1 ELSE 0 END), 0) AS critical_processes
        FROM ProcessConfig
        WHERE TenantID = :t AND IsDeleted = {flavor.false_literal}
        GROUP BY Department
        ORDER BY Department
        """,
        {"t": tenant_id},
        operation="processes.department_stats",
    )


def roi_summary(session: Session, *, tenant_id: int, department_scope: str = "ALL", days: int = 30) -> List[Dict[str, Any]]:
    """Per-process ROI: realised savings, hours saved and target attainment."""
    flavor = get_flavor()
    params: Dict[str, Any] = {"t": tenant_id, "days": int(days)}
    dept_filter = ""
    if department_scope and department_scope.upper() != "ALL":
        dept_filter = " AND c.Department = :dept"
        params["dept"] = department_scope

    rows = fetch_all(
        session,
        f"""
        SELECT c.ProcessName, c.Department, c.ExpectedRunsPerDay, c.Criticality,
               COALESCE(SUM(COALESCE(r.TransactionsCount, 0)), 0) AS transactions,
               COALESCE(SUM(COALESCE(r.TimeSavedHours, 0)), 0) AS hours_saved,
               COALESCE(SUM(COALESCE(r.CostSaved, 0)), 0) AS cost_saved,
               COUNT(r.RunID) AS runs
        FROM ProcessConfig c
        LEFT JOIN ProcessRuns r
               ON r.ProcessName = c.ProcessName AND r.TenantID = c.TenantID
              AND r.StartTime >= {flavor.days_ago(int(days))}
        WHERE c.TenantID = :t AND c.IsDeleted = {flavor.false_literal}{dept_filter}
        GROUP BY c.ProcessName, c.Department, c.ExpectedRunsPerDay, c.Criticality
        ORDER BY cost_saved DESC
        """,
        params,
        operation="processes.roi_summary",
    )
    for row in rows:
        days_count = max(1, int(days))
        actual_runs_per_day = float(row.get("runs") or 0) / days_count
        expected = float(row.get("ExpectedRunsPerDay") or 0)
        row["actual_runs_per_day"] = round(actual_runs_per_day, 1)
        row["target_attainment_percent"] = round((actual_runs_per_day / expected * 100) if expected else 0, 1)
        row["hours_saved"] = round(float(row.get("hours_saved") or 0), 1)
        row["cost_saved"] = round(float(row.get("cost_saved") or 0), 2)
        row["transactions"] = int(row.get("transactions") or 0)
        row["runs"] = int(row.get("runs") or 0)
    return rows
