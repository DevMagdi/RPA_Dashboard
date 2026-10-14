/**
 * Dashboard toolbar — the page's identity row and control row in one surface.
 *
 * The dashboard used to carry two separate chrome rows above the data: a
 * "first-run affordance" strip inside the global header and an identity row
 * inside the navy hero (product name, live chip, server clock, on-premises
 * chip, refresh, export). Both were decoration on a screen whose job is
 * decisions, and both pushed the numbers below the fold.
 *
 * This component replaces them with one sticky card:
 *   row 1 — page title + freshness/scope, then Live · server clock ·
 *           On-premises · Refresh · Export · Tour
 *   row 2 — the filters the whole page is scoped by (department / process /
 *           range) + clear + generate capacity recommendations
 *
 * It sticks exactly under the global header (`--header-height` is published by
 * `TopBar` through a ResizeObserver), so a scrolled dashboard always shows the
 * scope it is looking at.
 */
import { Compass, Filter, RefreshCw, ShieldCheck, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useRealtimeStatus } from '../../hooks/ui'
import { DATE_RANGES } from '../../lib/constants'
import { relative } from '../../lib/format'
import { Button, Card, SegmentedControl, Select, cn } from '../ui'

/**
 * Wall clock anchored to the server payload time (not the workstation), so the
 * ops room always shows the same truth as the backend. Isolated component:
 * only this chip re-renders every second, never the toolbar.
 */
export function ServerClock({ generatedAt }) {
  const { t } = useTranslation()
  const [offset] = useState(() => {
    const parsed = generatedAt ? Date.parse(generatedAt) : Number.NaN
    return Number.isFinite(parsed) ? parsed - Date.now() : 0
  })
  const [now, setNow] = useState(() => Date.now() + offset)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() + offset), 1000)
    return () => window.clearInterval(timer)
  }, [offset])

  const locale = typeof document !== 'undefined' ? document.documentElement.dataset.locale : undefined
  const formatted = new Intl.DateTimeFormat(locale || undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(now)

  return (
    <span className="chip tabular" title={generatedAt || undefined}>
      <span className="sr-only">{t('dashboard.hero.serverTime')}</span>
      <time suppressHydrationWarning>{formatted}</time>
    </span>
  )
}

/** Live / offline chip — the realtime socket state, in one word. */
export function LiveChip() {
  const { t } = useTranslation()
  const { status } = useRealtimeStatus()
  const open = status === 'open'
  return (
    <span className="chip" data-live={open ? 'open' : 'closed'}>
      <span className="relative flex h-1.5 w-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: open ? 'var(--success)' : 'var(--text-muted)' }} />
        {open ? <span className="live-dot absolute inset-0" style={{ color: 'var(--success)' }} aria-hidden /> : null}
      </span>
      {open ? t('app.live') : t('app.offline')}
    </span>
  )
}

export default function DashboardToolbar({
  title,
  greeting,
  generatedAt,
  scope,
  refreshing = false,
  onRefresh,
  onOpenTour,
  actions,
  filters,
  onFilterChange,
  onResetFilters,
  filtersDirty = false,
  departments = [],
  processes = [],
  onGenerate,
  generating = false,
  canGenerate = false,
  className,
}) {
  const { t } = useTranslation()

  return (
    <Card className={cn('dashboard-toolbar sticky top-[var(--header-height)] z-30 backdrop-blur-md', className)}>
      {/* ── row 1: identity + shift controls ─────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3 sm:px-4">
        <span aria-hidden className="dashboard-toolbar__mark" />
        <div className="min-w-0 flex-1">
          <h1 className="text-page-title truncate text-text" dir="auto">
            {title || t('dashboard.title')}
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 truncate text-[11px] text-muted">
            {greeting ? <span className="truncate" dir="auto">{greeting}</span> : null}
            {greeting && generatedAt ? <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-border-strong" /> : null}
            <span className="shrink-0">{generatedAt ? t('app.lastUpdated', { time: relative(generatedAt) }) : t('app.loading')}</span>
            {scope && scope !== 'ALL' ? (
              <>
                <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-border-strong" />
                <span className="shrink-0">
                  {t('app.scope')}: <strong className="font-semibold text-text">{scope}</strong>
                </span>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <LiveChip />
          <ServerClock generatedAt={generatedAt} />
          <span className="chip hidden xl:inline-flex">
            <ShieldCheck className="h-3 w-3 text-success" aria-hidden />
            {t('dashboard.privateInstallation')}
          </span>
          <Button variant="primary" size="sm" icon={RefreshCw} loading={refreshing} onClick={onRefresh}>
            {refreshing ? t('app.syncNow') : t('actions.refreshNow')}
          </Button>
          {actions}
          {onOpenTour ? (
            <Button variant="ghost" size="sm" icon={Compass} onClick={onOpenTour} className="hidden sm:inline-flex">
              {t('dashboard.startTour')}
            </Button>
          ) : null}
        </div>
      </div>

      {/* ── row 2: the scope every number on the page is measured against ── */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 border-t border-border/70 bg-surface-2/60 px-3.5 py-2.5 sm:px-4">
        <span className="flex items-center gap-2 pb-2 text-xs font-medium text-muted">
          <Filter className="h-4 w-4" aria-hidden />
          {t('common.filters')}
        </span>
        <label className="space-y-1">
          <span className="block text-[11px] text-muted">{t('dashboard.filters.department')}</span>
          <Select
            className="h-9 w-44 py-0 text-xs"
            value={filters.department}
            onChange={(event) => onFilterChange({ department: event.target.value, process: 'ALL' })}
          >
            <option value="ALL">{t('dashboard.filters.all')}</option>
            {departments.map((row) => {
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
            onChange={(event) => onFilterChange({ process: event.target.value })}
          >
            <option value="ALL">{t('dashboard.filters.all')}</option>
            {processes.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </label>
        <div className="space-y-1">
          <span className="block text-[11px] text-muted" id="dashboard-range-label">
            {t('dashboard.filters.range')}
          </span>
          <div role="group" aria-labelledby="dashboard-range-label">
            <SegmentedControl
              size="sm"
              value={String(filters.days)}
              onValueChange={(next) => onFilterChange({ days: Number(next) })}
              items={DATE_RANGES.map((range) => ({
                value: String(range.value),
                label: t('dashboard.filters.days', { count: range.count }),
              }))}
            />
          </div>
        </div>

        <div className="ms-auto flex flex-wrap items-center gap-2 pb-0.5">
          {filtersDirty ? (
            <Button variant="ghost" size="sm" icon={X} onClick={onResetFilters}>
              {t('actions.clearFilters')}
            </Button>
          ) : null}
          {canGenerate ? (
            <Button variant="outline" size="sm" icon={Sparkles} loading={generating} onClick={onGenerate}>
              {generating ? t('capacity.generating') : t('capacity.generate')}
            </Button>
          ) : null}
        </div>
      </div>

    </Card>
  )
}
