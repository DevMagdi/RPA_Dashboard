/**
 * Dashboard page — the classic control-room layout contract.
 *
 * The redesign reordered the page into tidy, titled bands and deleted the two
 * decorative chrome rows (the header's first-run strip and extra identity
 * rows). What an operator relies on is the *order* and the fact that the pinned
 * bands never become draggable, so that is what this file locks:
 *
 *   toolbar (sticky) → command hero → KPI row → decision queue
 *   → health board → active run → analytics grid → departments + onboarding
 *
 * It renders the real page with the real derived signals; only the data hooks,
 * the auth/toast contexts and the chart-heavy widget modules are stubbed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import DashboardPage from '../pages/DashboardPage'
import en from '../i18n/locales/en.json'

const dashboardPayload = vi.hoisted(() => ({
  kpis: {
    runningNow: 2,
    activeProcess: 'Invoice_Processing',
    costSaved: 48200,
    stopsToday: 0,
    totalProcedures: 42,
    totalTransactions: 1250,
    runsToday: 316,
    targetRuns: 400,
    timeSaved: 96,
    successRate: 98.4,
    failureDetailsAll: [],
  },
  sidebarStats: { successRate: 98.4, successRuns: 980, bookedRuns: 996 },
  charts: {
    volume: Array.from({ length: 14 }, (_, index) => ({ date: `${index + 1} Oct`, volume: 100 + index * 10 })),
    savings: Array.from({ length: 14 }, (_, index) => ({ date: `${index + 1} Oct`, bar: 1000 + index * 100 })),
  },
  analytics: { departments: [], statusDistribution: [] },
  table: [
    {
      RunID: 1,
      Status: 'Success',
      ProcessName: 'Invoice_Processing',
      StartTime: '2026-02-01T09:28:00Z',
      DurationMinutes: 6,
    },
  ],
  meta: { generated_at: '2026-02-01T09:30:00Z' },
  scope: { department: 'ALL' },
}))

vi.mock('../context/AuthProvider', () => ({
  useAuth: () => ({ user: { user_id: 7, username: 'magdi', full_name: 'Magdi Hassan' }, has: () => true, logout: vi.fn() }),
}))
vi.mock('../context/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))
vi.mock('../hooks/ui', async (importOriginal) => ({
  ...(await importOriginal()),
  useRealtimeStatus: () => ({ status: 'open', lastEventAt: Date.now(), retries: 0 }),
}))
vi.mock('../hooks/api', () => ({
  useDashboard: () => ({ data: dashboardPayload, isLoading: false, isError: false, refetch: vi.fn() }),
  useCapacityInsights: () => ({ data: { summary: { online_runners: 4, total_queue_depth: 12 }, utilization: [], recommendations: [] }, isLoading: false }),
  useSlaWorkload: () => ({ data: [], isLoading: false }),
  useAlerts: () => ({ data: [], isLoading: false }),
  useDepartments: () => ({ data: ['Finance', 'Operations'] }),
  useProcessOptions: () => ({ data: ['Invoice_Processing'] }),
  useGenerateRecommendations: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateRecommendationStatus: () => ({ mutateAsync: vi.fn() }),
  useSetAlertStatus: () => ({ mutateAsync: vi.fn() }),
}))
/* The first-run tour is a modal on top of the page: out of the way here. The
   lazy widget modules are *not* stubbed — the assertions below locate each band
   by its accessible heading, so the real components render inside the real
   Suspense boundaries and the order check stays honest. */
vi.mock('../components/dashboard/ProductTourDialog', () => ({ default: () => null }))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/**
 * The bands top to bottom, each located by something a reader can see: a
 * selector for the pinned chrome, the accessible section heading for the titled
 * bands. A band that disappears (or is duplicated) fails the contract itself.
 */
const BANDS = [
  ['toolbar', (container) => container.querySelector('.dashboard-toolbar')],
  ['commandHero', (container) => container.querySelector('.command-hero')],
  ['kpiRow', (container) => container.querySelector('.kpi-grid')],
  ['triageQueue', (container) => container.querySelector('#triage-queue')],
  ['healthBoard', (container) => container.querySelector('.health-card')],
  ['activeRun', (container) => container.querySelector('.active-run-band')],
  ['analytics', (container) => sectionTitled(container, en.dashboard.analytics.title)],
  ['departments', (container) => sectionTitled(container, en.dashboard.departmentBreakdown)],
]

/** The <section> that carries a band heading (SectionTitle or CardHeader). */
function sectionTitled(container, title) {
  const heading = [...container.querySelectorAll('h2')].find((node) => node.textContent.trim() === title)
  return heading ? heading.closest('section') : null
}

function bandNodes(container) {
  return BANDS.map(([name, find]) => {
    const node = find(container)
    if (!node) throw new Error(`missing band: ${name}`)
    return [name, node]
  })
}

/** Document order — jsdom has no layout, and DOM order *is* the reading order. */
function expectOrdered(nodes) {
  for (let index = 1; index < nodes.length; index += 1) {
    const [previousName, previous] = nodes[index - 1]
    const [name, node] = nodes[index]
    // eslint-disable-next-line no-bitwise
    expect(previous.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING, `${previousName} before ${name}`).toBeTruthy()
  }
}

describe('dashboard layout (classic control room)', () => {
  it('orders the page: toolbar → hero → KPI row → decisions → health → analytics', async () => {
    const { container } = renderPage()
    // the analytics grid, the active-run banner and the department bars arrive
    // as lazy chunks: wait for every band before asserting their order
    // every band is behind a lazy chunk and/or a Suspense boundary: wait for
    // the last one (the department breakdown) before asserting the order
    await waitFor(() => expect(sectionTitled(container, en.dashboard.departmentBreakdown)).toBeTruthy(), { timeout: 4000 })

    expectOrdered(bandNodes(container))
  })

  it('titles every band and keeps exactly one h1 (the toolbar owns it)', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(container.querySelector('.command-hero')).toBeTruthy())

    const headings = [...container.querySelectorAll('h1')]
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent(en.dashboard.title)

    // the hero titles itself with the operator's greeting (spec: time-aware greeting)
    expect(container.querySelector('.command-hero h2.command-hero__title')).toBeTruthy()

    const h2 = [...container.querySelectorAll('h2')].map((node) => node.textContent)
    for (const title of [
      en.dashboard.overview.title,
      en.dashboard.health.title,
      en.dashboard.analytics.title,
    ]) {
      expect(h2.some((text) => text.includes(title)), title).toBe(true)
    }
  })

  it('pins six KPI cards, each with a token-driven colour strip', async () => {
    const { container } = renderPage()
    const overview = screen.getByRole('region', { name: en.dashboard.overview.title })
    await waitFor(() => expect(overview.querySelectorAll('.kpi-strip').length).toBe(6))

    const strips = [...overview.querySelectorAll('.kpi-strip')].map((node) => node.style.getPropertyValue('--strip'))
    for (const value of strips) expect(value.startsWith('var(--strip-')).toBe(true)
    expect(container.querySelector('.kpi-grid')).toBeTruthy()

    for (const label of [
      en.dashboard.totalProcedures,
      en.dashboard.totalTransactions,
      en.dashboard.runsToday,
      en.dashboard.timeSaved,
      en.dashboard.costSaved,
      en.dashboard.activeRun,
    ]) {
      expect(within(overview).getByText(label)).toBeInTheDocument()
    }
  })

  it('keeps the KPI row out of the draggable analytics grid', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(sectionTitled(container, en.dashboard.analytics.title)).toBeTruthy(), { timeout: 4000 })

    const analytics = sectionTitled(container, en.dashboard.analytics.title)
    expect(within(analytics).queryByText(en.dashboard.totalProcedures)).not.toBeInTheDocument()
    // the pinned bands are outside the draggable grid, so a wallboard cannot reorder them
    expect(analytics.contains(container.querySelector('.command-hero'))).toBe(false)
    expect(analytics.contains(container.querySelector('#triage-queue'))).toBe(false)
    expect(analytics.contains(container.querySelector('.kpi-grid'))).toBe(false)
  })

  it('keeps the decision tier actionable and scoped by the toolbar filters', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(container.querySelector('#triage-queue')).toBeTruthy())

    // the triage queue renders an explicit all-clear rather than an empty hole
    expect(screen.getByText(en.dashboard.triage.allClear)).toBeInTheDocument()
    // the scope every number is measured by lives in the sticky toolbar
    const toolbar = container.querySelector('.dashboard-toolbar')
    expect(within(toolbar).getByText(en.common.filters)).toBeInTheDocument()
    expect(toolbar.querySelectorAll('select')).toHaveLength(2)
  })
})
