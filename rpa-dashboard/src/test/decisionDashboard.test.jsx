/**
 * Triage queue + health board — the decision tier of the dashboard.
 *
 * Renders the real components with the real derived signals and locks the
 * behaviour an on-call operator depends on:
 *  • the queue shows the worst condition first, with the action that fixes it,
 *  • acknowledging an alert happens *here* (no trip to /alerts),
 *  • a healthy operation reads as an explicit all-clear, never as "no data",
 *  • the whole tier localizes into Arabic and keeps RTL direction.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import HealthBoard from '../components/dashboard/HealthBoard'
import TriageQueue from '../components/dashboard/TriageQueue'
import en from '../i18n/locales/en.json'
import ar from '../i18n/locales/ar.json'
import { buildContextMetrics, buildHealthMetrics, buildOpsSignals } from '../lib/opsSignals'

const dashboard = {
  kpis: {
    totalProcedures: 6,
    totalTransactions: 35608,
    runsToday: 52,
    targetRuns: 380,
    stopsToday: 2,
    timeSaved: 4256.1,
    costSaved: 495447,
    failureDetailsAll: [
      { ProcessName: 'Invoice_Processing', RequestID: 'INV-1', Status: 'Failed', FailureReason: 'Database deadlock on sp_UpdateCustomer', StartTime: '2026-10-14T17:32:48' },
      { ProcessName: 'Invoice_Processing', RequestID: 'INV-2', Status: 'Failed', FailureReason: 'Database deadlock on sp_UpdateCustomer', StartTime: '2026-10-14T16:02:11' },
    ],
  },
  sidebarStats: { bookedRuns: 1373, successRate: 84.6, successRuns: 1162 },
}

const slaWorkload = [
  { ProcessName: 'Fraud_Alert_Triage', Criticality: 'Critical', PendingItems: 140, SLATargetMinutes: 35, EstimatedCompletionMinutes: 93.3, SLAStatus: 'Breach_Risk', LastUpdatedAt: '2026-10-14T17:58:09' },
  { ProcessName: 'credit_card_linkage', Criticality: 'Medium', PendingItems: 60, SLATargetMinutes: 20, EstimatedCompletionMinutes: 40, SLAStatus: 'Breach_Risk', LastUpdatedAt: '2026-10-14T17:58:09' },
]

const capacity = {
  summary: { online_runners: 2, total_queue_depth: 303 },
  utilization: [
    { process_name: 'Fraud_Alert_Triage', criticality: 'Critical', queue_depth: 140, online_runners: 1, failure_rate_percent: 9.8, sla_status: 'Breach_Risk' },
    { process_name: 'Invoice_Processing', criticality: 'High', queue_depth: 60, online_runners: 0, failure_rate_percent: 18.3, sla_status: 'Warning' },
  ],
  recommendations: [],
}

const alerts = [
  { AlertID: 6, RuleKey: 'sla_breach_risk', Severity: 'Critical', Title: 'SLA breach risk: Fraud_Alert_Triage', Detail: 'Backlog 140 items', EntityType: 'ProcessQueue', EntityID: 'Fraud_Alert_Triage', Status: 'Open', OccurrenceCount: 1 },
]

const signals = buildOpsSignals({ dashboard, slaWorkload, capacity, alerts })

function renderQueue(props = {}) {
  return render(
    <MemoryRouter>
      <TriageQueue signals={signals} {...props} />
    </MemoryRouter>,
  )
}

describe('triage queue', () => {
  it('leads with the worst SLA breach and shows the evidence behind it', () => {
    renderQueue()

    expect(screen.getByText(en.dashboard.triage.title)).toBeInTheDocument()
    const rows = [...document.querySelectorAll('.triage-row')]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].dataset.severity).toBe('critical')
    expect(within(rows[0]).getByText(en.dashboard.triage.titles.sla.replace('{{process}}', 'Fraud_Alert_Triage'))).toBeInTheDocument()
    // the numbers an operator needs to decide, inline: backlog, drain, SLA
    expect(within(rows[0]).getByText(/140/)).toBeInTheDocument()
    expect(within(rows[0]).getByText(/93/)).toBeInTheDocument()
  })

  it('groups repeated failures and names the reason to go and fix', () => {
    renderQueue()
    const rows = [...document.querySelectorAll('.triage-row')]
    const failure = rows.find((row) => row.textContent.includes('Invoice_Processing'))
    expect(failure).toBeTruthy()
    expect(within(failure).getByText(/Database deadlock on sp_UpdateCustomer/)).toBeInTheDocument()
    expect(within(failure).getByText(new RegExp(en.dashboard.triage.evidence.repeatReason.replace('{{count}}', '2')))).toBeInTheDocument()
  })

  it('acknowledges the linked alert without leaving the dashboard', async () => {
    const onAcknowledge = vi.fn()
    renderQueue({ onAcknowledge })

    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: en.alerts.acknowledge })[0])
    await waitFor(() => expect(onAcknowledge).toHaveBeenCalledWith(6))
  })

  it('drills through to the page that can actually resolve the row', () => {
    renderQueue()
    const links = [...document.querySelectorAll('.triage-row a[href]')].map((node) => node.getAttribute('href'))
    expect(links).toContain('/capacity')
    expect(links).toContain('/runs')
    expect(links).toContain('/infrastructure')
  })

  it('collapses a long queue and expands it on demand', async () => {
    const many = buildOpsSignals({
      dashboard,
      slaWorkload: Array.from({ length: 9 }, (_, index) => ({
        ProcessName: `Process_${index}`,
        PendingItems: 100 - index,
        SLATargetMinutes: 30,
        EstimatedCompletionMinutes: 90 - index,
        SLAStatus: 'Breach_Risk',
      })),
      capacity: {},
      alerts: [],
    })
    render(
      <MemoryRouter>
        <TriageQueue signals={many} />
      </MemoryRouter>,
    )

    expect(document.querySelectorAll('.triage-row')).toHaveLength(4)
    const user = userEvent.setup()
    const hidden = many.items.length - 4
    await user.click(screen.getByRole('button', { name: new RegExp(`Show ${hidden} more`) }))
    expect(document.querySelectorAll('.triage-row')).toHaveLength(many.items.length)
  })

  it('states an explicit all-clear instead of rendering an empty box', () => {
    const clean = buildOpsSignals({
      dashboard: { kpis: { stopsToday: 0, failureDetailsAll: [] }, sidebarStats: { successRate: 99.5 } },
      slaWorkload: [{ ProcessName: 'KYC_Check', PendingItems: 0, SLATargetMinutes: 45, EstimatedCompletionMinutes: 1, SLAStatus: 'Healthy' }],
      capacity: { summary: { online_runners: 3, total_queue_depth: 0 }, utilization: [] },
      alerts: [],
    })
    render(
      <MemoryRouter>
        <TriageQueue signals={clean} />
      </MemoryRouter>,
    )

    expect(screen.getByText(en.dashboard.triage.allClear)).toBeInTheDocument()
    expect(document.querySelectorAll('.triage-row')).toHaveLength(0)
  })

  it('renders the whole tier in Arabic under RTL', async () => {
    renderQueue()

    const { applyLanguage } = await import('../i18n')
    await applyLanguage('ar')

    expect(document.documentElement.dir).toBe('rtl')
    expect(await screen.findByText(ar.dashboard.triage.title)).toBeInTheDocument()
    expect(screen.getAllByText(ar.dashboard.triage.titles.sla.replace('{{process}}', 'Fraud_Alert_Triage')).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: ar.alerts.acknowledge }).length).toBeGreaterThan(0)

    await applyLanguage('en')
  })
})

describe('health board', () => {
  it('shows the informational figures as a compact secondary strip', async () => {
    const metrics = buildHealthMetrics({ dashboard, signals })
    const context = buildContextMetrics({ dashboard, capacity })
    render(
      <MemoryRouter>
        <HealthBoard metrics={metrics} context={context} />
      </MemoryRouter>,
    )

    const strip = document.querySelector('.context-strip')
    expect(strip).toBeTruthy()
    expect(strip.children).toHaveLength(context.length)
    expect(within(strip).getByText(en.dashboard.totalProcedures)).toBeInTheDocument()
    await waitFor(() => expect(within(strip).getByText('6')).toBeInTheDocument())
    // the money figure is real payload data, formatted as currency
    expect(within(strip).getByText(/495/)).toBeInTheDocument()
  })
})
