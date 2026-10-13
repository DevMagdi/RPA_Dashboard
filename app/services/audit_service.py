"""Audit trail service.

Every sensitive action is recorded with *who / what / when / from where* plus
before/after values, user agent and correlation id — the evidence trail banks
require for SOX/regulatory reviews.

Design notes
------------
* Writing an audit record **never breaks** the business operation: failures are
  logged and swallowed (the business transaction must not roll back because the
  audit insert failed)... **except** when called through
  :func:`record_strict`, used for vault access where missing evidence would be a
  compliance breach and the operation must fail instead.
* Values are JSON-serialised defensively and secrets are redacted by key name.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.core.logging import get_correlation_id
from app.db.dialect import get_flavor
from app.db.repository import execute, fetch_all, fetch_one, insert_row
from app.db.session import session_scope
from app.db.tables import AuditLogs

logger = logging.getLogger(__name__)

#: Keys whose values are always masked before being written to the audit trail.
SENSITIVE_KEYS = {
    "password",
    "passwd",
    "passwordhash",
    "secret",
    "client_secret",
    "token",
    "agent_token",
    "access_token",
    "refresh_token",
    "apikey",
    "api_key",
    "value",
    "encryptedvalue",
    "mfa_secret",
    "mfasecretencrypted",
    "backup_codes",
    "private_key",
}


def _redact(payload: Any) -> Any:
    """Recursively mask sensitive keys inside a JSON-like structure."""
    if isinstance(payload, dict):
        return {
            key: ("***REDACTED***" if str(key).lower() in SENSITIVE_KEYS else _redact(value))
            for key, value in payload.items()
        }
    if isinstance(payload, list):
        return [_redact(item) for item in payload]
    return payload


def _serialise(values: Optional[Any]) -> Optional[str]:
    """Serialise audit values to a JSON string (never raises)."""
    if values is None:
        return None
    if isinstance(values, str):
        return values[:4000]
    import json

    try:
        return json.dumps(_redact(values), default=str, ensure_ascii=False)[:4000]
    except Exception:  # pragma: no cover - defensive
        return str(values)[:4000]


def record(
    session: Session,
    *,
    
    action_type: str,
    user_id: Optional[int] = None,
    process_name: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    old_values: Optional[Any] = None,
    new_values: Optional[Any] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    is_success: bool = True,
) -> Optional[int]:
    """Append an audit record inside the caller's transaction.

    Returns the new ``LogID`` (or ``None`` when the write failed).
    """
    try:
        return insert_row(
            session,
            AuditLogs,
            {
                "UserID": user_id,
                "ActionType": action_type[:60],
                "ProcessName": (process_name or None) and str(process_name)[:100],
                "EntityType": (entity_type or None) and str(entity_type)[:50],
                "EntityID": (entity_id or None) and str(entity_id)[:80],
                "OldValues": _serialise(old_values),
                "NewValues": _serialise(new_values),
                "IPAddress": (ip_address or None) and str(ip_address)[:64],
                "UserAgent": (user_agent or None) and str(user_agent)[:400],
                "CorrelationID": get_correlation_id(),
                "IsSuccess": bool(is_success),
            },
        )
    except Exception as exc:  # pragma: no cover - audit must never break flows
        logger.error("Audit write failed for %s: %s", action_type, exc)
        return None


def record_standalone(
    *,
    
    action_type: str,
    user_id: Optional[int] = None,
    process_name: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    old_values: Optional[Any] = None,
    new_values: Optional[Any] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    is_success: bool = True,
) -> Optional[int]:
    """Convenience wrapper opening its own transaction (best-effort)."""
    try:
        with session_scope() as session:
            return record(
                session,
                
                action_type=action_type,
                user_id=user_id,
                process_name=process_name,
                entity_type=entity_type,
                entity_id=entity_id,
                old_values=old_values,
                new_values=new_values,
                ip_address=ip_address,
                user_agent=user_agent,
                is_success=is_success,
            )
    except Exception as exc:  # pragma: no cover
        logger.error("Standalone audit write failed for %s: %s", action_type, exc)
        return None


def record_strict(session: Session, **kwargs: Any) -> int:
    """Audit inside the transaction and **fail** the operation when it cannot be written.

    Used for vault reads: if we cannot prove who read a bank credential, the
    read must not happen at all.
    """
    log_id = record(session, **kwargs)
    if log_id is None:
        raise RuntimeError("audit trail unavailable — refusing to complete sensitive operation")
    return log_id


def query_logs(
    session: Session,
    *,
    
    limit: int = 200,
    offset: int = 0,
    action_type: Optional[str] = None,
    username: Optional[str] = None,
    process_name: Optional[str] = None,
    department: Optional[str] = None,
    allowed_department: str = "ALL",
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    search: Optional[str] = None,
) -> list[Dict[str, Any]]:
    """Filterable, paginated audit query used by the Audit Trail screen."""
    from app.db.dialect import get_flavor

    flavor = get_flavor()
    where = ["1 = 1"]
    params: Dict[str, Any] = {"limit": int(min(limit, 1000)), "offset": int(offset)}

    if action_type:
        where.append("a.ActionType = :action")
        params["action"] = action_type
    if username:
        where.append("u.Username = :username")
        params["username"] = username
    if process_name:
        where.append("a.ProcessName = :process")
        params["process"] = process_name
    if since:
        where.append("a.ActionDate >= :since")
        params["since"] = since
    if until:
        where.append("a.ActionDate <= :until")
        params["until"] = until
    if search:
        where.append("(a.ActionType LIKE :search OR a.ProcessName LIKE :search OR u.Username LIKE :search)")
        params["search"] = f"%{search}%"

    # Department scoping: users outside "ALL" only see their department's trail
    dept_join = ""
    if allowed_department != "ALL":
        dept_join = " AND (p.Department = :allowed_dept OR a.ProcessName IS NULL)"
        params["allowed_dept"] = allowed_department
    if department:
        dept_join += " AND p.Department = :dept"
        params["dept"] = department

    sql = f"""
        SELECT
            a.LogID, COALESCE(u.Username, 'System') AS Username, a.ActionType, a.ProcessName,
            a.EntityType, a.EntityID, a.OldValues, a.NewValues, a.ActionDate, a.IPAddress,
            a.UserAgent, a.CorrelationID, a.IsSuccess
        FROM AuditLogs a
        LEFT JOIN SystemUsers u ON a.UserID = u.UserID
        LEFT JOIN ProcessConfig p ON a.ProcessName = p.ProcessName
        WHERE {' AND '.join(where)} {dept_join}
        ORDER BY a.ActionDate DESC, a.LogID DESC
        {flavor.paginate(params['limit'], params['offset'])}
    """
    return fetch_all(session, sql, params, operation="audit.query")


def count_logs(session: Session, **filters: Any) -> int:
    """Total rows matching the audit filters (for pagination widgets)."""
    where = ["1 = 1"]
    params: Dict[str, Any] = {}
    if filters.get("action_type"):
        where.append("ActionType = :action")
        params["action"] = filters["action_type"]
    row = fetch_one(
        session,
        f"SELECT COUNT(1) AS total FROM AuditLogs WHERE {' AND '.join(where)}",
        params,
        operation="audit.count",
    )
    return int((row or {}).get("total") or 0)


def purge_older_than(session: Session, *, retention_days: int) -> int:
    """Retention policy enforcement — delete audit rows beyond the window."""
    flavor = get_flavor()
    return execute(
        session,
        f"DELETE FROM AuditLogs WHERE ActionDate < {flavor.days_ago(retention_days)}",
        {},
        operation="audit.purge",
    )


def recent_critical_events(session: Session, *, hours: int = 24, limit: int = 20) -> list[Dict[str, Any]]:
    """Failed/denied actions in the recent window — surfaced on the health page."""
    from app.db.dialect import get_flavor

    flavor = get_flavor()
    rows = fetch_all(
        session,
        f"""
        SELECT {flavor.top(int(limit))} ActionType, ProcessName, IPAddress, ActionDate, EntityType, EntityID
        FROM AuditLogs
        WHERE IsSuccess = {flavor.false_literal}
          AND ActionDate >= {flavor.days_ago(1)}
        ORDER BY ActionDate DESC{flavor.limit(int(limit))}
        """,
        {},
        operation="audit.critical",
    )
    return rows


def summarise_activity(session: Session, *, days: int = 7) -> list[Dict[str, Any]]:
    """Daily activity histogram for the audit dashboard widget."""
    from app.db.dialect import get_flavor

    flavor = get_flavor()
    rows = fetch_all(
        session,
        f"""
        SELECT {flavor.cast_date('ActionDate')} AS day, COUNT(1) AS events
        FROM AuditLogs
        WHERE ActionDate >= {flavor.days_ago(days)}
        GROUP BY {flavor.cast_date('ActionDate')}
        ORDER BY day
        """,
        {},
        operation="audit.activity",
    )
    return rows
