"""Audit trail, branded exports and notification endpoints."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.services import audit_service, export_service, notification_service, process_service, run_service
from app.services.auth_service import AuthenticatedUser

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["Audit & Reporting"])


# --------------------------------------------------------------------------- #
# Audit trail
# --------------------------------------------------------------------------- #
@router.get("/audit-logs", summary="Filtered audit trail")
def audit_logs(
    action_type: Optional[str] = Query(None, max_length=60),
    username: Optional[str] = Query(None, max_length=100),
    process_name: Optional[str] = Query(None, max_length=100),
    department: Optional[str] = Query(None, max_length=50),
    days: Optional[int] = Query(None, ge=1, le=3650),
    search: Optional[str] = Query(None, max_length=100),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("audit:read", "*")),
) -> Dict[str, Any]:
    """Query the immutable action log (who / what / when / from where)."""
    since = datetime.utcnow() - timedelta(days=days) if days else None
    items = audit_service.query_logs(
        db,
        
        limit=limit,
        offset=offset,
        action_type=action_type,
        username=username,
        process_name=process_name,
        department=department,
        allowed_department=principal.department,
        since=since,
        search=search,
    )
    for item in items:
        if isinstance(item.get("ActionDate"), datetime):
            item["ActionDate"] = item["ActionDate"].strftime("%Y-%m-%d %H:%M:%S")
        if item.get("IsSuccess") is not None:
            item["IsSuccess"] = bool(item["IsSuccess"])
    return {"items": items, "limit": limit, "offset": offset, "count": len(items)}


@router.get("/audit-logs/summary", summary="Audit activity summary")
def audit_summary(
    days: int = Query(7, ge=1, le=365),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("audit:read", "*")),
) -> Dict[str, Any]:
    """Daily activity histogram + recent failed/denied actions."""
    return {
        "activity": audit_service.summarise_activity(db, days=days),
        "recent_failures": audit_service.recent_critical_events(db, limit=20),
        "window_days": days,
    }


# --------------------------------------------------------------------------- #
# Exports (Excel / PDF, organization-branded)
# --------------------------------------------------------------------------- #
@router.get("/exports/audit.xlsx", summary="Export the audit trail to Excel")
def export_audit_excel(
    days: int = Query(30, ge=1, le=3650),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("export:read", "*")),
) -> Response:
    """Branded XLSX export of the audit trail for the caller's scope."""
    rows = audit_service.query_logs(
        db,
        
        limit=1000,
        allowed_department=principal.department,
        since=datetime.utcnow() - timedelta(days=days),
    )
    columns = ["LogID", "ActionDate", "Username", "ActionType", "ProcessName", "EntityType", "IPAddress", "IsSuccess"]
    payload = export_service.build_excel(
        
        title="Audit Trail",
        columns=columns,
        rows=rows,
        sheet_name="Audit",
        metadata={"Scope": principal.department, "Window": f"{days} days", "Exported by": principal.username},
    )
    filename = f"audit_trail_{datetime.utcnow():%Y%m%d_%H%M}.xlsx"
    return Response(
        content=payload,
        media_type=export_service.excel_mime(),
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/exports/runs.xlsx", summary="Export run history to Excel")
def export_runs_excel(
    days: int = Query(30, ge=1, le=365),
    process: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("export:read", "*")),
) -> Response:
    """Branded XLSX export of runs (with realised savings) for the caller's scope."""
    result = run_service.list_runs(
        db,
        
        department_scope=principal.department,
        process_name=process,
        since=datetime.utcnow() - timedelta(days=days),
        limit=1000,
    )
    columns = [
        "RunID",
        "ProcessName",
        "Department",
        "Status",
        "StartTime",
        "EndTime",
        "DurationMinutes",
        "TransactionsCount",
        "TimeSavedHours",
        "CostSaved",
        "MachineName",
        "FailureReason",
    ]
    payload = export_service.build_excel(
        
        title="Run History",
        columns=columns,
        rows=result["items"],
        sheet_name="Runs",
        metadata={"Window": f"{days} days", "Process": process or "All", "Exported by": principal.username},
    )
    filename = f"runs_{datetime.utcnow():%Y%m%d_%H%M}.xlsx"
    return Response(
        content=payload,
        media_type=export_service.excel_mime(),
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/exports/roi.pdf", summary="Export the ROI pack to PDF")
def export_roi_pdf(
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("export:read", "*")),
) -> Response:
    """Branded PDF ROI pack (executive summary + per-process table)."""
    roi = process_service.roi_summary(db, department_scope=principal.department, days=days)
    total_cost = sum(float(row.get("cost_saved") or 0) for row in roi)
    total_hours = sum(float(row.get("hours_saved") or 0) for row in roi)
    total_transactions = sum(int(row.get("transactions") or 0) for row in roi)

    payload = export_service.build_pdf(
        
        title=f"ROI & Value Realisation Report — last {days} days",
        summary_lines=[
            f"Total cost saved: {total_cost:,.2f} EGP",
            f"Total hours saved: {total_hours:,.1f} hours",
            f"Processed transactions: {total_transactions:,}",
            f"Processes in scope: {len(roi)} · Scope: {principal.department} · Requested by: {principal.username}",
        ],
        sections=[
            {
                "title": "Per-process realisation",
                "columns": [
                    "ProcessName",
                    "Department",
                    "runs",
                    "transactions",
                    "hours_saved",
                    "cost_saved",
                    "target_attainment_percent",
                ],
                "rows": roi,
            }
        ],
    )
    filename = f"roi_report_{datetime.utcnow():%Y%m%d_%H%M}.pdf"
    return Response(
        content=payload,
        media_type=export_service.pdf_mime(),
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/exports/capacity.pdf", summary="Export the capacity report to PDF")
def export_capacity_pdf(
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("export:read", "*")),
) -> Response:
    """Branded PDF capacity pack: utilisation, SLA risk and recommendations."""
    from app.services.capacity_service import get_capacity_summary, list_recommendations

    summary = get_capacity_summary(db, department_scope=principal.department)
    recommendations = list_recommendations(db, status="Open", limit=50)

    metrics = summary.get("summary", {})
    payload = export_service.build_pdf(
        
        title="Capacity & SLA Advisor Report",
        summary_lines=[
            f"Processes analysed: {metrics.get('total_processes', 0)} · Online runners: {metrics.get('online_runners', 0)}",
            f"Weighted runner utilisation: {metrics.get('avg_utilization_percent', 0)}%",
            f"Queue depth: {metrics.get('total_queue_depth', 0):,} items · SLA at risk: {metrics.get('sla_at_risk', 0)}",
            f"Open recommendations: {len(recommendations)} (critical: {metrics.get('critical_count', 0)})",
        ],
        sections=[
            {
                "title": "Runner utilisation & SLA status",
                "columns": [
                    "process_name",
                    "department",
                    "utilization_percent",
                    "queue_depth",
                    "predicted_wait_minutes",
                    "sla_target_minutes",
                    "sla_status",
                ],
                "rows": summary.get("utilization", []),
            },
            {
                "title": "Open recommendations",
                "columns": ["severity", "process_name", "title", "status"],
                "rows": recommendations,
            },
        ],
    )
    filename = f"capacity_report_{datetime.utcnow():%Y%m%d_%H%M}.pdf"
    return Response(
        content=payload,
        media_type=export_service.pdf_mime(),
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --------------------------------------------------------------------------- #
# Notifications
# --------------------------------------------------------------------------- #
class TestNotificationRequest(BaseModel):
    """Send a test alert to verify channel wiring."""

    Severity: str = Field("Info", pattern="^(Info|Warning|Critical)$")


@router.get("/notifications", summary="Notification delivery log")
def list_notifications(
    status_filter: Optional[str] = Query(None, alias="status", pattern="^(Pending|Sent|Failed|Skipped)$"),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("audit:read", "*")),
) -> List[Dict[str, Any]]:
    """History of Slack/Teams/Email alerts issued by the platform."""
    return notification_service.list_notifications(
        db, limit=limit, status=status_filter
    )


@router.get("/notifications/statistics", summary="Notification delivery SLI")
def notification_stats(
    days: int = Query(7, ge=1, le=90),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("audit:read", "*")),
) -> Dict[str, Any]:
    """Delivery success rate and configured channels."""
    return notification_service.notification_statistics(db, days=days)


@router.post("/notifications/test", summary="Send a test notification")
def send_test_notification(
    payload: TestNotificationRequest,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("*")),
) -> Dict[str, Any]:
    """Verify Slack/Teams/Email configuration from the admin screen."""
    result = notification_service.send_test_notification(
        db, severity=payload.Severity
    )
    audit_service.record(
        db,
        
        action_type="Notification_Test",
        user_id=principal.user_id,
        new_values=result,
    )
    if not result.get("queued"):
        raise HTTPException(
            status_code=400,
            detail=f"لم يتم إرسال الرسالة: {result.get('reason', 'unknown')} — راجع إعدادات قنوات التنبيه",
        )
    return {"status": "success", **result}
