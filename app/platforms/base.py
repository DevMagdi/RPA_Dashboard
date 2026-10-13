"""Platform adapter abstraction — the multi-vendor core of the Control Room.

The Control Room must orchestrate **any** RPA stack a bank may own:
UiPath Orchestrator, Automation Anywhere (v11 / Automation 360), Blue Prism or
a bespoke home-grown runner.  Instead of branching on vendor names throughout
the codebase, every integration implements :class:`PlatformAdapter`.

Design principles
-----------------
* **Composition over inheritance** — adapters *own* their HTTP client, mapper
  and configuration; they do not inherit vendor-specific behaviour.
* **Canonical domain model** — adapters translate vendor payloads into the
  dataclasses below (ISO-8601 UTC timestamps, normalised statuses).
* **Config-driven** — a new client is onboarded by storing a provider key plus
  credentials in the tenant configuration; **zero code change**.
* **Read + write** — adapters expose both telemetry reads and control actions
  (``start_job`` / ``stop_job``) so the dashboard can act, not just observe.
"""

from __future__ import annotations

import abc
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, Iterable, List, Optional, Sequence

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Canonical statuses
# --------------------------------------------------------------------------- #
class CanonicalStatus(str, Enum):
    """Vendor-independent run/job statuses used across the platform."""

    PENDING = "Pending"
    RUNNING = "Running"
    COMPLETED = "Completed"
    FAILED = "Failed"
    STOPPED = "Stopped"
    FAULTED = "Faulted"
    SUSPENDED = "Suspended"
    UNKNOWN = "Unknown"


#: Vendor status → canonical status mapping (extendable per adapter).
_STATUS_ALIASES: Dict[str, CanonicalStatus] = {
    # English generics
    "successful": CanonicalStatus.COMPLETED,
    "success": CanonicalStatus.COMPLETED,
    "completed": CanonicalStatus.COMPLETED,
    "complete": CanonicalStatus.COMPLETED,
    "done": CanonicalStatus.COMPLETED,
    "finished": CanonicalStatus.COMPLETED,
    "failed": CanonicalStatus.FAILED,
    "failure": CanonicalStatus.FAILED,
    "error": CanonicalStatus.FAILED,
    "errored": CanonicalStatus.FAILED,
    "faulted": CanonicalStatus.FAULTED,
    "terminated": CanonicalStatus.STOPPED,
    "aborted": CanonicalStatus.STOPPED,
    "cancelled": CanonicalStatus.STOPPED,
    "canceled": CanonicalStatus.STOPPED,
    "stopped": CanonicalStatus.STOPPED,
    "killed": CanonicalStatus.STOPPED,
    "running": CanonicalStatus.RUNNING,
    "executing": CanonicalStatus.RUNNING,
    "inprogress": CanonicalStatus.RUNNING,
    "in_progress": CanonicalStatus.RUNNING,
    "pending": CanonicalStatus.PENDING,
    "queued": CanonicalStatus.PENDING,
    "new": CanonicalStatus.PENDING,
    "scheduled": CanonicalStatus.PENDING,
    "paused": CanonicalStatus.SUSPENDED,
    "suspended": CanonicalStatus.SUSPENDED,
    "onhold": CanonicalStatus.SUSPENDED,
}


def normalize_status(value: Any) -> CanonicalStatus:
    """Translate a vendor status string into :class:`CanonicalStatus`.

    Unknown values degrade to ``UNKNOWN`` instead of raising, keeping the
    platform resilient to vendor upgrades.
    """
    if isinstance(value, CanonicalStatus):
        return value
    key = str(value or "").strip().lower().replace(" ", "").replace("-", "_")
    return _STATUS_ALIASES.get(key, CanonicalStatus.UNKNOWN)


def to_utc(value: Any) -> Optional[datetime]:
    """Best-effort conversion of vendor timestamps to naive-UTC datetime.

    Accepts ``datetime`` objects, ISO-8601 strings and epoch milliseconds —
    the formats encountered across UiPath / AA / Blue Prism payloads.
    """
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, (int, float)):
        # Heuristic: values above 1e11 are milliseconds
        seconds = value / 1000.0 if value > 1e11 else float(value)
        return datetime.fromtimestamp(seconds, tz=timezone.utc).replace(tzinfo=None)
    else:
        text = str(value).strip()
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            for fmt in ("%Y-%m-%d %H:%M:%S", "%m/%d/%Y %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f"):
                try:
                    dt = datetime.strptime(text, fmt)
                    break
                except ValueError:
                    continue
            else:
                return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


# --------------------------------------------------------------------------- #
# Domain records
# --------------------------------------------------------------------------- #
@dataclass
class ProcessDefinition:
    """A published automation, normalised across vendors."""

    key: str
    name: str
    department: Optional[str] = None
    is_active: bool = True
    provider: str = "generic_sql"
    description: Optional[str] = None
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass
class RunRecord:
    """One job execution."""

    external_id: str
    process_key: str
    status: CanonicalStatus
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    duration_minutes: Optional[float] = None
    transactions_count: int = 0
    success_count: int = 0
    failed_count: int = 0
    machine_name: Optional[str] = None
    robot_name: Optional[str] = None
    failure_reason: Optional[str] = None
    exit_code: Optional[str] = None
    raw: Dict[str, Any] = field(default_factory=dict)

    def computed_duration(self) -> Optional[float]:
        """Duration in minutes, derived from timestamps when not supplied."""
        if self.duration_minutes is not None:
            return float(self.duration_minutes)
        if self.started_at and self.finished_at:
            return round((self.finished_at - self.started_at).total_seconds() / 60.0, 2)
        return None


@dataclass
class QueueStats:
    """Aggregate queue telemetry for one process."""

    process_key: str
    pending: int = 0
    active: int = 0
    avg_processing_seconds: float = 30.0
    failed: int = 0
    last_updated_at: Optional[datetime] = None


@dataclass
class QueueItemRecord:
    """A single work item inside a vendor queue."""

    item_id: str
    process_key: str
    status: str = "New"
    created_at: Optional[datetime] = None
    priority: Optional[str] = None
    reference: Optional[str] = None
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass
class MachineRecord:
    """A runner / robot host."""

    key: str
    name: str
    status: str = "Offline"
    cpu_usage: int = 0
    ram_usage: int = 0
    hdd_usage: int = 0
    total_ram_gb: int = 0
    total_hdd_gb: int = 0
    runner_type: str = "Unattended"
    last_ping: Optional[datetime] = None
    os_name: Optional[str] = None
    agent_version: Optional[str] = None
    ip_address: Optional[str] = None
    robot_capacity: int = 1
    provider: str = "generic_sql"
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass
class JobStartRequest:
    """Request to start an automation."""

    process_key: str
    machine_keys: Sequence[str] = field(default_factory=list)
    arguments: Dict[str, Any] = field(default_factory=dict)
    priority: str = "Normal"
    idempotency_key: Optional[str] = None
    trigger: str = "manual"
    triggered_by: Optional[str] = None
    reason: Optional[str] = None


@dataclass
class JobHandle:
    """Result of a control action."""

    external_id: Optional[str]
    accepted: bool
    status: CanonicalStatus = CanonicalStatus.PENDING
    message: str = ""


@dataclass
class BotStatus:
    """Live status of a robot/agent."""

    machine_key: str
    status: str
    current_job_id: Optional[str] = None
    current_process_key: Optional[str] = None
    since: Optional[datetime] = None


@dataclass
class AdapterHealth:
    """Health of the upstream platform (shown on the Control Room health page)."""

    ok: bool
    provider: str
    message: str = ""
    latency_ms: Optional[float] = None
    details: Dict[str, Any] = field(default_factory=dict)


# --------------------------------------------------------------------------- #
# Adapter interface
# --------------------------------------------------------------------------- #
class PlatformAdapter(abc.ABC):
    """Interface every vendor integration must implement.

    Implementations must be *pure translators*: no business rules, no tenant
    filtering, no persistence.  The service layer owns those concerns.
    """

    #: Stable identifier persisted in ``Tenants.PlatformProvider``.
    name: str = "abstract"

    #: Human readable vendor name for the UI.
    display_name: str = "Abstract Platform"

    def __init__(self, config: Optional[Dict[str, Any]] = None) -> None:
        self.config: Dict[str, Any] = config or {}

    # -------------------------- telemetry ----------------------------- #
    @abc.abstractmethod
    def get_processes(self, *, include_inactive: bool = False) -> List[ProcessDefinition]:
        """Return published automations."""

    @abc.abstractmethod
    def get_runs(
        self,
        *,
        process_key: Optional[str] = None,
        since: Optional[datetime] = None,
        limit: int = 500,
    ) -> List[RunRecord]:
        """Return recent job executions (newest first)."""

    @abc.abstractmethod
    def get_queue_stats(self, *, process_key: Optional[str] = None) -> List[QueueStats]:
        """Return queue depth/throughput per process."""

    def get_queue_items(self, *, process_key: str, status: Optional[str] = None, limit: int = 100) -> List[QueueItemRecord]:
        """Return individual work items (optional capability)."""
        return []

    @abc.abstractmethod
    def get_machines(self) -> List[MachineRecord]:
        """Return runner hosts with resource telemetry."""

    def get_bot_status(self, *, machine_key: Optional[str] = None) -> List[BotStatus]:
        """Return live robot status (optional capability)."""
        return []

    # --------------------------- control ------------------------------ #
    def start_job(self, request: JobStartRequest) -> JobHandle:
        """Start an automation (optional capability)."""
        raise NotImplementedError(f"{self.display_name} adapter does not support starting jobs")

    def stop_job(self, external_id: str, *, reason: Optional[str] = None) -> JobHandle:
        """Stop a running job (optional capability)."""
        raise NotImplementedError(f"{self.display_name} adapter does not support stopping jobs")

    # ----------------------------- meta ------------------------------- #
    def capabilities(self) -> Dict[str, bool]:
        """Feature matrix surfaced to the UI (which buttons to enable)."""
        return {
            "read_processes": True,
            "read_runs": True,
            "read_queues": True,
            "read_machines": True,
            "read_bot_status": False,
            "start_job": False,
            "stop_job": False,
            "queue_items": False,
        }

    def health(self) -> AdapterHealth:
        """Lightweight connectivity probe."""
        started = time.perf_counter()
        try:
            processes = self.get_processes(include_inactive=True)
            return AdapterHealth(
                ok=True,
                provider=self.name,
                message=f"reachable ({len(processes)} processes)",
                latency_ms=round((time.perf_counter() - started) * 1000, 2),
            )
        except NotImplementedError:
            return AdapterHealth(ok=True, provider=self.name, message="local adapter")
        except Exception as exc:  # pragma: no cover - depends on network
            logger.warning("Adapter health check failed for %s: %s", self.name, exc)
            return AdapterHealth(
                ok=False,
                provider=self.name,
                message=str(exc)[:200],
                latency_ms=round((time.perf_counter() - started) * 1000, 2),
            )

    # --------------------------- utilities ---------------------------- #
    @staticmethod
    def _first(payload: Dict[str, Any], *keys: str, default: Any = None) -> Any:
        """Return the first present key — vendors change field casing often."""
        for key in keys:
            if key in payload and payload[key] is not None:
                return payload[key]
            # case-insensitive fallback
            for actual, value in payload.items():
                if actual.lower() == key.lower() and value is not None:
                    return value
        return default

    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return f"<{type(self).__name__} provider={self.name}>"


def register_status_alias(alias: str, status: CanonicalStatus) -> None:
    """Allow adapters (or clients) to extend the status dictionary at runtime."""
    _STATUS_ALIASES[str(alias).strip().lower().replace(" ", "").replace("-", "_")] = status


def summarize_runs(runs: Iterable[RunRecord]) -> Dict[str, int]:
    """Small helper used by tests and the sync service."""
    summary: Dict[str, int] = {}
    for run in runs:
        summary[run.status.value] = summary.get(run.status.value, 0) + 1
    return summary
