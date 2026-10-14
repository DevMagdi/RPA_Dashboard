/**
 * Health board — the four numbers that carry a decision.
 *
 * The previous rail showed six equally weighted cards (including "total
 * procedures", a static configuration count) with no reference point, so a
 * reader could not tell good from bad without opening another page. Each card
 * here states the value, the **target**, the verdict against that target and
 * the evidence behind it.
 *
 * The informational figures (procedures, transactions, hours saved, money
 * saved, runners, queue depth) are real but do not carry a decision, so they
 * live in a compact context strip underneath instead of competing for space.
 */
import { motion } from 'framer-motion'
import {
  Activity,
  BadgeDollarSign,
  Bot,
  CheckCircle2,
  HelpCircle,
  ListChecks,
  Package,
  ShieldAlert,
  Timer,
  Workflow,
  XCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Sparkline } from '../charts/primitives'
import { CHART_COLORS } from '../../lib/constants'
import { compactNumber, currency, hoursSaved } from '../../lib/format'
import { Card, CountUpStat, ProgressBar, Skeleton, cn } from '../ui'

const VERDICT_META = {
  ok: { tone: 'success', icon: CheckCircle2, strip: 'var(--success)' },
  risk: { tone: 'warning', icon: ShieldAlert, strip: 'var(--warning)' },
  breach: { tone: 'danger', icon: XCircle, strip: 'var(--danger)' },
  unknown: { tone: 'muted', icon: HelpCircle, strip: 'var(--text-muted)' },
}

const METRIC_ICON = {
  successRate: Activity,
  failedToday: XCircle,
  sla: ShieldAlert,
  throughput: Timer,
}

const CONTEXT_ICON = {
  totalProcedures: Workflow,
  totalTransactions: Package,
  timeSaved: Timer,
  costSaved: BadgeDollarSign,
  onlineRunners: Bot,
  queueDepth: ListChecks,
}

function formatContext(value, format) {
  if (format === 'currency') return currency(value)
  if (format === 'hours') return hoursSaved(value)
  if (format === 'compact') return compactNumber(value)
  return Number(value || 0).toLocaleString()
}

function HealthCard({ metric, index, spark }) {
  const { t } = useTranslation()
  const meta = VERDICT_META[metric.verdict] || VERDICT_META.unknown
  const Icon = METRIC_ICON[metric.key] || Activity
  const showSparkline = metric.key === 'throughput' && spark?.length > 1

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
    >
      <Card hover className={cn('health-card group relative h-full overflow-hidden p-4', `health-card--${metric.verdict}`)}>
        <span aria-hidden className="kpi-strip" style={{ '--strip': meta.strip }} />
        <div className="flex items-start justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-xl"
              style={{ background: `color-mix(in srgb, ${meta.strip} 13%, transparent)`, color: meta.strip }}
            >
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 truncate text-xs font-medium text-muted">{t(metric.labelKey)}</span>
          </span>
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
              meta.tone === 'success' && 'bg-success-soft text-success',
              meta.tone === 'warning' && 'bg-warning-soft text-warning',
              meta.tone === 'danger' && 'bg-danger-soft text-danger',
              meta.tone === 'muted' && 'bg-surface-3 text-muted',
            )}
          >
            <meta.icon className="h-2.5 w-2.5" aria-hidden />
            {t(metric.verdictKey)}
          </span>
        </div>

        <p className="mt-2.5 text-3xl font-semibold text-text">
          <CountUpStat value={metric.value} format={metric.format} />
        </p>

        <p className="mt-0.5 text-[11px] text-muted tabular">
          {t(metric.targetKey, metric.targetParams)}
        </p>

        <div className="mt-2.5">
          {showSparkline ? (
            <span className="block h-8 w-full">
              <Sparkline
                data={spark.slice(-14)}
                dataKey="volume"
                color={meta.strip}
                height={32}
                strokeWidth={1.75}
                ariaLabel={t('dashboard.runVolume')}
              />
            </span>
          ) : (
            <ProgressBar value={metric.progress} tone={meta.tone === 'muted' ? undefined : meta.tone} size="sm" ariaLabel={t(metric.labelKey)} />
          )}
        </div>

        <p className="mt-2 truncate text-[11px] text-muted" dir="auto" title={t(metric.hintKey, metric.hintParams)}>
          {t(metric.hintKey, metric.hintParams)}
        </p>
      </Card>
    </motion.div>
  )
}

export default function HealthBoard({ metrics = [], context = [], spark = [], loading = false, className }) {
  const { t } = useTranslation()

  if (loading && metrics.length === 0) {
    return (
      <div className={cn('space-y-3', className)}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={index} className="p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-8 w-20" />
              <Skeleton className="mt-3 h-2 w-full" />
            </Card>
          ))}
        </div>
        <Skeleton className="h-12 rounded-2xl" />
      </div>
    )
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric, index) => (
          <HealthCard key={metric.key} metric={metric} index={index} spark={spark} />
        ))}
      </div>

      {context.length ? (
        <dl className="context-strip grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border/80 bg-border/60 sm:grid-cols-3 xl:grid-cols-6">
          {context.map((item) => {
            const Icon = CONTEXT_ICON[item.key] || Activity
            return (
              <div key={item.key} className="flex items-center gap-2 bg-surface px-3 py-2.5">
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                <div className="min-w-0">
                  <dt className="truncate text-[10px] font-semibold tracking-[0.08em] text-muted uppercase">{t(item.labelKey)}</dt>
                  <dd className="truncate text-sm font-semibold text-text tabular" title={formatContext(item.value, item.format)}>
                    {formatContext(item.value, item.format)}
                  </dd>
                </div>
              </div>
            )
          })}
        </dl>
      ) : null}
    </div>
  )
}

/* Re-exported for the chart-free colour contract (kept token-driven, never hardcoded). */
export { CHART_COLORS }
