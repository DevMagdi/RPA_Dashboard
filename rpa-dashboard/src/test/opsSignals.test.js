/**
 * Operations decision engine — the policy behind the triage queue.
 *
 * The fixtures below are the *actual* payload shapes returned by the running
 * backend (`GET /api/dashboard-data`, `/api/sla-workload`, `/api/alerts`) for a
 * seeded demo database, so these tests fail if the engine ever stops reading a
 * field the server actually sends.
 *
 * What is locked here:
 *  • every signal cites a real server field,
 *  • severity ordering is deterministic,
 *  • duplicate alerts fold into the condition they describe (no double count),
 *  • the verdict is the *worst* condition present, never one metric alone,
 *  • an all-clear payload produces an empty queue and a healthy verdict.
 */
import { describe, expect, it } from 'vitest'

import {
  OPS_THRESHOLDS,
  VERDICT,
  buildContextMetrics,
  buildHealthMetrics,
  buildOpsSignals,
} from '../lib/opsSignals'

/* --- real payload: 84.6% success, 4 failed runs today, 2 SLA breaches ---- */
const dashboard = {
  kpis: {
    totalProcedures: 6,
    totalTransactions: 35608,
    runsToday: 52,
    targetRuns: 380,
    stopsToday: 4,
    timeSaved: 4256.1,
    costSaved: 495447,
    runningNow: 4,
    activeProcess: 'Invoice_Processing',
    failureDetailsAll: [
      { ProcessName: 'credit_card_linkage', RequestID: 'CRE-1', Status: 'Stopped', FailureReason: 'Invalid account number format', StartTime: '2026-10-14T18:17:05' },
      { ProcessName: 'Invoice_Processing', RequestID: 'INV-1', Status: 'Failed', FailureReason: 'Database deadlock on sp_UpdateCustomer', StartTime: '2026-10-14T17:32:48' },
      { ProcessName: 'Loan_Disbursement', RequestID: 'LOA-1', Status: 'Failed', FailureReason: 'Invalid account number format', StartTime: '2026-10-14T17:12:03' },
      { ProcessName: 'Statement_Generation', RequestID: 'STA-1', Status: 'Failed', FailureReason: 'Manual intervention required', StartTime: '2026-10-14T12:37:54' },
    ],
  },
  sidebarStats: { bookedRuns: 1373, successRate: 84.6, errorRate: 15.4, successRuns: 1162 },
}

const slaWorkload = [
  { ProcessName: 'Fraud_Alert_Triage', Criticality: 'Critical', PendingItems: 140, SLATargetMinutes: 35, EstimatedCompletionMinutes: 93.3, SLAStatus: 'Breach_Risk', LastUpdatedAt: '2026-10-14T17:58:09' },
  { ProcessName: 'Invoice_Processing', Criticality: 'High', PendingItems: 60, SLATargetMinutes: 30, EstimatedCompletionMinutes: 25.0, SLAStatus: 'Warning', LastUpdatedAt: '2026-10-14T17:58:09' },
  { ProcessName: 'KYC_Check', Criticality: 'High', PendingItems: 4, SLATargetMinutes: 45, EstimatedCompletionMinutes: 0.8, SLAStatus: 'Healthy' },
]

const capacity = {
  summary: { online_runners: 2, total_queue_depth: 303, critical_count: 2, sla_at_risk: 2, avg_utilization_percent: 9.9 },
  utilization: [
    { process_name: 'Fraud_Alert_Triage', criticality: 'Critical', queue_depth: 140, online_runners: 1, failure_rate_percent: 9.8, sla_status: 'Breach_Risk' },
    { process_name: 'Invoice_Processing', criticality: 'High', queue_depth: 60, online_runners: 0, failure_rate_percent: 18.3, sla_status: 'Warning' },
    { process_name: 'Loan_Disbursement', criticality: 'Critical', queue_depth: 35, online_runners: 0, failure_rate_percent: 26.1, sla_status: 'Healthy' },
  ],
  recommendations: [
    { id: 11, process_name: 'Fraud_Alert_Triage', title: 'Add runners', detail: 'Throughput gap 89%', severity: 'Critical', status: 'Open' },
    { id: 12, process_name: 'KYC_Check', title: 'Idle fleet', detail: 'Runners idle', severity: 'Info', status: 'Open' },
  ],
}

const alerts = [
  { AlertID: 6, RuleKey: 'sla_breach_risk', Severity: 'Critical', Title: 'SLA breach risk: Fraud_Alert_Triage', Detail: 'Backlog 140 items', EntityType: 'ProcessQueue', EntityID: 'Fraud_Alert_Triage', Status: 'Open', OccurrenceCount: 1 },
  { AlertID: 7, RuleKey: 'agent_offline', Severity: 'High', Title: 'Agent offline: Bot-07', Detail: 'No heartbeat for 6m', EntityType: 'Bot', EntityID: 'Bot-07', Status: 'Open', OccurrenceCount: 3 },
  { AlertID: 8, RuleKey: 'sla_breach_risk', Severity: 'Critical', Title: 'already resolved', EntityType: 'ProcessQueue', EntityID: 'KYC_Check', Status: 'Resolved', OccurrenceCount: 1 },
]

describe('operations decision engine', () => {
  const signals = buildOpsSignals({ dashboard, slaWorkload, capacity, alerts })

  it('escalates to critical when the real payload has breaches and failed runs', () => {
    expect(signals.verdict).toBe(VERDICT.critical)
    expect(signals.counts.critical).toBeGreaterThan(0)
    expect(signals.counts.total).toBe(signals.items.length)
  })

  it('states the reasons behind the verdict from server fields only', () => {
    const keys = signals.reasons.map((reason) => reason.key)
    expect(keys).toContain('dashboard.verdict.reasons.sla')
    expect(keys).toContain('dashboard.verdict.reasons.failures')
    expect(keys).toContain('dashboard.verdict.reasons.alerts')
    const sla = signals.reasons.find((reason) => reason.key === 'dashboard.verdict.reasons.sla')
    expect(sla.count).toBe(1) // Fraud_Alert_Triage is the only Breach_Risk row
    const failures = signals.reasons.find((reason) => reason.key === 'dashboard.verdict.reasons.failures')
    expect(failures.count).toBe(4) // kpis.stopsToday
  })

  it('ranks the worst SLA overshoot first', () => {
    expect(signals.items[0].kind).toBe('sla')
    expect(signals.items[0].process).toBe('Fraud_Alert_Triage')
    expect(signals.items[0].severity).toBe('critical')
    // 93.3m against a 35m SLA, rounded for display
    expect(signals.items[0].evidenceParams).toMatchObject({ pending: 140, drain: 93, target: 35 })
  })

  it('groups failed runs per process and surfaces the most frequent reason', () => {
    const failures = signals.items.filter((item) => item.kind === 'failure')
    expect(failures).toHaveLength(4) // four distinct processes failed today
    const loan = failures.find((item) => item.process === 'Loan_Disbursement')
    // 26.1% failure rate and Critical criticality both escalate this row
    expect(loan.severity).toBe('critical')
    expect(loan.detail).toBe('Invalid account number format')
    expect(loan.evidenceParams.failureRate).toBe(26.1)
  })

  it('flags a queue that has work but no online runner', () => {
    const runners = signals.items.filter((item) => item.kind === 'runner')
    expect(runners.map((item) => item.process).toSorted()).toEqual(['Invoice_Processing', 'Loan_Disbursement'])
    for (const row of runners) expect(row.evidenceParams.pending).toBeGreaterThan(0)
  })

  it('folds a duplicate alert into the condition it describes instead of double counting', () => {
    const slaRow = signals.items.find((item) => item.id === 'sla:Fraud_Alert_Triage')
    expect(slaRow.alert).toMatchObject({ id: 6, severity: 'Critical' })
    // …while an alert about a condition that is not otherwise listed stays its own row
    expect(signals.items.some((item) => item.id === 'alert:7')).toBe(true)
    // …and a resolved alert never appears at all
    expect(signals.items.some((item) => item.alert?.id === 8)).toBe(false)
  })

  it('only carries open capacity recommendations, and only the actionable severities', () => {
    const capacityRows = signals.items.filter((item) => item.kind === 'capacity')
    expect(capacityRows).toHaveLength(1)
    expect(capacityRows[0].recommendationId).toBe(11)
    expect(capacityRows[0].detail).toBe('Throughput gap 89%')
  })

  it('caps and orders the queue deterministically', () => {
    const ranks = { critical: 0, high: 1, warning: 2, info: 3 }
    for (let index = 1; index < signals.items.length; index += 1) {
      expect(ranks[signals.items[index - 1].severity]).toBeLessThanOrEqual(ranks[signals.items[index].severity])
    }
    expect(signals.items.length).toBeLessThanOrEqual(OPS_THRESHOLDS.maxItems)
    expect(signals.items.every((item) => item.link?.to)).toBe(true)
  })

  it('reports an all-clear operation as an empty queue, not as missing data', () => {
    const clean = buildOpsSignals({
      dashboard: {
        kpis: { ...dashboard.kpis, stopsToday: 0, failureDetailsAll: [] },
        sidebarStats: { successRate: 99.4 },
      },
      slaWorkload: [{ ProcessName: 'KYC_Check', PendingItems: 0, SLATargetMinutes: 45, EstimatedCompletionMinutes: 1, SLAStatus: 'Healthy' }],
      capacity: { summary: { online_runners: 3, total_queue_depth: 0 }, utilization: [], recommendations: [] },
      alerts: [],
    })
    expect(clean.verdict).toBe(VERDICT.healthy)
    expect(clean.items).toEqual([])
    expect(clean.reasons).toEqual([])
    expect(clean.totals).toMatchObject({ successRate: 99.4, failedToday: 0, openAlerts: 0, trackedProcesses: 1 })
  })

  it('never crashes on a partially loaded payload', () => {
    expect(buildOpsSignals({}).verdict).toBe(VERDICT.healthy)
    expect(buildOpsSignals({ dashboard: {} }).items).toEqual([])
    expect(buildOpsSignals({ slaWorkload: null, capacity: null, alerts: null }).counts.total).toBe(0)
  })

  it('degrades (not escalates) when only a warning-level condition exists', () => {
    const warningOnly = buildOpsSignals({
      dashboard: { kpis: { stopsToday: 0, failureDetailsAll: [] }, sidebarStats: { successRate: 99 } },
      slaWorkload: [{ ProcessName: 'Invoice_Processing', PendingItems: 60, SLATargetMinutes: 30, EstimatedCompletionMinutes: 25, SLAStatus: 'Warning' }],
      capacity: {},
      alerts: [],
    })
    expect(warningOnly.verdict).toBe(VERDICT.degraded)
    expect(warningOnly.items[0].severity).toBe('warning')
  })
})

describe('health board metrics', () => {
  const signals = buildOpsSignals({ dashboard, slaWorkload, capacity, alerts })
  const metrics = buildHealthMetrics({ dashboard, signals })

  it('compares every metric against a target and returns a verdict', () => {
    expect(metrics).toHaveLength(4)
    for (const metric of metrics) {
      expect(metric.targetKey).toBeTruthy()
      expect(['ok', 'risk', 'breach', 'unknown']).toContain(metric.verdict)
      expect(metric.progress).toBeGreaterThanOrEqual(0)
      expect(metric.progress).toBeLessThanOrEqual(100)
    }
  })

  it('judges the real success rate as breaching and throughput as behind plan', () => {
    const byKey = Object.fromEntries(metrics.map((metric) => [metric.key, metric]))
    expect(byKey.successRate).toMatchObject({ value: 84.6, verdict: 'breach' })
    expect(byKey.failedToday).toMatchObject({ value: 4, verdict: 'breach' })
    expect(byKey.sla).toMatchObject({ value: 1, verdict: 'breach' })
    // 52 runs against a server-provided target of 380 = 13.7% of the daily plan
    expect(byKey.throughput).toMatchObject({ value: 52, verdict: 'risk' })
    expect(byKey.throughput.hintParams.percent).toBe(13.7)
    expect(byKey.throughput.targetParams.value).toBe(380)
  })

  it('keeps informational figures out of the decision metrics', () => {
    const context = buildContextMetrics({ dashboard, capacity })
    expect(context.map((item) => item.key)).toEqual([
      'totalProcedures',
      'totalTransactions',
      'timeSaved',
      'costSaved',
      'onlineRunners',
      'queueDepth',
    ])
    expect(context.find((item) => item.key === 'costSaved').value).toBe(495447)
    expect(context.find((item) => item.key === 'queueDepth').value).toBe(303)
  })
})
