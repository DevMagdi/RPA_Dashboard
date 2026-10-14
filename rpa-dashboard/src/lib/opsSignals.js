/**
 * Operations decision engine — turns raw dashboard payloads into a ranked
 * "what needs a decision right now" list.
 *
 * Why this module exists
 * ----------------------
 * Every number an operator needs to act on was already in the payload
 * (`kpis.failureDetailsAll`, `sla-workload`, `capacity.recommendations`,
 * open alerts) but nothing on the dashboard *ranked* it, so the screen showed
 * metrics without a verdict and nobody could tell what to do first.
 *
 * This file is deliberately **pure and dependency-free** (no React, no i18n,
 * no formatting): it maps server payload → ordered signals. That makes the
 * whole triage policy unit-testable, and keeps it out of the chart runtime.
 *
 * Every signal cites the server field it came from, so a reviewer can trace a
 * rendered row back to a payload key.
 */

/**
 * Operating thresholds.
 *
 * Three of the four health metrics are compared against a *server* target
 * (`kpis.targetRuns`, the SLA verdict computed by `sla_service._classify`,
 * and "zero failures is the target"). The success-rate target is an operating
 * threshold owned by the UI, because the backend stores only a per-process
 * `SLATargetMinutes` and no global reliability target — it is declared here,
 * in one place, instead of being hardcoded inside a component.
 */
export const OPS_THRESHOLDS = {
  /** Below this success rate the operation is "degraded" and needs a look. */
  successRateTarget: 95,
  /** Below this success rate the verdict escalates to critical. */
  successRateCritical: 85,
  /** Per-process 7-day failure rate that escalates a failure signal. */
  failureRateCritical: 20,
  /** runsToday / targetRuns below this ratio means the day is behind plan. */
  throughputWarningRatio: 0.6,
  /** How many triage rows the queue shows before collapsing into "show more". */
  visibleItems: 4,
  /** Hard cap on rendered rows so a bad night cannot produce a wall of cards. */
  maxItems: 12,
}

export const SEVERITY = { critical: 'critical', high: 'high', warning: 'warning', info: 'info' }

/** Lower rank = higher on the queue. */
const SEVERITY_RANK = { critical: 0, high: 1, warning: 2, info: 3 }

export const VERDICT = { critical: 'critical', degraded: 'degraded', healthy: 'healthy' }

const toNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/* ------------------------------------------------------------------ *
 * 1. Signals
 * ------------------------------------------------------------------ */

/**
 * SLA verdicts straight from `GET /api/sla-workload`
 * (`sla_service.get_workload` → `SLAStatus` ∈ Healthy | Warning | Breach_Risk).
 */
function slaSignals(rows) {
  return (rows || [])
    .filter((row) => row && String(row.SLAStatus || 'Healthy') !== 'Healthy')
    .map((row) => {
      const breach = String(row.SLAStatus) === 'Breach_Risk'
      const target = toNumber(row.SLATargetMinutes)
      const estimated = toNumber(row.EstimatedCompletionMinutes)
      return {
        id: `sla:${row.ProcessName}`,
        kind: 'sla',
        severity: breach ? SEVERITY.critical : SEVERITY.warning,
        process: row.ProcessName,
        criticality: row.Criticality || null,
        titleKey: 'dashboard.triage.titles.sla',
        titleParams: { process: row.ProcessName },
        detail: null,
        evidenceKey: breach ? 'dashboard.triage.evidence.slaBreach' : 'dashboard.triage.evidence.slaWarning',
        evidenceParams: {
          pending: toNumber(row.PendingItems),
          drain: Math.round(estimated),
          target: Math.round(target),
        },
        link: { to: '/capacity', labelKey: 'dashboard.triage.links.capacity' },
        occurredAt: row.LastUpdatedAt || null,
        // Overshoot ratio drives ordering: 93m against a 35m SLA outranks 40m against 20m.
        weight: target > 0 ? estimated / target : 0,
        metric: toNumber(row.PendingItems),
      }
    })
}

/**
 * Failed / stopped runs **today**, from `dashboard-data` →
 * `kpis.failureDetailsAll`. Grouped per process so one broken process reads as
 * one decision instead of a list of identical rows, and the most frequent
 * failure reason is surfaced (that is the thing you actually go and fix).
 */
function failureSignals(details, utilizationByProcess) {
  const groups = new Map()
  for (const row of details || []) {
    if (!row?.ProcessName) continue
    const entry = groups.get(row.ProcessName) || { process: row.ProcessName, runs: [], reasons: new Map() }
    entry.runs.push(row)
    const reason = String(row.FailureReason || 'Unknown')
    entry.reasons.set(reason, (entry.reasons.get(reason) || 0) + 1)
    groups.set(row.ProcessName, entry)
  }

  return [...groups.values()].map((entry) => {
    // Most frequent failure reason — the thing you actually go and fix.
    let topReason = null
    let occurrences = 0
    for (const [reason, count] of entry.reasons) {
      if (count > occurrences) {
        topReason = reason
        occurrences = count
      }
    }
    const capacity = utilizationByProcess.get(entry.process)
    const failureRate = toNumber(capacity?.failure_rate_percent)
    const escalates =
      String(capacity?.criticality) === 'Critical' || failureRate >= OPS_THRESHOLDS.failureRateCritical
    // Latest start time, without sorting: ISO-8601 strings compare directly.
    const latest = entry.runs.reduce(
      (newest, run) => (run.StartTime && (!newest || run.StartTime > newest) ? run.StartTime : newest),
      null,
    )
    return {
      id: `failure:${entry.process}`,
      kind: 'failure',
      severity: escalates ? SEVERITY.critical : SEVERITY.high,
      process: entry.process,
      criticality: capacity?.criticality || null,
      titleKey: 'dashboard.triage.titles.failures',
      titleParams: { count: entry.runs.length, process: entry.process },
      detail: topReason,
      detailNoteKey: occurrences > 1 ? 'dashboard.triage.evidence.repeatReason' : null,
      detailNoteParams: occurrences > 1 ? { count: occurrences } : null,
      evidenceKey: 'dashboard.triage.evidence.failures',
      evidenceParams: { count: entry.runs.length, failureRate: Math.round(failureRate * 10) / 10 },
      link: { to: '/runs', labelKey: 'dashboard.triage.links.runs' },
      occurredAt: latest || null,
      weight: failureRate / 100 + (escalates ? 1 : 0),
      metric: entry.runs.length,
    }
  })
}

/**
 * Open capacity recommendations from `dashboard-data` → `capacity.recommendations`
 * (`capacity_service._load_open_recommendations`).
 */
function capacitySignals(recommendations) {
  return (recommendations || [])
    .filter((row) => row && (row.status || 'Open') === 'Open')
    .filter((row) => ['Critical', 'High', 'Warning'].includes(String(row.severity)))
    .map((row) => ({
      id: `capacity:${row.id ?? row.title}`,
      kind: 'capacity',
      severity:
        String(row.severity) === 'Critical'
          ? SEVERITY.critical
          : String(row.severity) === 'High'
            ? SEVERITY.high
            : SEVERITY.warning,
      process: row.process_name || null,
      criticality: null,
      titleKey: 'dashboard.triage.titles.capacity',
      titleParams: {},
      // Server-authored headline + detail: rendered with dir="auto".
      detail: row.detail || row.title || null,
      serverTitle: row.title || null,
      evidenceKey: 'dashboard.triage.evidence.capacity',
      evidenceParams: {},
      link: { to: '/capacity', labelKey: 'dashboard.triage.links.capacity' },
      recommendationId: row.id ?? null,
      occurredAt: row.created_at || null,
      weight: String(row.severity) === 'Critical' ? 0.9 : 0.4,
      metric: 0,
    }))
}

/**
 * Queues that have work but **no online runner** — derived from
 * `capacity.utilization` (`online_runners === 0 && queue_depth > 0`).
 * Nothing else on the dashboard said this out loud, yet it is the single
 * cheapest thing an operator can fix.
 */
function idleQueueSignals(utilization) {
  return (utilization || [])
    .filter((row) => toNumber(row.online_runners) === 0 && toNumber(row.queue_depth) > 0)
    .map((row) => ({
      id: `runner:${row.process_name}`,
      kind: 'runner',
      severity: String(row.sla_status) === 'Breach_Risk' ? SEVERITY.high : SEVERITY.warning,
      process: row.process_name,
      criticality: row.criticality || null,
      titleKey: 'dashboard.triage.titles.noRunner',
      titleParams: { process: row.process_name },
      detail: null,
      evidenceKey: 'dashboard.triage.evidence.noRunner',
      evidenceParams: { pending: toNumber(row.queue_depth) },
      link: { to: '/infrastructure', labelKey: 'dashboard.triage.links.infrastructure' },
      occurredAt: null,
      weight: toNumber(row.queue_depth) / 1000,
      metric: toNumber(row.queue_depth),
    }))
}

/**
 * Open alerts from `GET /api/alerts?status=Open`.
 *
 * Alerts are *not* rendered as their own rows when they describe a condition
 * already listed (an SLA breach risk, a failure rate, an offline agent): the
 * duplicate would double-count the same decision. Instead the alert is folded
 * into that row, which is what makes the "Acknowledge" action available there.
 */
const ALERT_KIND_BY_RULE = {
  sla_breach_risk: 'sla',
  high_failure_rate: 'failure',
  repeated_failure: 'failure',
  agent_offline: 'runner',
}

const ALERT_SEVERITY = { Critical: SEVERITY.critical, High: SEVERITY.high, Warning: SEVERITY.warning, Info: SEVERITY.info }

function openAlerts(alerts) {
  return (alerts || []).filter((row) => row && String(row.Status) === 'Open')
}

/* ------------------------------------------------------------------ *
 * 2. Assembly
 * ------------------------------------------------------------------ */

function rankItems(items) {
  return items
    .toSorted((a, b) => {
      const bySeverity = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)
      if (bySeverity !== 0) return bySeverity
      return toNumber(b.weight) - toNumber(a.weight)
    })
    .slice(0, OPS_THRESHOLDS.maxItems)
}

/**
 * Build the full operations picture from the four dashboard queries.
 *
 * @returns {{verdict: string, counts: object, reasons: Array, items: Array, totals: object}}
 */
export function buildOpsSignals({
  dashboard,
  slaWorkload,
  capacity,
  alerts,
  thresholds = OPS_THRESHOLDS,
} = {}) {
  const kpis = dashboard?.kpis || {}
  const sidebar = dashboard?.sidebarStats || {}
  const utilization = capacity?.utilization || []
  const utilizationByProcess = new Map(utilization.map((row) => [row.process_name, row]))

  const rows = [
    ...slaSignals(slaWorkload),
    ...failureSignals(kpis.failureDetailsAll, utilizationByProcess),
    ...capacitySignals(capacity?.recommendations),
    ...idleQueueSignals(utilization),
  ]

  // Fold duplicate alerts into the condition they describe.
  const byId = new Map(rows.map((row) => [row.id, row]))
  const unmatched = []
  for (const alert of openAlerts(alerts)) {
    const kind = ALERT_KIND_BY_RULE[String(alert.RuleKey)]
    const candidate = kind ? byId.get(`${kind}:${alert.EntityID}`) : null
    const severity = ALERT_SEVERITY[String(alert.Severity)] || SEVERITY.info
    if (candidate) {
      candidate.alert = { id: alert.AlertID, severity: alert.Severity, occurrences: toNumber(alert.OccurrenceCount) }
      if ((SEVERITY_RANK[severity] ?? 9) < (SEVERITY_RANK[candidate.severity] ?? 9)) candidate.severity = severity
    } else {
      unmatched.push({
        id: `alert:${alert.AlertID}`,
        kind: 'alert',
        severity,
        process: alert.EntityType === 'ProcessQueue' || alert.EntityType === 'Process' ? alert.EntityID : null,
        criticality: null,
        titleKey: 'dashboard.triage.titles.alert',
        titleParams: {},
        serverTitle: alert.Title || null,
        detail: alert.Detail || null,
        evidenceKey: 'dashboard.triage.evidence.alert',
        evidenceParams: { count: toNumber(alert.OccurrenceCount) || 1 },
        link: { to: '/alerts', labelKey: 'dashboard.triage.links.alerts' },
        alert: { id: alert.AlertID, severity: alert.Severity, occurrences: toNumber(alert.OccurrenceCount) },
        occurredAt: alert.LastSeenAt || alert.FirstSeenAt || null,
        weight: toNumber(alert.OccurrenceCount) / 10,
        metric: toNumber(alert.OccurrenceCount) || 1,
      })
    }
  }

  const items = rankItems([...rows, ...unmatched])

  const counts = items.reduce(
    (accumulator, item) => {
      accumulator[item.severity] = (accumulator[item.severity] || 0) + 1
      accumulator.total += 1
      return accumulator
    },
    { critical: 0, high: 0, warning: 0, info: 0, total: 0 },
  )

  const successRate = toNumber(sidebar.successRate ?? kpis.successRate)
  const slaBreach = (slaWorkload || []).filter((row) => String(row.SLAStatus) === 'Breach_Risk').length
  const failedToday = toNumber(kpis.stopsToday)
  const openAlertCount = openAlerts(alerts).length

  // The verdict is the worst condition present — it must never be derived from
  // a single metric, or a green SLA would hide a wall of failed runs.
  // `successRate === 0` means "no runs booked in this window", which is *not*
  // a failure: a brand-new installation must not open on a red screen.
  const hasRate = successRate > 0
  let verdict = VERDICT.healthy
  if (
    counts.critical > 0 ||
    slaBreach > 0 ||
    (hasRate && successRate < thresholds.successRateCritical) ||
    failedToday > 0
  ) {
    verdict = VERDICT.critical
  } else if (
    counts.high > 0 ||
    counts.warning > 0 ||
    (hasRate && successRate < thresholds.successRateTarget) ||
    openAlertCount > 0
  ) {
    verdict = VERDICT.degraded
  }

  // Short, factual reason chips for the hero verdict line (top three only).
  const reasons = [
    slaBreach > 0 && { key: 'dashboard.verdict.reasons.sla', count: slaBreach },
    failedToday > 0 && { key: 'dashboard.verdict.reasons.failures', count: failedToday },
    openAlertCount > 0 && { key: 'dashboard.verdict.reasons.alerts', count: openAlertCount },
    successRate > 0 && successRate < thresholds.successRateTarget && {
      key: 'dashboard.verdict.reasons.successRate',
      count: Math.round((thresholds.successRateTarget - successRate) * 10) / 10,
    },
  ]
    .filter(Boolean)
    .slice(0, 3)

  return {
    verdict,
    counts,
    reasons,
    items,
    totals: {
      successRate,
      slaBreach,
      slaWarning: (slaWorkload || []).filter((row) => String(row.SLAStatus) === 'Warning').length,
      trackedProcesses: (slaWorkload || []).length,
      failedToday,
      openAlerts: openAlertCount,
      queuedItems: toNumber(capacity?.summary?.total_queue_depth),
      onlineRunners: toNumber(capacity?.summary?.online_runners),
    },
  }
}

/* ------------------------------------------------------------------ *
 * 3. Health board
 * ------------------------------------------------------------------ */

/**
 * The four numbers that carry a decision, each with an explicit target and a
 * verdict — a metric without a reference point cannot be acted on.
 *
 * Targets are server-provided where the backend has one:
 *   throughput → `kpis.targetRuns` (Σ `ExpectedRunsPerDay`),
 *   failures   → zero (any failed run today is an event),
 *   SLA        → zero processes in breach,
 *   success    → `OPS_THRESHOLDS.successRateTarget` (UI operating threshold).
 */
export function buildHealthMetrics({ dashboard, signals, thresholds = OPS_THRESHOLDS } = {}) {
  const kpis = dashboard?.kpis || {}
  const sidebar = dashboard?.sidebarStats || {}
  const { totals } = signals

  const successRate = totals.successRate
  const successVerdict =
    successRate <= 0
      ? 'unknown'
      : successRate < thresholds.successRateCritical
        ? 'breach'
        : successRate < thresholds.successRateTarget
          ? 'risk'
          : 'ok'

  const failedToday = totals.failedToday
  const tracked = totals.trackedProcesses
  const throughput = toNumber(kpis.runsToday)
  const target = toNumber(kpis.targetRuns)
  const ratio = target > 0 ? throughput / target : 0

  return [
    {
      key: 'successRate',
      labelKey: 'dashboard.hero.successRate',
      value: successRate,
      format: 'percent',
      verdict: successVerdict,
      verdictKey: `dashboard.health.verdicts.${successVerdict}`,
      targetKey: 'dashboard.health.targets.successRate',
      targetParams: { value: thresholds.successRateTarget },
      hintKey: 'dashboard.health.hints.successRate',
      hintParams: {
        ok: toNumber(sidebar.successRuns),
        total: toNumber(sidebar.bookedRuns),
      },
      progress: Math.min(100, successRate),
    },
    {
      key: 'failedToday',
      labelKey: 'dashboard.stopsToday',
      value: failedToday,
      format: 'number',
      verdict: failedToday > 0 ? 'breach' : 'ok',
      verdictKey: `dashboard.health.verdicts.${failedToday > 0 ? 'breach' : 'ok'}`,
      targetKey: 'dashboard.health.targets.failedToday',
      targetParams: {},
      hintKey: 'dashboard.health.hints.failedToday',
      hintParams: {},
      progress: failedToday > 0 ? 100 : 0,
    },
    {
      key: 'sla',
      labelKey: 'dashboard.slaBreaches',
      value: totals.slaBreach,
      format: 'number',
      verdict: totals.slaBreach > 0 ? 'breach' : totals.slaWarning > 0 ? 'risk' : tracked > 0 ? 'ok' : 'unknown',
      verdictKey: `dashboard.health.verdicts.${
        totals.slaBreach > 0 ? 'breach' : totals.slaWarning > 0 ? 'risk' : tracked > 0 ? 'ok' : 'unknown'
      }`,
      targetKey: 'dashboard.health.targets.sla',
      targetParams: {},
      hintKey: 'dashboard.health.hints.sla',
      hintParams: { warning: totals.slaWarning, tracked },
      progress: tracked > 0 ? Math.min(100, ((totals.slaBreach + totals.slaWarning) / tracked) * 100) : 0,
    },
    {
      key: 'throughput',
      labelKey: 'dashboard.runsToday',
      value: throughput,
      format: 'number',
      verdict: target <= 0 ? 'unknown' : ratio < thresholds.throughputWarningRatio ? 'risk' : 'ok',
      verdictKey: `dashboard.health.verdicts.${
        target <= 0 ? 'unknown' : ratio < thresholds.throughputWarningRatio ? 'risk' : 'ok'
      }`,
      targetKey: 'dashboard.health.targets.throughput',
      targetParams: { value: target },
      hintKey: 'dashboard.health.hints.throughput',
      hintParams: { percent: Math.round(ratio * 1000) / 10 },
      progress: target > 0 ? Math.min(100, ratio * 100) : 0,
    },
  ]
}

/** Informational figures — real, but they do not carry a decision. */
export function buildContextMetrics({ dashboard, capacity } = {}) {
  const kpis = dashboard?.kpis || {}
  const summary = capacity?.summary || {}
  return [
    { key: 'totalProcedures', labelKey: 'dashboard.totalProcedures', value: toNumber(kpis.totalProcedures), format: 'number' },
    { key: 'totalTransactions', labelKey: 'dashboard.totalTransactions', value: toNumber(kpis.totalTransactions), format: 'compact' },
    { key: 'timeSaved', labelKey: 'dashboard.timeSaved', value: toNumber(kpis.timeSaved), format: 'hours' },
    { key: 'costSaved', labelKey: 'dashboard.costSaved', value: toNumber(kpis.costSaved), format: 'currency' },
    { key: 'onlineRunners', labelKey: 'capacity.onlineRunners', value: toNumber(summary.online_runners), format: 'number' },
    { key: 'queueDepth', labelKey: 'capacity.queueDepth', value: toNumber(summary.total_queue_depth), format: 'compact' },
  ]
}

export default buildOpsSignals
