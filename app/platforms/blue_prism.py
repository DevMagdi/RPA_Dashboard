"""Blue Prism adapter (stub — vendor-neutral extension point).

Blue Prism is deployed On-Premises inside the bank. Its runtime resources
expose work queues and process execution through the Blue Prism application
server / database. This stub implements the
:class:`~app.platforms.base.PlatformAdapter` contract so the organization
can select ``blue_prism`` as its provider today; read methods return empty
collections until the bank-specific connection (application-server API or
read-only database views) is configured. Control actions are explicitly
reported as unsupported instead of silently pretending to run a bot.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import List, Optional

from app.platforms.base import (
    AdapterHealth,
    CanonicalStatus,
    JobHandle,
    JobStartRequest,
    MachineRecord,
    PlatformAdapter,
    ProcessDefinition,
    QueueStats,
    RunRecord,
)

logger = logging.getLogger(__name__)


class BluePrismAdapter(PlatformAdapter):
    """Blue Prism integration placeholder (safe no-op reads)."""

    name = "blue_prism"
    display_name = "Blue Prism"

    CAPABILITIES = {
        "read_processes": False,
        "read_runs": False,
        "read_queues": False,
        "read_machines": False,
        "read_bot_status": False,
        "start_job": False,
        "stop_job": False,
        "queue_items": False,
    }

    def get_processes(self, *, include_inactive: bool = False) -> List[ProcessDefinition]:
        return []

    def get_runs(
        self, *, process_key: Optional[str] = None, since: Optional[datetime] = None, limit: int = 500
    ) -> List[RunRecord]:
        return []

    def get_queue_stats(self, *, process_key: Optional[str] = None) -> List[QueueStats]:
        return []

    def get_machines(self) -> List[MachineRecord]:
        return []

    def get_bot_status(self, *, machine_key=None):
        return []

    def start_job(self, request: JobStartRequest) -> JobHandle:
        return JobHandle(
            external_id=None,
            accepted=False,
            status=CanonicalStatus.UNKNOWN,
            message="Blue Prism control is not configured for this installation",
        )

    def stop_job(self, external_id: str, *, reason: Optional[str] = None) -> JobHandle:
        return JobHandle(
            external_id=external_id,
            accepted=False,
            status=CanonicalStatus.UNKNOWN,
            message="Blue Prism control is not configured for this installation",
        )

    def health(self) -> AdapterHealth:
        configured = bool(self.config.get("base_url"))
        return AdapterHealth(
            ok=False,
            provider=self.name,
            message="Blue Prism adapter stub — configure the application-server connection"
            if not configured
            else "Blue Prism connection not yet implemented for this installation",
        )
