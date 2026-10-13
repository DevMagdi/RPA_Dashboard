"""Bot run ingestion & query endpoints.

These endpoints *close the loop*: before this refactor nothing in the platform
could create a ``ProcessRuns`` row, so every KPI had to be seeded by hand.

``POST /api/runs/start``           — register the start of a run (idempotent)
``POST /api/runs/{id}/complete``   — finalise a run (status, transactions, savings)
``POST /api/runs/{id}/progress``   — live progress for long-running jobs
``POST /api/runs/{id}/heartbeat``  — liveness heartbeat (updates LastHeartbeatAt)
``GET  /api/runs``                 — filtered, paginated run history
``GET  /api/runs/statistics``      — daily distribution
``GET  /api/runs/top-failures``    — most common failure reasons
``POST /api/runs/reap-stale``      — close abandoned runs (admin/ops)

Authenticated with the **agent token** (``X-Agent-Token``) when called by a bot
and with the user JWT when called from the UI/scheduler.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_db, require_permission
from app.db.repository import fetch_one
from app.services import audit_service, infra_service, process_service, run_service
from app.services.auth_service import AuthenticatedUser
from app.services.dashboard_service import invalidate_dashboard_cache
from app.services.run_service import RunError
from app.services.realtime import hub

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/runs", tags=["Run Ingestion"])


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class RunStartRequest(BaseModel):
    """Payload sent by a bot when it starts processing."""

    ProcessName: str = Field(..., min_length=1, max_length=100)
    RequestID: Optional[str] = Field(None, max_length=100)
    MachineName: Optional[str] = Field(None, max_length=100)
    RobotName: Optional[str] = Field(None, max_length=100)
    IdempotencyKey: Optional[str] = Field(None, max_length=120)
    ProviderRunId: Optional[str] = Field(None, max_length=200)
    Trigger: str = Field("api", max_length=40)
    Reason: Optional[str] = Field(None, max_length=300)
    StartedAt: Optional[datetime] = None


class RunCompleteRequest(BaseModel):
    """Payload sent when a run finishes."""

    Status: str = Field("Completed", max_length=20)
    TransactionsCount: Optional[int] = Field(None, ge=0, le=10_000_000)
    SuccessCount: Optional[int] = Field(None, ge=0, le=10_000_000)
    FailedCount: Optional[int] = Field(None, ge=0, le=10_000_000)
    FailureReason: Optional[str] = Field(None, max_length=500)
    ExitCode: Optional[str] = Field(None, max_length=40)
    FinishedAt: Optional[datetime] = None


class RunProgressRequest(BaseModel):
    """Lightweight progress ping."""

    TransactionsCount: int = Field(..., ge=0, le=10_000_000)
    FailureReason: Optional[str] = Field(None, max_length=500)


# --------------------------------------------------------------------------- #
# Agent authentication helper
# --------------------------------------------------------------------------- #
def _authenticate_agent_or_user(
    request: Request,
    db: Session,
    x_agent_token: Optional[str],
) -> tuple[Optional[Dict[str, Any]], Optional[AuthenticatedUser]]:
    """Resolve the caller: an enrolled agent **or** an authenticated user.

    Returns ``(machine_row, principal)``.
    """
    if x_agent_token:
        machine_name = request.headers.get("x-machine-name")
        if not machine_name:
            raise HTTPException(status_code=400, detail="ترويسة X-Machine-Name مطلوبة مع توكن الأجنت")

        machine = fetch_one(
            db,
            "SELECT MachineName, AssignedProcess FROM BotInfrastructure WHERE MachineName = :m",
            {"m": machine_name},
            operation="runs.agent_lookup",
        )
        if not machine:
            raise HTTPException(status_code=401, detail="الجهاز غير مسجل")

        verified = infra_service.verify_agent_token(db, machine_name=machine_name, token=x_agent_token)
        if not verified:
            raise HTTPException(status_code=401, detail="توكن الجهاز غير صحيح")
        return machine, None

    from app.api.deps import authenticate_bearer

    try:
        principal = authenticate_bearer(request, db)
    except HTTPException:
        raise HTTPException(status_code=401, detail="مطلوب مصادقة (توكن الأجنت أو تسجيل دخول المستخدم)")
    return None, principal


# --------------------------------------------------------------------------- #
# Ingestion
# --------------------------------------------------------------------------- #
@router.post("/start", status_code=201, summary="Register a run start (idempotent)")
async def start_run(
    payload: RunStartRequest,
    request: Request,
    db: Session = Depends(get_db),
    x_agent_token: Optional[str] = Header(None, alias="X-Agent-Token"),
    idempotency_key_header: Optional[str] = Header(None, alias="Idempotency-Key"),
) -> Dict[str, Any]:
    """Create a ``Running`` row; replaying the same idempotency key is a no-op.

    The key may be sent as the ``Idempotency-Key`` header (preferred) or as
    the ``IdempotencyKey`` body field for legacy agents.
    """
    machine, principal = _authenticate_agent_or_user(request, db, x_agent_token)

    if not process_service.process_exists(db, process_name=payload.ProcessName):
        raise HTTPException(status_code=404, detail="العملية غير مسجلة في النظام")

    try:
        run_id, created = run_service.start_run(
            db,
            
            process_name=payload.ProcessName,
            request_id=payload.RequestID,
            idempotency_key=payload.IdempotencyKey or idempotency_key_header,
            machine_name=payload.MachineName or (machine or {}).get("MachineName"),
            robot_name=payload.RobotName,
            provider_run_id=payload.ProviderRunId,
            trigger=payload.Trigger,
            triggered_by=principal.username if principal else payload.MachineName,
            trigger_reason=payload.Reason,
            started_at=payload.StartedAt,
        )
    except RunError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if created:
        audit_service.record(
            db,
            
            action_type="Run_Started",
            user_id=principal.user_id if principal else None,
            process_name=payload.ProcessName,
            entity_type="ProcessRun",
            entity_id=str(run_id),
            new_values={
                "RequestID": payload.RequestID,
                "Machine": payload.MachineName or (machine or {}).get("MachineName"),
                "Trigger": payload.Trigger,
            },
            ip_address=client_ip(request),
        )
        invalidate_dashboard_cache()
        await _publish_run_event("run_started", run_id, payload.ProcessName)

    return {"status": "success", "run_id": run_id, "created": created, "process_name": payload.ProcessName}


@router.post("/{run_id}/complete", summary="Finalise a run")
async def complete_run(
    run_id: int,
    payload: RunCompleteRequest,
    request: Request,
    db: Session = Depends(get_db),
    x_agent_token: Optional[str] = Header(None, alias="X-Agent-Token"),
) -> Dict[str, Any]:
    """Set the final status; duration and savings are computed server-side."""
    machine, principal = _authenticate_agent_or_user(request, db, x_agent_token)

    try:
        result = run_service.complete_run(
            db,
            
            run_id=run_id,
            status=payload.Status,
            transactions_count=payload.TransactionsCount,
            success_count=payload.SuccessCount,
            failed_count=payload.FailedCount,
            failure_reason=payload.FailureReason,
            exit_code=payload.ExitCode,
            finished_at=payload.FinishedAt,
        )
    except RunError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not result.get("already_completed"):
        run_row = fetch_one(
            db, "SELECT ProcessName FROM ProcessRuns WHERE RunID = :id", {"id": run_id}, operation="runs.process_name"
        )
        audit_service.record(
            db,
            
            action_type=f"Run_{payload.Status}",
            user_id=principal.user_id if principal else None,
            process_name=(run_row or {}).get("ProcessName"),
            entity_type="ProcessRun",
            entity_id=str(run_id),
            new_values=result,
            ip_address=client_ip(request),
            is_success=payload.Status == "Completed",
        )
        invalidate_dashboard_cache()
        await _publish_run_event("run_completed", run_id, (run_row or {}).get("ProcessName"), result)

    return {"status": "success", **result}


@router.post("/{run_id}/progress", summary="Update run progress")
def run_progress(
    run_id: int,
    payload: RunProgressRequest,
    request: Request,
    db: Session = Depends(get_db),
    x_agent_token: Optional[str] = Header(None, alias="X-Agent-Token"),
) -> Dict[str, Any]:
    """Refresh the live transaction counter for a long-running job."""
    _machine, _principal = _authenticate_agent_or_user(request, db, x_agent_token)
    try:
        return run_service.update_progress(
            db,
            
            run_id=run_id,
            transactions_count=payload.TransactionsCount,
            failure_reason=payload.FailureReason,
        )
    except RunError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{run_id}/heartbeat", summary="Run heartbeat")
def run_heartbeat(
    run_id: int,
    payload: RunProgressRequest,
    request: Request,
    db: Session = Depends(get_db),
    x_agent_token: Optional[str] = Header(None, alias="X-Agent-Token"),
) -> Dict[str, Any]:
    """Liveness ping for a running job (refreshes ``LastHeartbeatAt``)."""
    _machine, _principal = _authenticate_agent_or_user(request, db, x_agent_token)
    try:
        return run_service.heartbeat_run(
            db, run_id=run_id, transactions_count=payload.TransactionsCount, failure_reason=payload.FailureReason
        )
    except RunError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# --------------------------------------------------------------------------- #
# Query
# --------------------------------------------------------------------------- #
@router.get("", summary="Run history (filtered, paginated)")
def list_runs(
    process: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    machine: Optional[str] = Query(None),
    since_hours: Optional[int] = Query(None, ge=1, le=8760),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("dashboard:read", "*")),
) -> Dict[str, Any]:
    """Browse the run history with department scoping applied."""
    from datetime import timedelta

    since = datetime.utcnow() - timedelta(hours=since_hours) if since_hours else None
    return run_service.list_runs(
        db,
        
        department_scope=principal.department,
        process_name=process,
        status=status_filter,
        machine_name=machine,
        since=since,
        limit=limit,
        offset=offset,
    )


@router.get("/statistics", summary="Daily run statistics")
def statistics(
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("dashboard:read", "*")),
) -> Dict[str, Any]:
    """Runs per day with completed/failed split."""
    return run_service.run_statistics(db, days=days)


@router.get("/top-failures", summary="Most frequent failure reasons")
def top_failures(
    days: int = Query(7, ge=1, le=90),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("dashboard:read", "*")),
) -> List[Dict[str, Any]]:
    """Failure fingerprints for targeted remediation."""
    return run_service.top_failure_reasons(db, days=days, limit=limit)


@router.post("/reap-stale", summary="Close abandoned running jobs")
def reap_stale(
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("commands:write", "*")),
) -> Dict[str, Any]:
    """Mark long-running ``Running`` jobs (crashed agents) as ``Stopped``."""
    count = run_service.reap_stale_runs(db)
    if count:
        audit_service.record(
            db,
            
            action_type="Runs_Reaped",
            user_id=principal.user_id,
            new_values={"count": count},
        )
        invalidate_dashboard_cache()
    return {"status": "success", "reaped": count}


async def _publish_run_event(
    event: str, run_id: int, process_name: Optional[str], extra: Optional[Dict[str, Any]] = None
) -> None:
    """Fan out a run lifecycle event to connected dashboards."""
    payload: Dict[str, Any] = {"run_id": run_id, "process_name": process_name}
    if extra:
        payload.update({k: v for k, v in extra.items() if k != "already_completed"})
    await hub.publish(event, payload)
