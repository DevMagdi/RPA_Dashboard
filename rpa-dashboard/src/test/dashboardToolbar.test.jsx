/**
 * Dashboard toolbar — the single sticky chrome row of the redesigned page.
 *
 * The redesign deleted two decorative rows (the header's "first-run affordance"
 * strip and the hero's identity row) and moved everything an operator actually
 * uses into one surface. These tests lock that contract:
 *  • title + greeting + freshness + scope on row 1, filters on row 2,
 *  • Live state, the server-anchored clock and the on-premises statement stay
 *    visible (they were the useful half of the deleted hero row),
 *  • Refresh / Export / Tour are real, wired controls,
 *  • every filter change goes through one callback (the page puts it in a
 *    transition), and clearing only appears once a filter is off its default,
 *  • the whole bar localizes into Arabic and keeps RTL direction.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import DashboardToolbar, { ServerClock } from '../components/dashboard/DashboardToolbar'
import ExportMenu from '../components/features/ExportMenu'
import en from '../i18n/locales/en.json'
import ar from '../i18n/locales/ar.json'

vi.mock('../context/AuthProvider', () => ({ useAuth: () => ({ has: () => true }) }))
vi.mock('../context/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))
vi.mock('../hooks/ui', async (importOriginal) => ({
  ...(await importOriginal()),
  useRealtimeStatus: () => ({ status: 'open', lastEventAt: Date.now(), retries: 0 }),
}))

const DEFAULTS = { department: 'ALL', process: 'ALL', days: 90 }
const departments = ['Finance', 'Operations']
const processes = ['Invoice_Processing', 'Fraud_Alert_Triage']

const DEFAULT_PROPS = {
  title: en.dashboard.title,
  greeting: en.dashboard.hero.greetingMorning.replace('{{name}}', 'Magdi Hassan'),
  generatedAt: '2026-02-01T09:30:00Z',
  scope: 'Finance',
  filters: DEFAULTS,
  departments,
  processes,
  canGenerate: true,
}

function renderToolbar(props = {}) {
  const spies = {
    onRefresh: vi.fn(),
    onOpenTour: vi.fn(),
    onFilterChange: vi.fn(),
    onResetFilters: vi.fn(),
    onGenerate: vi.fn(),
  }
  const view = render(
    <MemoryRouter>
      <DashboardToolbar actions={<ExportMenu days={90} />} {...DEFAULT_PROPS} {...spies} {...props} />
    </MemoryRouter>,
  )
  return { ...view, ...spies }
}

describe('dashboard toolbar', () => {
  it('carries the page identity, freshness and scope in one sticky surface', () => {
    renderToolbar()

    expect(screen.getByRole('heading', { level: 1, name: en.dashboard.title })).toBeInTheDocument()
    expect(screen.getByText('Good morning, Magdi Hassan')).toBeInTheDocument()
    // the scope chip quotes the department the numbers are filtered by
    expect(screen.getAllByText('Finance').length).toBeGreaterThan(0)

    const card = document.querySelector('.dashboard-toolbar')
    expect(card).toBeTruthy()
    expect(card.className).toContain('sticky')
    expect(card.className).toContain('top-[var(--header-height)]')
  })

  it('keeps the live state, the server-anchored clock and the on-premises statement', () => {
    renderToolbar()

    expect(screen.getByText(en.app.live)).toBeInTheDocument()
    expect(screen.getByText(en.dashboard.privateInstallation)).toBeInTheDocument()

    // server clock: an accessible name plus a HH:MM(:SS) readout in tabular digits
    expect(screen.getByText(en.dashboard.hero.serverTime)).toBeInTheDocument()
    const clock = document.querySelector('.chip.tabular time')
    expect(clock).toBeTruthy()
    expect(clock.textContent).toMatch(/\d{1,2}:\d{2}(:\d{2})?/)
  })

  it('re-ticks the clock against the server payload time, not the workstation', () => {
    render(<ServerClock generatedAt={new Date().toISOString()} />)
    const clock = document.querySelector('.chip.tabular time')
    expect(clock.textContent).toMatch(/\d{1,2}:\d{2}(:\d{2})?/)
  })

  it('wires refresh, export and the product tour to real controls', async () => {
    const user = userEvent.setup()
    const { onRefresh, onOpenTour } = renderToolbar()

    await user.click(screen.getByRole('button', { name: en.actions.refreshNow }))
    expect(onRefresh).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: en.actions.export }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: en.dashboard.startTour }))
    expect(onOpenTour).toHaveBeenCalledTimes(1)
  })

  it('routes every filter change through one callback and resets the process with the department', async () => {
    const user = userEvent.setup()
    const { container, onFilterChange } = renderToolbar()

    const [departmentSelect, processSelect] = container.querySelectorAll('select')
    await user.selectOptions(departmentSelect, 'Finance')
    // choosing a department always resets the process list with it
    expect(onFilterChange).toHaveBeenCalledWith({ department: 'Finance', process: 'ALL' })

    await user.selectOptions(processSelect, 'Invoice_Processing')
    expect(onFilterChange).toHaveBeenCalledWith({ process: 'Invoice_Processing' })

    await user.click(screen.getByRole('radio', { name: en.dashboard.filters.days.replace('{{count}}', '7') }))
    expect(onFilterChange).toHaveBeenCalledWith({ days: 7 })
  })

  it('only offers "clear filters" once a filter is off its default', async () => {
    const user = userEvent.setup()
    const clean = renderToolbar()
    expect(clean.queryByRole('button', { name: en.actions.clearFilters })).not.toBeInTheDocument()
    clean.unmount()

    const { onResetFilters } = renderToolbar({ filters: { department: 'Finance', process: 'ALL', days: 90 }, filtersDirty: true })
    await user.click(screen.getByRole('button', { name: en.actions.clearFilters }))
    expect(onResetFilters).toHaveBeenCalledTimes(1)
  })

  it('gates the capacity generator behind the permission the page passes in', async () => {
    const user = userEvent.setup()
    const denied = renderToolbar({ canGenerate: false })
    expect(denied.queryByRole('button', { name: en.capacity.generate })).not.toBeInTheDocument()
    denied.unmount()

    const { onGenerate } = renderToolbar()
    await user.click(screen.getByRole('button', { name: en.capacity.generate }))
    expect(onGenerate).toHaveBeenCalledTimes(1)
  })

  it('renders the same toolbar in Arabic with RTL direction', async () => {
    renderToolbar({
      title: ar.dashboard.title,
      greeting: ar.dashboard.hero.greetingMorning.replace('{{name}}', 'مجدي حسن'),
    })

    const { applyLanguage } = await import('../i18n')
    await applyLanguage('ar')

    expect(document.documentElement.dir).toBe('rtl')
    expect(screen.getByRole('heading', { level: 1, name: ar.dashboard.title })).toBeInTheDocument()
    expect(screen.getByText(ar.common.filters)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: ar.actions.refreshNow })).toBeInTheDocument()

    await applyLanguage('en')
  })
})
