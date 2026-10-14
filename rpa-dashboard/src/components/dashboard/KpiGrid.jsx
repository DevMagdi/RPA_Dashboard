/**
 * KPI rail — the six numbers an operator checks first.
 *
 * Deliberately dependency-light: it uses the hand-built `Sparkline` (no chart
 * runtime) so the dashboard paints its headline figures in the first frame,
 * while the heavier recharts widgets are still streaming in behind Suspense.
 */
import { motion } from 'framer-motion'
import { Activity, BadgeDollarSign, Bot, Package, Timer, Workflow } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CHART_COLORS } from '../../lib/constants'
import { compactNumber, currency, hoursSaved } from '../../lib/format'
import { Sparkline } from '../charts/primitives'
import { Card, CountUpStat, Skeleton, cn } from '../ui'



const KPI_CONFIG = [
  { key: 'totalProcedures', label: 'dashboard.totalProcedures', icon: Workflow, tone: 'brand' },
  { key: 'totalTransactions', label: 'dashboard.totalTransactions', icon: Package, tone: 'info' },
  { key: 'runsToday', label: 'dashboard.runsToday', icon: Activity, tone: 'success', hintKey: 'targetRuns' },
  { key: 'timeSaved', label: 'dashboard.timeSaved', icon: Timer, format: 'hours', tone: 'warning' },
  { key: 'costSaved', label: 'dashboard.costSaved', icon: BadgeDollarSign, format: 'currency', tone: 'success' },
  { key: 'runningNow', label: 'dashboard.activeRun', icon: Bot, tone: 'info' },
]

const KPI_TONES = {
  brand: 'bg-brand-soft text-brand',
  info: 'bg-info-soft text-info',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
}

export default function KpiGrid({ kpis, loading, spark = [], onSelect }) {
  const { t } = useTranslation()

  if (loading && !kpis) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
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
        const interactive = Boolean(onSelect)
        return (
          <motion.div
            key={item.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.34, delay: index * 0.045, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card
              hover={interactive}
              onClick={interactive ? () => onSelect(item.key) : undefined}
              className={cn('group relative h-full overflow-hidden p-4', interactive && 'cursor-pointer')}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/40 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              />
              <div className="flex items-start gap-3">
                <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-transform duration-300 group-hover:scale-105', KPI_TONES[item.tone])}>
                  <item.icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-muted">{t(item.label)}</p>
                  <p className="mt-0.5 truncate text-lg font-semibold text-text">{display}</p>
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
