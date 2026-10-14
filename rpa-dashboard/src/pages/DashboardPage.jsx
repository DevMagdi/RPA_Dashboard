import { useQueryClient } from '@tanstack/react-query'
import { Filter, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { Button, Card, ErrorState, Select, Skeleton, cx } from '../components/ui'
import ExportMenu from '../components/features/ExportMenu'
import CommandCenterHero from '../components/dashboard/CommandCenterHero'
import ProductTourDialog from '../components/dashboard/ProductTourDialog'
import WidgetGrid, { HIDDEN_KEY } from '../components/dashboard/WidgetGrid'
import {
  ActiveRunBanner,
  CapacityPanel,
  DepartmentBars,
  KpiGrid,
  OutcomeDonut,
  RecentRunsTable,
  SavingsChart,
  SlaPanel,
  VolumeChart,
} from '../components/dashboard/Widgets'
import { DATE_RANGES, DEFAULT_WIDGET_LAYOUT } from '../lib/constants'
import storage from '../lib/storage'

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

export default function DashboardPage() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const toast = useToast()
  const { has, user } = useAuth()
  const tourStorageKey = `onboarding.control-room.v4.${user?.user_id ?? 'current'}`

  const { filters, update, reset } = useUrlFilters(DEFAULTS)
  const [refreshing, setRefreshing] = useState(false)
  const [busyRecommendation, setBusyRecommendation] = useState(null)
  const [hiddenIds, setHiddenIds] = useState(() => storage.get(HIDDEN_KEY, []))
  const [tourOpen, setTourOpen] = useState(false)

  const dashboard = useDashboard(filters)
  const capacity = useCapacityInsights({ department: filters.department === 'ALL' ? undefined : filters.department })
  const sla = useSlaWorkload(filters.process === 'ALL' ? undefined : filters.process)
  const departments = useDepartments()
  const processes = useProcessOptions(filters.department === 'ALL' ? undefined : filters.department)

  const generate = useGenerateRecommendations()
  const decide = useUpdateRecommendationStatus()

  const data = dashboard.data

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
      toast.success(t('actions.refresh'))
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

  const allWidgets = useMemo(() => {
    const definitions = {
      kpis: { render: () => <div className="p-3"><KpiGrid kpis={data?.kpis} loading={dashboard.isLoading} /></div> },
      capacity: {
        render: () => (
          <div className="h-full p-3">
            <CapacityPanel
              capacity={capacity.data}
              loading={capacity.isLoading}
              busyId={busyRecommendation}
              onRequestCapacity={requestCapacity}
            />
          </div>
        ),
      },
      volume: { render: () => <div className="h-full p-3"><VolumeChart data={data?.charts?.volume} height={220} loading={dashboard.isLoading} /></div> },
      health: { render: () => <div className="h-full p-3"><OutcomeDonut data={data?.analytics?.statusDistribution} height={220} loading={dashboard.isLoading} /></div> },
      savings: { render: () => <div className="h-full p-3"><SavingsChart data={data?.charts?.savings} height={220} loading={dashboard.isLoading} /></div> },
      runs: {
        render: () => (
          <div className="h-full overflow-hidden p-3">
            <RecentRunsTable rows={data?.table} loading={dashboard.isLoading} dense />
          </div>
        ),
      },
      sla: { render: () => <div className="h-full overflow-hidden p-3"><SlaPanel rows={sla.data} loading={sla.isLoading} /></div> },
    }

    return DEFAULT_WIDGET_LAYOUT.map((item) => ({
      id: item.i,
      title: t(WIDGET_TITLES[item.i]),
      ...definitions[item.i],
    }))
  }, [data, dashboard.isLoading, capacity.data, capacity.isLoading, sla.data, sla.isLoading, busyRecommendation, requestCapacity, t])

  const visible = useMemo(() => allWidgets.filter((widget) => !hiddenIds.includes(widget.id)), [allWidgets, hiddenIds])
  const hidden = useMemo(() => allWidgets.filter((widget) => hiddenIds.includes(widget.id)), [allWidgets, hiddenIds])

  if (dashboard.isError) {
    return (
      <Card>
        <ErrorState error={dashboard.error} onRetry={() => dashboard.refetch()} retryLabel={t('actions.retry')} />
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
      />

      {/* Filters — persisted in the URL so a view can be shared with a colleague */}
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-3">
          <span className="flex items-center gap-2 text-xs text-muted">
            <Filter className="h-4 w-4" aria-hidden />
            {t('actions.filter')}
          </span>
          <label className="space-y-1">
            <span className="block text-[11px] text-muted">{t('dashboard.filters.department')}</span>
            <Select
              className="h-9 w-44 py-0 text-xs"
              value={filters.department}
              onChange={(event) => update({ department: event.target.value, process: 'ALL' })}
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
            <Select className="h-9 w-52 py-0 text-xs" value={filters.process} onChange={(event) => update({ process: event.target.value })}>
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
            <Select className="h-9 w-36 py-0 text-xs" value={filters.days} onChange={(event) => update({ days: Number(event.target.value) })}>
              {DATE_RANGES.map((range) => (
                <option key={range.value} value={range.value}>
                  {t('dashboard.filters.days', { count: range.count })}
                </option>
              ))}
            </Select>
          </label>
          {filters.department !== 'ALL' || filters.process !== 'ALL' || filters.days !== DEFAULTS.days ? (
            <Button variant="ghost" size="sm" icon={X} onClick={reset}>
              {t('actions.clear')}
            </Button>
          ) : null}
          {has('capacity:act') || has('*') ? (
            <Button variant="outline" size="sm" loading={generate.isPending} onClick={() => generate.mutate()} className="ms-auto">
              {generate.isPending ? t('capacity.generating') : t('capacity.generate')}
            </Button>
          ) : null}
        </div>
      </Card>

      <ActiveRunBanner kpis={data?.kpis} />

      {dashboard.isLoading && !data ? (
        <div className="space-y-3">
          <Skeleton className="h-28" />
          <div className="grid gap-3 lg:grid-cols-3">
            <Skeleton className="h-64" />
            <Skeleton className="h-64 lg:col-span-2" />
          </div>
        </div>
      ) : (
        <WidgetGrid
          widgets={visible}
          hidden={hidden}
          onReset={() => setHiddenIds([])}
          onToggleHidden={(id, hide) => {
            const next = hide ? [...new Set([...hiddenIds, id])] : hiddenIds.filter((item) => item !== id)
            setHiddenIds(next)
            storage.set(HIDDEN_KEY, next)
          }}
        />
      )}

      {/* Department breakdown sits below the grid: rarely needed at a glance */}
      <div className={cx('grid gap-3', 'lg:grid-cols-2')}>
        <DepartmentBars data={data?.analytics?.departments} loading={dashboard.isLoading} height={240} />
      </div>

      <ProductTourDialog open={tourOpen} onClose={closeTour} />
    </div>
  )
}
