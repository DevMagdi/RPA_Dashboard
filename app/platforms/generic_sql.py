"""Generic SQL adapter — the native Control Room provider.

This is the adapter that preserves the original behaviour of the platform:
telemetry is written into the Control Room database by the ingestion API
(``/api/runs/*``) or by agents, and read back through SQL.  It also serves as
the reference implementation for banks with in-house orchestrators: point the
``table_map`` at their schema and the platform works without new code.

Configuration example (stored for the organization)::

    {
      "provider": "generic_sql",
      "table_map": {
        "processes": "ProcessConfig",
        "runs": "ProcessRuns",
        "queues": "ProcessQueues",
        "machines": "BotInfrastructure"
      },
      "column_map": {"runs": {"external_id": "ProviderRunId"}}
    }
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from app.db.dialect import get_flavor
from app.db.repository import fetch_all
from app.db.session import session_scope
from app.platforms.base import (
    BotStatus,
    CanonicalStatus,
    JobHandle,
    JobStartRequest,
    MachineRecord,
    PlatformAdapter,
    ProcessDefinition,
    QueueItemRecord,
    QueueStats,
    RunRecord,
    normalize_status,
)

logger = logging.getLogger(__name__)


class GenericSQLAdapter(PlatformAdapter):
    """Reads telemetry directly from the Control Room database."""

    name = "generic_sql"
    display_name = "Native Control Room (SQL)"

    def __init__(self, config: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(config)
        self.table_map: Dict[str, str] = {
            "processes": "ProcessConfig",
            "runs": "ProcessRuns",
            "queues": "ProcessQueues",
            "machines": "BotInfrastructure",
            **(self.config.get("table_map") or {}),
        }

    # ------------------------------------------------------------------ #
    # Reads
    # ------------------------------------------------------------------ #
    def get_processes(self, *, include_inactive: bool = False) -> List[ProcessDefinition]:
        """Return processes configured for the organization."""
        flavor = get_flavor()
        where = "IsDeleted = " + flavor.false_literal
        if not include_inactive:
            where += " AND IsActive = " + flavor.true_literal
        with session_scope() as session:
            rows = fetch_all(
                session,
                f"""
                SELECT ProcessName, Department, BotName, Provider, PlatformProcessKey, IsActive, Notes
                FROM {self.table_map['processes']}
                WHERE {where}
                ORDER BY ProcessName
                """,
                operation="adapter.processes",
            )
        return [
            ProcessDefinition(
                key=str(row.get("PlatformProcessKey") or row["ProcessName"]),
                name=str(row["ProcessName"]),
                department=row.get("Department"),
                is_active=bool(row.get("IsActive", True)),
                provider=str(row.get("Provider") or self.name),
                description=row.get("Notes"),
                extra={"bot_name": row.get("BotName")},
            )
            for row in rows
        ]

    def get_runs(
        self,
        *,
        process_key: Optional[str] = None,
        since: Optional[datetime] = None,
        limit: int = 500,
    ) -> List[RunRecord]:
        """Return recent runs."""
        flavor = get_flavor()
        where = [f"IsDeleted = {flavor.false_literal}"]
        params: Dict[str, Any] = {"limit": int(min(limit, 5000))}
        if process_key:
            where.append("ProcessName = :p")
            params["p"] = process_key
        if since:
            where.append("StartTime >= :since")
            params["since"] = since

        sql = f"""
            SELECT {flavor.top(params['limit'])} RunID, ProcessName, RequestID, Status, StartTime, EndTime,
                   DurationMinutes, FailureReason, TransactionsCount, SuccessCount, FailedCount,
                   MachineName, RobotName, Provider, ProviderRunId, ExitCode
            FROM {self.table_map['runs']}
            WHERE {' AND '.join(where)}
            ORDER BY StartTime DESC{flavor.limit(params['limit'])}
        """
        with session_scope() as session:
            rows = fetch_all(session, sql, params, operation="adapter.runs")
        return [self._map_run(row) for row in rows]

    def _map_run(self, row: Dict[str, Any]) -> RunRecord:
        return RunRecord(
            external_id=str(row.get("ProviderRunId") or row.get("RunID")),
            process_key=str(row.get("ProcessName")),
            status=normalize_status(row.get("Status")),
            started_at=row.get("StartTime"),
            finished_at=row.get("EndTime"),
            duration_minutes=float(row["DurationMinutes"]) if row.get("DurationMinutes") is not None else None,
            transactions_count=int(row.get("TransactionsCount") or 0),
            success_count=int(row.get("SuccessCount") or 0),
            failed_count=int(row.get("FailedCount") or 0),
            machine_name=row.get("MachineName"),
            robot_name=row.get("RobotName"),
            failure_reason=row.get("FailureReason"),
            exit_code=str(row["ExitCode"]) if row.get("ExitCode") is not None else None,
            raw=dict(row),
        )

    def get_queue_stats(self, *, process_key: Optional[str] = None) -> List[QueueStats]:
        """Return queue depth for configured processes."""
        flavor = get_flavor()
        where = [f"q.IsDeleted = {flavor.false_literal}"]
        params: Dict[str, Any] = {}
        if process_key:
            where.append("q.ProcessName = :p")
            params["p"] = process_key

        sql = f"""
            SELECT q.ProcessName, q.PendingItems, q.ActiveItems, q.AvgItemProcessingSeconds, q.LastUpdatedAt
            FROM {self.table_map['queues']} q
            WHERE {' AND '.join(where)}
        """
        with session_scope() as session:
            rows = fetch_all(session, sql, params, operation="adapter.queues")
        return [
            QueueStats(
                process_key=str(row["ProcessName"]),
                pending=int(row.get("PendingItems") or 0),
                active=int(row.get("ActiveItems") or 0),
                avg_processing_seconds=float(row.get("AvgItemProcessingSeconds") or 30),
                last_updated_at=row.get("LastUpdatedAt"),
            )
            for row in rows
        ]

    def get_queue_items(
        self, *, process_key: str, status: Optional[str] = None, limit: int = 100
    ) -> List[QueueItemRecord]:
        """Native provider does not persist individual work items."""
        return []

    def get_machines(self) -> List[MachineRecord]:
        """Return registered runner machines."""
        flavor = get_flavor()
        sql = f"""
            SELECT MachineName, AssignedProcess, Status, CPU_Usage, RAM_Usage, HDD_Usage, LastPing,
                   TotalRAM_GB, TotalHDD_GB, RunnerType, LastIP, OSName, AgentVersion, Platform, RobotCapacity
            FROM {self.table_map['machines']}
            WHERE IsDeleted = {flavor.false_literal}
            ORDER BY MachineName
        """
        with session_scope() as session:
            rows = fetch_all(session, sql, {}, operation="adapter.machines")
        machines: List[MachineRecord] = []
        for row in rows:
            last_ping = row.get("LastPing")
            is_stale = not last_ping or (datetime.utcnow() - last_ping) > timedelta(seconds=180)
            machines.append(
                MachineRecord(
                    key=str(row["MachineName"]),
                    name=str(row["MachineName"]),
                    status="Offline" if is_stale else str(row.get("Status") or "Online"),
                    cpu_usage=int(row.get("CPU_Usage") or 0),
                    ram_usage=int(row.get("RAM_Usage") or 0),
                    hdd_usage=int(row.get("HDD_Usage") or 0),
                    total_ram_gb=int(row.get("TotalRAM_GB") or 0),
                    total_hdd_gb=int(row.get("TotalHDD_GB") or 0),
                    runner_type=str(row.get("RunnerType") or "Unattended"),
                    last_ping=last_ping,
                    os_name=row.get("OSName"),
                    agent_version=str(row.get("AgentVersion") or ""),
                    ip_address=row.get("LastIP"),
                    robot_capacity=int(row.get("RobotCapacity") or 1),
                    provider=str(row.get("Platform") or self.name),
                    extra={"assigned_process": row.get("AssignedProcess")},
                )
            )
        return machines

    def get_bot_status(self, *, machine_key: Optional[str] = None) -> List[BotStatus]:
        """Live machine status derived from heartbeat freshness."""
        machines = self.get_machines()
        return [
            BotStatus(
                machine_key=m.key,
                status=m.status,
                current_process_key=m.extra.get("assigned_process") if m.status != "Offline" else None,
                since=m.last_ping,
            )
            for m in machines
            if not machine_key or m.key == machine_key
        ]

    # ------------------------------------------------------------------ #
    # Control (delegated to the realtime command bus / agent websocket)
    # ------------------------------------------------------------------ #
    def start_job(self, request: JobStartRequest) -> JobHandle:
        """The native provider dispatches start commands to connected agents.

        The actual dispatch happens in :mod:`app.services.command_service`
        (WebSocket + Redis pub/sub) so this adapter stays transport agnostic.
        """
        # Always return an external_id: the caller's idempotency key when one
        # was supplied, otherwise a freshly generated job reference — API
        # consumers must never receive ``external_id: null`` for an accepted
        # job (they need it to poll/stop the job later).
        return JobHandle(
            external_id=request.idempotency_key or f"job-{uuid.uuid4().hex}",
            accepted=True,
            status=CanonicalStatus.PENDING,
            message="Command queued for the native agent",
        )

    def stop_job(self, external_id: str, *, reason: Optional[str] = None) -> JobHandle:
        return JobHandle(
            external_id=external_id, accepted=True, status=CanonicalStatus.STOPPED, message="Stop queued"
        )

    CAPABILITIES: Dict[str, bool] = {
        "read_processes": True,
        "read_runs": True,
        "read_queues": True,
        "read_machines": True,
        "read_bot_status": True,
        "start_job": True,
        "stop_job": True,
        "queue_items": False,
    }
