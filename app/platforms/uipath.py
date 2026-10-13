"""UiPath Orchestrator adapter.

Implements the :class:`~app.platforms.base.PlatformAdapter` contract against
the UiPath **Orchestrator OData API**.

Supported operations
--------------------
====================  ====================================================
Operation             Endpoint
====================  ====================================================
processes             ``GET /odata/Releases``
runs                  ``GET /odata/Jobs`` (``$filter`` / ``$orderby``)
queue stats           ``GET /odata/QueueDefinitions`` + ``/odata/Queues``
queue items           ``GET /odata/QueueItems``
machines              ``GET /odata/Machines`` + ``/odata/Sessions``
bot status            ``GET /odata/Robots``
start job             ``POST /odata/Jobs/UiPath.Server.Configuration.OData.StartJobs``
stop job              ``POST /odata/Jobs({id})/UiPath.Server.Configuration.OData.StopJob``
====================  ====================================================

Auth: OAuth2 client-credentials (Cloud) or PAT / personal access token
(on-prem).  ``X-UIPATH-TenantName`` and ``X-UIPATH-OrganizationUnitId``
(folder) headers are injected from configuration.

The adapter is **read-mostly + control**: it never writes business data into
the Control Room database; the sync service decides what to persist.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from app.platforms.base import (
    BotStatus,
    CanonicalStatus,
    JobHandle,
    JobStartRequest,
    MachineRecord,
    ProcessDefinition,
    QueueItemRecord,
    QueueStats,
    RunRecord,
    normalize_status,
    to_utc,
)
from app.platforms.http_base import HttpPlatformAdapter

logger = logging.getLogger(__name__)


class UiPathOrchestratorAdapter(HttpPlatformAdapter):
    """UiPath Orchestrator integration (Cloud and on-prem 2021.10+)."""

    name = "uipath"
    display_name = "UiPath Orchestrator"

    # ------------------------------------------------------------------ #
    # Processes
    # ------------------------------------------------------------------ #
    def get_processes(self, *, include_inactive: bool = False) -> List[ProcessDefinition]:
        """Return releases (published automations)."""
        params: Dict[str, Any] = {"$top": 1000}
        if not include_inactive:
            params["$filter"] = "IsLatestVersion eq true and ProcessKey ne null"

        payload = self.request("GET", "/odata/Releases", params=params)
        processes: List[ProcessDefinition] = []
        for item in self.unwrap_list(payload, "value"):
            key = str(item.get("Key") or item.get("Id") or item.get("Name"))
            processes.append(
                ProcessDefinition(
                    key=key,
                    name=str(item.get("Name") or key),
                    department=item.get("Department") or item.get("FolderName"),
                    is_active=bool(item.get("IsLatestVersion", True)) and not bool(item.get("IsDeleted", False)),
                    provider=self.name,
                    description=item.get("Description"),
                    extra={
                        "folder_id": item.get("OrganizationUnitId"),
                        "process_version": item.get("ProcessVersion"),
                        "environment": item.get("EnvironmentName"),
                        "raw": item,
                    },
                )
            )
        return processes

    # ------------------------------------------------------------------ #
    # Runs / jobs
    # ------------------------------------------------------------------ #
    def get_runs(
        self,
        *,
        process_key: Optional[str] = None,
        since: Optional[datetime] = None,
        limit: int = 500,
    ) -> List[RunRecord]:
        """Return recent jobs, newest first."""
        filters: List[str] = []
        if process_key:
            filters.append(f"Release/Key eq {process_key}")
        if since:
            filters.append(f"StartTime ge {since.strftime('%Y-%m-%dT%H:%M:%SZ')}")

        params: Dict[str, Any] = {
            "$top": min(int(limit), 1000),
            "$orderby": "StartTime desc",
            "$expand": "Release,Robot",
        }
        if filters:
            params["$filter"] = " and ".join(filters)

        payload = self.request("GET", "/odata/Jobs", params=params)
        return [self._map_job(item) for item in self.unwrap_list(payload, "value")]

    def _map_job(self, item: Dict[str, Any]) -> RunRecord:
        """Map a UiPath job payload into the canonical :class:`RunRecord`."""
        release = item.get("Release") or {}
        robot = item.get("Robot") or {}
        state = item.get("State") or item.get("Status")
        return RunRecord(
            external_id=str(item.get("Key") or item.get("Id") or ""),
            process_key=str(release.get("Key") or release.get("Name") or item.get("ReleaseName") or "unknown"),
            status=normalize_status(state),
            started_at=to_utc(item.get("StartTime")),
            finished_at=to_utc(item.get("EndTime")),
            duration_minutes=None,  # computed from timestamps by the model
            transactions_count=int(item.get("InputArguments", {}).get("TransactionsCount") or 0)
            if isinstance(item.get("InputArguments"), dict)
            else 0,
            failed_count=0,
            machine_name=item.get("MachineName") or robot.get("Name"),
            robot_name=robot.get("Name") or item.get("RobotName"),
            failure_reason=(item.get("Info") or item.get("JobError") or {}).get("Message")
            if isinstance(item.get("Info") or item.get("JobError"), dict)
            else (item.get("Info") if isinstance(item.get("Info"), str) else None),
            exit_code=str(item.get("ExitCode")) if item.get("ExitCode") is not None else None,
            raw=item,
        )

    # ------------------------------------------------------------------ #
    # Queues
    # ------------------------------------------------------------------ #
    def get_queue_stats(self, *, process_key: Optional[str] = None) -> List[QueueStats]:
        """Aggregate queue depth per queue definition.

        UiPath exposes per-status counts through the ``/odata/Queues``
        endpoint; we aggregate the top items to compute pending/active.
        """
        params: Dict[str, Any] = {"$top": 1000, "$expand": "QueueDefinition"}
        if process_key:
            params["$filter"] = f"QueueDefinition/Name eq '{process_key}'"

        payload = self.request("GET", "/odata/QueueItems", params=params)
        buckets: Dict[str, QueueStats] = {}
        for item in self.unwrap_list(payload, "value"):
            definition = item.get("QueueDefinition") or {}
            key = str(definition.get("Name") or item.get("QueueDefinitionId") or "unknown")
            stats = buckets.setdefault(key, QueueStats(process_key=key, last_updated_at=to_utc(item.get("CreationTime"))))
            status = str(item.get("Status") or "").lower()
            if status in ("new", "retried"):
                stats.pending += 1
            elif status in ("inprogress", "in_progress"):
                stats.active += 1
            elif status in ("failed", "abandoned"):
                stats.failed += 1
        return list(buckets.values())

    def get_queue_items(
        self, *, process_key: str, status: Optional[str] = None, limit: int = 100
    ) -> List[QueueItemRecord]:
        """Return individual queue items (work items)."""
        filters = [f"QueueDefinition/Name eq '{process_key}'"]
        if status:
            filters.append(f"Status eq '{status}'")
        payload = self.request(
            "GET",
            "/odata/QueueItems",
            params={"$top": min(int(limit), 1000), "$filter": " and ".join(filters), "$orderby": "CreationTime desc"},
        )
        return [
            QueueItemRecord(
                item_id=str(item.get("Id")),
                process_key=process_key,
                status=str(item.get("Status") or "New"),
                created_at=to_utc(item.get("CreationTime")),
                priority=str(item.get("Priority")) if item.get("Priority") is not None else None,
                reference=item.get("Reference"),
                raw=item,
            )
            for item in self.unwrap_list(payload, "value")
        ]

    # ------------------------------------------------------------------ #
    # Machines & robots
    # ------------------------------------------------------------------ #
    def get_machines(self) -> List[MachineRecord]:
        """Return host machines with static specs (utilisation comes from sessions)."""
        payload = self.request("GET", "/odata/Machines", params={"$top": 1000})
        machines: List[MachineRecord] = []
        for item in self.unwrap_list(payload, "value"):
            key = str(item.get("Id") or item.get("Name"))
            machines.append(
                MachineRecord(
                    key=key,
                    name=str(item.get("Name") or key),
                    status="Online" if int(item.get("RobotVersionsCount") or 0) > 0 else "Offline",
                    total_ram_gb=0,
                    total_hdd_gb=0,
                    runner_type="Unattended" if item.get("Type") in (0, "Unattended") else "Attended",
                    os_name=item.get("OperatingSystem"),
                    agent_version=str(item.get("RobotVersionsCount") or ""),
                    provider=self.name,
                    extra={"raw": item},
                )
            )
        return machines

    def get_bot_status(self, *, machine_key: Optional[str] = None) -> List[BotStatus]:
        """Return live robot sessions."""
        params: Dict[str, Any] = {"$top": 1000, "$expand": "Robot"}
        payload = self.request("GET", "/odata/Sessions", params=params)
        statuses: List[BotStatus] = []
        for item in self.unwrap_list(payload, "value"):
            robot = item.get("Robot") or {}
            name = str(robot.get("Name") or item.get("MachineName") or "")
            if machine_key and name != machine_key:
                continue
            state = str(item.get("State") or "")
            statuses.append(
                BotStatus(
                    machine_key=name,
                    status="Online" if state.lower() in ("available", "busy") else "Offline",
                    current_job_id=str(item.get("JobId")) if item.get("JobId") else None,
                    current_process_key=item.get("ReleaseName"),
                    since=to_utc(item.get("ReportingTime")),
                )
            )
        return statuses

    # ------------------------------------------------------------------ #
    # Control
    # ------------------------------------------------------------------ #
    def start_job(self, request: JobStartRequest) -> JobHandle:
        """Start a job through ``Jobs/UiPath.Server.Configuration.OData.StartJobs``."""
        body = {
            "startInfo": {
                "ReleaseKey": request.process_key,
                "Strategy": "ModernJobsCount",
                "JobsCount": 1,
                "InputArguments": self._dump_arguments(request.arguments),
                "RobotIds": [],
                "NoOfRobots": 0,
            }
        }
        if request.machine_keys:
            body["startInfo"]["MachineRobots"] = []  # kept for API compatibility
            body["startInfo"]["Robots"] = list(request.machine_keys)

        payload = self.request(
            "POST", "/odata/Jobs/UiPath.Server.Configuration.OData.StartJobs", json_body=body
        )
        jobs = self.unwrap_list(payload, "value")
        if not jobs:
            return JobHandle(external_id=None, accepted=False, message="UiPath returned no job")
        job = jobs[0]
        return JobHandle(
            external_id=str(job.get("Key") or job.get("Id") or ""),
            accepted=True,
            status=normalize_status(job.get("State") or CanonicalStatus.PENDING),
            message="Job accepted by UiPath Orchestrator",
        )

    def stop_job(self, external_id: str, *, reason: Optional[str] = None) -> JobHandle:
        """Stop a running job."""
        body = {"jobId": external_id}
        if reason is not None:
            body["reason"] = reason  # supported on newer Orchestrator versions
        self.request(
            "POST",
            f"/odata/Jobs({external_id})/UiPath.Server.Configuration.OData.StopJob",
            json_body=body,
        )
        return JobHandle(
            external_id=external_id,
            accepted=True,
            status=CanonicalStatus.STOPPED,
            message="Stop requested",
        )

    def capabilities(self) -> Dict[str, bool]:
        return {
            "read_processes": True,
            "read_runs": True,
            "read_queues": True,
            "read_machines": True,
            "read_bot_status": True,
            "start_job": True,
            "stop_job": True,
            "queue_items": True,
        }

    @staticmethod
    def _dump_arguments(arguments: Dict[str, Any]) -> str:
        """UiPath expects InputArguments as a JSON *string*."""
        import json

        return json.dumps(arguments or {}, ensure_ascii=False)
