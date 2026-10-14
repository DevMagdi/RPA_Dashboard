/**
 * KPI row — the six headline figures of the estate, in one tidy line.
 *
 * Classic BI convention: a fixed row of equally weighted cards above every
 * other section, each with a coloured top strip (the `--strip-*` tokens), an
 * icon, the number and — where a trend exists — a delta chip or a sparkline.
 *
 * Deliberately dependency-light: it uses the hand-built `Sparkline` (no chart
 * runtime), so the dashboard paints its headline figures in the first frame
 * while the heavier recharts widgets are still streaming in behind Suspense.
 * The row is pinned: it never takes part in the draggable analytics grid.
 */
import { motion } from 'framer-motion'
import { Activity, BadgeDollarSign, Bot, Package, Timer, Workflow } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CHART_COLORS } from '../../lib/constants'
import { compactNumber, currency, hoursSaved } from '../../lib/format'
import { seriesDelta } from '../../lib/stats'
import { DeltaChip, Sparkline } from '../charts/primitives'
import { Card, CountUpStat, Skeleton, cn } from '../ui'

/*
 * Each card carries a coloured top strip. The strip token drives both the 4px
 * bar and the icon tint, so the palette stays in one place (CSS variables) and
 * follows the organization brand, the theme and the text direction.
 */
export const KPI_CONFIG = [
  { key: 'totalProcedures', label: 'dashboard.totalProcedures', icon: Workflow, strip: 'navy' },
  { key: 'totalTransactions', label: 'dashboard.totalTransactions', icon: Package, strip: 'blue' },
  {
    key: 'runsToday',
    label: 'dashboard.runsToday',
    icon: Activity,
    strip: 'green',
    hintKey: 'targetRuns',
    delta: { from: 'spark', key: 'volume' },
  },
  { key: 'timeSaved', label: 'dashboard.timeSaved', icon: Timer, format: 'hours', strip: 'indigo' },
  { key: 'costSaved', label: 'dashboard.costSaved', icon: BadgeDollarSign, format: 'currency-compact', strip: 'teal', delta: { from: 'savings', key: 'bar' } },
  { key: 'runningNow', label: 'dashboard.activeRun', icon: Bot, strip: 'orange' },
]

export default function KpiGrid({ kpis, loading = false, spark = [], savings = [], onSelect, className }) {
  const { t } = useTranslation()

  if (loading && !kpis) {
    return (
      <div className={cn('kpi-grid grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6', className)}>
        {Array.from({ length: 6 }).map((_, index) => (
          <Card key={index} className="p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-6 w-16" />
            <Skeleton className="mt-2 h-2 w-12" />
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className={cn('kpi-grid grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6', className)}>
      {KPI_CONFIG.map((item, index) => {
        const raw = kpis?.[item.key] ?? 0
        const display =
          item.format === 'hours' ? (
            <>{hoursSaved(raw)}</>
          ) : item.format === 'currency-compact' ? (
            <CountUpStat value={Number(raw) || 0} format="currency-compact" />
          ) : (
            <CountUpStat value={raw} format="number" />
          )
        const interactive = Boolean(onSelect)
        const delta = item.delta ? seriesDelta(item.delta.from === 'savings' ? savings : spark, item.delta.key) : null
        const exact = item.format === 'currency-compact' ? currency(raw) : undefined
        const running = item.key === 'runningNow' && Number(raw) > 0
        return (
          <motion.div
            key={item.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.34, delay: index * 0.045, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card
              hover
              onClick={interactive ? () => onSelect(item.key) : undefined}
              className={cn('group relative h-full overflow-hidden p-4', interactive && 'cursor-pointer', running && 'shadow-glow')}
            >
              <span aria-hidden className="kpi-strip" style={{ '--strip': `var(--strip-${item.strip})` }} />
              <div className="flex items-start gap-3">
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-transform duration-300 group-hover:scale-105"
                  style={{
                    background: `color-mix(in srgb, var(--strip-${item.strip}) 14%, transparent)`,
                    color: `var(--strip-${item.strip})`,
                  }}
                >
                  <item.icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-muted">{t(item.label)}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <p className="min-w-0 truncate text-2xl font-semibold text-text stat-number" title={exact}>
                      {display}
                    </p>
                    {delta !== null ? <DeltaChip value={delta} className="shrink-0" /> : null}
                    {running ? (
                      <span className="relative flex h-2 w-2 shrink-0" title={t('app.live')}>
                        <span className="h-2 w-2 rounded-full bg-orange" />
                        <span className="live-dot absolute inset-0" style={{ color: 'var(--orange)' }} aria-hidden />
                      </span>
                    ) : null}
                  </div>
                  {item.hintKey && kpis?.[item.hintKey] !== undefined ? (
                    <p className="mt-0.5 truncate text-[11px] text-muted">
                      {t('common.of')} {compactNumber(kpis[item.hintKey])}
                    </p>
                  ) : spark.length > 1 && item.key === 'runsToday' ? (
                    <span className="mt-1 block h-4 w-full opacity-80">
                      <Sparkline data={spark.slice(-14)} dataKey="volume" color={CHART_COLORS.success} height={16} strokeWidth={1.5} />
                    </span>
                  ) : null}
                </div>
              </div>
            </Card>
          </motion.div>
        )
      })}
    </div>
  )
}
