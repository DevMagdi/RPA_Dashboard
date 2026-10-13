"""Runner agent endpoints: enrolment, WebSocket control channel, heartbeats.

Authentication model
--------------------
* ``POST /api/agent/enroll`` exchanges a short-lived enrolment code (TTL,
  single use) for a permanent token that is **stored hashed with a pepper**.
* The WebSocket and heartbeat endpoints validate that token in constant time.
* Agents may pass the token through the ``X-Agent-Token`` header (preferred) or
  the ``token`` query parameter (kept for the legacy agent, logged as
  deprecated because query strings leak into proxy/access logs).

Reliability
-----------
The socket handler uses ``try/finally`` so a machine is **always** marked
offline on disconnect — the original implementation leaked ``Online`` state
forever whenever an unexpected error (not just ``WebSocketDisconnect``) occurred.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import client_ip, current_principal, get_db, rate_limit
from app.core.config import get_settings
from app.core.metrics import track_agent_count
from app.services import audit_service, infra_service
from app.services.auth_service import AuthenticatedUser
from app.services.infra_service import InfraError
from app.services.realtime import hub

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Agents"])


class AgentEnrollRequest(BaseModel):
    """Self-enrolment payload sent by a freshly installed agent."""

    MachineName: str = Field(..., min_length=1, max_length=100)
    EnrollmentCode: str = Field(..., min_length=4, max_length=40)


class AgentHeartbeat(BaseModel):
    """HTTP heartbeat (the WebSocket is preferred; kept for firewalled hosts)."""

    MachineName: str = Field(..., min_length=1, max_length=100)
    CPU_Usage: int = Field(..., ge=0, le=100)
    RAM_Usage: int = Field(..., ge=0, le=100)
    HDD_Usage: int = Field(..., ge=0, le=100)
    MachineIP: Optional[str] = Field(None, max_length=64)
    OSName: Optional[str] = Field(None, max_length=64)
    AgentVersion: Optional[str] = Field(None, max_length=40)


class CommandAck(BaseModel):
    """Acknowledgement sent by the agent after executing a command."""

    MachineName: str = Field(..., min_length=1, max_length=100)
    CommandID: int
    Success: bool = True
    Result: Optional[str] = Field(None, max_length=500)


# --------------------------------------------------------------------------- #
# Enrolment
# --------------------------------------------------------------------------- #
@router.post("/api/agent/enroll", tags=["Agents"], summary="Exchange an enrolment code for a token")
def agent_enroll(
    payload: AgentEnrollRequest,
    request: Request,
    db: Session = Depends(get_db),
    _limit=Depends(rate_limit(5, 3600, "agent_enroll")),
) -> Dict[str, Any]:
    """Enrol a machine using its one-time code (5 attempts/hour per IP)."""
    from app.db.repository import fetch_one

    machine = fetch_one(
        db,
        "SELECT TenantID, MachineName FROM BotInfrastructure WHERE MachineName = :m",
        {"m": payload.MachineName},
        operation="agents.enroll_lookup",
    )
    if not machine:
        raise HTTPException(status_code=404, detail="الجهاز غير مسجل — أضفه من لوحة التحكم أولاً")

    tenant_id = int(machine["TenantID"])
    try:
        result = infra_service.enroll_agent(
            db, tenant_id=tenant_id, machine_name=payload.MachineName, enrollment_code=payload.EnrollmentCode
        )
    except InfraError as exc:
        audit_service.record(
            db,
            tenant_id=tenant_id,
            action_type="Agent_Enroll_Failed",
            entity_type="BotInfrastructure",
            entity_id=payload.MachineName,
            new_values={"reason": str(exc)},
            ip_address=client_ip(request),
            is_success=False,
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    audit_service.record(
        db,
        tenant_id=tenant_id,
        action_type="Agent_Enroll",
        entity_type="BotInfrastructure",
        entity_id=payload.MachineName,
        ip_address=client_ip(request),
    )
    return {"status": "success", **result}


# --------------------------------------------------------------------------- #
# Heartbeats
# --------------------------------------------------------------------------- #
@router.post("/api/agent-heartbeat", tags=["Agents"], summary="HTTP heartbeat (fallback)")
def agent_heartbeat(
    payload: AgentHeartbeat,
    request: Request,
    db: Session = Depends(get_db),
    x_agent_token: str = Header(..., alias="X-Agent-Token"),
) -> Dict[str, Any]:
    """Record a heartbeat when the agent cannot hold a WebSocket open."""
    machine = infra_service.verify_agent_token(db, machine_name=payload.MachineName, token=x_agent_token)
    if not machine:
        raise HTTPException(status_code=401, detail="توكن الجهاز غير صحيح")

    infra_service.record_heartbeat(
        db,
        tenant_id=int(machine["TenantID"]),
        machine_name=payload.MachineName,
        cpu_usage=payload.CPU_Usage,
        ram_usage=payload.RAM_Usage,
        hdd_usage=payload.HDD_Usage,
        ip_address=payload.MachineIP or client_ip(request),
        os_name=payload.OSName,
        agent_version=payload.AgentVersion,
    )
    return {"status": "success", "server_time": datetime.utcnow().isoformat() + "Z"}


@router.post("/api/agent/commands/ack", tags=["Agents"], summary="Acknowledge a command")
async def acknowledge_command(
    payload: CommandAck,
    db: Session = Depends(get_db),
    x_agent_token: str = Header(..., alias="X-Agent-Token"),
) -> Dict[str, Any]:
    """Agents confirm execution so the console can show real command status."""
    machine = infra_service.verify_agent_token(db, machine_name=payload.MachineName, token=x_agent_token)
    if not machine:
        raise HTTPException(status_code=401, detail="توكن الجهاز غير صحيح")

    tenant_id = int(machine["TenantID"])
    affected = infra_service.acknowledge_command(
        db, tenant_id=tenant_id, command_id=payload.CommandID, success=payload.Success, result=payload.Result
    )
    audit_service.record(
        db,
        tenant_id=tenant_id,
        action_type="Command_Acknowledged",
        entity_type="BotCommand",
        entity_id=str(payload.CommandID),
        new_values={"success": payload.Success, "result": payload.Result},
        is_success=payload.Success,
    )
    await hub.publish(
        "command_ack",
        {"command_id": payload.CommandID, "machine": payload.MachineName, "success": payload.Success},
        tenant_id=tenant_id,
    )
    return {"status": "success", "affected": affected}


# --------------------------------------------------------------------------- #
# WebSocket control channel
# --------------------------------------------------------------------------- #
def _extract_agent_token(websocket: WebSocket) -> tuple[Optional[str], bool]:
    """Return ``(token, from_query)`` supporting the modern and legacy transports."""
    header_token = websocket.headers.get("x-agent-token")
    if header_token:
        return header_token, False
    protocol = websocket.headers.get("sec-websocket-protocol")
    if protocol and protocol.lower().startswith("agent-token."):
        return protocol.split(".", 1)[1], False
    query_token = websocket.query_params.get("token")
    return query_token, bool(query_token)


@router.websocket("/ws/agent/{machine_name}")
async def agent_socket(websocket: WebSocket, machine_name: str) -> None:
    """Bidirectional channel: telemetry up, commands down.

    The connection is authenticated *before* ``accept()`` and the machine's
    status is always reset in a ``finally`` block.
    """
    token, from_query = _extract_agent_token(websocket)
    if from_query:
        logger.warning(
            "Agent %s authenticated with a query-string token — migrate to the X-Agent-Token header "
            "(query strings are recorded in proxy access logs)",
            machine_name,
        )

    if not token:
        await websocket.close(code=1008)
        return

    # Verify the token against the machine registry (own short-lived session)
    from app.db.session import session_scope

    with session_scope() as session:
        machine = infra_service.verify_agent_token(session, machine_name=machine_name, token=token)
        if not machine:
            logger.warning("Agent authentication failed for %s", machine_name)
            await websocket.close(code=1008)
            return
        tenant_id = int(machine["TenantID"])
        infra_service.set_machine_status(session, tenant_id=tenant_id, machine_name=machine_name, status="Online")

    await websocket.accept()
    await hub.register_agent(machine_name, websocket)
    logger.info("Agent socket opened: %s (tenant=%s)", machine_name, tenant_id)

    settings = get_settings()
    try:
        while True:
            raw = await websocket.receive_text()
            if not raw:
                continue
            try:
                data = json.loads(raw)
            except ValueError:
                continue

            kind = str(data.get("type") or "heartbeat").lower()
            if kind == "heartbeat":
                with session_scope() as session:
                    infra_service.record_heartbeat(
                        session,
                        tenant_id=tenant_id,
                        machine_name=machine_name,
                        cpu_usage=int(data.get("CPU_Usage") or 0),
                        ram_usage=int(data.get("RAM_Usage") or 0),
                        hdd_usage=int(data.get("HDD_Usage") or 0),
                        ip_address=str(data.get("MachineIP") or "")[:64] or None,
                        os_name=str(data.get("OSName") or "")[:64] or None,
                        agent_version=str(data.get("AgentVersion") or "")[:40] or None,
                    )
                await hub.publish(
                    "agent_heartbeat",
                    {
                        "machine": machine_name,
                        "cpu": int(data.get("CPU_Usage") or 0),
                        "ram": int(data.get("RAM_Usage") or 0),
                        "hdd": int(data.get("HDD_Usage") or 0),
                    },
                    tenant_id=tenant_id,
                )
            elif kind == "command_ack":
                with session_scope() as session:
                    infra_service.acknowledge_command(
                        session,
                        tenant_id=tenant_id,
                        command_id=int(data.get("command_id") or 0),
                        success=bool(data.get("success", True)),
                        result=str(data.get("result") or "")[:500],
                    )
                await hub.publish("command_ack", {"machine": machine_name, **data}, tenant_id=tenant_id)
            elif kind == "run_event":
                # Agents may stream run lifecycle events over the socket
                with session_scope() as session:
                    event = str(data.get("event") or "").lower()
                    if event == "start":
                        run_service_start(session, tenant_id, machine_name, data)
                    elif event == "complete":
                        run_service_complete(session, tenant_id, data)
    except WebSocketDisconnect:
        logger.info("Agent socket closed by peer: %s", machine_name)
    except asyncio.CancelledError:  # pragma: no cover - server shutdown
        raise
    except Exception as exc:  # noqa: BLE001 - never leak a stuck "Online" state
        logger.error("Agent socket error for %s: %s", machine_name, exc, exc_info=True)
    finally:
        await hub.unregister_agent(machine_name)
        try:
            with session_scope() as session:
                infra_service.set_machine_status(
                    session, tenant_id=tenant_id, machine_name=machine_name, status="Offline"
                )
        except Exception as exc:  # pragma: no cover - DB down during shutdown
            logger.error("Failed to mark %s offline: %s", machine_name, exc)
        logger.info("Agent socket cleanup complete: %s (stale threshold %ss)", machine_name, settings.AGENT_STALE_SECONDS)


def run_service_start(session: Session, tenant_id: int, machine_name: str, data: Dict[str, Any]) -> None:
    """Handle a run-start event streamed by an agent (best effort)."""
    from app.services import run_service

    try:
        run_service.start_run(
            session,
            tenant_id=tenant_id,
            process_name=str(data.get("process_name") or ""),
            request_id=data.get("request_id"),
            idempotency_key=data.get("idempotency_key"),
            machine_name=machine_name,
            trigger="agent",
        )
    except Exception as exc:  # pragma: no cover - agent data is untrusted
        logger.warning("Agent run-start rejected: %s", exc)


def run_service_complete(session: Session, tenant_id: int, data: Dict[str, Any]) -> None:
    """Handle a run-complete event streamed by an agent (best effort)."""
    from app.services import run_service

    run_id = data.get("run_id")
    if not run_id:
        return
    try:
        run_service.complete_run(
            session,
            tenant_id=tenant_id,
            run_id=int(run_id),
            status=str(data.get("status") or "Completed"),
            transactions_count=int(data.get("transactions_count") or 0),
            failure_reason=data.get("failure_reason"),
        )
    except Exception as exc:  # pragma: no cover
        logger.warning("Agent run-complete rejected: %s", exc)


# --------------------------------------------------------------------------- #
# Fleet diagnostics for operators
# --------------------------------------------------------------------------- #
@router.get("/api/agents/connected", tags=["Agents"], summary="Currently connected agents")
def connected_agents(
    principal: AuthenticatedUser = Depends(current_principal),
) -> Dict[str, Any]:
    """Live socket inventory (used by the Control Room health page)."""
    agents = hub.connected_agents()
    track_agent_count(absolute=len(agents))
    return {"count": len(agents), "agents": agents, "subscribers": hub.subscriber_count()}
