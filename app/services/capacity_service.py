"""Capacity Advisor (recommendation engine).

Turns raw telemetry into **actionable, quantified** advice, e.g.::

    [Critical] Invoice_Processing — add 2 Unattended runners
    Runner utilisation 92% · queue depth 480 items · predicted wait 47 min
    against a 30 min SLA. Adding 2 runners brings the projected wait to 16 min.

How it works
------------
For every process the engine computes:

* **Runner utilisation** — productive automation minutes versus available
  runner minutes (runner type drives availability: 24 h unattended, 8 h
  attended, 4 h test bot).
* **Predicted queue wait** — ``depth × seconds-per-item ÷ parallel capacity``.
* **SLA verdict** — predicted wait vs ``SLATargetMinutes`` (breach risk at 100%,
  warning at the process ``SLAWarningRatio``).
* **Throughput gap** — actual runs/day versus ``ExpectedRunsPerDay``.
* **Fleet hygiene** — offline runners still assigned, idle runners, processes
  without an SLA target, chronic failures.

Each insight becomes a row in ``Recommendations`` (deduplicated by fingerprint,
history preserved) with a severity of ``Info`` / ``Warning`` / ``Critical`` and
a one-click action payload consumed by the UI.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.core.cache import get_cache
from app.core.config import get_settings
from app.core.metrics import RECOMMENDATIONS
from app.db.dialect import get_flavor
from app.db.repository import fetch_all, fetch_one, insert_row, update_rows
from app.db.tables import Recommendations

logger = logging.getLogger(__name__)

SEVERITY_INFO = "Info"
SEVERITY_WARNING = "Warning"
SEVERITY_CRITICAL = "Critical"

#: Hours a runner of each type is available per day.
AVAILABILITY_HOURS = {"Unattended": 24.0, "Attended": 8.0, "TestBot": 4.0, "": 24.0}


# --------------------------------------------------------------------------- #
# Domain objects
# --------------------------------------------------------------------------- #
@dataclass
class ProcessCapacity:
    """Per-process capacity and SLA health snapshot."""

    process_name: str
    department: str
    criticality: str = "Medium"
    sla_target_minutes: int = 0
    runner_capacity: int = 0
    online_runners: int = 0
    offline_runners: int = 0
    busy_minutes_7d: float = 0.0
    available_minutes_7d: float = 0.0
    utilization_percent: float = 0.0
    runs_per_day: float = 0.0
    expected_runs_per_day: int = 0
    throughput_gap_percent: float = 0.0
    queue_depth: int = 0
    active_items: int = 0
    avg_item_seconds: float = 30.0
    predicted_wait_minutes: float = 0.0
    sla_status: str = "Unknown"  # Healthy | Warning | Breach_Risk | Unknown
    failure_rate_percent: float = 0.0
    runs_7d: int = 0
    failed_7d: int = 0
    cost_saved_7d: float = 0.0
    avg_duration_minutes: float = 0.0

    @property
    def is_bottleneck(self) -> bool:
        """True when the process cannot meet its SLA with the current fleet."""
        return self.sla_status == "Breach_Risk" or self.throughput_gap_percent > 25


@dataclass
class Recommendation:
    """A single actionable insight."""

    kind: str
    severity: str
    title: str
    detail: str
    process_name: Optional[str] = None
    department: Optional[str] = None
    suggested_action: Optional[str] = None
    action_payload: Dict[str, Any] = field(default_factory=dict)
    metrics: Dict[str, Any] = field(default_factory=dict)
    fingerprint: str = ""
    recommendation_id: Optional[int] = None
    status: str = "Open"
    created_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        payload = asdict(self)
        payload["metrics"] = self.metrics
        return payload


# --------------------------------------------------------------------------- #
# Analytics
# --------------------------------------------------------------------------- #
def compute_capacity(session: Session, *, window_days: int = 7) -> List[ProcessCapacity]:
    """Compute the capacity snapshot for every active process."""
    flavor = get_flavor()
    settings = get_settings()

    config_rows = fetch_all(
        session,
        f"""
        SELECT ConfigID, ProcessName, Department, Criticality, SLATargetMinutes,
               ExpectedRunsPerDay, SLAWarningRatio
        FROM ProcessConfig
        WHERE IsActive = {flavor.true_literal} AND IsDeleted = {flavor.false_literal}
        ORDER BY ProcessName
        """,
        {},
        operation="capacity.config",
    )
    if not config_rows:
        return []

    run_rows = fetch_all(
        session,
        f"""
        SELECT r.ProcessName,
               COUNT(1) AS runs,
               COALESCE(SUM(COALESCE(r.DurationMinutes, 0)), 0) AS busy_minutes,
               COALESCE(AVG(CASE WHEN r.DurationMinutes IS NOT NULL THEN r.DurationMinutes END), 0) AS avg_duration,
               COALESCE(SUM(CASE WHEN r.Status IN ('Failed','Stopped') THEN 1 ELSE 0 END), 0) AS failed,
               COALESCE(SUM(COALESCE(r.CostSaved, 0)), 0) AS cost_saved
        FROM ProcessRuns r
        WHERE r.StartTime >= {flavor.days_ago(window_days)}
        GROUP BY r.ProcessName
        """,
        {},
        operation="capacity.runs",
    )
    runs_by_process = {str(row["ProcessName"]): row for row in run_rows}

    machine_rows = fetch_all(
        session,
        f"""
        SELECT AssignedProcess, RunnerType, Status, LastPing, CPU_Usage
        FROM BotInfrastructure
        WHERE IsDeleted = {flavor.false_literal}
        """,
        {},
        operation="capacity.machines",
    )
    fleet: Dict[str, List[Dict[str, Any]]] = {}
    for machine in machine_rows:
        process = str(machine.get("AssignedProcess") or "")
        fleet.setdefault(process, []).append(machine)

    queue_rows = fetch_all(
        session,
        f"""
        SELECT ProcessName, PendingItems, ActiveItems, AvgItemProcessingSeconds
        FROM ProcessQueues
        WHERE IsDeleted = {flavor.false_literal}
        """,
        {},
        operation="capacity.queues",
    )
    queue_by_process = {str(row["ProcessName"]): row for row in queue_rows}

    now = datetime.utcnow()
    snapshots: List[ProcessCapacity] = []

    for config in config_rows:
        process_name = str(config["ProcessName"])
        stats = runs_by_process.get(process_name, {})
        queue = queue_by_process.get(process_name, {})
        machines = fleet.get(process_name, [])

        online = [
            m
            for m in machines
            if str(m.get("Status")) == "Online"
            and m.get("LastPing")
            and (now - m["LastPing"]) < timedelta(seconds=settings.AGENT_STALE_SECONDS)
        ]
        offline = [m for m in machines if m not in online]

        # Available minutes depend on runner type mix
        available_minutes = 0.0
        for machine in online:
            hours = AVAILABILITY_HOURS.get(str(machine.get("RunnerType") or ""), 24.0)
            available_minutes += hours * 60 * window_days

        busy_minutes = float(stats.get("busy_minutes") or 0)
        utilization = (busy_minutes / available_minutes * 100) if available_minutes > 0 else 0.0

        runs = int(stats.get("runs") or 0)
        failed = int(stats.get("failed") or 0)
        runs_per_day = runs / window_days if window_days else 0.0
        expected_runs = int(config.get("ExpectedRunsPerDay") or 0)
        gap = ((expected_runs - runs_per_day) / expected_runs * 100) if expected_runs > 0 else 0.0

        pending = int(queue.get("PendingItems") or 0)
        avg_item_seconds = float(queue.get("AvgItemProcessingSeconds") or 30)
        parallel_capacity = max(1, len(online))

        # Predicted wait: queue drain time given current parallel capacity
        predicted_wait = (pending * avg_item_seconds / 60.0) / parallel_capacity if pending else 0.0
        sla_target = int(config.get("SLATargetMinutes") or 0)
        warning_ratio = float(config.get("SLAWarningRatio") or 0.75)

        if sla_target <= 0:
            sla_status = "Unknown"
        elif predicted_wait >= sla_target:
            sla_status = "Breach_Risk"
        elif predicted_wait >= sla_target * warning_ratio:
            sla_status = "Warning"
        else:
            sla_status = "Healthy"

        snapshots.append(
            ProcessCapacity(
                process_name=process_name,
                department=str(config.get("Department") or "Operations"),
                criticality=str(config.get("Criticality") or "Medium"),
                sla_target_minutes=sla_target,
                runner_capacity=len(machines),
                online_runners=len(online),
                offline_runners=len(offline),
                busy_minutes_7d=round(busy_minutes, 1),
                available_minutes_7d=round(available_minutes, 1),
                utilization_percent=round(utilization, 1),
                runs_per_day=round(runs_per_day, 1),
                expected_runs_per_day=expected_runs,
                throughput_gap_percent=round(max(0.0, gap), 1),
                queue_depth=pending,
                active_items=int(queue.get("ActiveItems") or 0),
                avg_item_seconds=avg_item_seconds,
                predicted_wait_minutes=round(predicted_wait, 1),
                sla_status=sla_status,
                failure_rate_percent=round((failed / runs * 100) if runs else 0.0, 1),
                runs_7d=runs,
                failed_7d=failed,
                cost_saved_7d=round(float(stats.get("cost_saved") or 0), 2),
                avg_duration_minutes=round(float(stats.get("avg_duration") or 0), 2),
            )
        )

    return snapshots


def _fingerprint(kind: str, process_name: Optional[str], window: str) -> str:
    """Stable dedupe key so the same insight is not re-created every run."""
    raw = f"{kind}|{process_name or '-'}|{window}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:40]


def _recommend_additional_runners(capacity: ProcessCapacity, settings: Any) -> Optional[Recommendation]:
    """Generate the headline recommendation: how many runners to add."""
    if capacity.online_runners == 0 and capacity.queue_depth == 0 and capacity.runs_7d == 0:
        return None

    severity: Optional[str] = None
    if capacity.sla_status == "Breach_Risk" or capacity.utilization_percent >= settings.CAPACITY_UTILIZATION_CRITICAL:
        severity = SEVERITY_CRITICAL
    elif capacity.sla_status == "Warning" or capacity.utilization_percent >= settings.CAPACITY_UTILIZATION_WARNING:
        severity = SEVERITY_WARNING

    if severity is None:
        return None

    # Required capacity to meet the SLA for the current backlog
    required = capacity.online_runners or 1
    if capacity.sla_target_minutes > 0 and capacity.queue_depth > 0:
        required = max(
            1,
            math.ceil(capacity.queue_depth * capacity.avg_item_seconds / 60.0 / capacity.sla_target_minutes),
        )
    else:
        # No SLA configured → size for the outstanding throughput gap
        required = max(1, math.ceil(capacity.online_runners * max(1.0, 1 + capacity.throughput_gap_percent / 100.0)))

    runners_to_add = max(1, required - capacity.online_runners)
    projected_wait = (
        round((capacity.queue_depth * capacity.avg_item_seconds / 60.0) / (capacity.online_runners + runners_to_add), 1)
        if capacity.queue_depth
        else 0.0
    )

    detail = (
        f"الاستغلال الحالي {capacity.utilization_percent}% · طول الطابور {capacity.queue_depth} عنصر · "
        f"الانتظار المتوقع {capacity.predicted_wait_minutes} دقيقة مقابل SLA {capacity.sla_target_minutes} دقيقة. "
        f"إضافة {runners_to_add} روبوت يخفض الانتظار المتوقع إلى {projected_wait} دقيقة."
    )

    return Recommendation(
        kind="capacity_add_runners",
        severity=severity,
        process_name=capacity.process_name,
        department=capacity.department,
        title=f"أضف {runners_to_add} روبوت {'Unattended' if capacity.criticality != 'Medium' else 'إضافي'} لعملية {capacity.process_name}",
        detail=detail,
        suggested_action="Request Additional Capacity",
        action_payload={
            "process_name": capacity.process_name,
            "runners_to_add": runners_to_add,
            "current_online_runners": capacity.online_runners,
            "target_utilization_percent": settings.CAPACITY_UTILIZATION_WARNING,
        },
        metrics={
            "utilization_percent": capacity.utilization_percent,
            "queue_depth": capacity.queue_depth,
            "predicted_wait_minutes": capacity.predicted_wait_minutes,
            "projected_wait_minutes": projected_wait,
            "sla_target_minutes": capacity.sla_target_minutes,
            "sla_status": capacity.sla_status,
            "throughput_gap_percent": capacity.throughput_gap_percent,
            "cost_saved_7d": capacity.cost_saved_7d,
        },
        fingerprint=_fingerprint("capacity_add_runners", capacity.process_name, "current"),
    )


def _recommend_missing_sla(capacity: ProcessCapacity) -> Optional[Recommendation]:
    """A process without an SLA target cannot be governed — ask for one."""
    if capacity.sla_target_minutes > 0:
        return None
    return Recommendation(
        kind="sla_not_configured",
        severity=SEVERITY_INFO,
        process_name=capacity.process_name,
        department=capacity.department,
        title=f"لم يتم تحديد SLA لعملية {capacity.process_name}",
        detail=(
            "بدون زمن استهداف لن نتمكن من حساب مخاطر تجاوز الـ SLA أو التوصية بسعة إضافية بدقة. "
            f"متوسط مدة التشغيل الحالي {capacity.avg_duration_minutes} دقيقة."
        ),
        suggested_action="Configure SLA",
        action_payload={"process_name": capacity.process_name, "suggested_sla_minutes": int(capacity.avg_duration_minutes or 30)},
        metrics={"avg_duration_minutes": capacity.avg_duration_minutes, "runs_7d": capacity.runs_7d},
        fingerprint=_fingerprint("sla_not_configured", capacity.process_name, "current"),
    )


def _recommend_offline_runners(capacity: ProcessCapacity) -> Optional[Recommendation]:
    """Offline runners assigned to a busy process are wasted licence capacity."""
    if capacity.offline_runners <= 0 or (capacity.queue_depth == 0 and capacity.utilization_percent < 50):
        return None
    severity = SEVERITY_CRITICAL if capacity.sla_status == "Breach_Risk" else SEVERITY_WARNING
    return Recommendation(
        kind="runners_offline",
        severity=severity,
        process_name=capacity.process_name,
        department=capacity.department,
        title=f"{capacity.offline_runners} روبوت غير متصل لعملية {capacity.process_name}",
        detail=(
            f"عدد {capacity.offline_runners} من أصل {capacity.runner_capacity} روبوت غير متصل، "
            f"مما يقلل السعة الفعلية إلى {capacity.online_runners} روبوت مع طابور {capacity.queue_depth} عنصر."
        ),
        suggested_action="Investigate Runners",
        action_payload={"process_name": capacity.process_name, "offline_runners": capacity.offline_runners},
        metrics={"offline_runners": capacity.offline_runners, "online_runners": capacity.online_runners},
        fingerprint=_fingerprint("runners_offline", capacity.process_name, "current"),
    )


def _recommend_failures(capacity: ProcessCapacity) -> Optional[Recommendation]:
    """Chronic failure rate erodes the business case — flag it."""
    if capacity.runs_7d < 20 or capacity.failure_rate_percent < 10:
        return None
    severity = SEVERITY_CRITICAL if capacity.failure_rate_percent >= 25 else SEVERITY_WARNING
    lost_savings = round(capacity.cost_saved_7d * (capacity.failure_rate_percent / 100), 2)
    return Recommendation(
        kind="high_failure_rate",
        severity=severity,
        process_name=capacity.process_name,
        department=capacity.department,
        title=f"معدل فشل مرتفع ({capacity.failure_rate_percent}%) لعملية {capacity.process_name}",
        detail=(
            f"{capacity.failed_7d} من {capacity.runs_7d} تشغيل خلال أسبوع. "
            f"القيمة المفقودة من توقفات تقديرية {lost_savings:,.0f}."
        ),
        suggested_action="Review Failures",
        action_payload={"process_name": capacity.process_name},
        metrics={"failure_rate_percent": capacity.failure_rate_percent, "failed_runs": capacity.failed_7d},
        fingerprint=_fingerprint("high_failure_rate", capacity.process_name, "current"),
    )


def _recommend_idle_fleet(capacities: List[ProcessCapacity]) -> Optional[Recommendation]:
    """Unassigned/idle capacity is a licence cost worth flagging at fleet level."""
    idle = [
        c
        for c in capacities
        if c.utilization_percent < 25 and c.runs_7d < max(10, c.expected_runs_per_day * 3) and c.runner_capacity > 0
    ]
    if not idle:
        return None
    total_savings = round(sum(c.cost_saved_7d for c in idle), 2)
    return Recommendation(
        kind="idle_capacity",
        severity=SEVERITY_INFO,
        process_name=None,
        department=None,
        title=f"{len(idle)} عملية بسعة غير مستغلة (استغلال أقل من 25%)",
        detail=(
            "إمكانية إعادة توزيع الرخص على العمليات المزدحمة بدلاً من شراء سعة جديدة. "
            "العمليات: " + ", ".join(c.process_name for c in idle[:6])
        ),
        suggested_action="Rebalance Capacity",
        action_payload={"processes": [c.process_name for c in idle]},
        metrics={"processes_count": len(idle), "cost_saved_7d": total_savings},
        fingerprint=_fingerprint("idle_capacity", None, "current"),
    )


def generate_recommendations(
    session: Session, *, persist: bool = True, limit_per_kind: int = 50
) -> List[Recommendation]:
    """Run the engine, persist the insights and return them (newest first)."""
    settings = get_settings()
    capacities = compute_capacity(session, window_days=settings.CAPACITY_LOOKAHEAD_DAYS // 2 or 7)

    candidates: List[Recommendation] = []
    for capacity in capacities:
        per_process = [
            _recommend_additional_runners(capacity, settings),
            _recommend_missing_sla(capacity),
            _recommend_offline_runners(capacity),
            _recommend_failures(capacity),
        ]
        candidates.extend(item for item in per_process if item)

    fleet_recommendation = _recommend_idle_fleet(capacities)
    if fleet_recommendation:
        candidates.append(fleet_recommendation)

    # Severity ordering for the UI (critical first)
    order = {SEVERITY_CRITICAL: 0, SEVERITY_WARNING: 1, SEVERITY_INFO: 2}
    candidates.sort(key=lambda r: (order.get(r.severity, 3), -(r.metrics.get("queue_depth") or 0)))

    if persist:
        _persist(session, recommendations=candidates[:limit_per_kind])

    for recommendation in candidates:
        RECOMMENDATIONS.labels(severity=recommendation.severity, kind=recommendation.kind).inc()

    return candidates


def _persist(session: Session, *, recommendations: List[Recommendation]) -> None:
    """Upsert recommendations, keeping history and avoiding duplicates."""
    now = datetime.utcnow()
    open_rows = fetch_all(
        session,
        "SELECT RecommendationID, Fingerprint, Severity, Status FROM Recommendations "
        "WHERE Status IN ('Open','Acknowledged','Requested')",
        {},
        operation="capacity.open_recommendations",
    )

    existing = {str(row.get("Fingerprint")): row for row in open_rows}
    seen: set[str] = set()

    for recommendation in recommendations:
        seen.add(recommendation.fingerprint)
        current = existing.get(recommendation.fingerprint)
        if current:
            # Refresh the numbers but keep the operator's lifecycle state
            if str(current.get("Severity")) != recommendation.severity or recommendation.metrics:
                update_rows(
                    session,
                    Recommendations,
                    {
                        "Severity": recommendation.severity,
                        "Title": recommendation.title[:300],
                        "Detail": recommendation.detail,
                        "MetricsJson": json.dumps(recommendation.metrics, default=str),
                    },
                    [Recommendations.c.RecommendationID == int(current["RecommendationID"])],
                )
            continue

        new_id = insert_row(
            session,
            Recommendations,
            {
                "Kind": recommendation.kind,
                "Severity": recommendation.severity,
                "ProcessName": recommendation.process_name,
                "Department": recommendation.department,
                "Title": recommendation.title[:300],
                "Detail": recommendation.detail,
                "MetricsJson": json.dumps(recommendation.metrics, default=str),
                "SuggestedAction": recommendation.suggested_action,
                "ActionPayloadJson": json.dumps(recommendation.action_payload, default=str),
                "Status": "Open",
                "Fingerprint": recommendation.fingerprint,
            },
        )
        recommendation.recommendation_id = int(new_id)

    # Auto-resolve insights that no longer apply
    for fingerprint, row in existing.items():
        if fingerprint not in seen:
            update_rows(
                session,
                Recommendations,
                {"Status": "Resolved", "AppliedAt": now},
                [Recommendations.c.RecommendationID == int(row["RecommendationID"])],
            )


def get_capacity_summary(
    session: Session, *, department_scope: str = "ALL", use_cache: bool = True
) -> Dict[str, Any]:
    """Capacity snapshot + active recommendations (cached for the dashboard)."""
    cache = get_cache()
    cache_key = f"capacity:v4:{department_scope}"
    if use_cache:
        cached = cache.get_json(cache_key)
        if cached:
            return cached

    capacities = compute_capacity(session)
    if department_scope and department_scope.upper() != "ALL":
        capacities = [c for c in capacities if c.department == department_scope]

    recommendations = _load_open_recommendations(session, department_scope=department_scope)

    bottlenecks = sorted(
        [c for c in capacities if c.sla_status in ("Breach_Risk", "Warning")],
        key=lambda c: (c.sla_status != "Breach_Risk", -c.predicted_wait_minutes),
    )

    total_runners = sum(c.online_runners for c in capacities)
    total_queue = sum(c.queue_depth for c in capacities)
    weighted_util = (
        round(sum(c.utilization_percent * max(1, c.online_runners) for c in capacities) / max(1, total_runners), 1)
        if capacities
        else 0.0
    )

    summary = {
        "total_processes": len(capacities),
        "online_runners": total_runners,
        "total_queue_depth": total_queue,
        "avg_utilization_percent": weighted_util,
        "critical_count": len([r for r in recommendations if r["severity"] == SEVERITY_CRITICAL]),
        "warning_count": len([r for r in recommendations if r["severity"] == SEVERITY_WARNING]),
        "info_count": len([r for r in recommendations if r["severity"] == SEVERITY_INFO]),
        "sla_at_risk": len([c for c in capacities if c.sla_status == "Breach_Risk"]),
        "sla_warning": len([c for c in capacities if c.sla_status == "Warning"]),
        "potential_savings_7d": round(sum(c.cost_saved_7d for c in capacities), 2),
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }

    payload = {
        "summary": summary,
        "utilization": [
            {
                "process_name": c.process_name,
                "department": c.department,
                "criticality": c.criticality,
                "utilization_percent": c.utilization_percent,
                "queue_depth": c.queue_depth,
                "predicted_wait_minutes": c.predicted_wait_minutes,
                "sla_target_minutes": c.sla_target_minutes,
                "sla_status": c.sla_status,
                "online_runners": c.online_runners,
                "runs_7d": c.runs_7d,
                "failure_rate_percent": c.failure_rate_percent,
                "cost_saved_7d": c.cost_saved_7d,
                "throughput_gap_percent": c.throughput_gap_percent,
            }
            for c in capacities
        ],
        "bottlenecks": [
            {
                "process_name": c.process_name,
                "predicted_wait_minutes": c.predicted_wait_minutes,
                "sla_target_minutes": c.sla_target_minutes,
                "queue_depth": c.queue_depth,
                "utilization_percent": c.utilization_percent,
                "sla_status": c.sla_status,
            }
            for c in bottlenecks[:10]
        ],
        "recommendations": recommendations[:20],
    }

    if use_cache:
        cache.set_json(cache_key, payload, 45)
    return payload


def _load_open_recommendations(
    session: Session, *, department_scope: str = "ALL", limit: int = 100
) -> List[Dict[str, Any]]:
    """Read active recommendations, mapped for the API/UI."""
    flavor = get_flavor()
    where = ["Status IN ('Open','Acknowledged','Requested')"]
    params: Dict[str, Any] = {"limit": int(limit)}
    if department_scope and department_scope.upper() != "ALL":
        where.append("(Department = :dept OR Department IS NULL)")
        params["dept"] = department_scope

    rows = fetch_all(
        session,
        f"""
        SELECT {flavor.top(params['limit'])} RecommendationID, Kind, Severity, ProcessName, Department, Title,
               Detail, MetricsJson, SuggestedAction, ActionPayloadJson, Status, CreatedAt,
               AcknowledgedBy, AcknowledgedAt, AppliedAt
        FROM Recommendations
        WHERE {' AND '.join(where)}
        ORDER BY
            CASE Severity WHEN 'Critical' THEN 0 WHEN 'Warning' THEN 1 ELSE 2 END,
            CreatedAt DESC{flavor.limit(params['limit'])}
        """,
        params,
        operation="capacity.open_recommendations",
    )

    def _safe_json(raw: Any, fallback: Any) -> Any:
        if not raw:
            return fallback
        try:
            return json.loads(raw)
        except (TypeError, ValueError):
            return fallback

    return [
        {
            "id": int(row["RecommendationID"]),
            "kind": row.get("Kind"),
            "severity": row.get("Severity"),
            "process_name": row.get("ProcessName"),
            "department": row.get("Department"),
            "title": row.get("Title"),
            "detail": row.get("Detail"),
            "metrics": _safe_json(row.get("MetricsJson"), {}),
            "suggested_action": row.get("SuggestedAction"),
            "action_payload": _safe_json(row.get("ActionPayloadJson"), {}),
            "status": row.get("Status"),
            "created_at": row.get("CreatedAt"),
            "acknowledged_at": row.get("AcknowledgedAt"),
            "acknowledged_by": row.get("AcknowledgedBy"),
            "applied_at": row.get("AppliedAt"),
        }
        for row in rows
    ]


def list_recommendations(
    session: Session,
    *,
    
    status: Optional[str] = None,
    severity: Optional[str] = None,
    process_name: Optional[str] = None,
    limit: int = 200,
) -> List[Dict[str, Any]]:
    """History view: filter by status/severity/process."""
    flavor = get_flavor()
    where = ["1 = 1"]
    params: Dict[str, Any] = {"limit": int(min(limit, 1000))}
    if status:
        where.append("Status = :status")
        params["status"] = status
    if severity:
        where.append("Severity = :severity")
        params["severity"] = severity
    if process_name:
        where.append("ProcessName = :process")
        params["process"] = process_name

    rows = fetch_all(
        session,
        f"""
        SELECT {flavor.top(params['limit'])} RecommendationID, Kind, Severity, ProcessName, Department, Title,
               Detail, MetricsJson, SuggestedAction, ActionPayloadJson, Status, CreatedAt, AppliedAt
        FROM Recommendations
        WHERE {' AND '.join(where)}
        ORDER BY CreatedAt DESC{flavor.limit(params['limit'])}
        """,
        params,
        operation="capacity.list_recommendations",
    )
    result = []
    for row in rows:
        try:
            metrics = json.loads(row.get("MetricsJson") or "{}")
        except (TypeError, ValueError):
            metrics = {}
        try:
            action_payload = json.loads(row.get("ActionPayloadJson") or "{}")
        except (TypeError, ValueError):
            action_payload = {}
        result.append(
            {
                "id": int(row["RecommendationID"]),
                "kind": row.get("Kind"),
                "severity": row.get("Severity"),
                "process_name": row.get("ProcessName"),
                "department": row.get("Department"),
                "title": row.get("Title"),
                "detail": row.get("Detail"),
                "metrics": metrics,
                "suggested_action": row.get("SuggestedAction"),
                "action_payload": action_payload,
                "status": row.get("Status"),
                "created_at": row.get("CreatedAt"),
                "applied_at": row.get("AppliedAt"),
            }
        )
    return result


def set_recommendation_status(
    session: Session,
    *,
    
    recommendation_id: int,
    status: str,
    user_id: Optional[int] = None,
    comment: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Acknowledge / request / apply / dismiss a recommendation."""
    allowed = {"Acknowledged", "Requested", "Applied", "Dismissed", "Resolved", "Open"}
    if status not in allowed:
        raise ValueError(f"status must be one of {sorted(allowed)}")

    row = fetch_one(
        session,
        "SELECT RecommendationID, Status, Kind, ProcessName, ActionPayloadJson FROM Recommendations "
        "WHERE RecommendationID = :id",
        {"id": recommendation_id},
        operation="capacity.get_recommendation",
    )
    if not row:
        return None

    values: Dict[str, Any] = {"Status": status}
    if status == "Acknowledged":
        values.update({"AcknowledgedBy": user_id, "AcknowledgedAt": datetime.utcnow()})
    if status in ("Applied", "Requested"):
        values["AppliedAt"] = datetime.utcnow()
    if comment:
        values["Detail"] = comment[:4000]

    update_rows(session, Recommendations, values, [Recommendations.c.RecommendationID == recommendation_id])

    try:
        action_payload = json.loads(row.get("ActionPayloadJson") or "{}")
    except (TypeError, ValueError):
        action_payload = {}

    return {
        "id": recommendation_id,
        "status": status,
        "kind": row.get("Kind"),
        "process_name": row.get("ProcessName"),
        "action_payload": action_payload,
    }


def capacity_history(session: Session, *, process_name: Optional[str] = None, days: int = 30) -> List[Dict[str, Any]]:
    """Historical SLA/queue trend for one process (backed by QueueSnapshots)."""
    flavor = get_flavor()
    where = [f"CapturedAt >= {flavor.days_ago(int(days))}"]
    params: Dict[str, Any] = {}
    if process_name:
        where.append("ProcessName = :p")
        params["p"] = process_name

    rows = fetch_all(
        session,
        f"""
        SELECT {flavor.cast_date('CapturedAt')} AS day,
               AVG(PendingItems) AS avg_pending,
               MAX(PendingItems) AS max_pending,
               AVG(ActiveItems) AS avg_active
        FROM QueueSnapshots
        WHERE {' AND '.join(where)}
        GROUP BY {flavor.cast_date('CapturedAt')}
        ORDER BY 1
        """,
        params,
        operation="capacity.history",
    )
    return [
        {
            "date": row["day"].strftime("%Y-%m-%d") if isinstance(row.get("day"), datetime) else str(row.get("day")),
            "avg_pending": round(float(row.get("avg_pending") or 0), 1),
            "max_pending": int(row.get("max_pending") or 0),
            "avg_active": round(float(row.get("avg_active") or 0), 1),
        }
        for row in rows
    ]
