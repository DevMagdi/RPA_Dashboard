/**
 * Command-centre hero + KPI rail — premium wireframe contracts.
 *
 * Locks the decision-first hero:
 *  • the operational verdict leading the hero, computed from real payload data,
 *  • personalized time-of-day greeting (en + ar, deep i18n parity),
 *  • the four-KPI command strip (Success / Active / Savings / SLA),
 *  • the live status bar with the server-anchored clock,
 *  • the live-activity ticker with the five most recent real runs,
 *  • the full-width 14-day sparkline strip with real series deltas,
 *  • always-on hover elevation and compact money on the six-card rail.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

function greetingFor(heroLocale) {
  const hour = new Date().getHours()
  const key = hour < 12 ? 'greetingMorning' : hour < 18 ? 'greetingAfternoon' : 'greetingEvening'
  return heroLocale[key].replace('{{name}}', 'Magdi Hassan')
}

function renderHero(props = {}) {
  return render(
    <MemoryRouter>
      <CommandCenterHero
        kpis={kpis}
        successRate={98.4}
        generatedAt={new Date().toISOString()}
        spark={spark}
        savings={savings}
        slaRisk={2}
        scope="Finance"
        onRefresh={vi.fn()}
        onOpenTour={vi.fn()}
        actions={<button type="button">Export report</button>}
        {...props}
      />
    </MemoryRouter>,
  )
}

describe('command centre hero', () => {
  it('renders the personalized greeting, five-KPI strip and 14-day sparkline', async () => {
    renderHero()

    expect(screen.getByRole('heading', { name: greetingFor(en.dashboard.hero) })).toBeInTheDocument()
    expect(screen.getByText(/Private Operations/)).toBeInTheDocument()
    expect(screen.getByText(en.dashboard.privateInstallation)).toBeInTheDocument()

    for (const label of [
      en.dashboard.hero.successRate,
      en.dashboard.hero.running,
      en.dashboard.costSaved,
      en.dashboard.slaBreaches,
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }

    // real payload values (count-up settles on the exact figure)
    await waitFor(() => expect(screen.getByText('98.4%')).toBeInTheDocument(), { timeout: 2500 })
    await waitFor(() => expect(screen.getByText('Invoice Reconciliation')).toBeInTheDocument(), { timeout: 2500 })
    expect(screen.getByText(en.dashboard.filters.days.replace('{{count}}', '14'))).toBeInTheDocument()

    // sparkline strip: label, trend chips and the series date axis
    expect(screen.getAllByText(en.dashboard.runVolume).length).toBeGreaterThan(0)
    expect(screen.getByText('1 Oct')).toBeInTheDocument()
    expect(screen.getByText('14 Oct')).toBeInTheDocument()
    expect(screen.getAllByText('53.8%').length).toBeGreaterThanOrEqual(2)

    // SLA risk > 0 → attention hint on the block
    expect(screen.getAllByText(en.dashboard.hero.attention).length).toBeGreaterThan(0)
  })

  it('moves the refresh action into the hero and reports an all-clear state at zero risk', async () => {
    const onRefresh = vi.fn()
    renderHero({ slaRisk: 0, onRefresh })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: en.actions.refreshNow }))
    expect(onRefresh).toHaveBeenCalledTimes(1)

    await waitFor(() => expect(screen.getAllByText(en.dashboard.hero.allClear).length).toBeGreaterThan(0))
  })

  it('renders the Arabic greeting and labels with RTL direction', async () => {
    renderHero()

    const { applyLanguage } = await import('../i18n')
    await applyLanguage('ar')

    expect(document.documentElement.dir).toBe('rtl')
    expect(await screen.findByRole('heading', { name: greetingFor(ar.dashboard.hero) })).toBeInTheDocument()
    expect(screen.getByText(ar.dashboard.hero.successRate)).toBeInTheDocument()
    expect(screen.getByText(ar.dashboard.privateInstallation)).toBeInTheDocument()

    await applyLanguage('en')
  })

  it('shows the live status bar with a server-anchored ticking clock', () => {
    renderHero({ generatedAt: '2026-02-01T09:30:00Z' })

    // server clock chip: accessible name + a HH(:mm):ss readout, tabular digits
    expect(screen.getByText(en.dashboard.hero.serverTime)).toBeInTheDocument()
    const clock = document.querySelector('.chip.tabular time')
    expect(clock).toBeTruthy()
    expect(clock.textContent).toMatch(/\d{1,2}:\d{2}(:\d{2})?/)
  })

  it('runs a live-activity ticker with the five most recent runs and a drill-through', () => {
    const activity = Array.from({ length: 7 }, (_, index) => ({
      RunID: 100 + index,
      Status: index % 2 === 0 ? 'Success' : 'Running',
      ProcessName: `Process ${index + 1}`,
      StartTime: new Date(Date.now() - (index + 1) * 60_000).toISOString(),
      DurationMinutes: 4 + index,
    }))
    renderHero({ activity })

    const ticker = screen.getByRole('log', { name: en.dashboard.hero.liveActivity })
    expect(ticker).toBeInTheDocument()
    // only the first five real runs make it into the ticker
    for (const name of ['Process 1', 'Process 5']) expect(within(ticker).getByText(name)).toBeInTheDocument()
    expect(within(ticker).queryByText('Process 6')).not.toBeInTheDocument()
    expect(within(ticker).getAllByText(en.dashboard.hero.viewAllRuns).length).toBe(1)
    expect(ticker.querySelector('a[href="/runs"]')).toBeTruthy()
  })

  it('hides the live-activity ticker when no runs exist', () => {
    renderHero({ activity: [] })
    expect(screen.queryByRole('log', { name: en.dashboard.hero.liveActivity })).not.toBeInTheDocument()
  })
})

describe('health board (replaces the six-card KPI rail)', () => {
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
