/**
 * Dashboard — the Control Room's command centre.
 *
 * Information architecture (v6, "classic control room")
 * -----------------------------------------------------
 * One tidy page, ordered by *how fast an operator can act*, with a clear
 * heading for every band and no decorative chrome rows:
 *
 *   1. Toolbar (sticky)  — page identity + freshness, Live/server clock,
 *                          Refresh · Export · Tour, and the filters that scope
 *                          every number below (shareable through the URL)
 *   2. KPI row           — the six headline figures, pinned (never draggable)
 *   3. Status console    — verdict → success gauge → 14-day volume → live runs
 *   4. Decision queue    — the ranked list of decisions, each with its action
 *   5. Health board      — the four metrics that carry a decision, vs target
 *   6. Active run        — what the fleet is doing this second
 *   7. Analytics         — trends and evidence, the only rearrangeable band
 *   8. Departments + onboarding checklist
 *
 * Bands 1–6 are pinned: they never move, so muscle memory works and a wallboard
 * cannot be rearranged into something unreadable.
 *
 * Performance architecture (this is the screen everyone opens first):
 *  1. the toolbar + KPI row + status console + decision tier render from the
 *     *critical* chunk only — no charting library is parsed before first paint;
 *  2. recharts-backed widgets arrive through `React.lazy` + `<Suspense>` with
 *     layout-stable skeletons, and the drag-and-drop grid is split again;
 *  3. filters are applied inside `startTransition`, so typing in a filter never
 *     blocks the live tiles;
 *  4. refresh invalidates *only* the queries it actually changes.
 */
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { Suspense, lazy, startTransition, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../context/AuthProvider'
import { useToast } from '../context/ToastProvider'
import {
  useAlerts,
  useCapacityInsights,
  useDashboard,
  useDepartments,
  useGenerateRecommendations,
  useProcessOptions,
  useSetAlertStatus,
  useSlaWorkload,
  useUpdateRecommendationStatus,
} from '../hooks/api'
import { useUrlFilters } from '../hooks/ui'
import api from '../lib/api'
import { DEFAULT_WIDGET_LAYOUT } from '../lib/constants'
import { useOnboardingProgress } from '../lib/onboarding'
import { buildContextMetrics, buildHealthMetrics, buildOpsSignals } from '../lib/opsSignals'
import storage from '../lib/storage'
import CommandCenterHero from '../components/dashboard/CommandCenterHero'
import DashboardToolbar from '../components/dashboard/DashboardToolbar'
import HealthBoard from '../components/dashboard/HealthBoard'
import KpiGrid from '../components/dashboard/KpiGrid'
import OnboardingChecklist from '../components/dashboard/OnboardingChecklist'
import TriageQueue from '../components/dashboard/TriageQueue'
import ExportMenu from '../components/features/ExportMenu'
import RouteFallback from '../components/common/RouteFallback'
import { Button, Card, EmptyState, SectionTitle, Skeleton, cn } from '../components/ui'

/* Heavy, below-the-fold modules: separate chunks, requested after first paint. */
const ProductTourDialog = lazy(() => import('../components/dashboard/ProductTourDialog'))
const WidgetGrid = lazy(() => import('../components/dashboard/WidgetGrid'))
const ActiveRunBanner = lazy(() => import('../components/dashboard/Widgets').then((module) => ({ default: module.ActiveRunBanner })))
const CapacityPanel = lazy(() => import('../components/dashboard/Widgets').then((module) => ({ default: module.CapacityPanel })))
const DepartmentBars = lazy(() => import('../components/dashboard/Widgets').then((module) => ({ default: module.DepartmentBars })))
const OutcomeDonut = lazy(() => import('../components/dashboard/Widgets').then((module) => ({ default: module.OutcomeDonut })))
const RecentRunsTable = lazy(() => import('../components/dashboard/Widgets').then((module) => ({ default: module.RecentRunsTable })))
const SavingsChart = lazy(() => import('../components/dashboard/Widgets').then((module) => ({ default: module.SavingsChart })))
const SlaPanel = lazy(() => import('../components/dashboard/Widgets').then((module) => ({ default: module.SlaPanel })))
const VolumeChart = lazy(() => import('../components/dashboard/Widgets').then((module) => ({ default: module.VolumeChart })))

const DEFAULTS = { department: 'ALL', process: 'ALL', days: 90 }

const WIDGET_TITLES = {
  capacity: 'capacity.insights',
  volume: 'dashboard.runVolume',
  health: 'dashboard.healthDonut',
  savings: 'dashboard.savingsTrend',
  runs: 'dashboard.recentRuns',
  sla: 'dashboard.slaBreaches',
}

function WidgetSkeleton({ height = 260 }) {
  return (
    <div className="p-3">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-3 rounded-xl" style={{ height }} />
    </div>
  )
}

export default function DashboardPage() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const toast = useToast()
  const { has, user } = useAuth()
  const tourStorageKey = `onboarding.control-room.v5.${user?.user_id ?? 'current'}`

  const { filters, update, reset } = useUrlFilters(DEFAULTS)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(null)
  const [hiddenIds, setHiddenIds] = useState(() => storage.get('widgets.hidden', []))
  const [tourOpen, setTourOpen] = useState(false)

  const dashboard = useDashboard(filters)
  const capacity = useCapacityInsights({ department: filters.department === 'ALL' ? undefined : filters.department })
  const sla = useSlaWorkload(filters.process === 'ALL' ? undefined : filters.process)
  const alerts = useAlerts({ status: 'Open', limit: 50 })
  const departments = useDepartments()
  const processes = useProcessOptions(filters.department === 'ALL' ? undefined : filters.department)

  const generate = useGenerateRecommendations()
  const decide = useUpdateRecommendationStatus()
  const setAlertStatus = useSetAlertStatus()

  const data = dashboard.data
  const spark = data?.charts?.volume || []
  const savings = data?.charts?.savings || []
  const booting = dashboard.isLoading && !data

  /**
   * One derivation feeds the verdict, the triage queue and the health board, so
   * the three can never disagree with each other.
   */
  const signals = useMemo(
    () =>
      buildOpsSignals({
        dashboard: data,
        slaWorkload: sla.data,
        capacity: capacity.data,
        alerts: alerts.data,
      }),
    [data, sla.data, capacity.data, alerts.data],
  )
  const healthMetrics = useMemo(() => buildHealthMetrics({ dashboard: data, signals }), [data, signals])
  const contextMetrics = useMemo(() => buildContextMetrics({ dashboard: data, capacity: capacity.data }), [data, capacity.data])

  const progress = useOnboardingProgress({
    stepProcesses: Boolean(data?.kpis?.totalProcedures),
  })

  useEffect(() => {
    if (!dashboard.isLoading && data && !storage.get(tourStorageKey, false)) {
      setTourOpen(true)
    }
  }, [dashboard.isLoading, data, tourStorageKey])

  const closeTour = useCallback(() => {
    storage.set(tourStorageKey, true)
    setTourOpen(false)
  }, [tourStorageKey])

  const onRefresh = async () => {
    setRefreshing(true)
    try {
      await api.post('/api/dashboard/refresh', {})
      await Promise.all([
        client.invalidateQueries({ queryKey: ['dashboard'] }),
        client.invalidateQueries({ queryKey: ['capacity'] }),
        client.invalidateQueries({ queryKey: ['sla-workload'] }),
        client.invalidateQueries({ queryKey: ['alerts'] }),
      ])
      toast.success(t('actions.refresh'), t('app.lastUpdated', { time: t('common.justNow') }))
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    } finally {
      setRefreshing(false)
    }
  }

  /** Acknowledging from the dashboard must never require a trip to /alerts. */
  const acknowledgeAlert = useCallback(
    async (alertId) => {
      setBusy(`alert:${alertId}`)
      try {
        await setAlertStatus.mutateAsync({ id: alertId, status: 'Acknowledged' })
        await client.invalidateQueries({ queryKey: ['alerts'] })
        toast.success(t('alerts.acknowledged'), t('dashboard.triage.acknowledgedHint'))
      } catch (error) {
        toast.error(t('errors.title'), error.message)
      } finally {
        setBusy(null)
      }
    },
    [client, setAlertStatus, t, toast],
  )

  const requestCapacity = useCallback(
    async (item) => {
      const id = item?.recommendationId ?? item?.id
      setBusy(`recommendation:${id}`)
      try {
        await decide.mutateAsync({ id, status: 'Requested', comment: t('actions.requestCapacity') })
        await client.invalidateQueries({ queryKey: ['capacity'] })
        toast.success(t('actions.requestCapacity'), item?.process || t('capacity.insights'))
      } catch (error) {
        toast.error(t('errors.title'), error.message)
      } finally {
        setBusy(null)
      }
    },
    [client, decide, t, toast],
  )

  const applyFilter = useCallback(
    (patch) => {
      startTransition(() => update(patch))
    },
    [update],
  )

  const allWidgets = useMemo(() => {
    const definitions = {
      capacity: {
        render: () => (
          <div className="h-full p-3">
            <Suspense fallback={<WidgetSkeleton />}>
              <CapacityPanel
                capacity={capacity.data}
                loading={capacity.isLoading}
                busyId={busy}
                onRequestCapacity={(recommendation) => requestCapacity({ recommendationId: recommendation.id, process: recommendation.process_name })}
              />
            </Suspense>
          </div>
        ),
      },
      volume: {
        render: () => (
          <div className="h-full p-3">
            <Suspense fallback={<WidgetSkeleton height={220} />}>
              <VolumeChart data={data?.charts?.volume} height={220} loading={dashboard.isLoading} />
            </Suspense>
          </div>
        ),
      },
      health: {
        render: () => (
          <div className="h-full p-3">
            <Suspense fallback={<WidgetSkeleton height={220} />}>
              <OutcomeDonut data={data?.analytics?.statusDistribution} height={220} loading={dashboard.isLoading} />
            </Suspense>
          </div>
        ),
      },
      savings: {
        render: () => (
          <div className="h-full p-3">
            <Suspense fallback={<WidgetSkeleton height={220} />}>
              <SavingsChart data={data?.charts?.savings} height={220} loading={dashboard.isLoading} />
            </Suspense>
          </div>
        ),
      },
      runs: {
        render: () => (
          <div className="h-full overflow-hidden p-3">
            <Suspense fallback={<WidgetSkeleton height={200} />}>
              <RecentRunsTable rows={data?.table} loading={dashboard.isLoading} dense />
            </Suspense>
          </div>
        ),
      },
      sla: {
        render: () => (
          <div className="h-full overflow-hidden p-3">
            <Suspense fallback={<WidgetSkeleton height={200} />}>
              <SlaPanel rows={sla.data} loading={sla.isLoading} />
            </Suspense>
          </div>
        ),
      },
    }

    return DEFAULT_WIDGET_LAYOUT.filter((item) => definitions[item.i]).map((item) => ({
      id: item.i,
      title: t(WIDGET_TITLES[item.i]),
      ...definitions[item.i],
    }))
  }, [data, dashboard.isLoading, capacity.data, capacity.isLoading, sla.data, sla.isLoading, busy, requestCapacity, t])

  const visible = useMemo(() => allWidgets.filter((widget) => !hiddenIds.includes(widget.id)), [allWidgets, hiddenIds])
  const hidden = useMemo(() => allWidgets.filter((widget) => hiddenIds.includes(widget.id)), [allWidgets, hiddenIds])
  const filtersDirty = filters.department !== DEFAULTS.department || filters.process !== DEFAULTS.process || filters.days !== DEFAULTS.days

  /* The toolbar carries the operator's name; the page no longer spends a whole
     navy hero on a greeting. */
  const operatorName = user?.full_name || user?.username || t('dashboard.hero.operator')
  const hour = new Date().getHours()
  const greetingKey =
    hour < 12 ? 'dashboard.hero.greetingMorning' : hour < 18 ? 'dashboard.hero.greetingAfternoon' : 'dashboard.hero.greetingEvening'

  if (dashboard.isError && !data) {
    return (
      <Card>
        <EmptyState
          tone="danger"
          title={t('errors.title')}
          description={dashboard.error?.message}
          action={
            <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => dashboard.refetch()}>
              {t('actions.tryAgain')}
            </Button>
          }
        />
      </Card>
    )
  }

  return (
    <div className="dashboard-page space-y-5">
      {/* ── Band 1: identity, freshness and scope — sticky, one surface ─── */}
      <DashboardToolbar
        title={t('dashboard.title')}
        greeting={t(greetingKey, { name: operatorName })}
        generatedAt={data?.meta?.generated_at}
        scope={data?.scope?.department}
        refreshing={refreshing}
        onRefresh={onRefresh}
        onOpenTour={() => setTourOpen(true)}
        actions={<ExportMenu days={filters.days} />}
        filters={filters}
        onFilterChange={applyFilter}
        onResetFilters={reset}
        filtersDirty={filtersDirty}
        departments={departments.data || []}
        processes={processes.data || []}
        onGenerate={() => generate.mutate()}
        generating={generate.isPending}
        canGenerate={has('capacity:act') || has('*')}
      />

      {/* ── Band 2: the six headline figures, pinned above everything ───── */}
      <section aria-label={t('dashboard.overview.title')}>
        <SectionTitle
          as="h2"
          className="mb-3"
          eyebrow={t('dashboard.overview.eyebrow')}
          title={t('dashboard.overview.title')}
          subtitle={t('dashboard.overview.subtitle')}
        />
        <KpiGrid kpis={data?.kpis} loading={booting} spark={spark} savings={savings} />
      </section>

      {/* ── Band 3: verdict, success gauge, volume trend and live runs ──── */}
      <section aria-label={t('dashboard.status.title')}>
        <SectionTitle
          as="h2"
          className="mb-3"
          eyebrow={t('dashboard.status.eyebrow')}
          title={t('dashboard.status.title')}
          subtitle={t('dashboard.status.subtitle')}
        />
        <CommandCenterHero
          successRate={data?.sidebarStats?.successRate ?? data?.kpis?.successRate}
          loading={booting}
          spark={spark}
          savings={savings}
          activity={data?.table || []}
          signals={signals}
        />
      </section>

      {/* ── Band 4: the ranked list of decisions ────────────────────────── */}
      <section id="triage-queue" className="scroll-mt-[calc(var(--header-height)+1rem)]" aria-label={t('dashboard.triage.title')}>
        <TriageQueue signals={signals} loading={booting} busy={busy} onAcknowledge={acknowledgeAlert} onDecide={requestCapacity} />
      </section>

      {/* ── Band 5: the four metrics that carry a decision, versus target ── */}
      <section aria-label={t('dashboard.health.title')}>
        <SectionTitle
          as="h2"
          className="mb-3"
          eyebrow={t('dashboard.health.eyebrow')}
          title={t('dashboard.health.title')}
          subtitle={t('dashboard.health.subtitle')}
        />
        <HealthBoard metrics={healthMetrics} context={contextMetrics} spark={spark} loading={booting} />
      </section>

      <Suspense fallback={<Skeleton className="h-14" />}>
        <ActiveRunBanner kpis={data?.kpis} />
      </Suspense>

      {/* ── Band 6: trends and evidence. Only this band is rearrangeable. ── */}
      <section aria-label={t('dashboard.analytics.title')}>
        <SectionTitle
          as="h2"
          className="mb-3"
          eyebrow={t('dashboard.analytics.eyebrow')}
          title={t('dashboard.analytics.title')}
          subtitle={t('dashboard.analytics.subtitle')}
        />
        {booting ? (
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-64" />
            <Skeleton className="h-64 lg:col-span-2" />
          </div>
        ) : (
          <Suspense fallback={<RouteFallback variant="dashboard" />}>
            <WidgetGrid
              widgets={visible}
              hidden={hidden}
              onReset={() => setHiddenIds([])}
              onToggleHidden={(id, hide) => {
                const next = hide ? [...new Set([...hiddenIds, id])] : hiddenIds.filter((item) => item !== id)
                setHiddenIds(next)
                storage.set('widgets.hidden', next)
              }}
            />
          </Suspense>
        )}
      </section>

      <div className={cn('grid gap-4', 'lg:grid-cols-2')}>
        <Suspense fallback={<Skeleton className="h-64 rounded-2xl" />}>
          <DepartmentBars data={data?.analytics?.departments} loading={dashboard.isLoading} height={240} />
        </Suspense>
        <OnboardingChecklist done={progress} className="lg:self-start" />
      </div>

      <Suspense fallback={null}>
        {tourOpen ? <ProductTourDialog open={tourOpen} onClose={closeTour} onFinish={closeTour} /> : null}
      </Suspense>
    </div>
  )
}
