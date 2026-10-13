"""Alerting engine: configurable rules, deduplication, cooldown, channels.

Rules (all thresholds configurable through settings):

* ``agent_offline`` — a runner has not pinged within the stale threshold
* ``sla_breach_risk`` — queue backlog would breach the process SLA target
* ``high_failure_rate`` — failure rate above threshold in the lookback window
* ``repeated_failure_reason`` — the same failure reason repeats N times

Alerts are stored in ``Alerts`` with a unique ``DedupeKey``: re-evaluating a
rule that is already open only bumps ``OccurrenceCount``/``LastSeenAt``.
Notifications go through :mod:`app.services.notification_service`
(SMTP / Microsoft Teams / Slack — all usable On-Premises) and respect its
cooldown, so an open alert never spams a channel.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.repository import fetch_all, fetch_one, insert_row, update_rows
from app.db.tables import Alerts

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _dedupe(rule_key: str, entity_id: str) -> str:
    return hashlib.sha256(f"{rule_key}:{entity_id}".encode()).hexdigest()[:40] + f":{rule_key}:{entity_id}"[:120]


def _upsert_alert(
    session: Session,
    *,
    rule_key: str,
    severity: str,
    title: str,
    detail: str = "",
    entity_type: str = "",
    entity_id: str = "",
) -> Dict[str, Any]:
    dedupe = _dedupe(rule_key, entity_id or title)
    existing = fetch_one(
        session,
        "SELECT AlertID, Status, OccurrenceCount FROM Alerts WHERE DedupeKey = :d",
        {"d": dedupe},
        operation="alerts.lookup",
    )
    if existing:
        update_rows(
            session,
            Alerts,
            {
                "LastSeenAt": _now(),
                "OccurrenceCount": int(existing.get("OccurrenceCount") or 1) + 1,
                "Title": title[:300],
                "Detail": detail or None,
                "Severity": severity,
                # A resolved alert that fires again re-opens.
                "Status": "Open" if existing.get("Status") == "Resolved" else existing.get("Status"),
                "ResolvedAt": None if existing.get("Status") == "Resolved" else None,
            },
            [Alerts.c.AlertID == int(existing["AlertID"])],
        )
        return {"alert_id": int(existing["AlertID"]), "created": False, "dedupe_key": dedupe}
    alert_id = insert_row(
        session,
        Alerts,
        {
            "RuleKey": rule_key,
            "Severity": severity,
            "Title": title[:300],
            "Detail": detail or None,
            "EntityType": entity_type or None,
            "EntityID": entity_id or None,
            "Status": "Open",
            "DedupeKey": dedupe,
            "Fingerprint": dedupe,
            "FirstSeenAt": _now(),
            "LastSeenAt": _now(),
            "OccurrenceCount": 1,
        },
    )
    return {"alert_id": int(alert_id), "created": True, "dedupe_key": dedupe}


def evaluate_alerts(session: Session) -> List[Dict[str, Any]]:
    """Evaluate every rule once and upsert alerts. Returns created/updated alerts."""
    settings = get_settings()
    now = _now()
    results: List[Dict[str, Any]] = []

    # 1) Agent offline
    try:
        rows = fetch_all(
            session,
            "SELECT MachineName, LastPing, Status FROM BotInfrastructure WHERE (IsDeleted = 0 OR IsDeleted IS NULL)",
            operation="alerts.agents",
        )
        for row in rows:
            last = row.get("LastPing")
            offline = not last or (now - last) > timedelta(seconds=settings.AGENT_STALE_SECONDS)
            if offline:
                results.append(
                    _upsert_alert(
                        session,
                        rule_key="agent_offline",
                        severity="Critical",
                        title=f"Agent offline: {row.get('MachineName')}",
                        detail=f"Last ping: {last}",
                        entity_type="BotInfrastructure",
                        entity_id=str(row.get("MachineName")),
                    )
                )
    except Exception as exc:  # pragma: no cover - one rule must not kill the rest
        logger.warning("agent_offline rule failed: %s", exc)

    # 2) SLA breach risk + 3) failure rules need process/queue/run data
    try:
        queues = fetch_all(
            session,
            """
            SELECT q.ProcessName, q.PendingItems, q.ActiveItems, q.AvgItemProcessingSeconds,
                   c.SLATargetMinutes, c.SLAWarningRatio
            FROM ProcessQueues q JOIN ProcessConfig c ON c.ProcessName = q.ProcessName
            WHERE (q.IsDeleted = 0 OR q.IsDeleted IS NULL) AND (c.IsDeleted = 0 OR c.IsDeleted IS NULL)
            """,
            operation="alerts.queues",
        )
        for q in queues:
            pending = int(q.get("PendingItems") or 0)
            avg = float(q.get("AvgItemProcessingSeconds") or 30)
            sla = float(q.get("SLATargetMinutes") or 0)
            if pending and sla > 0:
                drain_minutes = pending * avg / 60.0
                ratio = float(q.get("SLAWarningRatio") or 0.75)
                if drain_minutes >= sla * ratio:
                    results.append(
                        _upsert_alert(
                            session,
                            rule_key="sla_breach_risk",
                            severity="Critical" if drain_minutes >= sla else "Warning",
                            title=f"SLA breach risk: {q.get('ProcessName')}",
                            detail=f"Backlog {pending} items, estimated drain {drain_minutes:.0f}m vs SLA {sla:.0f}m",
                            entity_type="ProcessQueue",
                            entity_id=str(q.get("ProcessName")),
                        )
                    )
    except Exception as exc:  # pragma: no cover
        logger.warning("sla_breach_risk rule failed: %s", exc)

    try:
        threshold = float(getattr(settings, "ALERT_FAILURE_RATE_THRESHOLD", 0.25))
        min_runs = int(getattr(settings, "ALERT_FAILURE_MIN_RUNS", 10))
        rows = fetch_all(
            session,
            """
            SELECT ProcessName, COUNT(1) AS total,
                   SUM(CASE WHEN Status = 'Failed' THEN 1 ELSE 0 END) AS failed
            FROM ProcessRuns WHERE StartTime >= :since GROUP BY ProcessName
            """,
            {"since": now - timedelta(hours=24)},
            operation="alerts.failure_rate",
        )
        for row in rows:
            total = int(row.get("total") or 0)
            failed = int(row.get("failed") or 0)
            if total >= min_runs and total and (failed / total) >= threshold:
                results.append(
                    _upsert_alert(
                        session,
                        rule_key="high_failure_rate",
                        severity="Critical",
                        title=f"High failure rate: {row.get('ProcessName')}",
                        detail=f"{failed}/{total} runs failed in the last 24h ({failed / total:.0%})",
                        entity_type="Process",
                        entity_id=str(row.get("ProcessName")),
                    )
                )
        reasons = fetch_all(
            session,
            """
            SELECT ProcessName, FailureReason, COUNT(1) AS c FROM ProcessRuns
            WHERE Status = 'Failed' AND FailureReason IS NOT NULL AND StartTime >= :since
            GROUP BY ProcessName, FailureReason
            """,
            {"since": now - timedelta(hours=24)},
            operation="alerts.failure_reasons",
        )
        repeat = int(getattr(settings, "ALERT_REPEATED_FAILURE_THRESHOLD", 3))
        for row in reasons:
            if int(row.get("c") or 0) >= repeat:
                results.append(
                    _upsert_alert(
                        session,
                        rule_key="repeated_failure_reason",
                        severity="Warning",
                        title=f"Repeated failure: {row.get('ProcessName')}",
                        detail=str(row.get("FailureReason"))[:500],
                        entity_type="Process",
                        entity_id=f"{row.get('ProcessName')}:{str(row.get('FailureReason'))[:60]}",
                    )
                )
    except Exception as exc:  # pragma: no cover
        logger.warning("failure rules failed: %s", exc)

    # Notify only newly created alerts (cooldown handled in notification_service)
    if settings.NOTIFY_ENABLED:
        from app.services import notification_service

        for item in results:
            if item.get("created"):
                row = fetch_one(session, "SELECT * FROM Alerts WHERE AlertID = :id", {"id": item["alert_id"]}, operation="alerts.get")
                if row:
                    try:
                        notification_service.notify(
                            session,
                            subject=str(row.get("Title")),
                            body=str(row.get("Detail") or ""),
                            severity=str(row.get("Severity") or "Warning"),
                            dedupe_key=item["dedupe_key"],
                            related_type="alert",
                            related_id=str(item["alert_id"]),
                        )
                        update_rows(session, Alerts, {"NotifiedAt": _now()}, [Alerts.c.AlertID == item["alert_id"]])
                    except Exception as exc:  # pragma: no cover
                        logger.warning("Alert notification failed: %s", exc)
    logger.info("Alert evaluation: %s alerts touched", len(results))
    return results


def list_alerts(session: Session, *, status: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
    where = ["1 = 1"]
    params: Dict[str, Any] = {}
    if status:
        where.append("Status = :s")
        params["s"] = status
    rows = fetch_all(
        session,
        f"SELECT * FROM Alerts WHERE {' AND '.join(where)} ORDER BY LastSeenAt DESC",
        params,
        operation="alerts.list",
    )
    return rows[: max(1, min(limit, 500))]


def open_alert_count(session: Session) -> int:
    row = fetch_one(session, "SELECT COUNT(1) AS c FROM Alerts WHERE Status = 'Open'", operation="alerts.count") or {}
    return int(row.get("c") or 0)


def set_alert_status(session: Session, *, alert_id: int, status: str, user_id: Optional[int]) -> int:
    if status not in ("Open", "Acknowledged", "Resolved"):
        raise ValueError("حالة تنبيه غير صالحة")
    values: Dict[str, Any] = {"Status": status}
    if status == "Acknowledged":
        values.update({"AcknowledgedBy": user_id, "AcknowledgedAt": _now()})
    if status == "Resolved":
        values.update({"ResolvedBy": user_id, "ResolvedAt": _now()})
    return update_rows(session, Alerts, values, [Alerts.c.AlertID == alert_id])
