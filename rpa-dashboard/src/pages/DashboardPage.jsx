/**
 * Dashboard — the Control Room's command centre.
 *
 * Performance architecture (this is the screen everyone opens first):
 *  1. the shell + hero + KPI rail render from the *critical* chunk only — no
 *     charting library is parsed before first paint;
 *  2. recharts-backed widgets arrive through `React.lazy` + `<Suspense>` with
 *     layout-stable skeletons, and the drag-and-drop grid is split again;
 *  3. filters are applied inside `startTransition`, so typing in a filter never
 *     blocks the live tiles;
 *  4. refresh invalidates *only* the queries it actually changes.
 */
import { useQueryClient } from '@tanstack/react-query'
import { Filter, RefreshCw, Sparkles, X } from 'lucide-react'
import { Suspense, lazy, startTransition, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../context/AuthProvider'
import { useToast } from '../context/ToastProvider'
import {
  useCapacityInsights,
  useDashboard,
  useDepartments,
  useGenerateRecommendations,
  useProcessOptions,
  useSlaWorkload,
  useUpdateRecommendationStatus,
} from '../hooks/api'
import { useUrlFilters } from '../hooks/ui'
import api from '../lib/api'
import { DATE_RANGES, DEFAULT_WIDGET_LAYOUT } from '../lib/constants'
import { useOnboardingProgress } from '../lib/onboarding'
import storage from '../lib/storage'
import CommandCenterHero from '../components/dashboard/CommandCenterHero'
import KpiGrid from '../components/dashboard/KpiGrid'
import OnboardingChecklist from '../components/dashboard/OnboardingChecklist'
import ExportMenu from '../components/features/ExportMenu'
import RouteFallback from '../components/common/RouteFallback'
import { Button, Card, EmptyState, Select, Skeleton, cn } from '../components/ui'

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
  kpis: 'dashboard.title',
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
  const tourStorageKey = `onboarding.control-room.v4.${user?.user_id ?? 'current'}`

  const { filters, update, reset } = useUrlFilters(DEFAULTS)
  const [refreshing, setRefreshing] = useState(false)
  const [busyRecommendation, setBusyRecommendation] = useState(null)
  const [hiddenIds, setHiddenIds] = useState(() => storage.get('widgets.hidden', []))
  const [tourOpen, setTourOpen] = useState(false)

  const dashboard = useDashboard(filters)
  const capacity = useCapacityInsights({ department: filters.department === 'ALL' ? undefined : filters.department })
  const sla = useSlaWorkload(filters.process === 'ALL' ? undefined : filters.process)
  const departments = useDepartments()
  const processes = useProcessOptions(filters.department === 'ALL' ? undefined : filters.department)

  const generate = useGenerateRecommendations()
  const decide = useUpdateRecommendationStatus()
  const progress = useOnboardingProgress({
    stepProcesses: Boolean(dashboard.data?.kpis?.totalProcedures),
  })

  const data = dashboard.data
  const spark = data?.charts?.volume || []

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
      ])
      toast.success(t('actions.refresh'), t('app.lastUpdated', { time: t('common.justNow') }))
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    } finally {
      setRefreshing(false)
    }
  }

  const requestCapacity = useCallback(
    async (recommendation) => {
      setBusyRecommendation(recommendation.id)
      try {
        await decide.mutateAsync({ id: recommendation.id, status: 'Requested', comment: t('actions.requestCapacity') })
        toast.success(t('actions.requestCapacity'), recommendation.process_name)
      } catch (error) {
        toast.error(t('errors.title'), error.message)
      } finally {
        setBusyRecommendation(null)
      }
    },
    [decide, t, toast],
  )

  const applyFilter = useCallback(
    (patch) => {
      startTransition(() => update(patch))
    },
    [update],
  )

  const allWidgets = useMemo(() => {
    const definitions = {
      kpis: {
        render: () => (
          <div className="p-3">
            <KpiGrid kpis={data?.kpis} loading={dashboard.isLoading} spark={spark} />
          </div>
        ),
      },
      capacity: {
        render: () => (
          <div className="h-full p-3">
            <Suspense fallback={<WidgetSkeleton />}>
              <CapacityPanel
                capacity={capacity.data}
                loading={capacity.isLoading}
                busyId={busyRecommendation}
                onRequestCapacity={requestCapacity}
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

    return DEFAULT_WIDGET_LAYOUT.map((item) => ({
      id: item.i,
      title: t(WIDGET_TITLES[item.i]),
      ...definitions[item.i],
    }))
  }, [data, dashboard.isLoading, capacity.data, capacity.isLoading, sla.data, sla.isLoading, busyRecommendation, requestCapacity, t, spark])

  const visible = useMemo(() => allWidgets.filter((widget) => !hiddenIds.includes(widget.id)), [allWidgets, hiddenIds])
  const hidden = useMemo(() => allWidgets.filter((widget) => hiddenIds.includes(widget.id)), [allWidgets, hiddenIds])
  const filtersDirty = filters.department !== DEFAULTS.department || filters.process !== DEFAULTS.process || filters.days !== DEFAULTS.days

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
    <div className="space-y-4">
      <CommandCenterHero
        kpis={data?.kpis}
        successRate={data?.sidebarStats?.successRate}
        generatedAt={data?.meta?.generated_at}
        loading={dashboard.isLoading && !data}
        refreshing={refreshing}
        onRefresh={onRefresh}
        onOpenTour={() => setTourOpen(true)}
        actions={<ExportMenu days={filters.days} />}
        spark={spark}
        scope={data?.scope?.department}
      />

      {/* Filters — persisted in the URL so a view can be shared with a colleague */}
      <Card className="sticky top-[3.7rem] z-20 p-3 backdrop-blur-md">
        <div className="flex flex-wrap items-end gap-3">
          <span className="flex items-center gap-2 text-xs font-medium text-muted">
            <Filter className="h-4 w-4" aria-hidden />
            {t('common.filters')}
          </span>
          <label className="space-y-1">
            <span className="block text-[11px] text-muted">{t('dashboard.filters.department')}</span>
            <Select
              className="h-9 w-44 py-0 text-xs"
              value={filters.department}
              onChange={(event) => applyFilter({ department: event.target.value, process: 'ALL' })}
            >
              <option value="ALL">{t('dashboard.filters.all')}</option>
              {(departments.data || []).map((row) => {
                const name = typeof row === 'string' ? row : row.Department || row.department || row.name
                return (
                  <option key={name} value={name}>
                    {name}
                  </option>
                )
              })}
            </Select>
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] text-muted">{t('dashboard.filters.process')}</span>
            <Select
              className="h-9 w-52 py-0 text-xs"
              value={filters.process}
              onChange={(event) => applyFilter({ process: event.target.value })}
            >
              <option value="ALL">{t('dashboard.filters.all')}</option>
              {(processes.data || []).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] text-muted">{t('dashboard.filters.range')}</span>
            <Select
              className="h-9 w-36 py-0 text-xs"
              value={filters.days}
              onChange={(event) => applyFilter({ days: Number(event.target.value) })}
            >
              {DATE_RANGES.map((range) => (
                <option key={range.value} value={range.value}>
                  {t('dashboard.filters.days', { count: range.count })}
                </option>
              ))}
            </Select>
          </label>
          {filtersDirty ? (
            <Button variant="ghost" size="sm" icon={X} onClick={reset}>
              {t('actions.clearFilters')}
            </Button>
          ) : null}
          {has('capacity:act') || has('*') ? (
            <Button
              variant="outline"
              size="sm"
              icon={Sparkles}
              loading={generate.isPending}
              onClick={() => generate.mutate()}
              className="ms-auto"
            >
              {generate.isPending ? t('capacity.generating') : t('capacity.generate')}
            </Button>
          ) : null}
        </div>
      </Card>

      <Suspense fallback={<Skeleton className="h-14" />}>
        <ActiveRunBanner kpis={data?.kpis} />
      </Suspense>

      {dashboard.isLoading && !data ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-20" />
            ))}
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <Skeleton className="h-64" />
            <Skeleton className="h-64 lg:col-span-2" />
          </div>
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

      <div className={cn('grid gap-3', 'lg:grid-cols-2')}>
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
