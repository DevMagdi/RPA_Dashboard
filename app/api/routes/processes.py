"""Process catalogue, ROI, SLA and workload endpoints."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.services import audit_service, process_service, sla_service
from app.services.auth_service import AuthenticatedUser
from app.services.dashboard_service import invalidate_dashboard_cache

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["Processes"])


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class ROIConfigUpdate(BaseModel):
    """ROI configuration payload (backward compatible with the original API)."""

    ProcessName: str = Field(..., min_length=1, max_length=100)
    EmpMinutesPerRequest: float = Field(..., ge=0, le=100_000)
    EmpCostPerRequest: float = Field(..., ge=0, le=1_000_000)
    BotCostPerRequest: float = Field(..., ge=0, le=1_000_000)
    ExpectedRunsPerDay: int = Field(..., ge=0, le=100_000)
    Department: Optional[str] = Field(None, max_length=50)
    BotName: Optional[str] = Field(None, max_length=100)
    Criticality: Optional[str] = Field(None, max_length=20)


class SLAConfigUpdate(BaseModel):
    """SLA configuration payload."""

    ProcessName: str = Field(..., min_length=1, max_length=100)
    SLATargetMinutes: int = Field(..., gt=0, le=100_000)
    AvgItemProcessingSeconds: int = Field(..., gt=0, le=100_000)
    SLAWarningRatio: float = Field(0.75, ge=0.1, le=1.0)


class QueueTelemetry(BaseModel):
    """Queue depth telemetry pushed by bots/queues."""

    ProcessName: str = Field(..., min_length=1, max_length=100)
    PendingItems: int = Field(..., ge=0, le=10_000_000)
    ActiveItems: int = Field(..., ge=0, le=10_000_000)
    AvgItemProcessingSeconds: Optional[int] = Field(None, gt=0, le=100_000)


class ProcessActiveUpdate(BaseModel):
    """Enable/disable a process."""

    IsActive: bool


# --------------------------------------------------------------------------- #
# Catalogue
# --------------------------------------------------------------------------- #
@router.get("/processes", summary="Paginated process catalogue")
def list_processes(
    search: Optional[str] = Query(None, max_length=100),
    department: Optional[str] = Query(None, max_length=50),
    after: Optional[str] = Query(None, description="Keyset cursor (last ProcessName)"),
    page_size: int = Query(200, ge=1, le=1000),
    include_total: bool = Query(False),
    include_inactive: bool = Query(False),
    sort_by: str = Query("ProcessName"),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("processes:read", "*")),
) -> Dict[str, Any]:
    """Keyset-paginated list — stable and index friendly for large catalogues."""
    return process_service.list_processes(
        db,
        tenant_id=principal.tenant_id,
        department_scope=principal.department,
        search=search,
        department=department,
        after=after,
        page_size=page_size,
        sort_by=sort_by,
        sort_dir=sort_dir,
        include_total=include_total,
        include_inactive=include_inactive,
    )


@router.get("/processes/{process_name}", summary="Single process configuration")
def get_process(
    process_name: str,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("processes:read", "*")),
) -> Dict[str, Any]:
    """Return one process (403 when outside the caller's department scope)."""
    row = process_service.get_process(db, tenant_id=principal.tenant_id, process_name=process_name)
    if not row:
        raise HTTPException(status_code=404, detail="العملية غير موجودة")
    if principal.department != "ALL" and str(row.get("Department")) != principal.department:
        raise HTTPException(status_code=403, detail="غير مصرح لك برؤية هذه العملية")
    return row


@router.get("/processes-meta/departments", summary="Department rollup")
def department_stats(
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("processes:read", "*")),
) -> List[Dict[str, Any]]:
    """Process counts per department (sidebar tree / filters)."""
    return process_service.department_stats(db, tenant_id=principal.tenant_id)


@router.get("/processes-meta/roi-summary", summary="ROI realisation per process")
def roi_summary(
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("processes:read", "*")),
) -> List[Dict[str, Any]]:
    """Realised savings, hours saved and target attainment."""
    return process_service.roi_summary(
        db, tenant_id=principal.tenant_id, department_scope=principal.department, days=days
    )


@router.patch("/processes/{process_name}/active", summary="Enable/disable a process")
def set_process_active(
    process_name: str,
    payload: ProcessActiveUpdate,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("processes:write", "*")),
) -> Dict[str, Any]:
    """Toggle a process without deleting its history."""
    affected = process_service.set_active(
        db, tenant_id=principal.tenant_id, process_name=process_name, is_active=payload.IsActive
    )
    if not affected:
        raise HTTPException(status_code=404, detail="العملية غير موجودة")
    audit_service.record(
        db,
        tenant_id=principal.tenant_id,
        action_type="Process_Activation_Changed",
        user_id=principal.user_id,
        process_name=process_name,
        new_values={"IsActive": payload.IsActive},
    )
    invalidate_dashboard_cache(principal.tenant_id)
    return {"status": "success", "is_active": payload.IsActive}


@router.delete("/processes/{process_name}", summary="Soft delete a process")
def delete_process(
    process_name: str,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("processes:write", "*")),
) -> Dict[str, Any]:
    """Logically delete a process (audit + history preserved)."""
    affected = process_service.soft_delete_process(db, tenant_id=principal.tenant_id, process_name=process_name)
    if not affected:
        raise HTTPException(status_code=404, detail="العملية غير موجودة")
    audit_service.record(
        db,
        tenant_id=principal.tenant_id,
        action_type="Delete_Process",
        user_id=principal.user_id,
        process_name=process_name,
    )
    invalidate_dashboard_cache(principal.tenant_id)
    return {"status": "success", "message": "تم حذف العملية (يمكن استرجاعها من قاعدة البيانات)"}


# --------------------------------------------------------------------------- #
# ROI
# --------------------------------------------------------------------------- #
@router.post("/update-roi", summary="Create/update ROI configuration")
def update_roi(
    payload: ROIConfigUpdate,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("roi:write", "*")),
) -> Dict[str, Any]:
    """Upsert ROI parameters; creates the process when it does not exist yet."""
    if principal.department != "ALL" and payload.Department and payload.Department != principal.department:
        raise HTTPException(status_code=403, detail="لا يمكنك تعديل عملية خارج قسمك")

    try:
        result = process_service.update_roi(
            db,
            tenant_id=principal.tenant_id,
            process_name=payload.ProcessName,
            emp_minutes_per_request=payload.EmpMinutesPerRequest,
            emp_cost_per_request=payload.EmpCostPerRequest,
            bot_cost_per_request=payload.BotCostPerRequest,
            expected_runs_per_day=payload.ExpectedRunsPerDay,
            department=payload.Department,
            bot_name=payload.BotName,
            criticality=payload.Criticality,
            updated_by=principal.user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    audit_service.record(
        db,
        tenant_id=principal.tenant_id,
        action_type="Create_Process_ROI" if result["created"] else "Update_ROI",
        user_id=principal.user_id,
        process_name=payload.ProcessName,
        old_values=result["before"],
        new_values=result["after"],
    )
    invalidate_dashboard_cache(principal.tenant_id)
    return {
        "status": "success",
        "created": result["created"],
        "message": "تم إنشاء العملية وحفظ بيانات الـ ROI" if result["created"] else "تم تحديث بيانات الـ ROI",
    }


# --------------------------------------------------------------------------- #
# SLA & workload
# --------------------------------------------------------------------------- #
@router.post("/update-sla", summary="Update SLA target & queue processing time")
def update_sla(
    payload: SLAConfigUpdate,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("sla:write", "*")),
) -> Dict[str, Any]:
    """Set the SLA target and the average item processing time."""
    try:
        result = process_service.update_sla(
            db,
            tenant_id=principal.tenant_id,
            process_name=payload.ProcessName,
            sla_target_minutes=payload.SLATargetMinutes,
            avg_item_processing_seconds=payload.AvgItemProcessingSeconds,
            warning_ratio=payload.SLAWarningRatio,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    audit_service.record(
        db,
        tenant_id=principal.tenant_id,
        action_type="Update_SLA",
        user_id=principal.user_id,
        process_name=payload.ProcessName,
        old_values=result["before"],
        new_values=result["after"],
    )
    invalidate_dashboard_cache(principal.tenant_id)
    return {"status": "success", "message": "تم تحديث إعدادات الـ SLA"}


@router.get("/sla-workload", summary="Queue workload with SLA verdicts")
def sla_workload(
    process: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("dashboard:read", "*")),
) -> List[Dict[str, Any]]:
    """Per-process queue depth, predicted drain time and SLA status."""
    return sla_service.get_workload(
        db, tenant_id=principal.tenant_id, department_scope=principal.department, process_name=process
    )


@router.post("/queues/telemetry", summary="Push queue depth telemetry")
def queue_telemetry(
    payload: QueueTelemetry,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("processes:write", "*")),
) -> Dict[str, Any]:
    """Upsert queue depth (called by the scheduler or an integration job)."""
    if not process_service.process_exists(db, tenant_id=principal.tenant_id, process_name=payload.ProcessName):
        raise HTTPException(status_code=404, detail="العملية غير موجودة")

    result = sla_service.update_queue_telemetry(
        db,
        tenant_id=principal.tenant_id,
        process_name=payload.ProcessName,
        pending_items=payload.PendingItems,
        active_items=payload.ActiveItems,
        avg_item_processing_seconds=payload.AvgItemProcessingSeconds,
    )
    audit_service.record(
        db,
        tenant_id=principal.tenant_id,
        action_type="Queue_Telemetry",
        user_id=principal.user_id,
        process_name=payload.ProcessName,
        new_values={k: str(v) for k, v in result.items()},
    )
    invalidate_dashboard_cache(principal.tenant_id)
    return {"status": "success", "data": {k: str(v) for k, v in result.items()}}
