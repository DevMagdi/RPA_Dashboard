/**
 * Status console (light panel) + health board — the dashboard's evidence tier.
 *
 * Locks the redesign contract:
 *  • the panel is a *light* surface; the only dark band on it is the verdict,
 *  • the verdict leads the panel and its tone is token-driven (no hex in JSX),
 *  • the success rate stays an accessible gauge (role="img" + real percentage),
 *  • the 14-day volume card carries a real sparkline, delta chip and date axis,
 *  • the live-activity ticker shows the five most recent real runs and drills
 *    through to /runs — and disappears honestly when there is no activity,
 *  • the same copy renders in Arabic with RTL direction,
 *  • the health board still judges every metric against an explicit target.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import CommandCenterHero from '../components/dashboard/CommandCenterHero'
import HealthBoard from '../components/dashboard/HealthBoard'
import { buildHealthMetrics, buildOpsSignals } from '../lib/opsSignals'
import en from '../i18n/locales/en.json'
import ar from '../i18n/locales/ar.json'

vi.mock('../context/AuthProvider', () => ({
  useAuth: () => ({ user: { username: 'magdi', full_name: 'Magdi Hassan' }, has: () => true }),
}))
vi.mock('../hooks/ui', async (importOriginal) => ({
  ...(await importOriginal()),
  useRealtimeStatus: () => ({ status: 'open', lastEventAt: Date.now(), retries: 0 }),
}))

const spark = Array.from({ length: 14 }, (_, index) => ({
  date: `${index + 1} Oct`,
  volume: 100 + index * 10,
  completed: 95 + index * 10,
}))
const savings = Array.from({ length: 14 }, (_, index) => ({
  date: `${index + 1} Oct`,
  bar: 1000 + index * 100,
  line: 950 + index * 100,
}))
const kpis = {
  runningNow: 3,
  activeProcess: 'Invoice Reconciliation',
  costSaved: 48200,
  stopsToday: 1,
  totalProcedures: 42,
  totalTransactions: 1250,
  runsToday: 316,
  targetRuns: 400,
  timeSaved: 96,
  successRate: 98.4,
}
const activity = Array.from({ length: 7 }, (_, index) => ({
  RunID: 100 + index,
  Status: index % 2 === 0 ? 'Success' : 'Running',
  ProcessName: `Process ${index + 1}`,
  StartTime: new Date(Date.now() - (index + 1) * 60_000).toISOString(),
  DurationMinutes: 4 + index,
}))

/** A quiet shift: nothing failed, nothing breached, no alert is open. */
const healthySignals = buildOpsSignals({
  dashboard: { kpis: { ...kpis, stopsToday: 0 }, sidebarStats: { successRate: 98.4, successRuns: 980, bookedRuns: 996 } },
  slaWorkload: [],
  capacity: {},
  alerts: [],
})

function renderPanel(props = {}) {
  return render(
    <MemoryRouter>
      <CommandCenterHero
        successRate={98.4}
        spark={spark}
        savings={savings}
        activity={activity}
        signals={healthySignals}
        {...props}
      />
    </MemoryRouter>,
  )
}

describe('status console panel', () => {
  it('is a light panel whose only dark surface is the verdict band', () => {
    const { container } = renderPanel()
    const panel = container.querySelector('.status-panel')
    expect(panel).toBeTruthy()
    expect(panel.getAttribute('aria-label')).toBe(en.dashboard.commandCenter)
    // decorative depth layers stay behind the content (aurora 0 → grid 1 → content 2)
    expect(container.querySelector('.status-panel__aurora')).toBeTruthy()
    expect(container.querySelector('.status-panel__grid')).toBeTruthy()
    expect(container.querySelector('.status-panel__content')).toBeTruthy()
    // the identity row is gone: no product eyebrow, no chips, no refresh button here
    expect(container.querySelector('.status-panel__eyebrow')).toBeNull()
    expect(screen.queryByRole('button', { name: en.actions.refreshNow })).not.toBeInTheDocument()
  })

  it('leads with the operational verdict and an accessible success gauge', async () => {
    renderPanel()

    expect(screen.getByText(en.dashboard.verdict.healthy)).toBeInTheDocument()
    const gauge = screen.getByRole('img', { name: `${en.dashboard.hero.successGauge}: 98.4%` })
    expect(gauge.querySelector('circle.status-panel__gauge-value')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('98.4%')).toBeInTheDocument(), { timeout: 2500 })
  })

  it('drives the verdict tone from tokens and cites the real reasons behind it', () => {
    const degraded = buildOpsSignals({
      dashboard: { kpis: { ...kpis, stopsToday: 2 }, sidebarStats: { successRate: 84.6 } },
      slaWorkload: [
        {
          ProcessName: 'Fraud_Alert_Triage',
          SLAStatus: 'Breach_Risk',
          PendingItems: 140,
          EstimatedCompletionMinutes: 93.3,
          SLATargetMinutes: 35,
        },
      ],
      capacity: {},
      alerts: [],
    })
    expect(degraded.verdict).toBe('critical')

    const { container } = renderPanel({ successRate: 84.6, signals: degraded })
    const verdict = container.querySelector('.status-panel__verdict')
    expect(verdict).toBeTruthy()
    expect(verdict.className).toContain('is-critical')
    expect(screen.getByText(en.dashboard.verdict.critical)).toBeInTheDocument()
    // the reasons are real counts from the payload, not decoration
    expect(screen.getByText(en.dashboard.verdict.reasons.sla)).toBeInTheDocument()
    expect(screen.getByText(en.dashboard.verdict.reasons.failures)).toBeInTheDocument()
    expect(container.querySelector('.status-panel__verdict-mark')).toBeTruthy()
  })

  it('reports an all-clear verdict when nothing needs a decision', () => {
    const clean = buildOpsSignals({
      dashboard: { kpis: { ...kpis, stopsToday: 0 }, sidebarStats: { successRate: 99.2 } },
      slaWorkload: [],
      capacity: {},
      alerts: [],
    })
    expect(clean.verdict).toBe('healthy')
    expect(clean.items).toEqual([])

    const { container } = renderPanel({ successRate: 99.2, signals: clean })
    expect(container.querySelector('.status-panel__verdict.is-healthy')).toBeTruthy()
    expect(screen.getByText(en.dashboard.verdict.allClear)).toBeInTheDocument()
  })

  it('plots the 14-day run volume with a trend chip and a real date axis', () => {
    renderPanel()

    expect(screen.getByText(en.dashboard.runVolume)).toBeInTheDocument()
    expect(screen.getByText('1 Oct')).toBeInTheDocument()
    expect(screen.getByText('14 Oct')).toBeInTheDocument()
    // +23 volume over the window, +53.8% saved value: both are computed deltas
    expect(screen.getAllByText('53.8%').length).toBeGreaterThanOrEqual(1)
    expect(document.querySelector('.status-panel__axis')).toBeTruthy()
  })

  it('runs a live-activity ticker with the five most recent runs and a drill-through', () => {
    renderPanel()

    const ticker = screen.getByRole('log', { name: en.dashboard.hero.liveActivity })
    expect(ticker).toBeInTheDocument()
    for (const name of ['Process 1', 'Process 5']) expect(within(ticker).getByText(name)).toBeInTheDocument()
    expect(within(ticker).queryByText('Process 6')).not.toBeInTheDocument()
    expect(within(ticker).getAllByText(en.dashboard.hero.viewAllRuns).length).toBe(1)
    expect(ticker.querySelector('a[href="/runs"]')).toBeTruthy()
  })

  it('hides the live-activity ticker when no runs exist', () => {
    renderPanel({ activity: [] })
    expect(screen.queryByRole('log', { name: en.dashboard.hero.liveActivity })).not.toBeInTheDocument()
    expect(screen.getByText(en.dashboard.empty.runs)).toBeInTheDocument()
  })

  it('renders skeletons instead of empty cards while the payload is in flight', () => {
    const { container } = renderPanel({ loading: true, spark: [], savings: [], activity: [] })
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)
  })

  it('renders the same panel in Arabic with RTL direction', async () => {
    renderPanel()

    const { applyLanguage } = await import('../i18n')
    await applyLanguage('ar')

    expect(document.documentElement.dir).toBe('rtl')
    expect(screen.getByText(ar.dashboard.verdict.healthy)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: `${ar.dashboard.hero.successGauge}: 98.4%` })).toBeInTheDocument()
    expect(screen.getByText(ar.dashboard.hero.liveActivity)).toBeInTheDocument()

    await applyLanguage('en')
  })
})

describe('health board (the decision metrics, versus target)', () => {
  const signals = buildOpsSignals({
    dashboard: { kpis, sidebarStats: { successRate: 98.4, successRuns: 980, bookedRuns: 996 } },
    slaWorkload: [],
    capacity: { summary: { online_runners: 4, total_queue_depth: 12 } },
    alerts: [],
  })
  const metrics = buildHealthMetrics({ dashboard: { kpis, sidebarStats: { successRate: 98.4, successRuns: 980, bookedRuns: 996 } }, signals })

  it('judges every metric against an explicit target and verdict', () => {
    render(
      <MemoryRouter>
        <HealthBoard metrics={metrics} context={[]} spark={spark} />
      </MemoryRouter>,
    )

    for (const label of [
      en.dashboard.hero.successRate,
      en.dashboard.stopsToday,
      en.dashboard.slaBreaches,
      en.dashboard.runsToday,
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    // the target is stated next to the number, not implied
    expect(screen.getByText('Target 95%')).toBeInTheDocument()
    expect(screen.getByText('Target 400 runs today')).toBeInTheDocument()
    expect(screen.getAllByText(en.dashboard.health.verdicts.ok).length).toBeGreaterThan(0)

    // every verdict card keeps the token-driven coloured strip (no hardcoded hex)
    const strips = [...document.querySelectorAll('.kpi-strip')].map((node) => node.style.getPropertyValue('--strip'))
    expect(strips.length).toBe(4)
    for (const value of strips) expect(value.startsWith('var(--')).toBe(true)
  })

  it('escalates the verdict when the success rate falls below the operating threshold', () => {
    const degraded = buildOpsSignals({
      dashboard: { kpis: { ...kpis, successRate: 84.6 }, sidebarStats: { successRate: 84.6 } },
      slaWorkload: [],
      capacity: {},
      alerts: [],
    })
    const degradedMetrics = buildHealthMetrics({ dashboard: { kpis, sidebarStats: { successRate: 84.6 } }, signals: degraded })
    expect(degraded.verdict).toBe('critical')
    expect(degradedMetrics[0].verdict).toBe('breach')

    render(
      <MemoryRouter>
        <HealthBoard metrics={degradedMetrics} context={[]} />
      </MemoryRouter>,
    )
    expect(screen.getAllByText(en.dashboard.health.verdicts.breach).length).toBeGreaterThan(0)
    expect(document.querySelector('.health-card--breach')).toBeTruthy()
  })
})
