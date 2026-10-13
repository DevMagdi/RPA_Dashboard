"""Capacity Advisor endpoints (recommendation engine)."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.services import audit_service, capacity_service, notification_service
from app.services.auth_service import AuthenticatedUser
from app.services.realtime import hub

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/capacity", tags=["Capacity Advisor"])


class RecommendationDecision(BaseModel):
    """Lifecycle action for a recommendation."""

    Status: str = Field(..., pattern="^(Acknowledged|Requested|Applied|Dismissed|Resolved|Open)$")
    Comment: Optional[str] = Field(None, max_length=4000)


@router.get("/insights", summary="Capacity insights for the dashboard panel")
def insights(
    department: Optional[str] = Query(None),
    refresh: bool = Query(False, description="Recompute instead of using the 45s cache"),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("capacity:read", "*")),
) -> Dict[str, Any]:
    """Runner utilisation, SLA risk, bottlenecks and top recommendations."""
    scope = principal.department
    if principal.department == "ALL" and department:
        scope = department
    return capacity_service.get_capacity_summary(
        db, department_scope=scope, use_cache=not refresh
    )


@router.get("/utilization", summary="Per-process capacity snapshot")
def utilization(
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("capacity:read", "*")),
) -> List[Dict[str, Any]]:
    """Raw capacity analytics (utilisation, queue, predicted wait, SLA verdict)."""
    scopes = capacity_service.compute_capacity(db)
    if principal.department != "ALL":
        scopes = [item for item in scopes if item.department == principal.department]
    return [
        {
            "process_name": item.process_name,
            "department": item.department,
            "criticality": item.criticality,
            "online_runners": item.online_runners,
            "offline_runners": item.offline_runners,
            "utilization_percent": item.utilization_percent,
            "runs_per_day": item.runs_per_day,
            "expected_runs_per_day": item.expected_runs_per_day,
            "throughput_gap_percent": item.throughput_gap_percent,
            "queue_depth": item.queue_depth,
            "predicted_wait_minutes": item.predicted_wait_minutes,
            "sla_target_minutes": item.sla_target_minutes,
            "sla_status": item.sla_status,
            "failure_rate_percent": item.failure_rate_percent,
            "cost_saved_7d": item.cost_saved_7d,
        }
        for item in scopes
    ]


@router.post("/generate", summary="Recompute recommendations now")
async def generate(
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("capacity:act", "*")),
) -> Dict[str, Any]:
    """Run the advisor engine, persist insights and notify on critical ones."""
    recommendations = capacity_service.generate_recommendations(db, persist=True)
    scope = principal.department
    if scope != "ALL":
        recommendations = [r for r in recommendations if r.department in (scope, None)]

    critical = [r for r in recommendations if r.severity == "Critical"]
    sent = notification_service.notify_capacity_recommendations(
        db,
        
        recommendations=[
            {
                "id": getattr(r, "recommendation_id", None),
                "severity": r.severity,
                "title": r.title,
                "detail": r.detail,
            }
            for r in critical
        ],
    )
    audit_service.record(
        db,
        
        action_type="Capacity_Recalculated",
        user_id=principal.user_id,
        new_values={"generated": len(recommendations), "critical": len(critical), "notifications": sent},
    )
    await hub.publish(
        "capacity_update",
        {"critical": len(critical), "generated": len(recommendations)},
        
    )
    return {
        "status": "success",
        "generated": len(recommendations),
        "critical": len(critical),
        "notifications_queued": sent,
        "recommendations": [
            {
                "kind": r.kind,
                "severity": r.severity,
                "process_name": r.process_name,
                "title": r.title,
                "detail": r.detail,
                "metrics": r.metrics,
                "suggested_action": r.suggested_action,
                "action_payload": r.action_payload,
            }
            for r in recommendations[:50]
        ],
    }


@router.get("/recommendations", summary="Recommendation history")
def list_recommendations(
    status_filter: Optional[str] = Query(None, alias="status"),
    severity: Optional[str] = Query(None, pattern="^(Info|Warning|Critical)$"),
    process: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("capacity:read", "*")),
) -> List[Dict[str, Any]]:
    """Filterable history of every insight ever produced (audit friendly)."""
    return capacity_service.list_recommendations(
        db,
        
        status=status_filter,
        severity=severity,
        process_name=process,
        limit=limit,
    )


@router.post("/recommendations/{recommendation_id}/status", summary="Act on a recommendation")
async def update_status(
    recommendation_id: int,
    payload: RecommendationDecision,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("capacity:act", "*")),
) -> Dict[str, Any]:
    """Acknowledge, request capacity, mark applied or dismiss an insight.

    ``Requested`` is the backend of the *"Request Additional Capacity"* button —
    it records the intent, writes the audit entry and notifies the channels so
    the capacity team can act on it.
    """
    try:
        result = capacity_service.set_recommendation_status(
            db,
            
            recommendation_id=recommendation_id,
            status=payload.Status,
            user_id=principal.user_id,
            comment=payload.Comment,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not result:
        raise HTTPException(status_code=404, detail="التوصية غير موجودة")

    audit_service.record(
        db,
        
        action_type=f"Recommendation_{payload.Status}",
        user_id=principal.user_id,
        process_name=result.get("process_name"),
        entity_type="Recommendation",
        entity_id=str(recommendation_id),
        new_values={"status": payload.Status, "comment": payload.Comment, "action": result.get("action_payload")},
    )

    if payload.Status == "Requested":
        notification_service.notify(
            db,
            
            subject=f"طلب سعة إضافية: {result.get('process_name') or 'عام'}",
            body=(
                f"طلب من {principal.username}: {payload.Comment or 'لم يتم إضافة تعليق'}\n"
                f"التفاصيل: {result.get('action_payload')}"
            ),
            severity="Warning",
            dedupe_key=f"capacity_request:{recommendation_id}",
            related_type="recommendation",
            related_id=str(recommendation_id),
        )

    await hub.publish(
        "recommendation_updated",
        {"id": recommendation_id, "status": payload.Status, "by": principal.username},
        
    )
    return {"status": "success", **result}


@router.get("/history", summary="Queue/SLA history for a process")
def history(
    process: Optional[str] = Query(None),
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("capacity:read", "*")),
) -> List[Dict[str, Any]]:
    """Daily queue depth history (backed by queue snapshots)."""
    return capacity_service.capacity_history(
        db, process_name=process, days=days
    )
