"""Notification service — Slack / Microsoft Teams / Email.

Critical capacity recommendations, failed runs, offline runners and approval
requests are pushed to the channels the bank already watches (this was the
single biggest operational gap in the original platform: everything required
someone to stare at a dashboard).

* **Deduplication / cooldown** — the same alert will not spam a channel
  (``NOTIFY_COOLDOWN_MINUTES``), tracked through ``NotificationLog.DedupeKey``.
* **Delivery log** — every attempt is persisted with status + error.
* **Non-blocking** — sends run in a worker thread so API latency is unaffected;
  failures never propagate to the caller.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.metrics import NOTIFICATIONS
from app.db.dialect import get_flavor
from app.db.repository import fetch_all, fetch_one, insert_row, update_rows
from app.db.tables import NotificationLog

logger = logging.getLogger(__name__)

CHANNEL_EMAIL = "email"
CHANNEL_SLACK = "slack"
CHANNEL_TEAMS = "teams"

_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="notify")
_lock = threading.Lock()


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# --------------------------------------------------------------------------- #
# Channel transports (best effort, never raise)
# --------------------------------------------------------------------------- #
def _send_slack(webhook: str, subject: str, body: str, severity: str) -> tuple[bool, str]:
    """Post a Block-Kit message to a Slack incoming webhook."""
    import httpx

    colour = {"Critical": "#EF4444", "Warning": "#F58220", "Info": "#4F46E5"}.get(severity, "#1E3A5F")
    payload = {
        "text": f"[{severity}] {subject}",
        "attachments": [
            {
                "color": colour,
                "title": subject,
                "text": body,
                "footer": "RPA CoE Control Room",
                "ts": int(_now().timestamp()),
            }
        ],
    }
    try:
        with httpx.Client(timeout=10) as client:
            response = client.post(webhook, json=payload)
        if response.status_code >= 300:
            return False, f"slack HTTP {response.status_code}: {response.text[:150]}"
        return True, "delivered"
    except Exception as exc:  # pragma: no cover - network dependent
        return False, f"slack error: {exc}"[:200]


def _send_teams(webhook: str, subject: str, body: str, severity: str) -> tuple[bool, str]:
    """Post an Adaptive-Card style message to a Teams webhook."""
    import httpx

    colour = {"Critical": "attention", "Warning": "warning", "Info": "good"}.get(severity, "default")
    payload = {
        "@type": "MessageCard",
        "@context": "https://schema.org/extensions",
        "themeColor": {"Critical": "EF4444", "Warning": "F58220", "Info": "4F46E5"}.get(severity, "1E3A5F"),
        "summary": subject,
        "title": subject,
        "text": body,
        "sections": [{"facts": [{"name": "Severity", "value": severity}], "markdown": True}],
        "potentialAction": [],
        "_severity": colour,
    }
    try:
        with httpx.Client(timeout=10) as client:
            response = client.post(webhook, json=payload)
        if response.status_code >= 300:
            return False, f"teams HTTP {response.status_code}: {response.text[:150]}"
        return True, "delivered"
    except Exception as exc:  # pragma: no cover
        return False, f"teams error: {exc}"[:200]


def _send_email(recipients: List[str], subject: str, body: str, severity: str) -> tuple[bool, str]:
    """Send an HTML email through the configured SMTP relay."""
    settings = get_settings()
    if not settings.NOTIFY_SMTP_HOST or not recipients:
        return False, "SMTP not configured"

    message = EmailMessage()
    message["Subject"] = f"[{severity}] {subject}"
    message["From"] = settings.NOTIFY_SMTP_FROM
    message["To"] = ", ".join(recipients)
    message.set_content(body)
    message.add_alternative(
        f"""
        <html><body style="font-family:Segoe UI,Arial,sans-serif;color:#1e293b">
          <div style="border-left:4px solid #F58220;padding:12px 18px;background:#f8fafc">
            <h2 style="margin:0 0 6px;color:#1E3A5F">{subject}</h2>
            <p style="margin:0 0 12px;font-size:12px;color:#64748b">Severity: <b>{severity}</b></p>
            <pre style="white-space:pre-wrap;font-size:13px">{body}</pre>
          </div>
          <p style="font-size:11px;color:#94a3b8">RPA CoE Control Room — automated message</p>
        </body></html>
        """,
        subtype="html",
    )

    try:
        context = ssl.create_default_context()
        if settings.NOTIFY_SMTP_TLS:
            with smtplib.SMTP(settings.NOTIFY_SMTP_HOST, settings.NOTIFY_SMTP_PORT, timeout=15) as server:
                server.starttls(context=context)
                if settings.NOTIFY_SMTP_USER:
                    server.login(settings.NOTIFY_SMTP_USER, settings.NOTIFY_SMTP_PASSWORD)
                server.send_message(message)
        else:
            with smtplib.SMTP_SSL(settings.NOTIFY_SMTP_HOST, settings.NOTIFY_SMTP_PORT, timeout=15, context=context) as server:
                if settings.NOTIFY_SMTP_USER:
                    server.login(settings.NOTIFY_SMTP_USER, settings.NOTIFY_SMTP_PASSWORD)
                server.send_message(message)
        return True, "delivered"
    except Exception as exc:  # pragma: no cover - depends on mail infra
        return False, f"smtp error: {exc}"[:200]


# --------------------------------------------------------------------------- #
# Dispatch
# --------------------------------------------------------------------------- #
def _is_in_cooldown(session: Session, *, dedupe_key: str) -> bool:
    """True when the same alert was delivered inside the cooldown window."""
    settings = get_settings()
    cutoff = _now() - timedelta(minutes=settings.NOTIFY_COOLDOWN_MINUTES)
    row = fetch_one(
        session,
        """
        SELECT NotificationID FROM NotificationLog
        WHERE DedupeKey = :k AND Status = 'Sent' AND CreatedAt >= :cutoff
        """,
        {"k": dedupe_key, "cutoff": cutoff},
        operation="notify.cooldown",
    )
    return bool(row)


def notify(
    session: Session,
    *,
    
    subject: str,
    body: str,
    severity: str = "Info",
    channels: Optional[List[str]] = None,
    recipients: Optional[List[str]] = None,
    dedupe_key: Optional[str] = None,
    related_type: Optional[str] = None,
    related_id: Optional[str] = None,
    force: bool = False,
) -> Dict[str, Any]:
    """Persist + dispatch a notification (respecting cooldown and config).

    Returns a summary of what happened; the caller (usually the capacity engine
    or the ingestion API) never needs to handle delivery errors.
    """
    settings = get_settings()
    dedupe = dedupe_key or f"{severity}:{subject[:120]}"

    if not force and _is_in_cooldown(session, dedupe_key=dedupe):
        return {"queued": False, "reason": "cooldown", "dedupe_key": dedupe}

    requested = channels or _default_channels()
    results: Dict[str, Any] = {"queued": False, "dedupe_key": dedupe, "channels": {}}

    if not settings.NOTIFY_ENABLED:
        # Still log the intent so operators can see what *would* be sent
        insert_row(
            session,
            NotificationLog,
            {
                "Channel": "disabled",
                "Subject": subject[:300],
                "Body": body[:4000],
                "Status": "Skipped",
                "Error": "NOTIFY_ENABLED=false",
                "RelatedType": related_type,
                "RelatedID": str(related_id) if related_id else None,
                "DedupeKey": dedupe[:160],
            },
        )
        return {"queued": False, "reason": "notifications_disabled", "dedupe_key": dedupe}

    for channel in requested:
        log_id = insert_row(
            session,
            NotificationLog,
            {
                "Channel": channel,
                "Target": ",".join(recipients or [])[:300] or None,
                "Subject": subject[:300],
                "Body": body[:4000],
                "Status": "Pending",
                "RelatedType": related_type,
                "RelatedID": str(related_id) if related_id else None,
                "DedupeKey": dedupe[:160],
            },
        )
        results["queued"] = True
        _dispatch_async(log_id, channel, subject, body, severity, recipients or [])

    return results


def _default_channels() -> List[str]:
    """Channels enabled by configuration."""
    settings = get_settings()
    channels: List[str] = []
    if settings.NOTIFY_SLACK_WEBHOOK:
        channels.append(CHANNEL_SLACK)
    if settings.NOTIFY_TEAMS_WEBHOOK:
        channels.append(CHANNEL_TEAMS)
    if settings.NOTIFY_SMTP_HOST:
        channels.append(CHANNEL_EMAIL)
    return channels


def _dispatch_async(
    log_id: int, channel: str, subject: str, body: str, severity: str, recipients: List[str]
) -> None:
    """Send in a worker thread and record the outcome in its own session."""

    def _worker() -> None:
        from app.db.session import session_scope

        ok, message = False, "unknown channel"
        try:
            if channel == CHANNEL_SLACK:
                ok, message = _send_slack(get_settings().NOTIFY_SLACK_WEBHOOK, subject, body, severity)
            elif channel == CHANNEL_TEAMS:
                ok, message = _send_teams(get_settings().NOTIFY_TEAMS_WEBHOOK, subject, body, severity)
            elif channel == CHANNEL_EMAIL:
                ok, message = _send_email(recipients, subject, body, severity)
            else:
                ok, message = False, f"unsupported channel {channel}"
        except Exception as exc:  # pragma: no cover - defensive
            ok, message = False, str(exc)[:200]

        NOTIFICATIONS.labels(channel=channel, status="sent" if ok else "failed").inc()
        try:
            with session_scope() as session:
                update_rows(
                    session,
                    NotificationLog,
                    {
                        "Status": "Sent" if ok else "Failed",
                        "Error": None if ok else message,
                        "SentAt": _now(),
                    },
                    [NotificationLog.c.NotificationID == log_id],
                )
        except Exception as exc:  # pragma: no cover
            logger.error("Unable to record notification outcome: %s", exc)

    with _lock:
        _executor.submit(_worker)


def notify_capacity_recommendations(session: Session, *, recommendations: List[Dict[str, Any]]) -> int:
    """Fan out *critical* capacity insights (used by the scheduler)."""
    sent = 0
    for recommendation in recommendations:
        if recommendation.get("severity") != "Critical":
            continue
        result = notify(
            session,
            
            subject=recommendation.get("title") or "Critical capacity insight",
            body=recommendation.get("detail") or "",
            severity="Critical",
            dedupe_key=f"rec:{recommendation.get('id')}",
            related_type="recommendation",
            related_id=str(recommendation.get("id")),
        )
        sent += 1 if result.get("queued") else 0
    return sent


def list_notifications(session: Session, *, limit: int = 100, status: Optional[str] = None) -> List[Dict[str, Any]]:
    """Delivery log for the operations screen."""
    flavor = get_flavor()
    where = ["1 = 1"]
    params: Dict[str, Any] = {"limit": int(min(limit, 500))}
    if status:
        where.append("Status = :s")
        params["s"] = status

    return fetch_all(
        session,
        f"""
        SELECT {flavor.top(params['limit'])} NotificationID, Channel, Target, Subject, Status, Error,
               RelatedType, RelatedID, CreatedAt, SentAt
        FROM NotificationLog
        WHERE {' AND '.join(where)}
        ORDER BY CreatedAt DESC{flavor.limit(params['limit'])}
        """,
        params,
        operation="notify.list",
    )


def send_test_notification(session: Session, *, severity: str = "Info") -> Dict[str, Any]:
    """Verify channel wiring from the admin settings screen."""
    return notify(
        session,
        
        subject="RPA CoE — رسالة تجريبية",
        body="تم إرسال هذه الرسالة للتأكد من إعدادات قنوات التنبيه (Slack/Teams/Email).",
        severity=severity,
        force=True,
        related_type="test",
    )


def notification_statistics(session: Session, *, days: int = 7) -> Dict[str, Any]:
    """Delivery SLI: how many alerts were delivered vs failed."""
    flavor = get_flavor()
    row = fetch_one(
        session,
        f"""
        SELECT COUNT(1) AS total,
               COALESCE(SUM(CASE WHEN Status = 'Sent' THEN 1 ELSE 0 END), 0) AS sent,
               COALESCE(SUM(CASE WHEN Status = 'Failed' THEN 1 ELSE 0 END), 0) AS failed,
               COALESCE(SUM(CASE WHEN Status = 'Skipped' THEN 1 ELSE 0 END), 0) AS skipped
        FROM NotificationLog
        WHERE CreatedAt >= {flavor.days_ago(int(days))}
        """,
        {},
        operation="notify.stats",
    ) or {}
    total = int(row.get("total") or 0)
    sent = int(row.get("sent") or 0)
    return {
        "total": total,
        "sent": sent,
        "failed": int(row.get("failed") or 0),
        "skipped": int(row.get("skipped") or 0),
        "success_rate": round(sent / total * 100, 1) if total else 0.0,
        "window_days": int(days),
        "enabled": get_settings().NOTIFY_ENABLED,
        "configured_channels": _default_channels(),
    }
