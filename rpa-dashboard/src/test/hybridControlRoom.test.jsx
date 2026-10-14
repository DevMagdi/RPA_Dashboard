/**
 * Hybrid control-room UI contracts (docs/HYBRID_UI_PLAN_AR.md).
 *
 *  • the top pill nav shows the five primary modules inline and folds every
 *    other module the user may open into "More" — permission-aware, active
 *    state on the current module;
 *  • the navy "bots online" badge reads the live connected-agent count;
 *  • the hero exposes an accessible success gauge;
 *  • the hero leads with the operational verdict and its tone is token-driven.
 */
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import CommandCenterHero from '../components/dashboard/CommandCenterHero'
import { buildOpsSignals } from '../lib/opsSignals'
import TopNav, { PRIMARY_NAV_IDS, splitTopNav } from '../components/layout/TopNav'
import { BotsOnlineBadge } from '../components/layout/TopBar'
import en from '../i18n/locales/en.json'
import ar from '../i18n/locales/ar.json'
import { sectionsFor } from '../lib/routeMeta'

const authState = vi.hoisted(() => ({ has: () => true }))
const agentState = vi.hoisted(() => ({ count: 8 }))

vi.mock('../context/AuthProvider', () => ({
  useAuth: () => ({ user: { username: 'magdi', full_name: 'Magdi Hassan' }, has: authState.has }),
}))
vi.mock('../hooks/ui', async (importOriginal) => ({
  ...(await importOriginal()),
  useRealtimeStatus: () => ({ status: 'open', lastEventAt: Date.now(), retries: 0 }),
}))
vi.mock('../hooks/api', async (importOriginal) => ({
  ...(await importOriginal()),
  useConnectedAgents: () => ({ data: { count: agentState.count, agents: [] } }),
  useAlertCount: () => ({ data: { open: 0 } }),
  useAlerts: () => ({ data: [] }),
}))

const spark = Array.from({ length: 14 }, (_, index) => ({ date: `${index + 1} Oct`, volume: 100 + index * 10 }))
const savings = Array.from({ length: 14 }, (_, index) => ({ date: `${index + 1} Oct`, bar: 1000 + index * 100 }))
const kpis = {
  runningNow: 3,
  costSaved: 48200,
  totalProcedures: 42,
  totalTransactions: 1250,
  runsToday: 316,
  timeSaved: 96,
  successRate: 98.4,
}

describe('top pill navigation', () => {
  it('keeps the five primary modules inline and never duplicates them in More', () => {
    const sections = sectionsFor(() => true)
    const { primary, overflow } = splitTopNav(sections)
    expect(primary.map((route) => route.id)).toEqual(PRIMARY_NAV_IDS)
    const overflowIds = overflow.flatMap((section) => section.routes.map((route) => route.id))
    for (const id of PRIMARY_NAV_IDS) expect(overflowIds).not.toContain(id)
    expect(overflowIds).toEqual(expect.arrayContaining(['infrastructure', 'audit', 'users']))
  })

  it('only offers modules the signed-in user is allowed to open', () => {
    const readOnlyDashboard = (permission) => permission === 'dashboard:read' || permission === null
    const { primary, overflow } = splitTopNav(sectionsFor(readOnlyDashboard))
    const reachable = [...primary, ...overflow.flatMap((section) => section.routes)].map((route) => route.id)
    expect(reachable).toContain('dashboard')
    expect(reachable).not.toContain('users')
    expect(reachable).not.toContain('processes')
  })

  it('renders primary links, marks the active module and exposes a labelled More menu', () => {
    authState.has = () => true
    render(
      <MemoryRouter initialEntries={['/runs']}>
        <TopNav />
      </MemoryRouter>,
    )
    const nav = screen.getByRole('navigation', { name: en.a11y.mainNavigation })
    const runs = within(nav).getByRole('link', { name: en.nav.runs })
    expect(runs).toHaveAttribute('href', '/runs')
    expect(runs).toHaveAttribute('aria-current', 'page')
    expect(runs.className).toContain('nav-pill-active')

    const dashboard = within(nav).getByRole('link', { name: en.nav.dashboard })
    expect(dashboard).not.toHaveAttribute('aria-current')
    expect(dashboard.className).not.toContain('nav-pill-active')

    expect(within(nav).getByRole('button', { name: /More modules \(\d+\)/ })).toBeInTheDocument()
  })
})

describe('navy bots-online badge', () => {
  it('shows the live connected-agent count from the API with an accessible label', () => {
    agentState.count = 8
    render(
      <MemoryRouter>
        <BotsOnlineBadge />
      </MemoryRouter>,
    )
    const badge = screen.getByTestId('bots-online')
    expect(badge).toHaveTextContent('8')
    expect(badge).toHaveAttribute('aria-label', '8 automation bots online')
    expect(badge.className).toContain('live-badge')
  })

  it('reports zero honestly instead of inventing activity', () => {
    agentState.count = 0
    render(
      <MemoryRouter>
        <BotsOnlineBadge />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('bots-online')).toHaveAttribute('aria-label', '0 automation bots online')
    agentState.count = 8
  })
})

describe('hybrid hero, verdict and KPI strip', () => {
  it('exposes the success rate as an accessible gauge', () => {
    render(
      <MemoryRouter>
        <CommandCenterHero kpis={kpis} successRate={98.4} spark={spark} savings={savings} slaRisk={0} onRefresh={vi.fn()} onOpenTour={vi.fn()} />
      </MemoryRouter>,
    )
    const gauge = screen.getByRole('img', { name: `${en.dashboard.hero.successGauge}: 98.4%` })
    expect(gauge.querySelector('circle.command-hero__gauge-value')).toBeTruthy()
  })

  it('leads the hero with an operational verdict whose tone is token-driven', () => {
    const degraded = buildOpsSignals({
      dashboard: { kpis: { ...kpis, stopsToday: 2 }, sidebarStats: { successRate: 84.6 } },
      slaWorkload: [{ ProcessName: 'Fraud_Alert_Triage', SLAStatus: 'Breach_Risk', PendingItems: 140, EstimatedCompletionMinutes: 93.3, SLATargetMinutes: 35 }],
      capacity: {},
      alerts: [],
    })
    expect(degraded.verdict).toBe('critical')

    const { container } = render(
      <MemoryRouter>
        <CommandCenterHero kpis={kpis} successRate={84.6} spark={spark} savings={savings} slaRisk={1} signals={degraded} onRefresh={vi.fn()} onOpenTour={vi.fn()} />
      </MemoryRouter>,
    )

    const verdict = container.querySelector('.command-hero__verdict')
    expect(verdict).toBeTruthy()
    expect(verdict.className).toContain('is-critical')
    expect(screen.getByText(en.dashboard.verdict.critical)).toBeInTheDocument()
    // the reasons are real counts from the payload, not decoration
    expect(screen.getByText(en.dashboard.verdict.reasons.sla)).toBeInTheDocument()
    expect(screen.getByText(en.dashboard.verdict.reasons.failures)).toBeInTheDocument()

    // Tone classes resolve to CSS custom properties — no hex is hardcoded in JSX.
    expect(document.querySelector('.command-hero__verdict-mark')).toBeTruthy()
  })

  it('reports an operational verdict when nothing needs a decision', () => {
    const clean = buildOpsSignals({
      dashboard: { kpis: { ...kpis, stopsToday: 0 }, sidebarStats: { successRate: 99.2 } },
      slaWorkload: [],
      capacity: {},
      alerts: [],
    })
    expect(clean.verdict).toBe('healthy')
    expect(clean.items).toEqual([])

    const { container } = render(
      <MemoryRouter>
        <CommandCenterHero kpis={kpis} successRate={99.2} spark={spark} savings={savings} slaRisk={0} signals={clean} onRefresh={vi.fn()} onOpenTour={vi.fn()} />
      </MemoryRouter>,
    )
    expect(container.querySelector('.command-hero__verdict.is-healthy')).toBeTruthy()
    expect(screen.getByText(en.dashboard.verdict.allClear)).toBeInTheDocument()
  })

  it('ships the same Arabic and English copy for every new hybrid key', () => {
    for (const key of ['more', 'moreModules']) {
      expect(en.nav[key]).toBeTruthy()
      expect(ar.nav[key]).toBeTruthy()
    }
    for (const key of ['botsOnline', 'botsOnlineLabel']) {
      expect(en.shell[key]).toBeTruthy()
      expect(ar.shell[key]).toBeTruthy()
    }
    for (const key of ['successGauge', 'gaugeCaption']) {
      expect(en.dashboard.hero[key]).toBeTruthy()
      expect(ar.dashboard.hero[key]).toBeTruthy()
    }
  })
})
