"""Dashboard, realtime streaming and branding endpoints."""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import RequestMeta, current_principal, get_db, rate_limit, request_meta, require_permission
from app.services import audit_service
from app.services.auth_service import AuthenticatedUser
from app.services.dashboard_service import get_dashboard, process_options, invalidate_dashboard_cache
from app.services.realtime import hub
from app.services.sla_service import backlog_trend, sla_summary
from app.services.tenant_service import get_branding

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["Dashboard"])


@router.get("/dashboard-data", summary="Aggregated dashboard payload")
def dashboard_data(
    process: Optional[str] = Query(None, description="Process filter (or 'All')"),
    days: int = Query(90, ge=1, le=730),
    department: Optional[str] = Query(None, description="Department filter (SuperAdmin/ALL scope only)"),
    refresh: bool = Query(False, description="Bypass the 20s cache"),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(current_principal),
) -> Dict[str, Any]:
    """Return KPIs, charts, recent runs, capacity insights and metadata."""
    scope = principal.department or "ALL"
    if principal.department != "ALL" and department and department != principal.department:
        # A department-scoped user can never widen their own scope
        scope = principal.department
    elif principal.department == "ALL" and department:
        scope = department

    payload = get_dashboard(
        db,
        tenant_id=principal.tenant_id,
        department_scope=scope,
        process=process,
        days=days,
        use_cache=not refresh,
    )
    payload["scope"] = {
        "department": scope,
        "process": process or "All",
        "days": days,
        "role": principal.role,
    }
    return payload


@router.get("/dashboard/process-options", summary="Process filter options")
def process_filter_options(
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(current_principal),
) -> List[str]:
    """Distinct process names visible to the caller."""
    return process_options(db, tenant_id=principal.tenant_id, department_scope=principal.department)


@router.get("/dashboard/sla-summary", summary="SLA headline numbers")
def sla_headline(
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(current_principal),
) -> Dict[str, Any]:
    """Counts of healthy / warning / breach-risk processes."""
    return sla_summary(db, tenant_id=principal.tenant_id, department_scope=principal.department)


@router.get("/dashboard/backlog-trend", summary="Queue backlog trend")
def backlog(
    process_name: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(current_principal),
) -> List[Dict[str, Any]]:
    """Backlog trend from queue snapshots (last 48 h)."""
    return backlog_trend(db, tenant_id=principal.tenant_id, process_name=process_name)


@router.post("/dashboard/refresh", summary="Invalidate cached dashboard data")
def refresh_cache(
    request: Request,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("dashboard:read", "*")),
    meta: RequestMeta = Depends(request_meta),
) -> Dict[str, Any]:
    """Force the next dashboard read to rebuild (used after bulk imports)."""
    invalidate_dashboard_cache(principal.tenant_id)
    audit_service.record(
        db,
        tenant_id=principal.tenant_id,
        action_type="Dashboard_Refreshed",
        user_id=principal.user_id,
        ip_address=meta.ip_address,
        user_agent=meta.user_agent,
    )
    return {"status": "success", "message": "تم تحديث ذاكرة الداشبورد"}


# --------------------------------------------------------------------------- #
# Branding (public: needed to render the login screen)
# --------------------------------------------------------------------------- #
@router.get("/branding", tags=["Tenants"], summary="Tenant branding for the UI")
def branding(request: Request, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Return white-label branding (logo, colours, locale) for the frontend."""
    from app.db.repository import fetch_one

    tenant_key = request.headers.get("x-tenant-key") or "default"
    tenant = fetch_one(
        db,
        "SELECT TenantID FROM Tenants WHERE TenantKey = :k AND IsActive = 1",
        {"k": tenant_key},
        operation="branding.lookup",
    )
    if not tenant:
        tenant = fetch_one(
            db, "SELECT TenantID FROM Tenants WHERE IsActive = 1 ORDER BY TenantID", operation="branding.default"
        )
    tenant_id = int(tenant["TenantID"]) if tenant else 1
    payload = get_branding(db, tenant_id)
    payload["api_version"] = "3.0.0"
    payload["features"] = {
        "mfa": True,
        "realtime": True,
        "capacity_advisor": True,
        "multi_vendor": True,
        "exports": True,
    }
    return payload


# --------------------------------------------------------------------------- #
# Realtime (SSE)
# --------------------------------------------------------------------------- #
@router.get("/realtime/events", summary="Server-Sent Events stream")
async def realtime_events(
    request: Request,
    principal: AuthenticatedUser = Depends(current_principal),
    _limit=Depends(rate_limit(10, 60, "sse")),
) -> StreamingResponse:
    """Stream live KPI/capacity events for the dashboard.

    SSE was chosen over WebSockets for the browser client: it survives corporate
    proxies, reconnects automatically and needs no client library.  A
    bidirectional socket is available at ``/ws/realtime`` for the control console.
    """
    subscriber_id = f"{principal.tenant_id}:{principal.user_id}:{uuid.uuid4().hex[:8]}"

    async def _generator():
        try:
            async for event in hub.subscribe_sse(
                subscriber_id=subscriber_id,
                tenant_id=principal.tenant_id,
                user_id=principal.user_id,
                department=principal.department,
                role=principal.role,
            ):
                if await request.is_disconnected():
                    break
                yield event
        except asyncio.CancelledError:  # pragma: no cover - client disconnect
            raise

    return StreamingResponse(
        _generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/realtime/status", summary="Realtime hub diagnostics")
def realtime_status(principal: AuthenticatedUser = Depends(require_permission("dashboard:read", "*"))) -> Dict[str, Any]:
    """How many clients/agents are connected right now."""
    return hub.snapshot()


class TriggerSnapshotRequest(BaseModel):
    """Request a fresh snapshot fan-out (e.g. after a bulk change)."""

    reason: str = Field("manual", max_length=120)


@router.post("/realtime/broadcast", summary="Push a refresh to all clients")
async def broadcast_refresh(
    payload: TriggerSnapshotRequest,
    principal: AuthenticatedUser = Depends(require_permission("dashboard:read", "*")),
    meta=Depends(require_permission("dashboard:read", "*")),
) -> Dict[str, Any]:
    """Notify every connected client that data changed (cheap, no payload)."""
    delivered = await hub.publish(
        "data_changed", {"reason": payload.reason, "by": principal.username}, tenant_id=principal.tenant_id
    )
    return {"status": "success", "delivered": delivered}
