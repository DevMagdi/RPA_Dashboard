/**
 * Dashboard widgets.
 *
 * Each widget is self-contained and receives plain data, so the dashboard can
 * rearrange them (drag & drop) or an integrator can reuse one on another page.
 */
import { motion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  Bot,
  Clock,
  Cpu,
  Gauge,
  ListChecks,
  Package,
  ServerCog,
  Timer,
  TrendingUp,
  Workflow,
} from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { CHART_COLORS, OUTCOME_COLORS } from '../../lib/constants'
import {
  compactNumber,
  currency,
  durationFromMinutes,
  hoursSaved,
  percent,
  relative,
  runStatusColor,
  severityColor,
} from '../../lib/format'
import { Badge, Button, Card, CardBody, CardHeader, CountUpStat, DataTable, EmptyState, ProgressBar, SeverityBadge, Skeleton, cx } from '../ui'

/* ------------------------------------------------------------------- KPIs */

const KPI_CONFIG = [
  { key: 'totalProcedures', label: 'dashboard.totalProcedures', icon: Workflow, tone: 'brand' },
  { key: 'totalTransactions', label: 'dashboard.totalTransactions', icon: Package, tone: 'info' },
  { key: 'runsToday', label: 'dashboard.runsToday', icon: Activity, tone: 'success', hintKey: 'targetRuns' },
  { key: 'timeSaved', label: 'dashboard.timeSaved', icon: Timer, format: 'hours', tone: 'warning' },
  { key: 'costSaved', label: 'dashboard.costSaved', icon: BadgeDollarSign, format: 'currency', tone: 'success' },
  { key: 'runningNow', label: 'dashboard.activeRun', icon: Bot, tone: 'info' },
]

export function KpiGrid({ kpis, loading }) {
  const { t } = useTranslation()

  if (loading && !kpis) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Card key={index} className="p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-6 w-16" />
          </Card>
        ))}
      </div>
    )
  }

  const tones = {
    brand: 'bg-brand-soft text-brand',
    info: 'bg-info-soft text-info',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
      {KPI_CONFIG.map((item, index) => {
        const raw = kpis?.[item.key] ?? 0
        const display =
          item.format === 'hours' ? (
            <>{hoursSaved(raw)}</>
          ) : item.format === 'currency' ? (
            <>{currency(raw)}</>
          ) : (
            <CountUpStat value={raw} format="number" />
          )
        return (
          <motion.div
            key={item.key}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card hover className="flex h-full items-start gap-3 p-4">
              <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-xl', tones[item.tone])}>
                <item.icon className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs text-muted">{t(item.label)}</p>
                <p className="mt-0.5 truncate text-lg font-semibold text-text">{display}</p>
                {item.hintKey && kpis?.[item.hintKey] !== undefined ? (
                  <p className="mt-0.5 text-[11px] text-muted">
                    {t('common.of')} {compactNumber(kpis[item.hintKey])}
                  </p>
                ) : null}
              </div>
            </Card>
          </motion.div>
        )
      })}
    </div>
  )
}

/* ----------------------------------------------------------------- Charts */

function ChartFrame({ title, subtitle, icon, actions, children, height = 240, empty, isEmpty, loading }) {
  return (
    <Card className="h-full">
      <CardHeader title={title} subtitle={subtitle} icon={icon} actions={actions} />
      <CardBody className="pt-3">
        {loading && isEmpty ? (
          <div className="space-y-3" style={{ height }} aria-label={title} aria-busy="true">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-[calc(100%-1.5rem)] w-full rounded-xl" />
          </div>
        ) : isEmpty ? (
          <EmptyState title={empty || 'No data'} className="py-8" />
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

function axisProps() {
  return {
    stroke: CHART_COLORS.axis,
    fontSize: 11,
    tickLine: false,
    axisLine: false,
  }
}

function tooltipStyle() {
  return {
    contentStyle: {
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      color: 'var(--text)',
      fontSize: 12,
      boxShadow: 'var(--shadow-pop)',
    },
    labelStyle: { color: 'var(--text-muted)', fontSize: 11 },
  }
}

export function VolumeChart({ data, loading, height }) {
  const { t } = useTranslation()
  const gradientId = useId().replace(/:/g, '')
  const rows = data || []
  return (
    <ChartFrame
      title={t('dashboard.runVolume')}
      icon={Activity}
      height={height}
      isEmpty={rows.length === 0}
      loading={loading}
      empty={t('dashboard.empty.chart')}
    >
      <AreaChart data={rows} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id={`${gradientId}-volume-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLORS.brand} stopOpacity={0.45} />
            <stop offset="100%" stopColor={CHART_COLORS.brand} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id={`${gradientId}-completed-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLORS.success} stopOpacity={0.4} />
            <stop offset="100%" stopColor={CHART_COLORS.success} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
        <XAxis dataKey="date" {...axisProps()} />
        <YAxis {...axisProps()} />
        <ChartTooltip {...tooltipStyle()} />
        <Area type="monotone" dataKey="volume" stroke={CHART_COLORS.brand} fill={`url(#${gradientId}-volume-fill)`} strokeWidth={2} name={t('dashboard.runsToday')} />
        <Area type="monotone" dataKey="completed" stroke={CHART_COLORS.success} fill={`url(#${gradientId}-completed-fill)`} strokeWidth={2} name={t('audit.success')} />
      </AreaChart>
    </ChartFrame>
  )
}

export function SavingsChart({ data, loading, height }) {
  const { t } = useTranslation()
  const rows = data || []
  return (
    <ChartFrame
      title={t('dashboard.savingsTrend')}
      icon={TrendingUp}
      height={height}
      isEmpty={rows.length === 0}
      loading={loading}
      empty={t('dashboard.empty.chart')}
    >
      <BarChart data={rows} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
        <XAxis dataKey="date" {...axisProps()} />
        <YAxis {...axisProps()} tickFormatter={(value) => compactNumber(value, 0)} />
        <ChartTooltip formatter={(value) => currency(value)} {...tooltipStyle()} />
        <Bar dataKey="bar" fill={CHART_COLORS.brand} radius={[6, 6, 0, 0]} name={t('dashboard.costSaved')} />
        <Line type="monotone" dataKey="line" stroke={CHART_COLORS.accent} strokeWidth={2} dot={false} name={t('dashboard.totalTransactions')} />
      </BarChart>
    </ChartFrame>
  )
}

export function OutcomeDonut({ data, loading, height }) {
  const { t } = useTranslation()
  const rows = (data || []).filter((item) => item.value > 0)
  return (
    <ChartFrame
      title={t('dashboard.healthDonut')}
      icon={Cpu}
      height={height}
      isEmpty={rows.length === 0}
      loading={loading}
      empty={t('dashboard.empty.chart')}
    >
      <PieChart>
        <Pie data={rows} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={3} stroke="none">
          {rows.map((entry) => (
            <Cell key={entry.name} fill={OUTCOME_COLORS[entry.name] || CHART_COLORS.muted} />
          ))}
        </Pie>
        <ChartTooltip {...tooltipStyle()} />
        <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-muted)' }} />
      </PieChart>
    </ChartFrame>
  )
}

export function DepartmentBars({ data, loading, height }) {
  const { t } = useTranslation()
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
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} horizontal={false} />
        <XAxis type="number" {...axisProps()} tickFormatter={(value) => compactNumber(value, 0)} />
        <YAxis type="category" dataKey="name" width={92} {...axisProps()} />
        <ChartTooltip {...tooltipStyle()} />
        <Bar dataKey="runs" fill={CHART_COLORS.brand} radius={[0, 6, 6, 0]} name={t('nav.runs')} />
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
      <Card className="flex items-center gap-3 p-3 text-sm text-muted">
        <Bot className="h-4 w-4" aria-hidden />
        {t('dashboard.activeRunEmpty')}
      </Card>
    )
  }

  return (
    <Card glass className="flex flex-wrap items-center gap-3 p-3">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-info-soft text-info">
        <Activity className="h-4 w-4 animate-pulse-soft" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted">{t('dashboard.activeRun')}</p>
        <p className="truncate text-sm font-semibold text-text">
          {kpis.activeProcess} · <span className="font-mono text-xs text-muted">{kpis.activeRequest}</span>
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
      </Card>
    )
  }

  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        title={t('capacity.insights')}
        subtitle={`${t('capacity.utilisation')}: ${percent(summary?.avg_utilization_percent || 0)}`}
        icon={Gauge}
        actions={
          <Link to="/capacity" className="text-xs text-brand hover:underline">
            {t('actions.viewAll')}
          </Link>
        }
      />
      <CardBody className="flex-1 space-y-3 overflow-y-auto">
        {recommendations.length === 0 ? (
          <EmptyState title={t('capacity.noInsights')} className="py-6" />
        ) : (
          recommendations.slice(0, 4).map((item) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-border bg-surface-2/70 p-3"
              style={{ borderInlineStartColor: severityColor(item.severity), borderInlineStartWidth: 3 }}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold text-text">{item.title}</p>
                <SeverityBadge severity={item.severity} label={t(`capacity.severity.${item.severity}`)} />
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted">{item.detail}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  loading={busyId === item.id}
                  onClick={() => onRequestCapacity?.(item)}
                >
                  {t('actions.requestCapacity')}
                </Button>
                {item.status && item.status !== 'Open' ? (
                  <Badge tone="neutral">{t(`capacity.statuses.${item.status}`)}</Badge>
                ) : null}
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
    { label: t('capacity.onlineRunners'), value: summary?.online_runners ?? 0, tone: 'success' },
    { label: t('capacity.queueDepth'), value: compactNumber(summary?.total_queue_depth || 0), tone: 'warning' },
    { label: t('capacity.openRecommendations'), value: summary?.critical_count ?? 0, tone: 'danger' },
    { label: t('dashboard.slaBreaches'), value: summary?.sla_at_risk ?? 0, tone: 'danger' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <Card key={tile.label} className="p-3">
          <p className="text-[11px] text-muted">{tile.label}</p>
          {/* The value slot can hold the Skeleton block, so it must not be a <p>. */}
          <div className="mt-1 text-lg font-semibold text-text">
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
    <Card className="h-full">
      <CardHeader title={t('capacity.history')} subtitle={t('capacity.slaTarget')} icon={Clock} />
      <CardBody className="space-y-3">
        {loading && !rows?.length ? <Skeleton className="h-24" /> : null}
        {!loading && data.length === 0 ? <EmptyState title={t('dashboard.empty.table')} className="py-6" /> : null}
        {data.map((row) => {
          const status = String(row.SLAStatus || 'Healthy')
          const tone = status === 'Breach_Risk' ? 'danger' : status === 'Warning' ? 'warning' : 'success'
          const progress = row.SLATargetMinutes
            ? Math.min(100, (Number(row.EstimatedCompletionMinutes || 0) / Number(row.SLATargetMinutes)) * 100)
            : 0
          return (
            <div key={row.ProcessName} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-medium text-text">{row.ProcessName}</span>
                <span className="text-muted">
                  {durationFromMinutes(row.EstimatedCompletionMinutes)} / {durationFromMinutes(row.SLATargetMinutes)}
                </span>
              </div>
              <ProgressBar value={progress} />
              <div className="flex items-center justify-between text-[11px] text-muted">
                <Badge tone={tone}>{status.replace('_', ' ')}</Badge>
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
      width: 120,
      render: (row) => (
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: runStatusColor(row.Status) }} />
          <span className="text-xs">{row.Status}</span>
        </span>
      ),
    },
    { key: 'ProcessName', header: t('processes.process'), render: (row) => <span className="font-medium">{row.ProcessName}</span> },
    { key: 'MachineName', header: t('runs.machine'), render: (row) => row.MachineName || '—' },
    {
      key: 'StartTime',
      header: t('runs.started'),
      render: (row) => <span className="text-xs text-muted" title={row.StartTime}>{relative(row.StartTime)}</span>,
    },
    {
      key: 'DurationMinutes',
      header: t('runs.duration'),
      align: 'end',
      render: (row) => <span className="tabular-nums text-xs">{durationFromMinutes(row.DurationMinutes)}</span>,
    },
    {
      key: 'TransactionsCount',
      header: t('runs.transactions'),
      align: 'end',
      render: (row) => <span className="tabular-nums text-xs">{compactNumber(row.TransactionsCount || 0)}</span>,
    },
    {
      key: 'CostSaved',
      header: t('processes.costSaved'),
      align: 'end',
      render: (row) => <span className="tabular-nums text-xs text-success">{currency(row.CostSaved || 0)}</span>,
    },
  ]

  return (
    <Card className="h-full">
      <CardHeader
        title={t('dashboard.recentRuns')}
        icon={ListChecks}
        actions={
          <Link to="/runs" className="inline-flex items-center gap-1 text-xs text-brand hover:underline">
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
        empty={<EmptyState title={t('dashboard.empty.runs')} className="py-8" />}
      />
    </Card>
  )
}

/* ------------------------------------------------------------ Top failures */

export function TopFailuresList({ rows, loading }) {
  const { t } = useTranslation()
  if (loading && !rows) return <Skeleton className="h-24" />
  if (!rows?.length) return <EmptyState title={t('dashboard.empty.table')} className="py-6" />
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.reason} className="flex items-start gap-2 rounded-xl border border-border bg-surface-2/60 p-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-text" title={row.reason}>
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
        <div key={item.label} className="rounded-xl border border-border bg-surface-2/60 px-3 py-2">
          <p className="text-[11px] text-muted">{item.label}</p>
          <p className="mt-0.5 text-sm font-semibold text-text">{item.value}</p>
        </div>
      ))}
    </div>
  )
}

export { Workflow as WorkflowIcon }
