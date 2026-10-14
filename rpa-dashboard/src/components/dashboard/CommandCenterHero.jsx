/**
 * Status console — the light "command panel" at the top of the dashboard.
 *
 * Classic BI reading order, three columns on a wide screen:
 *
 *   ┌── verdict band (navy) ───────────────────────────────────────────┐
 *   │ Operational / Degraded / Critical + the factual reasons + CTA     │
 *   └───────────────────────────────────────────────────────────────────┘
 *   ┌── success gauge ──┬── 14-day run volume ──┬── live activity ──────┐
 *
 * Why a light panel instead of the old full-bleed navy hero:
 *  • the identity row it used to carry (product name, live chip, server clock,
 *    on-premises chip, refresh, export) belongs to the page toolbar, and the
 *    dashboard now has one — so the panel no longer needs a headline row;
 *  • a Navy/Indigo/Teal palette reads calmer when the dark navy is reserved
 *    for the *verdict* — the single sentence an operator must not miss —
 *    instead of covering the whole fold.
 *
 * The verdict is computed by `lib/opsSignals.js` from the same payload as the
 * triage queue below, so the panel can never disagree with the queue.
 * Every colour is a design token: no hex is hardcoded in this file.
 */
import { ArrowRight, Activity, Gauge, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { DeltaChip, Sparkline } from '../charts/primitives'
import { useRealtimeStatus } from '../../hooks/ui'
import { durationFromMinutes, percent, relative, runStatusColor } from '../../lib/format'
import { seriesDelta } from '../../lib/stats'
import { Button, Card, Skeleton, cn } from '../ui'

/**
 * Radial success gauge — the ring fills with the success rate (0–100).
 * Pure SVG: no chart runtime on the critical path, and the arc animates via a
 * CSS transition that `prefers-reduced-motion` switches off.
 */
export function SuccessGauge({ value, label, caption }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0))
  const size = 92
  const radius = 38
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - pct / 100)
  return (
    <div className="status-panel__gauge" role="img" aria-label={`${label}: ${percent(pct, 1)}`}>
      <span className="relative grid h-[92px] w-[92px] shrink-0 place-items-center" aria-hidden>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 overflow-visible">
          <g style={{ transform: 'rotate(-90deg)', transformOrigin: '46px 46px' }}>
            <circle cx="46" cy="46" r={radius} fill="none" strokeWidth="8" className="status-panel__gauge-track" />
            <circle
              cx="46"
              cy="46"
              r={radius}
              fill="none"
              strokeWidth="8"
              strokeLinecap="round"
              className="status-panel__gauge-value"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
            />
          </g>
        </svg>
        <span className="text-lg font-bold tabular text-text">{percent(pct, 1)}</span>
      </span>
      <span className="status-panel__gauge-caption">{caption}</span>
    </div>
  )
}

/**
 * Operational verdict — the three-second answer.
 *
 * A time-of-day greeting reads well but tells an on-call operator nothing, so
 * the verdict leads the panel: one sentence (Operational / Degraded / Critical)
 * plus the factual reasons behind it, and a shortcut into the decision queue.
 */
const VERDICT_TONE = {
  critical: { className: 'is-critical', icon: ShieldAlert },
  degraded: { className: 'is-degraded', icon: ShieldAlert },
  healthy: { className: 'is-healthy', icon: ShieldCheck },
}

export function VerdictBanner({ signals, loading, className }) {
  const { t } = useTranslation()
  const verdict = signals?.verdict || 'healthy'
  const tone = VERDICT_TONE[verdict] || VERDICT_TONE.healthy
  const reasons = signals?.reasons || []
  const total = signals?.counts?.total ?? 0

  const jumpToQueue = () => {
    document.getElementById('triage-queue')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className={cn('status-panel__verdict', tone.className, className)}>
      <span className="status-panel__verdict-mark" aria-hidden>
        <tone.icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        {/* A <div>, not a <p>: the loading placeholder (Skeleton) renders a div,
            and a block element may never be nested inside a paragraph. */}
        <div className="status-panel__verdict-label">
          {loading ? <Skeleton className="h-7 w-40" /> : t(`dashboard.verdict.${verdict}`)}
        </div>
        {reasons.length > 0 ? (
          <p className="status-panel__verdict-reasons">
            {reasons.map((reason, index) => (
              <span key={reason.key} className="status-panel__verdict-reason">
                {index > 0 ? <span aria-hidden> · </span> : null}
                <strong className="tabular">{reason.count}</strong> {t(reason.key)}
              </span>
            ))}
          </p>
        ) : (
          <p className="status-panel__verdict-reasons">{t('dashboard.verdict.allClear')}</p>
        )}
      </div>
      {total > 0 ? (
        <Button variant="secondary" size="sm" className="status-panel__verdict-cta" onClick={jumpToQueue}>
          <span className="tabular">{total}</span>
          <span className="hidden sm:inline">{t('dashboard.triage.cta')}</span>
          <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
        </Button>
      ) : null}
    </div>
  )
}

/** Live activity item — one real run, status dot + process + freshness. */
function ActivityItem({ run }) {
  return (
    <span className="status-panel__activity-item">
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

/** Small labelled frame used by the three console cards. */
function ConsoleCard({ label, icon: Icon, aside, children, className, loading }) {
  return (
    <Card className={cn('status-panel__card flex min-w-0 flex-col gap-2 p-3.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-2xs font-semibold tracking-[0.1em] text-muted uppercase">
          {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden /> : null}
          <span className="truncate">{label}</span>
        </span>
        {aside}
      </div>
      {loading ? <Skeleton className="h-16 w-full rounded-xl" /> : children}
    </Card>
  )
}

export default function CommandCenterHero({
  successRate,
  loading = false,
  spark = [],
  savings = [],
  activity = [],
  signals = null,
  className,
}) {
  const { t } = useTranslation()
  const { status } = useRealtimeStatus()
  const rate = Number(successRate) || 0
  const volumeTrend = seriesDelta(spark, 'volume')
  const savingsTrend = seriesDelta(savings, 'bar')

  return (
    <section className={cn('status-panel', className)} aria-label={t('dashboard.commandCenter')}>
      <span aria-hidden className="status-panel__aurora" />
      <span aria-hidden className="status-panel__grid" />

      <div className="status-panel__content">
        {/* ── the verdict: the only dark surface on the page, on purpose ─── */}
        <VerdictBanner signals={signals} loading={loading} />

        {/* ── three evidence cards: gauge · 14-day volume · live activity ── */}
        <div className="status-panel__console">
          <ConsoleCard label={t('dashboard.hero.successGauge')} icon={Gauge} loading={loading}>
            <SuccessGauge value={rate} label={t('dashboard.hero.successGauge')} caption={t('dashboard.hero.gaugeCaption')} />
          </ConsoleCard>

          <ConsoleCard
            label={t('dashboard.runVolume')}
            icon={Activity}
            loading={loading}
            aside={volumeTrend !== null ? <DeltaChip value={volumeTrend} /> : null}
          >
            {spark.length > 1 ? (
              <>
                <span className="block h-12 w-full">
                  <Sparkline
                    data={spark}
                    dataKey="volume"
                    color="var(--chart-1)"
                    height={48}
                    strokeWidth={2}
                    ariaLabel={t('dashboard.runVolume')}
                  />
                </span>
                <span className="status-panel__axis">
                  <span dir="auto">{spark[0]?.date}</span>
                  <span dir="auto">{spark[spark.length - 1]?.date}</span>
                </span>
              </>
            ) : (
              <p className="text-xs text-muted">{t('dashboard.empty.chart')}</p>
            )}
          </ConsoleCard>

          <ConsoleCard
            label={t('dashboard.hero.liveActivity')}
            icon={Activity}
            loading={loading}
            className="status-panel__activity-card"
            aside={
              savingsTrend !== null ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-2xs text-muted">{t('dashboard.costSaved')}</span>
                  <DeltaChip value={savingsTrend} />
                </span>
              ) : null
            }
          >
            {activity.length > 0 ? (
              <div className="status-panel__activity" role="log" aria-label={t('dashboard.hero.liveActivity')}>
                <span className="status-panel__activity-label">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                    {status === 'open' ? <span className="live-dot absolute inset-0" style={{ color: 'var(--accent)' }} aria-hidden /> : null}
                  </span>
                  {t('app.live')}
                </span>
                {activity.slice(0, 5).map((run, index) => (
                  <ActivityItem key={run.RunID ?? index} run={run} />
                ))}
                <Link
                  to="/runs"
                  className="status-panel__link focus-ring ms-auto inline-flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-0.5 text-[11px] font-medium underline-offset-2 hover:underline"
                >
                  {t('dashboard.hero.viewAllRuns')}
                  <ArrowRight className="h-3 w-3 rtl:rotate-180" aria-hidden />
                </Link>
              </div>
            ) : (
              <p className="text-xs text-muted">{t('dashboard.empty.runs')}</p>
            )}
          </ConsoleCard>
        </div>
      </div>
    </section>
  )
}
