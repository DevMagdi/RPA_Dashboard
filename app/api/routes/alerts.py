"""Alerting endpoints: list, acknowledge/resolve, manual evaluation."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.services import alert_service, audit_service
from app.services.auth_service import AuthenticatedUser

router = APIRouter(prefix="/api/alerts", tags=["Alerts"])


class AlertStatusUpdate(BaseModel):
    Status: str = Field(..., pattern="^(Open|Acknowledged|Resolved)$")


@router.get("", summary="Alerts (Open / Acknowledged / Resolved)")
def list_alerts(
    status: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("dashboard:read", "*")),
) -> List[Dict[str, Any]]:
    return alert_service.list_alerts(db, status=status, limit=limit)


@router.get("/count", summary="Open alert count (bell badge)")
def alert_count(
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("dashboard:read", "*")),
) -> Dict[str, Any]:
    return {"open": alert_service.open_alert_count(db)}


@router.patch("/{alert_id}", summary="Acknowledge / resolve an alert")
def update_alert(
    alert_id: int,
    payload: AlertStatusUpdate,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("dashboard:read", "*")),
) -> Dict[str, Any]:
    try:
        affected = alert_service.set_alert_status(db, alert_id=alert_id, status=payload.Status, user_id=principal.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not affected:
        raise HTTPException(status_code=404, detail="التنبيه غير موجود")
    audit_service.record(
        db,
        action_type=f"Alert_{payload.Status}",
        user_id=principal.user_id,
        entity_type="Alert",
        entity_id=str(alert_id),
    )
    return {"status": "success", "affected": affected}


@router.post("/evaluate", summary="Evaluate alert rules now")
def evaluate(
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("commands:write", "*")),
) -> Dict[str, Any]:
    results = alert_service.evaluate_alerts(db)
    audit_service.record(db, action_type="Alerts_Evaluated", user_id=principal.user_id, new_values={"touched": len(results)})
    return {"status": "success", "touched": len(results), "open": alert_service.open_alert_count(db)}
