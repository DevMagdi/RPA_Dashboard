/**
 * Command-centre hero + KPI rail — premium wireframe contracts.
 *
 * Locks the Premium/Wow plan's P0 dashboard pieces:
 *  • personalized time-of-day greeting (en + ar, deep i18n parity),
 *  • the four-KPI command strip (Success / Active / Savings / SLA risk),
 *  • the full-width 14-day sparkline strip with real series deltas,
 *  • always-on hover elevation and compact money on the six-card rail.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import CommandCenterHero from '../components/dashboard/CommandCenterHero'
import KpiGrid from '../components/dashboard/KpiGrid'
import en from '../i18n/locales/en.json'
import ar from '../i18n/locales/ar.json'
import { currency } from '../lib/format'

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
  it('renders the personalized greeting, four-KPI strip and 14-day sparkline', async () => {
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
})

describe('KPI rail', () => {
  it('shows six large always-hoverable cards with compact money and series deltas', async () => {
    render(
      <MemoryRouter>
        <KpiGrid kpis={kpis} spark={spark} savings={savings} />
      </MemoryRouter>,
    )

    for (const label of [
      en.dashboard.totalProcedures,
      en.dashboard.totalTransactions,
      en.dashboard.runsToday,
      en.dashboard.timeSaved,
      en.dashboard.costSaved,
      en.dashboard.activeRun,
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }

    // hover elevation is always armed (plan: KPI cards lift on hover)
    expect(document.querySelector('.card-hover')).toBeTruthy()
    expect(document.querySelector('.card-elevated, .shadow-glow')).toBeTruthy()

    // exact currency stays available on the compact figure (query normalizes NBSP)
    const exactTitle = currency(48200).replace(/ /g, ' ')
    await waitFor(() => expect(screen.getByTitle(exactTitle)).toBeInTheDocument(), { timeout: 2500 })
    // both series deltas render as chips
    expect(screen.getAllByText('53.8%').length).toBeGreaterThanOrEqual(2)
  })
})
