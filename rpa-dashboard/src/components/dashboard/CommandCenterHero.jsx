/**
 * Command-centre hero — the first three seconds of the product.
 *
 * A live operations banner: what is running right now, how the portfolio is
 * performing, when the snapshot was taken and the one-click actions an operator
 * needs at shift handover.  The aurora/grid background is pure CSS (no canvas,
 * no image request), so it costs nothing on the critical path and animates on
 * the compositor thread only.
 */
import { motion } from 'framer-motion'
import { Activity, ArrowUpRight, Bot, CheckCircle2, Compass, Gauge, RefreshCw, ShieldCheck, Timer, Workflow } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Sparkline } from '../charts/primitives'
import { useRealtimeStatus } from '../../hooks/ui'
import { compactNumber, hoursSaved, percent, relative } from '../../lib/format'
import { Badge, Button, Skeleton, cn } from '../ui'

function HeroStat({ icon: Icon, label, value, tone = 'brand', loading, hint }) {
  const tones = {
    brand: 'bg-brand-soft text-brand',
    info: 'bg-info-soft text-info',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    accent: 'bg-accent-soft text-accent-strong',
  }
  return (
    <div className="command-hero__stat">
      <span className={cn('grid h-8.5 w-8.5 shrink-0 place-items-center rounded-xl', tones[tone])}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[10px] font-medium tracking-wide text-muted uppercase">{label}</span>
        <span className="mt-0.5 block truncate text-base font-semibold stat-number text-text">
          {loading ? <Skeleton className="h-5 w-14" /> : value}
        </span>
      </span>
      {hint ? <span className="ms-auto hidden text-[10px] text-muted sm:block">{hint}</span> : null}
    </div>
  )
}

export default function CommandCenterHero({
  kpis,
  successRate,
  generatedAt,
  loading = false,
  refreshing = false,
  onRefresh,
  onOpenTour,
  actions,
  spark = [],
  scope,
}) {
  const { t } = useTranslation()
  const { status } = useRealtimeStatus()
  const running = Number(kpis?.runningNow || 0)
  const isRunning = running > 0
  const liveLabel = status === 'open' ? t('app.live') : t('app.offline')
  const attention = Number(kpis?.stopsToday || 0) + Number(kpis?.slaBreaches || 0)

  return (
    <section className="command-hero" aria-label={t('dashboard.commandCenter')}>
      <span aria-hidden className="command-hero__aurora" />
      <span aria-hidden className="command-hero__grid" />

      <div className="command-hero__content">
        <div className="command-hero__copy">
          <div className="flex flex-wrap items-center gap-2">
            <span className="command-hero__eyebrow">
              <span className="relative flex h-1.5 w-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                {status === 'open' ? <span className="live-dot absolute inset-0" style={{ color: 'var(--accent)' }} aria-hidden /> : null}
              </span>
              {t('dashboard.hero.liveRail')} · {liveLabel}
            </span>
            <span className="chip">
              <ShieldCheck className="h-3 w-3 text-success" aria-hidden />
              {t('dashboard.privateInstallation')}
            </span>
            {scope && scope !== 'ALL' ? (
              <span className="chip">
                {t('app.scope')}: <strong className="font-semibold text-text">{scope}</strong>
              </span>
            ) : null}
          </div>

          <h2 className="command-hero__title display-tight">
            {t('dashboard.commandCenter')}
          </h2>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted sm:text-sm text-pretty">
            {t('dashboard.commandCenterSubtitle')}
          </p>

          <div className="command-hero__stats">
            <HeroStat
              icon={Bot}
              label={t('dashboard.hero.running')}
              value={compactNumber(running)}
              tone={isRunning ? 'info' : 'success'}
              loading={loading}
            />
            <HeroStat
              icon={Workflow}
              label={t('dashboard.hero.processes')}
              value={compactNumber(kpis?.totalProcedures ?? 0)}
              tone="brand"
              loading={loading}
              hint={kpis?.totalProcedures ? t('dashboard.widgets') : undefined}
            />
            <HeroStat
              icon={CheckCircle2}
              label={t('dashboard.hero.successRate')}
              value={percent(successRate ?? kpis?.successRate ?? 0)}
              tone="success"
              loading={loading}
            />
            <HeroStat
              icon={Timer}
              label={t('dashboard.timeSaved')}
              value={hoursSaved(kpis?.timeSaved ?? 0)}
              tone="warning"
              loading={loading}
            />
            {spark.length > 1 ? (
              <div className="command-hero__stat min-w-[10.5rem] flex-col items-start gap-1">
                <span className="flex w-full items-center justify-between text-[10px] font-medium tracking-wide text-muted uppercase">
                  {t('dashboard.runVolume')}
                  <ArrowUpRight className="h-3 w-3" aria-hidden />
                </span>
                <span className="h-8 w-full">
                  <Sparkline data={spark} dataKey="volume" color="var(--chart-1)" height={32} ariaLabel={t('dashboard.runVolume')} />
                </span>
              </div>
            ) : null}
          </div>

          <div className="command-hero__actions">
            <Button variant="primary" size="sm" icon={RefreshCw} loading={refreshing} onClick={onRefresh}>
              {refreshing ? t('app.syncNow') : t('actions.refreshNow')}
            </Button>
            <Button variant="secondary" size="sm" icon={Compass} onClick={onOpenTour}>
              {t('dashboard.startTour')}
            </Button>
            <Link
              to="/capacity"
              className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text"
            >
              <Gauge className="h-3.5 w-3.5" aria-hidden />
              {t('dashboard.hero.viewCapacity')}
            </Link>
            <div className="ms-auto flex items-center gap-2">{actions}</div>
          </div>

          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
            <span>{generatedAt ? t('app.lastUpdated', { time: relative(generatedAt) }) : t('app.loading')}</span>
            <span className="hidden h-1 w-1 rounded-full bg-border-strong sm:block" aria-hidden />
            <span className={cn('inline-flex items-center gap-1', attention > 0 ? 'text-warning' : 'text-success')}>
              <Activity className="h-3 w-3" aria-hidden />
              {attention > 0 ? `${t('dashboard.hero.attention')}: ${compactNumber(attention)}` : t('dashboard.hero.allClear')}
            </span>
          </p>
        </div>

        <div className="command-hero__visual">
          <span aria-hidden className="command-orbit command-orbit--outer" />
          <span aria-hidden className="command-orbit command-orbit--inner" />
          <span aria-hidden className="command-orbit__node command-orbit__node--one" />
          <span aria-hidden className="command-orbit__node command-orbit__node--two" />
          <span aria-hidden className="command-orbit__node command-orbit__node--three" />
          <motion.div
            className="command-core"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <span aria-hidden className="command-core__halo" />
            <span className="command-core__icon">
              <Bot className="h-8 w-8" strokeWidth={1.6} aria-hidden />
            </span>
            <span aria-hidden className={cn('command-core__signal', !isRunning && 'opacity-40')} />
          </motion.div>
          <span className="command-hero__visual-label">{liveLabel}</span>
        </div>
      </div>

      {attention > 0 ? (
        <div className="relative z-[2] flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-2 text-[11px] text-muted sm:px-6">
          <Badge tone="warning" size="sm" dot>
            {t('dashboard.hero.attention')}
          </Badge>
          <span className="truncate">{t('dashboard.hero.nextAction')}</span>
          <Link to="/capacity" className="ms-auto font-medium text-brand underline-offset-2 hover:underline">
            {t('dashboard.hero.viewCapacity')}
          </Link>
        </div>
      ) : null}
    </section>
  )
}
