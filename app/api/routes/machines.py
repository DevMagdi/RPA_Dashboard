"""Infrastructure (runner fleet), control commands and platform-sync endpoints."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.services import audit_service, infra_service, sync_service
from app.services.auth_service import AuthenticatedUser
from app.services.dashboard_service import invalidate_dashboard_cache
from app.services.infra_service import InfraError
from app.services.realtime import hub

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["Infrastructure"])


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class MachineRegistration(BaseModel):
    """Register a new runner."""

    MachineName: str = Field(..., min_length=1, max_length=100)
    AssignedBot: Optional[str] = Field(None, max_length=100, description="Process name the runner serves")
    RunnerType: str = Field("Unattended", pattern="^(Unattended|Attended|TestBot)$")
    TotalRAM_GB: int = Field(..., gt=0, le=4096)
    TotalHDD_GB: int = Field(..., gt=0, le=1_000_000)
    Platform: str = Field("generic_sql", max_length=40)
    RobotCapacity: int = Field(1, ge=1, le=100)


class MachineUpdate(BaseModel):
    """Update runner attributes."""

    AssignedBot: Optional[str] = Field(None, max_length=100)
    RunnerType: Optional[str] = Field(None, pattern="^(Unattended|Attended|TestBot)$")
    TotalRAM_GB: Optional[int] = Field(None, gt=0, le=4096)
    TotalHDD_GB: Optional[int] = Field(None, gt=0, le=1_000_000)
    RobotCapacity: Optional[int] = Field(None, ge=1, le=100)


class CommandRequest(BaseModel):
    """Dispatch a command to a runner agent."""

    Command: str = Field(..., pattern="^(RUN_BOT|STOP_BOT|PING|REFRESH_CONFIG|UPDATE_AGENT)$")
    ProcessName: Optional[str] = Field(None, max_length=100)
    RunID: Optional[int] = None
    Parameters: Dict[str, Any] = Field(default_factory=dict)
    Reason: Optional[str] = Field(None, max_length=300)
    TimeoutSeconds: int = Field(60, ge=5, le=3600)


class JobControlRequest(BaseModel):
    """Start/stop a job through the configured platform adapter."""

    ProcessName: str = Field(..., min_length=1, max_length=100)
    MachineNames: List[str] = Field(default_factory=list)
    Arguments: Dict[str, Any] = Field(default_factory=dict)
    Reason: Optional[str] = Field(None, max_length=300)
    Priority: str = Field("Normal", max_length=20)
    IdempotencyKey: Optional[str] = Field(
        None,
        max_length=120,
        description=(
            "Caller-supplied key making job starts safe to retry: resubmitting the "
            "same key does not start the job twice, and the response always carries "
            "the job's external_id (generated server-side when omitted)."
        ),
    )


# --------------------------------------------------------------------------- #
# Fleet
# --------------------------------------------------------------------------- #
@router.get("/infrastructure", summary="Runner fleet with live health")
def infrastructure(
    include_deleted: bool = Query(False),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("infrastructure:read", "*")),
) -> List[Dict[str, Any]]:
    """Machines with resource usage, health status and staleness flags."""
    return infra_service.list_machines(db, tenant_id=principal.tenant_id, include_deleted=include_deleted)


@router.get("/infrastructure/summary", summary="Fleet KPIs")
def infrastructure_summary(
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("infrastructure:read", "*")),
) -> Dict[str, Any]:
    """Online/offline/warning counts and average utilisation."""
    return infra_service.fleet_summary(db, tenant_id=principal.tenant_id)


@router.post("/register-machine", status_code=201, summary="Register a runner + enrolment code")
def register_machine(
    payload: MachineRegistration,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("infrastructure:write", "*")),
) -> Dict[str, Any]:
    """Add a machine to the fleet and return its one-time enrolment code."""
    try:
        result = infra_service.register_machine(
            db,
            tenant_id=principal.tenant_id,
            machine_name=payload.MachineName,
            assigned_process=payload.AssignedBot,
            runner_type=payload.RunnerType,
            total_ram_gb=payload.TotalRAM_GB,
            total_hdd_gb=payload.TotalHDD_GB,
            platform=payload.Platform,
            robot_capacity=payload.RobotCapacity,
        )
    except InfraError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    audit_service.record(
        db,
        tenant_id=principal.tenant_id,
        action_type="Register_Machine",
        user_id=principal.user_id,
        entity_type="BotInfrastructure",
        entity_id=str(result["machine_id"]),
        new_values={
            "MachineName": payload.MachineName,
            "AssignedBot": payload.AssignedBot,
            "RunnerType": payload.RunnerType,
        },
    )
    invalidate_dashboard_cache(principal.tenant_id)
    return {"status": "success", **result}


@router.post("/regenerate-enrollment-code/{machine_name}", summary="Issue a new enrolment code")
def regenerate_enrollment(
    machine_name: str,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("infrastructure:write", "*")),
) -> Dict[str, Any]:
    """Invalidate old codes and issue a fresh one (15 min TTL by default)."""
    machines = infra_service.list_machines(db, tenant_id=principal.tenant_id)
    if not any(m.get("MachineName") == machine_name for m in machines):
        raise HTTPException(status_code=404, detail="الجهاز غير مسجل في النظام")

    result = infra_service.issue_enrollment_code(db, tenant_id=principal.tenant_id, machine_name=machine_name)
    audit_service.record(
        db,
        tenant_id=principal.tenant_id,
        action_type="Regenerate_Enrollment_Code",
        user_id=principal.user_id,
        entity_type="BotInfrastructure",
        entity_id=machine_name,
    )
    return {"status": "success", **result}


@router.post("/update-machine", summary="Update runner attributes")
def update_machine(
    payload: MachineUpdate,
    machine_name: str = Query(..., alias="machine_name"),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("infrastructure:write", "*")),
) -> Dict[str, Any]:
    """Change assignment/type/capacity (capacity drives the advisor maths)."""
    try:
        affected = infra_service.update_machine(
            db,
            tenant_id=principal.tenant_id,
            machine_name=machine_name,
            assigned_process=payload.AssignedBot,
            runner_type=payload.RunnerType,
            total_ram_gb=payload.TotalRAM_GB,
            total_hdd_gb=payload.TotalHDD_GB,
            robot_capacity=payload.RobotCapacity,
        )
    except InfraError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not affected:
        raise HTTPException(status_code=404, detail="الجهاز غير موجود")
    audit_service.record(
        db,
        tenant_id=principal.tenant_id,
        action_type="Update_Machine",
        user_id=principal.user_id,
        entity_type="BotInfrastructure",
        entity_id=machine_name,
        new_values=payload.model_dump(exclude_none=True),
    )
    return {"status": "success", "message": "تم تحديث بيانات الجهاز"}


@router.delete("/machines/{machine_name}", summary="Soft delete a runner")
def delete_machine(
    machine_name: str,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("infrastructure:write", "*")),
) -> Dict[str, Any]:
    """Remove a runner from the active fleet (telemetry history preserved)."""
    affected = infra_service.soft_delete_machine(db, tenant_id=principal.tenant_id, machine_name=machine_name)
    if not affected:
        raise HTTPException(status_code=404, detail="الجهاز غير موجود")
    audit_service.record(
        db,
        tenant_id=principal.tenant_id,
        action_type="Delete_Machine",
        user_id=principal.user_id,
        entity_type="BotInfrastructure",
        entity_id=machine_name,
    )
    return {"status": "success", "affected": affected}


@router.post("/machines/{machine_name}/revoke-token", summary="Revoke a runner's credentials")
def revoke_token(
    machine_name: str,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("infrastructure:write", "*")),
) -> Dict[str, Any]:
    """Invalidate the agent token (stolen VM / decommissioned host)."""
    affected = infra_service.revoke_agent_token(db, tenant_id=principal.tenant_id, machine_name=machine_name)
    if not affected:
        raise HTTPException(status_code=404, detail="الجهاز غير موجود")
    audit_service.record(
        db,
        tenant_id=principal.tenant_id,
        action_type="Revoke_Agent_Token",
        user_id=principal.user_id,
        entity_type="BotInfrastructure",
        entity_id=machine_name,
    )
    return {"status": "success", "message": "تم إلغاء توكن الجهاز — يجب إعادة التسجيل من جديد"}


# --------------------------------------------------------------------------- #
# Control
# --------------------------------------------------------------------------- #
@router.post("/machines/{machine_name}/commands", summary="Send a command to a runner")
async def send_command(
    machine_name: str,
    payload: CommandRequest,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("commands:write", "*")),
) -> Dict[str, Any]:
    """Queue a command and deliver it immediately when the agent is connected."""
    command_payload = {
        "process_name": payload.ProcessName,
        "run_id": payload.RunID,
        "parameters": payload.Parameters,
        "reason": payload.Reason,
        "issued_by": principal.username,
    }
    try:
        result = infra_service.issue_command(
            db,
            tenant_id=principal.tenant_id,
            machine_name=machine_name,
            command=payload.Command,
            payload=command_payload,
            issued_by=principal.user_id,
            timeout_seconds=payload.TimeoutSeconds,
        )
    except InfraError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    delivered = await hub.send_to_agent(
        machine_name,
        {
            "type": "command",
            "command_id": result["command_id"],
            "command": payload.Command,
            **command_payload,
        },
    )
    if delivered:
        infra_service.mark_command_delivered(db, tenant_id=principal.tenant_id, command_id=result["command_id"])
        result["delivered"] = True
        result["status"] = "Sent"

    audit_service.record(
        db,
        tenant_id=principal.tenant_id,
        action_type="Command_Issued",
        user_id=principal.user_id,
        process_name=payload.ProcessName,
        entity_type="BotCommand",
        entity_id=str(result["command_id"]),
        new_values={"machine": machine_name, "command": payload.Command, "delivered": delivered},
    )
    return {"status": "success", **result}


@router.get("/commands", summary="Command history")
def list_commands(
    machine_name: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("infrastructure:read", "*")),
) -> List[Dict[str, Any]]:
    """Audit of every start/stop/ping issued from the Control Room."""
    return infra_service.list_commands(
        db, tenant_id=principal.tenant_id, machine_name=machine_name, status=status_filter, limit=limit
    )


@router.post("/jobs/start", summary="Start a job on the configured platform")
async def start_job(
    payload: JobControlRequest,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("commands:write", "*")),
) -> Dict[str, Any]:
    """Dispatch a start request through the tenant's platform adapter."""
    from app.platforms.base import JobStartRequest
    from app.platforms.registry import get_adapter_for_tenant

    process = fetch_process(db, principal.tenant_id, payload.ProcessName)
    if not process:
        raise HTTPException(status_code=404, detail="العملية غير موجودة")

    adapter = get_adapter_for_tenant(principal.tenant_id)
    if not adapter.capabilities().get("start_job"):
        raise HTTPException(status_code=501, detail="المزوّد الحالي لا يدعم بدء التشغيل مباشرة")

    request = JobStartRequest(
        process_key=str(process.get("PlatformProcessKey") or payload.ProcessName),
        machine_keys=payload.MachineNames,
        arguments=payload.Arguments,
        priority=payload.Priority,
        idempotency_key=payload.IdempotencyKey,
        trigger="manual",
        triggered_by=principal.username,
        reason=payload.Reason,
    )
    handle = adapter.start_job(request)
    # The caller must always learn the job's identity — adapters echo the
    # idempotency key or generate one (see generic_sql) — but never trust a
    # vendor to do it: fall back to the submitted/generated key here.
    external_id = handle.external_id or payload.IdempotencyKey

    audit_service.record(
        db,
        tenant_id=principal.tenant_id,
        action_type="Job_Start_Requested",
        user_id=principal.user_id,
        process_name=payload.ProcessName,
        new_values={
            "provider": adapter.name,
            "accepted": handle.accepted,
            "external_id": external_id,
            "idempotency_key": payload.IdempotencyKey,
            "reason": payload.Reason,
            "machines": payload.MachineNames,
        },
        is_success=handle.accepted,
    )
    if not handle.accepted:
        raise HTTPException(status_code=502, detail=handle.message or "فشل بدء التشغيل")
    return {
        "status": "success",
        "provider": adapter.name,
        "external_id": external_id,
        "idempotency_key": payload.IdempotencyKey,
        "job_status": handle.status.value,
        "message": handle.message,
    }


@router.post("/jobs/{external_id}/stop", summary="Stop a running job")
async def stop_job(
    external_id: str,
    reason: Optional[str] = Query(None, max_length=300),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("commands:write", "*")),
) -> Dict[str, Any]:
    """Stop a job on the platform adapter (UiPath/AA) or the native agent."""
    from app.platforms.registry import get_adapter_for_tenant

    adapter = get_adapter_for_tenant(principal.tenant_id)
    handle = adapter.stop_job(external_id, reason=reason)
    audit_service.record(
        db,
        tenant_id=principal.tenant_id,
        action_type="Job_Stop_Requested",
        user_id=principal.user_id,
        entity_type="Job",
        entity_id=external_id,
        new_values={"provider": adapter.name, "reason": reason},
        is_success=handle.accepted,
    )
    return {"status": "success", "provider": adapter.name, "message": handle.message}


# --------------------------------------------------------------------------- #
# Platform (multi-vendor) operations
# --------------------------------------------------------------------------- #
@router.get("/platform/providers", summary="Supported RPA platforms")
def providers(principal: AuthenticatedUser = Depends(require_permission("infrastructure:read", "*"))) -> List[Dict[str, Any]]:
    """Catalogue of adapters with their capability matrix (setup wizard)."""
    from app.services.tenant_service import list_providers

    return list_providers()


@router.get("/platform/health", summary="Provider connectivity check")
def platform_health(
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("infrastructure:read", "*")),
) -> Dict[str, Any]:
    """Ping the configured platform (used by the health page)."""
    from app.platforms.registry import platform_health as probe

    return probe(principal.tenant_id)


@router.post("/platform/sync", summary="Trigger a platform synchronisation")
async def trigger_sync(
    lookback_days: int = Query(2, ge=1, le=30),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("infrastructure:write", "*")),
) -> Dict[str, Any]:
    """Pull telemetry from UiPath / Automation Anywhere on demand."""
    import asyncio

    result = await asyncio.to_thread(sync_service.sync_tenant, principal.tenant_id, lookback_days=lookback_days, force=True)
    audit_service.record(
        db,
        tenant_id=principal.tenant_id,
        action_type="Platform_Sync",
        user_id=principal.user_id,
        new_values={k: str(v)[:200] for k, v in result.items()},
        is_success=bool(result.get("ok")),
    )
    invalidate_dashboard_cache(principal.tenant_id)
    return result


@router.get("/platform/sync-history", summary="Recent sync operations")
def sync_history(
    limit: int = Query(20, ge=1, le=200),
    principal: AuthenticatedUser = Depends(require_permission("infrastructure:read", "*")),
) -> List[Dict[str, Any]]:
    """Diagnostics for the platform integration."""
    return sync_service.sync_history(principal.tenant_id, limit=limit)


def fetch_process(db: Session, tenant_id: int, process_name: str) -> Optional[Dict[str, Any]]:
    """Small local helper (keeps the route file free of raw SQL)."""
    from app.db.repository import fetch_one

    return fetch_one(
        db,
        "SELECT ProcessName, PlatformProcessKey, Provider FROM ProcessConfig WHERE TenantID = :t AND ProcessName = :p",
        {"t": tenant_id, "p": process_name},
        operation="machines.fetch_process",
    )
