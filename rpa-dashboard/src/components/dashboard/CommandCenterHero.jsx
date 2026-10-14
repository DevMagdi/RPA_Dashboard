/**
 * Command-centre hero — the first three seconds of the product.
 *
 * Premium command-center wireframe (Wow plan):
 *   [live status bar: Connected · server clock]   [Refresh] [Export]
 *   Good morning, Magdi  + shift actions
 *   ─────────────────────────────────────────────────────
 *   Success · Active · Savings · SLA risk · Runs today   (five-KPI strip)
 *   ── 14-day run-volume sparkline strip ──
 *   ── live activity ticker (five most recent real runs) ──
 *
 * The aurora/grid background is pure CSS (no canvas, no image request), so it
 * costs nothing on the critical path and animates on the compositor thread.
 * Every number is real payload data — no synthetic decoration.
 */
import { Activity, ArrowRight, CheckCircle2, Clock, Compass, Gauge, RefreshCw, ShieldAlert, ShieldCheck, TrendingUp, Bot, BadgeDollarSign } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { DeltaChip, Sparkline } from '../charts/primitives'
import { useAuth } from '../../context/AuthProvider'
import { useRealtimeStatus } from '../../hooks/ui'
import { compactNumber, durationFromMinutes, relative, runStatusColor } from '../../lib/format'
import { rateDelta, seriesDelta } from '../../lib/stats'
import { Badge, Button, CountUpStat, Skeleton, cn } from '../ui'

const TONE_VARS = {
  brand: 'var(--brand)',
  info: 'var(--info)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  accent: 'var(--accent)',
}

/**
 * Wall clock anchored to the server payload time (not the workstation), so the
 * "ops room" always shows the same truth as the backend. Isolated component:
 * only this chip re-renders every second, never the hero.
 */
function ServerClock({ generatedAt }) {
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
      <Clock className="h-3 w-3 text-brand" aria-hidden />
      <span className="sr-only">{t('dashboard.hero.serverTime')}</span>
      <time suppressHydrationWarning>{formatted}</time>
    </span>
  )
}

/** Live activity item — one real run, status dot + process + freshness. */
function ActivityItem({ run }) {
  return (
    <span className="command-hero__activity-item">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: runStatusColor(run.Status) }} aria-hidden />
      <strong dir="auto">{run.ProcessName}</strong>
      <time title={run.StartTime} dateTime={run.StartTime}>
        {relative(run.StartTime)}
      </time>
      <span aria-hidden>·</span>
      <span className="tabular">{durationFromMinutes(run.DurationMinutes)}</span>
    </span>
  )
}

/** KPI block inside the hero strip. */
function HeroKpi({ icon: Icon, label, value, tone = 'brand', delta, hint, live, flashKey, glow }) {
  return (
    <div className={cn('command-hero__kpi', glow && 'glow-brand')}>
      <div className="command-hero__kpi-head">
        <span key={flashKey} className="command-hero__kpi-icon stat-flash" style={{ '--tone': TONE_VARS[tone] || TONE_VARS.brand }}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        {live ? (
          <span className="relative flex h-2 w-2" title="live">
            <span className="h-2 w-2 rounded-full" style={{ background: 'var(--info)' }} />
            <span className="live-dot absolute inset-0" style={{ color: 'var(--info)' }} aria-hidden />
          </span>
        ) : delta !== null && delta !== undefined ? (
          <DeltaChip value={delta} />
        ) : null}
      </div>
      <span className="command-hero__kpi-label">{label}</span>
      <span className="command-hero__kpi-value">{value}</span>
      {hint ? <span className="command-hero__kpi-hint">{hint}</span> : null}
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
  savings = [],
  slaRisk = 0,
  scope,
  activity = [],
}) {
  const { t } = useTranslation()
  const { status } = useRealtimeStatus()
  const { user } = useAuth()

  const running = Number(kpis?.runningNow || 0)
  const isRunning = running > 0
  const liveLabel = status === 'open' ? t('app.live') : t('app.offline')
  const riskCount = Number(slaRisk) + Number(kpis?.stopsToday || 0)
  const attention = riskCount

  const name = user?.full_name || user?.username || t('dashboard.hero.operator')
  const hour = new Date().getHours()
  const greetingKey =
    hour < 12 ? 'dashboard.hero.greetingMorning' : hour < 18 ? 'dashboard.hero.greetingAfternoon' : 'dashboard.hero.greetingEvening'

  const rate = successRate ?? kpis?.successRate ?? 0
  const successTrend = rateDelta(spark)
  const savingsTrend = seriesDelta(savings, 'bar')
  const runsTrend = seriesDelta(spark, 'volume')

  return (
    <section className="command-hero" aria-label={t('dashboard.commandCenter')}>
      <span aria-hidden className="command-hero__aurora" />
      <span aria-hidden className="command-hero__grid" />

      <div className="command-hero__content">
        {/* ── identity row: live eyebrow + shift actions ─────────────────── */}
        <div className="command-hero__head">
          <div className="flex flex-wrap items-center gap-2">
            <span className="command-hero__eyebrow">
              <span className="relative flex h-1.5 w-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                {status === 'open' ? <span className="live-dot absolute inset-0" style={{ color: 'var(--accent)' }} aria-hidden /> : null}
              </span>
              {t('app.name')} · {t('dashboard.hero.kicker')}
            </span>
            <span className="chip" data-live={status === 'open' ? 'open' : 'closed'}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: status === 'open' ? 'var(--success)' : 'var(--text-muted)' }} aria-hidden />
              {liveLabel}
            </span>
            <ServerClock generatedAt={generatedAt} />
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

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" icon={RefreshCw} loading={refreshing} onClick={onRefresh}>
              {refreshing ? t('app.syncNow') : t('actions.refreshNow')}
            </Button>
            <div className="flex items-center gap-2">{actions}</div>
          </div>
        </div>

        {/* ── greeting ───────────────────────────────────────────────────── */}
        <div>
          <h2 className="command-hero__title text-display">
            {t(greetingKey, { name })}
          </h2>
          <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-muted sm:text-sm text-pretty">
            {t('dashboard.commandCenterSubtitle')}
          </p>
        </div>

        <span className="divider" aria-hidden />

        {/* ── four-KPI command strip ─────────────────────────────────────── */}
        <div className="command-hero__kpis">
          <HeroKpi
            icon={TrendingUp}
            label={t('dashboard.hero.successRate')}
            tone="success"
            value={loading && !kpis ? <Skeleton className="h-7 w-16" /> : <CountUpStat value={rate} format="percent" />}
            delta={successTrend}
            hint={successTrend !== null ? undefined : t('dashboard.runVolume')}
            flashKey={rate}
          />
          <HeroKpi
            icon={Bot}
            label={t('dashboard.hero.running')}
            tone={isRunning ? 'info' : 'success'}
            value={loading && !kpis ? <Skeleton className="h-7 w-10" /> : <CountUpStat value={running} format="number" />}
            live={isRunning}
            glow={isRunning}
            hint={isRunning ? kpis?.activeProcess || undefined : t('dashboard.hero.standby')}
            flashKey={running}
          />
          <HeroKpi
            icon={BadgeDollarSign}
            label={t('dashboard.costSaved')}
            tone="accent"
            value={loading && !kpis ? <Skeleton className="h-7 w-24" /> : <CountUpStat value={Number(kpis?.costSaved) || 0} format="currency" />}
            delta={savingsTrend}
            hint={t('dashboard.filters.days', { count: 14 })}
            flashKey={kpis?.costSaved}
          />
          <HeroKpi
            icon={Number(slaRisk) > 0 ? ShieldAlert : Clock}
            label={t('dashboard.slaBreaches')}
            tone={Number(slaRisk) > 0 ? 'danger' : 'success'}
            value={loading && !kpis ? <Skeleton className="h-7 w-10" /> : <CountUpStat value={Number(slaRisk) || 0} format="number" />}
            hint={Number(slaRisk) > 0 ? t('dashboard.hero.attention') : t('dashboard.hero.allClear')}
            flashKey={slaRisk}
          />
          <HeroKpi
            icon={Activity}
            label={t('dashboard.hero.runsToday')}
            tone="brand"
            value={loading && !kpis ? <Skeleton className="h-7 w-10" /> : <CountUpStat value={Number(kpis?.runsToday) || 0} format="number" />}
            delta={runsTrend}
            hint={kpis?.targetRuns ? t('dashboard.hero.targetRuns', { total: compactNumber(kpis.targetRuns) }) : undefined}
            flashKey={kpis?.runsToday}
          />
        </div>

        {/* ── full-width 14-day sparkline strip ──────────────────────────── */}
        {spark.length > 1 ? (
          <div className="command-hero__strip">
            <div className="command-hero__strip-head">
              <span className="flex items-center gap-1.5 text-2xs font-semibold tracking-[0.1em] text-muted uppercase">
                {t('dashboard.runVolume')}
              </span>
              <DeltaChip value={seriesDelta(spark, 'volume')} />
            </div>
            <div className="h-11 w-full">
              <Sparkline data={spark} dataKey="volume" color="var(--chart-1)" height={44} strokeWidth={2} ariaLabel={t('dashboard.runVolume')} />
            </div>
            <div className="command-hero__strip-axis mt-1">
              <span dir="auto">{spark[0]?.date}</span>
              <span dir="auto">{spark[spark.length - 1]?.date}</span>
            </div>
          </div>
        ) : null}

        {/* ── live activity ticker: the five most recent real runs ───────── */}
        {activity.length > 0 ? (
          <div className="command-hero__activity" role="log" aria-label={t('dashboard.hero.liveActivity')}>
            <span className="command-hero__activity-label">
              <span className="relative flex h-1.5 w-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                {status === 'open' ? <span className="live-dot absolute inset-0" style={{ color: 'var(--accent)' }} aria-hidden /> : null}
              </span>
              {t('dashboard.hero.liveActivity')}
            </span>
            {activity.slice(0, 5).map((run, index) => (
              <ActivityItem key={run.RunID ?? index} run={run} />
            ))}
            <Link
              to="/runs"
              className="focus-ring ms-auto inline-flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-0.5 text-[11px] font-medium text-brand underline-offset-2 hover:underline"
            >
              {t('dashboard.hero.viewAllRuns')}
              <ArrowRight className="h-3 w-3 rtl:rotate-180" aria-hidden />
            </Link>
          </div>
        ) : null}

        {/* ── shift footer: freshness + attention + navigation ───────────── */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted">
          <span>{generatedAt ? t('app.lastUpdated', { time: relative(generatedAt) }) : t('app.loading')}</span>
          <span className="hidden h-1 w-1 rounded-full bg-border-strong sm:block" aria-hidden />
          <span className={cn('inline-flex items-center gap-1', attention > 0 ? 'text-warning' : 'text-success')}>
            <CheckCircle2 className="h-3 w-3" aria-hidden />
            {attention > 0 ? `${t('dashboard.hero.attention')}: ${compactNumber(attention)}` : t('dashboard.hero.allClear')}
          </span>

          <span className="ms-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" icon={Compass} onClick={onOpenTour} className="h-7 text-[11px]">
              {t('dashboard.startTour')}
            </Button>
            <Link
              to="/capacity"
              className="focus-ring inline-flex h-7 items-center gap-1.5 rounded-xl px-2.5 text-[11px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text"
            >
              <Gauge className="h-3.5 w-3.5" aria-hidden />
              {t('dashboard.hero.viewCapacity')}
            </Link>
          </span>
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
