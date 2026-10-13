"""Automation Anywhere adapter (Automation 360 & Enterprise 11).

Endpoint paths differ between Control Room generations, so they are
**configuration-driven** (``endpoints`` map in the adapter config).  Defaults
target Automation 360 (A2019+) and can be overridden per installation without a code
change — the core requirement for white-label deployments.

====================  ==========================================================
Operation             Automation 360 default
====================  ==========================================================
processes             ``GET  /v3/automations``
runs                  ``GET  /v3/activity/list``
queue stats           ``GET  /v3/wlm/queues`` (Workload Management)
queue items           ``GET  /v3/wlm/queues/{id}/workitems``
machines              ``GET  /v2/devices``
bot status            ``GET  /v2/devices/{id}/status``
start job             ``POST /v3/automations/deploy``
stop job              ``POST /v3/automations/deploy/{deploymentId}/stop``
====================  ==========================================================

Auth: Automation 360 uses ``POST /v3/authentication`` with username + apiKey
returning a short-lived token; Enterprise 11 uses ``/v1/authentication``.
Both are supported through ``auth_mode`` + ``token_url``.
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

DEFAULT_ENDPOINTS: Dict[str, str] = {
    "processes": "/v3/automations",
    "runs": "/v3/activity/list",
    "queues": "/v3/wlm/queues",
    "queue_items": "/v3/wlm/queues/{queue_id}/workitems",
    "machines": "/v2/devices",
    "bot_status": "/v2/devices/{device_id}/status",
    "start_job": "/v3/automations/deploy",
    "stop_job": "/v3/automations/deploy/{deployment_id}/stop",
    "authenticate": "/v3/authentication",
}


class AutomationAnywhereAdapter(HttpPlatformAdapter):
    """Automation Anywhere integration (config-driven endpoint map)."""

    name = "automation_anywhere"
    display_name = "Automation Anywhere"

    def __init__(self, config: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(config)
        endpoints = dict(DEFAULT_ENDPOINTS)
        endpoints.update((self.config or {}).get("endpoints") or {})
        self.endpoints = endpoints

    def _url(self, key: str, **path_params: Any) -> str:
        """Resolve an endpoint template."""
        template = self.endpoints.get(key)
        if not template:
            raise NotImplementedError(f"{self.display_name}: endpoint '{key}' is not configured")
        return template.format(**path_params) if path_params else template

    # ------------------------------------------------------------------ #
    # Telemetry
    # ------------------------------------------------------------------ #
    def get_processes(self, *, include_inactive: bool = False) -> List[ProcessDefinition]:
        """Return deployed automations."""
        payload = self.request("GET", self._url("processes"), params={"limit": 200})
        processes: List[ProcessDefinition] = []
        for item in self.unwrap_list(payload, "list", "data", "value"):
            key = str(item.get("id") or item.get("automationId") or item.get("name"))
            processes.append(
                ProcessDefinition(
                    key=key,
                    name=str(item.get("name") or key),
                    department=item.get("folderName") or item.get("workspace"),
                    is_active=str(item.get("status") or "published").lower() in ("published", "active", "available"),
                    provider=self.name,
                    description=item.get("description"),
                    extra={"path": item.get("path"), "raw": item},
                )
            )
        return processes

    def get_runs(
        self,
        *,
        process_key: Optional[str] = None,
        since: Optional[datetime] = None,
        limit: int = 500,
    ) -> List[RunRecord]:
        """Return automation activity entries."""
        params: Dict[str, Any] = {"limit": min(int(limit), 1000), "sort": "startDateTime desc"}
        if process_key:
            params["automationId"] = process_key
        if since:
            params["fromDate"] = since.strftime("%Y-%m-%dT%H:%M:%SZ")

        payload = self.request("GET", self._url("runs"), params=params)
        return [self._map_run(item) for item in self.unwrap_list(payload, "list", "data", "value")]

    def _map_run(self, item: Dict[str, Any]) -> RunRecord:
        """Map an AA activity entry into the canonical run record."""
        status = item.get("status") or item.get("state") or item.get("deploymentStatus")
        return RunRecord(
            external_id=str(item.get("id") or item.get("deploymentId") or ""),
            process_key=str(item.get("automationId") or item.get("automationName") or "unknown"),
            status=normalize_status(status),
            started_at=to_utc(item.get("startDateTime") or item.get("startTime")),
            finished_at=to_utc(item.get("endDateTime") or item.get("endTime")),
            transactions_count=int(item.get("transactionsProcessed") or item.get("successCount") or 0),
            success_count=int(item.get("successCount") or 0),
            failed_count=int(item.get("failureCount") or item.get("failedCount") or 0),
            machine_name=item.get("deviceName") or item.get("runnerName"),
            robot_name=item.get("botName") or item.get("runnerName"),
            failure_reason=item.get("errorMessage") or item.get("message"),
            exit_code=str(item.get("exitCode")) if item.get("exitCode") is not None else None,
            raw=item,
        )

    def get_queue_stats(self, *, process_key: Optional[str] = None) -> List[QueueStats]:
        """Return Workload Management queue depths."""
        payload = self.request("GET", self._url("queues"), params={"limit": 200})
        stats: List[QueueStats] = []
        for item in self.unwrap_list(payload, "list", "data", "value"):
            name = str(item.get("name") or item.get("queueName") or item.get("id"))
            if process_key and name != process_key:
                continue
            pending = int(item.get("pendingWorkItems") or item.get("newItems") or 0)
            active = int(item.get("inProgressWorkItems") or item.get("inProgressItems") or 0)
            failed = int(item.get("failedWorkItems") or 0)
            stats.append(
                QueueStats(
                    process_key=name,
                    pending=pending,
                    active=active,
                    failed=failed,
                    avg_processing_seconds=float(item.get("averageProcessingTimeSeconds") or 30.0),
                    last_updated_at=to_utc(item.get("lastUpdated") or item.get("updatedOn")),
                )
            )
        return stats

    def get_queue_items(
        self, *, process_key: str, status: Optional[str] = None, limit: int = 100
    ) -> List[QueueItemRecord]:
        """Return work items for one queue."""
        payload = self.request(
            "GET",
            self._url("queue_items", queue_id=process_key),
            params={"limit": min(int(limit), 500), "status": status} if status else {"limit": min(int(limit), 500)},
        )
        return [
            QueueItemRecord(
                item_id=str(item.get("id") or item.get("workItemId")),
                process_key=process_key,
                status=str(item.get("status") or "New"),
                created_at=to_utc(item.get("createdOn") or item.get("createdAt")),
                priority=str(item.get("priority")) if item.get("priority") is not None else None,
                reference=item.get("jsonAttributes") or item.get("reference"),
                raw=item,
            )
            for item in self.unwrap_list(payload, "list", "data", "value")
        ]

    def get_machines(self) -> List[MachineRecord]:
        """Return Control Room devices/runners."""
        payload = self.request("GET", self._url("machines"), params={"limit": 200})
        machines: List[MachineRecord] = []
        for item in self.unwrap_list(payload, "list", "data", "value"):
            key = str(item.get("id") or item.get("deviceId") or item.get("name"))
            status = str(item.get("status") or item.get("deviceStatus") or "disconnected")
            machines.append(
                MachineRecord(
                    key=key,
                    name=str(item.get("name") or key),
                    status="Online" if status.lower() in ("connected", "online", "available") else "Offline",
                    runner_type="Attended" if "attended" in str(item.get("type", "")).lower() else "Unattended",
                    os_name=item.get("operatingSystem") or item.get("os"),
                    agent_version=str(item.get("agentVersion") or ""),
                    ip_address=item.get("ipAddress") or item.get("hostName"),
                    robot_capacity=int(item.get("capacity") or item.get("concurrentBots") or 1),
                    provider=self.name,
                    extra={"raw": item},
                )
            )
        return machines

    def get_bot_status(self, *, machine_key: Optional[str] = None) -> List[BotStatus]:
        """Return device status (online/offline + current deployment)."""
        if machine_key:
            payload = self.request("GET", self._url("bot_status", device_id=machine_key))
            items = [payload] if isinstance(payload, dict) else self.unwrap_list(payload, "data")
        else:
            payload = self.request("GET", self._url("machines"), params={"limit": 200})
            items = self.unwrap_list(payload, "list", "data", "value")

        statuses: List[BotStatus] = []
        for item in items:
            key = str(item.get("id") or item.get("deviceId") or item.get("name"))
            status = str(item.get("status") or item.get("deviceStatus") or "offline")
            statuses.append(
                BotStatus(
                    machine_key=key,
                    status="Online" if status.lower() in ("connected", "online", "available", "busy") else "Offline",
                    current_job_id=str(item.get("currentDeploymentId")) if item.get("currentDeploymentId") else None,
                    current_process_key=item.get("currentAutomationName"),
                    since=to_utc(item.get("statusUpdatedOn") or item.get("lastModified")),
                )
            )
        return statuses

    # ------------------------------------------------------------------ #
    # Control
    # ------------------------------------------------------------------ #
    def start_job(self, request: JobStartRequest) -> JobHandle:
        """Deploy an automation (A360: ``POST /v3/automations/deploy``)."""
        body: Dict[str, Any] = {
            "fileId": request.process_key,
            "runAsUserIds": [int(key) for key in request.machine_keys if str(key).isdigit()] or [],
            "botInput": request.arguments or {},
        }
        if request.machine_keys:
            body["deviceIds"] = [str(k) for k in request.machine_keys]

        payload = self.request("POST", self._url("start_job"), json_body=body)
        deployment_id = (payload or {}).get("deploymentId") or (payload or {}).get("id")
        return JobHandle(
            external_id=str(deployment_id) if deployment_id else None,
            accepted=bool(deployment_id),
            status=CanonicalStatus.PENDING,
            message="Deployment submitted to Automation Anywhere",
        )

    def stop_job(self, external_id: str, *, reason: Optional[str] = None) -> JobHandle:
        """Stop a running deployment."""
        self.request("POST", self._url("stop_job", deployment_id=external_id), json_body={})
        return JobHandle(
            external_id=external_id, accepted=True, status=CanonicalStatus.STOPPED, message="Stop requested"
        )

    CAPABILITIES: Dict[str, bool] = {
        "read_processes": True,
        "read_runs": True,
        "read_queues": True,
        "read_machines": True,
        "read_bot_status": True,
        "start_job": True,
        "stop_job": True,
        "queue_items": True,
    }
