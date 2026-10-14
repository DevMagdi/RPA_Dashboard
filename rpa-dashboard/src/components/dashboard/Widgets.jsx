/**
 * Dashboard widgets.
 *
 * Each widget is self-contained and receives plain data, so the dashboard can
 * rearrange them (drag & drop) or an integrator can reuse one on another page.
 * They share the chart toolkit for tooltips/axes/gradients and therefore follow
 * the brand, the theme and the text direction automatically.
 */
import { motion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock,
  Cpu,
  Gauge,
  ListChecks,
  ServerCog,
  TrendingUp,
  Workflow,
  Zap,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { CHART_COLORS, OUTCOME_COLORS } from '../../lib/constants'
import { compactNumber, currency, durationFromMinutes, percent, relative, runStatusColor, severityColor } from '../../lib/format'
import {
  AreaGradient,
  ChartTooltipCard,
  OUTCOME_TOKENS,
  axisProps,
  chartMargin,
  useChartDirection,
  useGradientId,
} from '../charts/primitives'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  ProgressBar,
  SeverityBadge,
  Skeleton,
} from '../ui'

/* KpiGrid lives in its own module (no chart runtime on the critical path). */
export { default as KpiGrid } from './KpiGrid'

/* ----------------------------------------------------------------- Charts */

function ChartFrame({ title, subtitle, icon, actions, children, height = 240, empty, isEmpty, loading, legend }) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        actions={
          <>
            {legend}
            {actions}
          </>
        }
      />
      <CardBody className="flex-1 pt-4">
        {loading && isEmpty ? (
          <div className="space-y-3" style={{ height }} aria-label={title} aria-busy="true">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-[calc(100%-1.5rem)] w-full rounded-xl" />
          </div>
        ) : isEmpty ? (
          <EmptyState title={empty || 'No data'} className="py-8" compact />
        ) : (
          <div style={{ height }} role="img" aria-label={title}>
            <ResponsiveContainer width="100%" height="100%">
              {children}
            </ResponsiveContainer>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function LegendChip({ color, label, value }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />
      {label}
      {value !== undefined ? <strong className="font-semibold text-text tabular">{value}</strong> : null}
    </span>
  )
}

export function VolumeChart({ data, loading, height }) {
  const { t } = useTranslation()
  const { reverseTimeAxis, valueAxisOrientation } = useChartDirection()
  const gradientId = useGradientId('volume')
  const completedId = useGradientId('completed')
  const rows = data || []
  const peak = rows.reduce((best, row) => (Number(row.volume) > Number(best?.volume ?? -1) ? row : best), null)

  return (
    <ChartFrame
      title={t('dashboard.runVolume')}
      subtitle={peak ? `${t('dashboard.runsToday')}: ${compactNumber(peak.volume)} · ${peak.date}` : undefined}
      icon={Activity}
      height={height}
      isEmpty={rows.length === 0}
      loading={loading}
      empty={t('dashboard.empty.chart')}
      legend={
        rows.length ? (
          <span className="hidden items-center gap-3 sm:flex">
            <LegendChip color={CHART_COLORS.brand} label={t('dashboard.runVolume')} />
            <LegendChip color={CHART_COLORS.success} label={t('audit.success')} />
          </span>
        ) : null
      }
    >
      <AreaChart data={rows} margin={chartMargin({ rtl: reverseTimeAxis })}>
        <defs>
          <AreaGradient id={`${gradientId}`} color={CHART_COLORS.brand} />
          <AreaGradient id={`${completedId}`} color={CHART_COLORS.success} from={0.36} />
        </defs>
        <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
        <XAxis dataKey="date" {...axisProps()} reversed={reverseTimeAxis} minTickGap={24} />
        <YAxis {...axisProps()} orientation={valueAxisOrientation} width={44} tickFormatter={(value) => compactNumber(value, 0)} />
        <ChartTooltip content={<ChartTooltipCard totalLabel={t('common.results')} />} cursor={{ stroke: CHART_COLORS.grid, strokeWidth: 1 }} />
        <Area
          type="monotone"
          dataKey="volume"
          stroke={CHART_COLORS.brand}
          strokeWidth={2.4}
          fill={`url(#${gradientId})`}
          name={t('dashboard.runVolume')}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
        />
        <Area
          type="monotone"
          dataKey="completed"
          stroke={CHART_COLORS.success}
          strokeWidth={2}
          fill={`url(#${completedId})`}
          name={t('audit.success')}
          activeDot={{ r: 3.5, strokeWidth: 2, stroke: 'var(--surface)' }}
        />
      </AreaChart>
    </ChartFrame>
  )
}

export function SavingsChart({ data, loading, height }) {
  const { t } = useTranslation()
  const { reverseTimeAxis, valueAxisOrientation } = useChartDirection()
  const rows = data || []
  return (
    <ChartFrame
      title={t('dashboard.savingsTrend')}
      icon={TrendingUp}
      height={height}
      isEmpty={rows.length === 0}
      loading={loading}
      empty={t('dashboard.empty.chart')}
      legend={
        rows.length ? (
          <span className="hidden items-center gap-3 sm:flex">
            <LegendChip color={CHART_COLORS.brand} label={t('dashboard.costSaved')} />
            <LegendChip color={CHART_COLORS.accent} label={t('dashboard.totalTransactions')} />
          </span>
        ) : null
      }
    >
      <BarChart data={rows} margin={chartMargin({ rtl: reverseTimeAxis })} barCategoryGap="28%">
        <defs>
          <linearGradient id="savings-bar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.95} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.45} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
        <XAxis dataKey="date" {...axisProps()} reversed={reverseTimeAxis} minTickGap={20} />
        <YAxis {...axisProps()} orientation={valueAxisOrientation} width={52} tickFormatter={(value) => compactNumber(value, 0)} />
        <ChartTooltip
          content={<ChartTooltipCard formats={{ bar: 'currency', line: 'compact' }} />}
          cursor={{ fill: 'var(--brand-soft)', opacity: 0.5 }}
        />
        <Bar dataKey="bar" fill="url(#savings-bar)" radius={[6, 6, 2, 2]} name={t('dashboard.costSaved')} maxBarSize={34} />
        <Line type="monotone" dataKey="line" stroke={CHART_COLORS.accent} strokeWidth={2.2} dot={false} name={t('dashboard.totalTransactions')} />
      </BarChart>
    </ChartFrame>
  )
}

export function OutcomeDonut({ data, loading, height }) {
  const { t } = useTranslation()
  const rows = (data || []).filter((item) => Number(item.value) > 0)
  const total = rows.reduce((sum, item) => sum + Number(item.value || 0), 0)

  return (
    <Card className="flex h-full flex-col">
      <CardHeader title={t('dashboard.healthDonut')} icon={Cpu} />
      <CardBody className="flex-1 pt-4">
        {loading && rows.length === 0 ? (
          <div className="space-y-3" style={{ height }} aria-busy="true">
            <Skeleton className="mx-auto h-32 w-32 rounded-full" />
            <Skeleton className="h-3 w-40" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title={t('dashboard.empty.chart')} className="py-8" compact />
        ) : (
          <div className="space-y-3" style={{ minHeight: height }}>
            <div className="relative" style={{ height: (height || 220) - 72 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={rows}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="62%"
                    outerRadius="94%"
                    paddingAngle={2.5}
                    stroke="none"
                    cornerRadius={5}
                    startAngle={90}
                    endAngle={-270}
                  >
                    {rows.map((entry) => (
                      <Cell key={entry.name} fill={OUTCOME_COLORS[entry.name] || OUTCOME_TOKENS.Pending} />
                    ))}
                  </Pie>
                  <ChartTooltip content={<ChartTooltipCard />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="text-center">
                  <p className="text-xl font-semibold stat-number text-text">{compactNumber(total)}</p>
                  <p className="text-[10px] tracking-wide text-muted uppercase">{t('nav.runs')}</p>
                </div>
              </div>
            </div>
            <ul className="space-y-1.5">
              {rows.map((entry) => {
                const share = total ? (Number(entry.value) / total) * 100 : 0
                return (
                  <li key={entry.name} className="flex items-center gap-2 text-xs">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: OUTCOME_COLORS[entry.name] || OUTCOME_TOKENS.Pending }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-muted">{entry.name}</span>
                    <span className="tabular text-text">{compactNumber(entry.value)}</span>
                    <span className="w-10 shrink-0 text-end tabular text-muted">{share.toFixed(0)}%</span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

export function DepartmentBars({ data, loading, height }) {
  const { t } = useTranslation()
  const { reverseTimeAxis } = useChartDirection()
  const rows = data || []
  return (
    <ChartFrame
      title={t('dashboard.departmentBreakdown')}
      icon={ServerCog}
      height={height}
      isEmpty={rows.length === 0}
      loading={loading}
      empty={t('dashboard.empty.chart')}
    >
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 18, left: 8, bottom: 4 }}>
        <defs>
          <linearGradient id="dept-bar" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.55} />
            <stop offset="100%" stopColor="var(--chart-6)" stopOpacity={0.95} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={CHART_COLORS.grid} horizontal={false} />
        <XAxis type="number" {...axisProps()} reversed={reverseTimeAxis} tickFormatter={(value) => compactNumber(value, 0)} />
        <YAxis type="category" dataKey="name" width={104} {...axisProps()} />
        <ChartTooltip content={<ChartTooltipCard />} cursor={{ fill: 'var(--brand-soft)', opacity: 0.4 }} />
        <Bar dataKey="runs" fill="url(#dept-bar)" radius={[6, 6, 6, 6]} name={t('nav.runs')} maxBarSize={22} />
      </BarChart>
    </ChartFrame>
  )
}

/* -------------------------------------------------------------- Active run */

export function ActiveRunBanner({ kpis }) {
  const { t } = useTranslation()
  const running = kpis?.status === 'Running' || kpis?.runningNow > 0
  if (!running || !kpis?.activeProcess) {
    return (
      <Card className="flex items-center gap-3 p-3.5 text-sm text-muted">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-surface-2 text-muted">
          <Bot className="h-4 w-4" aria-hidden />
        </span>
        {t('dashboard.activeRunEmpty')}
      </Card>
    )
  }

  return (
    <Card glass className="relative flex flex-wrap items-center gap-3 overflow-hidden p-3.5">
      <span aria-hidden className="pointer-events-none absolute inset-y-0 start-0 w-1 bg-info" />
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-info-soft text-info">
        <Activity className="h-4 w-4 animate-pulse-soft" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold tracking-[0.14em] text-muted uppercase">{t('dashboard.activeRun')}</p>
        <p className="truncate text-sm font-semibold text-text" dir="auto">
          {kpis.activeProcess}
          {kpis.activeRequest ? <span className="ms-2 font-mono text-xs text-muted">{kpis.activeRequest}</span> : null}
        </p>
      </div>
      <Badge tone="info" dot>
        {kpis.activeMachine || '—'}
      </Badge>
      <Badge tone="neutral">
        {t('dashboard.runsToday')}: {compactNumber(kpis.runningNow)}
      </Badge>
    </Card>
  )
}

/* -------------------------------------------------------- Capacity panel */

export function CapacityPanel({ capacity, loading, onRequestCapacity, busyId }) {
  const { t } = useTranslation()
  const summary = capacity?.summary
  const recommendations = capacity?.recommendations || []

  if (loading && !capacity) {
    return (
      <Card className="h-full p-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-3 h-20" />
        <Skeleton className="mt-3 h-10" />
      </Card>
    )
  }

  const utilisation = Number(summary?.avg_utilization_percent || 0)

  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        title={t('capacity.insights')}
        subtitle={`${t('capacity.utilisation')}: ${percent(utilisation)}`}
        icon={Gauge}
        actions={
          <Link to="/capacity" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
            {t('actions.viewAll')}
            <ArrowRight className="h-3 w-3 rtl:rotate-180" aria-hidden />
          </Link>
        }
      />
      <div className="border-b border-border/70 px-4 py-3">
        <ProgressBar value={utilisation} tone={utilisation >= 90 ? 'danger' : utilisation >= 75 ? 'warning' : 'success'} />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1">
            <Zap className="h-3 w-3 text-warning" aria-hidden />
            {t('capacity.queueDepth')}: <strong className="font-semibold text-text tabular">{compactNumber(summary?.total_queue_depth || 0)}</strong>
          </span>
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-success" aria-hidden />
            {t('capacity.onlineRunners')}: <strong className="font-semibold text-text tabular">{summary?.online_runners ?? 0}</strong>
          </span>
        </div>
      </div>
      <CardBody className="flex-1 space-y-3 overflow-y-auto">
        {recommendations.length === 0 ? (
          <EmptyState title={t('capacity.noInsights')} className="py-6" compact />
        ) : (
          recommendations.slice(0, 4).map((item, index) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
              className="rounded-xl border border-border/80 bg-surface-2/60 p-3 transition-colors hover:border-brand/25"
              style={{ borderInlineStartColor: severityColor(item.severity), borderInlineStartWidth: 3 }}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold text-text" dir="auto">
                  {item.title}
                </p>
                <SeverityBadge severity={item.severity} />
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted" dir="auto">
                {item.detail}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button size="xs" variant="outline" loading={busyId === item.id} onClick={() => onRequestCapacity?.(item)}>
                  {t('actions.requestCapacity')}
                </Button>
                {item.status && item.status !== 'Open' ? <Badge tone="neutral" size="sm">{t(`capacity.statuses.${item.status}`)}</Badge> : null}
              </div>
            </motion.div>
          ))
        )}
      </CardBody>
    </Card>
  )
}

export function CapacitySummaryTiles({ summary, loading }) {
  const { t } = useTranslation()
  const tiles = [
    { label: t('capacity.onlineRunners'), value: summary?.online_runners ?? 0, tone: 'success', icon: ServerCog },
    { label: t('capacity.queueDepth'), value: compactNumber(summary?.total_queue_depth || 0), tone: 'warning', icon: ListChecks },
    { label: t('capacity.openRecommendations'), value: summary?.critical_count ?? 0, tone: 'danger', icon: AlertTriangle },
    { label: t('dashboard.slaBreaches'), value: summary?.sla_at_risk ?? 0, tone: 'danger', icon: Clock },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <Card key={tile.label} className="p-3.5">
          <p className="flex items-center gap-1.5 text-[11px] text-muted">
            <tile.icon className="h-3.5 w-3.5" aria-hidden />
            {tile.label}
          </p>
          {/* The value slot can hold a Skeleton block, so it must not be a <p>. */}
          <div className="mt-1 text-lg font-semibold stat-number text-text">
            {loading && !summary ? <Skeleton className="h-6 w-12" /> : tile.value}
          </div>
        </Card>
      ))}
    </div>
  )
}

/* --------------------------------------------------------------- SLA panel */

export function SlaPanel({ rows, loading }) {
  const { t } = useTranslation()
  const data = (rows || []).slice(0, 6)

  return (
    <Card className="flex h-full flex-col">
      <CardHeader title={t('capacity.history')} subtitle={t('capacity.slaTarget')} icon={Clock} />
      <CardBody className="flex-1 space-y-3.5 overflow-y-auto">
        {loading && !rows?.length ? (
          <>
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </>
        ) : null}
        {!loading && data.length === 0 ? <EmptyState title={t('dashboard.empty.table')} className="py-6" compact /> : null}
        {data.map((row) => {
          const status = String(row.SLAStatus || 'Healthy')
          const tone = status === 'Breach_Risk' ? 'danger' : status === 'Warning' ? 'warning' : 'success'
          const progress = row.SLATargetMinutes
            ? Math.min(100, (Number(row.EstimatedCompletionMinutes || 0) / Number(row.SLATargetMinutes)) * 100)
            : 0
          return (
            <div key={row.ProcessName} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-medium text-text" dir="auto">
                  {row.ProcessName}
                </span>
                <span className="shrink-0 tabular text-muted">
                  {durationFromMinutes(row.EstimatedCompletionMinutes)} / {durationFromMinutes(row.SLATargetMinutes)}
                </span>
              </div>
              <ProgressBar value={progress} tone={tone} />
              <div className="flex items-center justify-between text-[11px] text-muted">
                <Badge tone={tone} size="sm" dot>
                  {status.replace('_', ' ')}
                </Badge>
                <span>
                  {t('capacity.queueDepth')}: {compactNumber(row.PendingItems)}
                </span>
              </div>
            </div>
          )
        })}
      </CardBody>
    </Card>
  )
}

/* ----------------------------------------------------------- Recent runs */

export function RecentRunsTable({ rows, loading, dense = false }) {
  const { t } = useTranslation()
  const columns = [
    {
      key: 'Status',
      header: t('runs.status'),
      width: 130,
      render: (row) => (
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: runStatusColor(row.Status) }} aria-hidden />
          <span className="text-xs" dir="auto">
            {row.Status}
          </span>
        </span>
      ),
    },
    {
      key: 'ProcessName',
      header: t('processes.process'),
      dir: 'auto',
      render: (row) => <span className="font-medium">{row.ProcessName}</span>,
    },
    { key: 'MachineName', header: t('runs.machine'), dir: 'auto', render: (row) => row.MachineName || '—' },
    {
      key: 'StartTime',
      header: t('runs.started'),
      render: (row) => (
        <span className="text-xs text-muted" title={row.StartTime}>
          {relative(row.StartTime)}
        </span>
      ),
    },
    {
      key: 'DurationMinutes',
      header: t('runs.duration'),
      align: 'end',
      render: (row) => <span className="tabular text-xs">{durationFromMinutes(row.DurationMinutes)}</span>,
    },
    {
      key: 'TransactionsCount',
      header: t('runs.transactions'),
      align: 'end',
      render: (row) => <span className="tabular text-xs">{compactNumber(row.TransactionsCount || 0)}</span>,
    },
    {
      key: 'CostSaved',
      header: t('processes.costSaved'),
      align: 'end',
      render: (row) => <span className="tabular text-xs font-medium text-success">{currency(row.CostSaved || 0)}</span>,
    },
  ]

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader
        title={t('dashboard.recentRuns')}
        icon={ListChecks}
        actions={
          <Link to="/runs" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
            {t('actions.viewAll')}
            <ArrowRight className="h-3 w-3 rtl:rotate-180" aria-hidden />
          </Link>
        }
      />
      <DataTable
        columns={columns}
        rows={rows}
        dense={dense}
        loading={loading}
        rowKey={(row) => row.RunID}
        zebra
        empty={<EmptyState title={t('dashboard.empty.runs')} className="py-8" compact />}
      />
    </Card>
  )
}

/* ------------------------------------------------------------ Top failures */

export function TopFailuresList({ rows, loading }) {
  const { t } = useTranslation()
  if (loading && !rows) return <Skeleton className="h-24" />
  if (!rows?.length) return <EmptyState title={t('dashboard.empty.table')} className="py-6" compact />
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.reason} className="flex items-start gap-2.5 rounded-xl border border-border/80 bg-surface-2/60 p-2.5 transition-colors hover:border-warning/30">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-text" title={row.reason} dir="auto">
              {row.reason}
            </p>
            <p className="text-[11px] text-muted">
              {row.occurrences} × · {row.processes} {t('nav.processes')} · {relative(row.last_seen)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function MiniStatRow({ items }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-border/80 bg-surface-2/60 px-3 py-2">
          <p className="text-[11px] text-muted">{item.label}</p>
          <p className="mt-0.5 text-sm font-semibold text-text" dir="auto">
            {item.value}
          </p>
        </div>
      ))}
    </div>
  )
}

export { Workflow as WorkflowIcon }
