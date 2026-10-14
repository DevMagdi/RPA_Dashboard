/**
 * Triage queue — "what needs a decision right now".
 *
 * This is the component the dashboard was missing. The payload always carried
 * failed runs, SLA breaches, capacity recommendations and open alerts, but they
 * were scattered (or absent) so an operator had to visit four pages to find out
 * whether anything was wrong. Here they are merged by `lib/opsSignals.js`,
 * ranked by severity, and every row carries the action that resolves it.
 *
 * Deliberately dependency-light (no recharts): it sits above the fold and must
 * paint in the first frame, next to the hero.
 */
import { motion } from 'framer-motion'
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  ChevronDown,
  Gauge,
  ServerCog,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { OPS_THRESHOLDS } from '../../lib/opsSignals'
import { compactNumber, relative } from '../../lib/format'
import { Badge, Button, Card, EmptyState, Skeleton, cn } from '../ui'

const SEVERITY_META = {
  critical: { tone: 'danger', icon: ShieldAlert, strip: 'var(--danger)' },
  high: { tone: 'danger', icon: XCircle, strip: 'var(--danger)' },
  warning: { tone: 'warning', icon: ShieldAlert, strip: 'var(--warning)' },
  info: { tone: 'info', icon: BellRing, strip: 'var(--info)' },
}

const KIND_ICON = {
  sla: ShieldAlert,
  failure: XCircle,
  capacity: Gauge,
  runner: ServerCog,
  alert: BellRing,
}

function TriageRow({ item, busy, onAcknowledge, onDecide }) {
  const { t } = useTranslation()
  const meta = SEVERITY_META[item.severity] || SEVERITY_META.info
  const KindIcon = KIND_ICON[item.kind] || meta.icon

  return (
    <div className="triage-row" data-severity={item.severity}>
      <span aria-hidden className="triage-row__stripe" style={{ background: meta.strip }} />
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-xl"
        style={{ background: `color-mix(in srgb, ${meta.strip} 12%, transparent)`, color: meta.strip }}
      >
        <KindIcon className="h-4 w-4" aria-hidden />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-sm font-semibold text-text" dir="auto">
            {/* Server-authored headlines (capacity recommendations, alerts) are
                rendered verbatim; everything else is localized here. */}
            {item.serverTitle || t(item.titleKey, item.titleParams)}
          </h3>
          {item.criticality ? (
            <Badge tone={item.criticality === 'Critical' ? 'danger' : 'neutral'} size="sm">
              {item.criticality}
            </Badge>
          ) : null}
          {item.alert ? (
            <Badge tone={meta.tone} size="sm" dot>
              {t('dashboard.triage.alertBadge', { count: item.alert.occurrences || 1 })}
            </Badge>
          ) : null}
        </div>

        <p className="mt-0.5 text-xs text-muted" dir="auto">
          {item.detail ? (
            <>
              {item.detail}
              {item.detailNoteKey ? (
                <span className="text-text-soft"> · {t(item.detailNoteKey, item.detailNoteParams)}</span>
              ) : null}
              <span aria-hidden> · </span>
            </>
          ) : null}
          {t(item.evidenceKey, item.evidenceParams)}
          {item.occurredAt ? (
            <>
              <span aria-hidden> · </span>
              <time dateTime={item.occurredAt}>{relative(item.occurredAt)}</time>
            </>
          ) : null}
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        {item.alert ? (
          <Button
            size="xs"
            variant="secondary"
            loading={busy === `alert:${item.alert.id}`}
            onClick={() => onAcknowledge?.(item.alert.id)}
          >
            {t('alerts.acknowledge')}
          </Button>
        ) : null}
        {item.recommendationId ? (
          <Button
            size="xs"
            variant="outline"
            loading={busy === `recommendation:${item.recommendationId}`}
            onClick={() => onDecide?.(item)}
          >
            {t('actions.requestCapacity')}
          </Button>
        ) : null}
        {item.link ? (
          <Link
            to={item.link.to}
            className="focus-ring inline-flex h-7 items-center gap-1 rounded-xl px-2.5 text-xs font-medium text-brand transition-colors hover:bg-brand-soft"
          >
            {t(item.link.labelKey)}
            <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
          </Link>
        ) : null}
      </div>
    </div>
  )
}

export default function TriageQueue({ signals, loading = false, busy = null, onAcknowledge, onDecide, className }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const items = signals?.items || []
  const counts = signals?.counts || { critical: 0, high: 0, warning: 0, info: 0, total: 0 }
  const limit = expanded ? items.length : Math.min(items.length, OPS_THRESHOLDS.visibleItems)

  return (
    <Card className={cn('overflow-hidden', className)}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-lg"
            style={{
              background: counts.critical ? 'var(--danger-soft)' : counts.total ? 'var(--warning-soft)' : 'var(--success-soft)',
              color: counts.critical ? 'var(--danger)' : counts.total ? 'var(--warning)' : 'var(--success)',
            }}
          >
            {counts.total ? <ShieldAlert className="h-4 w-4" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
          </span>
          <h2 className="text-sm font-semibold text-text">{t('dashboard.triage.title')}</h2>
          <span className="text-xs text-muted">{t('dashboard.triage.subtitle')}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {counts.critical ? <Badge tone="danger" size="sm">{t('dashboard.triage.criticalCount', { count: counts.critical })}</Badge> : null}
          {counts.high ? <Badge tone="danger" size="sm">{t('dashboard.triage.highCount', { count: counts.high })}</Badge> : null}
          {counts.warning ? <Badge tone="warning" size="sm">{t('dashboard.triage.warningCount', { count: counts.warning })}</Badge> : null}
          <Link
            to="/alerts"
            className="focus-ring inline-flex h-7 items-center gap-1 rounded-xl px-2.5 text-xs font-medium text-brand transition-colors hover:bg-brand-soft"
          >
            {t('nav.alerts')}
            <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
          </Link>
        </div>
      </header>

      {loading && items.length === 0 ? (
        <ul className="divide-y divide-border/70" aria-busy="true">
          {[0, 1, 2].map((index) => (
            <li key={index} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="h-8 w-8 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
              <Skeleton className="h-7 w-24 rounded-xl" />
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <EmptyState
          tone="success"
          icon={CheckCircle2}
          title={t('dashboard.triage.allClear')}
          description={t('dashboard.triage.allClearHint', {
            runners: compactNumber(signals?.totals?.onlineRunners ?? 0),
            queued: compactNumber(signals?.totals?.queuedItems ?? 0),
          })}
          className="py-8"
          compact
        />
      ) : (
        <>
          <ul className="divide-y divide-border/70">
            {items.slice(0, limit).map((item, index) => (
              <motion.li
                key={item.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.26, delay: Math.min(index * 0.04, 0.24), ease: [0.22, 1, 0.36, 1] }}
                className="list-none"
              >
                <TriageRow item={item} busy={busy} onAcknowledge={onAcknowledge} onDecide={onDecide} />
              </motion.li>
            ))}
          </ul>
          {items.length > OPS_THRESHOLDS.visibleItems ? (
            <div className="border-t border-border/70 px-4 py-2 text-center">
              <Button
                size="xs"
                variant="ghost"
                icon={ChevronDown}
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
              >
                {expanded
                  ? t('dashboard.triage.showLess')
                  : t('dashboard.triage.showMore', { count: items.length - OPS_THRESHOLDS.visibleItems })}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Card>
  )
}
