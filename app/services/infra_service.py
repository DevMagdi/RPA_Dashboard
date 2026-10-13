"""Infrastructure service: runner fleet, agent enrolment and remote control.

Covers:
* machine registry (register / update / soft delete / revoke token)
* health classification with a configurable staleness threshold
* one-time enrolment codes with TTL
* the **command bus** (``BotCommands``) used to start/stop bots on runners —
  the missing capability that turned the platform from "monitoring" into
  "control room"
* live WebSocket/SSE fan-out through :mod:`app.services.realtime`
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import generate_agent_token, generate_enrollment_code, token_hash
from app.db.dialect import get_flavor
from app.db.repository import delete_rows, fetch_all, fetch_one, insert_row, update_rows
from app.db.tables import AgentEnrollmentCodes, BotCommands, BotInfrastructure

logger = logging.getLogger(__name__)

VALID_RUNNER_TYPES = ("Unattended", "Attended", "TestBot")
VALID_COMMANDS = ("RUN_BOT", "STOP_BOT", "PING", "REFRESH_CONFIG", "UPDATE_AGENT")


class InfraError(RuntimeError):
    """Invalid infrastructure operation."""


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# --------------------------------------------------------------------------- #
# Fleet registry
# --------------------------------------------------------------------------- #
def list_machines(session: Session, *, tenant_id: int, include_deleted: bool = False) -> List[Dict[str, Any]]:
    """Fleet inventory enriched with health status and utilisation."""
    flavor = get_flavor()
    settings = get_settings()
    where = ["TenantID = :t"]
    if not include_deleted:
        where.append(f"IsDeleted = {flavor.false_literal}")

    rows = fetch_all(
        session,
        f"""
        SELECT MachineID, MachineName, AssignedProcess, Status, CPU_Usage, RAM_Usage, HDD_Usage,
               LastPing, TotalRAM_GB, TotalHDD_GB, RunnerType, Platform, RobotCapacity,
               LastIP, OSName, AgentVersion, AgentTokenIssuedAt, CreatedAt
        FROM BotInfrastructure
        WHERE {' AND '.join(where)}
        ORDER BY MachineName
        """,
        {"t": tenant_id},
        operation="infra.list",
    )

    stale_seconds = settings.AGENT_STALE_SECONDS
    now = _now()
    for row in rows:
        last_ping = row.get("LastPing")
        is_offline = not last_ping or (now - last_ping) > timedelta(seconds=stale_seconds)
        if is_offline:
            row["Status"] = "Offline"
        cpu = int(row.get("CPU_Usage") or 0)
        ram = int(row.get("RAM_Usage") or 0)
        hdd = int(row.get("HDD_Usage") or 0)

        if is_offline:
            health = "Critical"
        elif cpu >= 90 or ram >= 90 or hdd >= 90:
            health = "Warning"
        elif str(row.get("Status")) == "Idle":
            health = "Idle"
        else:
            health = "Healthy"

        row["HealthStatus"] = health
        row["IsStale"] = is_offline
        row["IsOnline"] = not is_offline
        row["AssignedBot"] = row.get("AssignedProcess")  # backward-compatible alias
    return rows


def fleet_summary(session: Session, *, tenant_id: int) -> Dict[str, Any]:
    """Aggregate fleet KPIs for the infrastructure header cards."""
    machines = list_machines(session, tenant_id=tenant_id)
    online = [m for m in machines if m.get("Status") == "Online"]
    return {
        "total": len(machines),
        "online": len(online),
        "offline": len(machines) - len(online),
        "warning": len([m for m in machines if m.get("HealthStatus") == "Warning"]),
        "critical": len([m for m in machines if m.get("HealthStatus") == "Critical"]),
        "unattended": len([m for m in machines if m.get("RunnerType") == "Unattended"]),
        "attended": len([m for m in machines if m.get("RunnerType") == "Attended"]),
        "avg_cpu": round(sum(int(m.get("CPU_Usage") or 0) for m in online) / len(online), 1) if online else 0.0,
        "avg_ram": round(sum(int(m.get("RAM_Usage") or 0) for m in online) / len(online), 1) if online else 0.0,
        "license_capacity": sum(int(m.get("RobotCapacity") or 1) for m in machines),
    }


def register_machine(
    session: Session,
    *,
    tenant_id: int,
    machine_name: str,
    assigned_process: Optional[str],
    runner_type: str,
    total_ram_gb: int,
    total_hdd_gb: int,
    platform: str = "generic_sql",
    robot_capacity: int = 1,
) -> Dict[str, Any]:
    """Register a runner and issue a one-time enrolment code."""
    if runner_type not in VALID_RUNNER_TYPES:
        raise InfraError(f"نوع المشغّل يجب أن يكون إحدى: {', '.join(VALID_RUNNER_TYPES)}")
    if total_ram_gb <= 0 or total_hdd_gb <= 0:
        raise InfraError("مواصفات الجهاز غير صحيحة")

    existing = fetch_one(
        session,
        "SELECT MachineID FROM BotInfrastructure WHERE TenantID = :t AND MachineName = :m",
        {"t": tenant_id, "m": machine_name},
        operation="infra.exists",
    )
    if existing:
        raise InfraError("هذا الجهاز مسجل بالفعل")

    if assigned_process:
        process = fetch_one(
            session,
            "SELECT 1 AS x FROM ProcessConfig WHERE TenantID = :t AND ProcessName = :p",
            {"t": tenant_id, "p": assigned_process},
            operation="infra.validate_process",
        )
        if not process:
            raise InfraError("العملية المحددة غير موجودة")

    machine_id = insert_row(
        session,
        BotInfrastructure,
        {
            "TenantID": tenant_id,
            "MachineName": machine_name[:100],
            "AssignedProcess": (assigned_process or "")[:100] or None,
            "Status": "Offline",
            "CPU_Usage": 0,
            "RAM_Usage": 0,
            "HDD_Usage": 0,
            "TotalRAM_GB": int(total_ram_gb),
            "TotalHDD_GB": int(total_hdd_gb),
            "RunnerType": runner_type,
            "Platform": platform,
            "RobotCapacity": max(1, int(robot_capacity)),
        },
    )

    code = issue_enrollment_code(session, tenant_id=tenant_id, machine_name=machine_name)
    return {"machine_id": int(machine_id), **code}


def update_machine(
    session: Session,
    *,
    tenant_id: int,
    machine_name: str,
    assigned_process: Optional[str] = None,
    runner_type: Optional[str] = None,
    total_ram_gb: Optional[int] = None,
    total_hdd_gb: Optional[int] = None,
    robot_capacity: Optional[int] = None,
) -> int:
    """Update static runner attributes (assignment drives capacity math)."""
    if runner_type and runner_type not in VALID_RUNNER_TYPES:
        raise InfraError(f"نوع المشغّل يجب أن يكون إحدى: {', '.join(VALID_RUNNER_TYPES)}")

    values: Dict[str, Any] = {"UpdatedAt": _now()}
    if assigned_process is not None:
        values["AssignedProcess"] = assigned_process[:100] or None
    if runner_type:
        values["RunnerType"] = runner_type
    if total_ram_gb:
        values["TotalRAM_GB"] = int(total_ram_gb)
    if total_hdd_gb:
        values["TotalHDD_GB"] = int(total_hdd_gb)
    if robot_capacity:
        values["RobotCapacity"] = max(1, int(robot_capacity))

    return update_rows(
        session,
        BotInfrastructure,
        values,
        [BotInfrastructure.c.MachineName == machine_name, BotInfrastructure.c.TenantID == tenant_id],
    )


def record_heartbeat(
    session: Session,
    *,
    tenant_id: int,
    machine_name: str,
    cpu_usage: int,
    ram_usage: int,
    hdd_usage: int,
    ip_address: Optional[str] = None,
    os_name: Optional[str] = None,
    agent_version: Optional[str] = None,
) -> int:
    """Persist a heartbeat (validated 0-100 ranges) and mark the runner online."""
    values: Dict[str, Any] = {
        "CPU_Usage": max(0, min(100, int(cpu_usage))),
        "RAM_Usage": max(0, min(100, int(ram_usage))),
        "HDD_Usage": max(0, min(100, int(hdd_usage))),
        "Status": "Online",
        "LastPing": _now(),
        "UpdatedAt": _now(),
    }
    if ip_address:
        values["LastIP"] = ip_address[:64]
    if os_name:
        values["OSName"] = os_name[:64]
    if agent_version:
        values["AgentVersion"] = agent_version[:40]

    affected = update_rows(
        session,
        BotInfrastructure,
        values,
        [BotInfrastructure.c.MachineName == machine_name, BotInfrastructure.c.TenantID == tenant_id],
    )
    if not affected:
        logger.warning("Heartbeat from unknown machine %s (tenant=%s)", machine_name, tenant_id)
    return affected


def set_machine_status(session: Session, *, tenant_id: int, machine_name: str, status: str) -> int:
    """Force a status transition (used by the WebSocket connect/disconnect hooks)."""
    return update_rows(
        session,
        BotInfrastructure,
        {"Status": status, "LastPing": _now(), "UpdatedAt": _now()},
        [BotInfrastructure.c.MachineName == machine_name, BotInfrastructure.c.TenantID == tenant_id],
    )


def soft_delete_machine(session: Session, *, tenant_id: int, machine_name: str) -> int:
    """Remove a runner from the fleet without losing its telemetry history."""
    return update_rows(
        session,
        BotInfrastructure,
        {"IsDeleted": True, "DeletedAt": _now(), "Status": "Offline", "AgentToken": None},
        [BotInfrastructure.c.MachineName == machine_name, BotInfrastructure.c.TenantID == tenant_id],
    )


# --------------------------------------------------------------------------- #
# Agent tokens & enrolment
# --------------------------------------------------------------------------- #
def issue_enrollment_code(session: Session, *, tenant_id: int, machine_name: str) -> Dict[str, Any]:
    """Create a one-time enrolment code (previous unused codes are invalidated)."""
    settings = get_settings()
    # SQL Server has no portable DELETE...RETURNING, so delete then insert
    delete_rows(session, AgentEnrollmentCodes, [AgentEnrollmentCodes.c.MachineName == machine_name, AgentEnrollmentCodes.c.TenantID == tenant_id])

    code = generate_enrollment_code()
    expires_at = _now() + timedelta(minutes=settings.ENROLLMENT_TTL_MINUTES)
    insert_row(
        session,
        AgentEnrollmentCodes,
        {
            "TenantID": tenant_id,
            "MachineName": machine_name[:100],
            "EnrollmentCode": code,
            "ExpiresAt": expires_at,
            "IsUsed": False,
        },
    )
    return {
        "enrollment_code": code,
        "expires_at": expires_at.isoformat(),
        "expires_in_minutes": settings.ENROLLMENT_TTL_MINUTES,
    }


def enroll_agent(session: Session, *, tenant_id: int, machine_name: str, enrollment_code: str) -> Dict[str, Any]:
    """Exchange a valid enrolment code for a permanent (hashed) agent token."""
    settings = get_settings()
    code_row = fetch_one(
        session,
        f"""
        SELECT CodeID FROM AgentEnrollmentCodes
        WHERE TenantID = :t AND MachineName = :m AND EnrollmentCode = :c AND IsUsed = 0
          AND ExpiresAt >= {get_flavor().now()}
        """,
        {"t": tenant_id, "m": machine_name, "c": enrollment_code},
        operation="infra.enroll_lookup",
    )
    if not code_row:
        raise InfraError("كود الإقران غير صالح أو منتهي الصلاحية")

    machine = fetch_one(
        session,
        "SELECT MachineID FROM BotInfrastructure WHERE TenantID = :t AND MachineName = :m",
        {"t": tenant_id, "m": machine_name},
        operation="infra.enroll_machine",
    )
    if not machine:
        raise InfraError("الجهاز غير مسجل في النظام")

    raw_token = generate_agent_token()
    update_rows(
        session,
        BotInfrastructure,
        {"AgentToken": token_hash(raw_token), "AgentTokenIssuedAt": _now(), "Status": "Online", "LastPing": _now()},
        [BotInfrastructure.c.MachineName == machine_name, BotInfrastructure.c.TenantID == tenant_id],
    )
    update_rows(
        session,
        AgentEnrollmentCodes,
        {"IsUsed": True},
        [AgentEnrollmentCodes.c.CodeID == int(code_row["CodeID"])],
    )
    logger.info("Agent enrolled: %s (tenant=%s)", machine_name, tenant_id)
    return {"agent_token": raw_token, "heartbeat_interval_seconds": settings.AGENT_STALE_SECONDS // 6 or 5}


def verify_agent_token(session: Session, *, machine_name: str, token: str, tenant_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
    """Validate an agent token (constant-time) and return the machine row.

    The token is stored hashed with a pepper; a machine whose token was rotated
    or revoked simply fails to authenticate.
    """
    import secrets as _secrets

    if not token:
        return None

    where = "MachineName = :m"
    params: Dict[str, Any] = {"m": machine_name}
    if tenant_id is not None:
        where += " AND TenantID = :t"
        params["t"] = tenant_id

    row = fetch_one(
        session,
        f"SELECT MachineID, TenantID, MachineName, AgentToken FROM BotInfrastructure WHERE {where}",
        params,
        operation="infra.verify_agent",
    )
    if not row or not row.get("AgentToken"):
        return None

    stored = str(row["AgentToken"])
    expected = token_hash(token) if len(stored) == 64 else token
    if not _secrets.compare_digest(stored, expected):
        return None
    return row


def revoke_agent_token(session: Session, *, tenant_id: int, machine_name: str) -> int:
    """Revoke a runner's credentials (stolen VM / decommission)."""
    affected = update_rows(
        session,
        BotInfrastructure,
        {"AgentToken": None, "AgentTokenIssuedAt": None, "Status": "Offline", "UpdatedAt": _now()},
        [BotInfrastructure.c.MachineName == machine_name, BotInfrastructure.c.TenantID == tenant_id],
    )
    if affected:
        # Any queued command for that machine is now undeliverable
        update_rows(
            session,
            BotCommands,
            {"Status": "Cancelled", "Result": "agent token revoked"},
            [BotCommands.c.MachineName == machine_name, BotCommands.c.Status == "Queued"],
        )
    return affected


# --------------------------------------------------------------------------- #
# Command bus
# --------------------------------------------------------------------------- #
def issue_command(
    session: Session,
    *,
    tenant_id: int,
    machine_name: str,
    command: str,
    payload: Optional[Dict[str, Any]] = None,
    issued_by: Optional[int] = None,
    timeout_seconds: int = 60,
) -> Dict[str, Any]:
    """Queue a command for a runner (delivered over WebSocket when connected)."""
    if command not in VALID_COMMANDS:
        raise InfraError(f"أمر غير مدعوم: {command}")

    machine = fetch_one(
        session,
        "SELECT MachineName, Status, AgentToken FROM BotInfrastructure WHERE TenantID = :t AND MachineName = :m",
        {"t": tenant_id, "m": machine_name},
        operation="infra.command_machine",
    )
    if not machine:
        raise InfraError("الجهاز غير مسجل")

    import json

    command_id = insert_row(
        session,
        BotCommands,
        {
            "TenantID": tenant_id,
            "MachineName": machine_name[:100],
            "Command": command,
            "PayloadJson": json.dumps(payload or {}, default=str),
            "Status": "Queued",
            "IssuedBy": issued_by,
            "TimeoutSeconds": max(5, int(timeout_seconds)),
        },
    )
    logger.info("Command %s queued for %s (id=%s)", command, machine_name, command_id)
    return {
        "command_id": int(command_id),
        "machine_name": machine_name,
        "command": command,
        "status": "Queued",
        "delivered": False,
        "machine_status": machine.get("Status"),
    }


def mark_command_delivered(session: Session, *, tenant_id: int, command_id: int) -> int:
    """Record that the command reached the agent socket."""
    return update_rows(
        session,
        BotCommands,
        {"Status": "Sent", "SentAt": _now()},
        [BotCommands.c.CommandID == command_id, BotCommands.c.TenantID == tenant_id],
    )


def acknowledge_command(
    session: Session, *, tenant_id: int, command_id: int, success: bool, result: Optional[str] = None
) -> int:
    """Agent-side acknowledgement (success/failure + free-text result)."""
    return update_rows(
        session,
        BotCommands,
        {
            "Status": "Acknowledged" if success else "Failed",
            "AckedAt": _now(),
            "Result": (result or "")[:500] or None,
        },
        [BotCommands.c.CommandID == command_id, BotCommands.c.TenantID == tenant_id],
    )


def list_commands(
    session: Session, *, tenant_id: int, machine_name: Optional[str] = None, status: Optional[str] = None, limit: int = 100
) -> List[Dict[str, Any]]:
    """Command history for the control console."""
    flavor = get_flavor()
    where = ["c.TenantID = :t"]
    params: Dict[str, Any] = {"t": tenant_id, "limit": int(min(limit, 500))}
    if machine_name:
        where.append("c.MachineName = :m")
        params["m"] = machine_name
    if status:
        where.append("c.Status = :s")
        params["s"] = status

    return fetch_all(
        session,
        f"""
        SELECT {flavor.top(params['limit'])} c.CommandID, c.MachineName, c.Command, c.PayloadJson, c.Status,
               c.IssuedBy, c.IssuedAt, c.SentAt, c.AckedAt, c.Result, u.Username AS IssuedByUsername
        FROM BotCommands c
        LEFT JOIN SystemUsers u ON u.UserID = c.IssuedBy AND u.TenantID = c.TenantID
        WHERE {' AND '.join(where)}
        ORDER BY c.IssuedAt DESC{flavor.limit(params['limit'])}
        """,
        params,
        operation="infra.list_commands",
    )


def timeout_stale_commands(session: Session, *, tenant_id: int) -> int:
    """Mark commands that were never acknowledged within their timeout."""
    rows = fetch_all(
        session,
        """
        SELECT CommandID, TimeoutSeconds, IssuedAt FROM BotCommands
        WHERE TenantID = :t AND Status IN ('Queued','Sent')
        """,
        {"t": tenant_id},
        operation="infra.stale_commands",
    )
    count = 0
    now = _now()
    for row in rows:
        issued_at = row.get("IssuedAt")
        timeout = int(row.get("TimeoutSeconds") or 60)
        if issued_at and (now - issued_at) > timedelta(seconds=timeout):
            update_rows(
                session,
                BotCommands,
                {"Status": "Timeout", "Result": "no acknowledgement from agent"},
                [BotCommands.c.CommandID == int(row["CommandID"])],
            )
            count += 1
    return count
