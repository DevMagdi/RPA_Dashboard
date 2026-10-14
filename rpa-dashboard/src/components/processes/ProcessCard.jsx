import { Pencil, Power, Trash2, Workflow } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Card, ProgressBar } from '../ui'
import { compactNumber, currency, percent } from '../../lib/format'

const CRITICALITY_TONE = { Critical: 'danger', High: 'warning', Medium: 'info', Low: 'neutral' }
const ATTAINMENT_TEXT = { success: 'text-success', warning: 'text-warning', danger: 'text-danger' }

function Metric({ label, value, tone = 'text-text' }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/80 bg-surface-2/55 px-3 py-2.5">
      <dt className="truncate text-[10px] font-medium text-muted">{label}</dt>
      <dd className={`mt-1 truncate text-sm font-semibold tabular-nums ${tone}`} dir="auto">
        {value}
      </dd>
    </div>
  )
}

export default function ProcessCard({
  process,
  stats,
  canWrite,
  onEditRoi,
  onEditSla,
  onToggleActive,
  onDelete,
}) {
  const { t } = useTranslation()
  const attainment = Number(stats?.target_attainment_percent || 0)
  const attainmentTone = attainment >= 90 ? 'success' : attainment >= 60 ? 'warning' : 'danger'

  return (
    <Card as="article" hover className="overflow-hidden">
      <header className="flex items-start justify-between gap-3 px-4 py-3.5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-brand/15 bg-brand-soft text-brand">
            <Workflow className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-text" dir="auto" title={process.ProcessName}>
              {process.ProcessName}
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-muted" dir="auto">
              {[process.BotName || process.Provider, process.Department].filter(Boolean).join(' · ') || t('common.unknown')}
            </p>
          </div>
        </div>
        <Badge tone={CRITICALITY_TONE[process.Criticality] || 'neutral'}>
          {process.Criticality || t('common.na')}
        </Badge>
      </header>

      <dl className="grid grid-cols-2 gap-2 px-4 pb-4">
        <Metric label={t('processes.expectedRuns')} value={compactNumber(process.ExpectedRunsPerDay || 0)} />
        <Metric label={t('processes.actualRuns')} value={compactNumber(stats?.actual_runs_per_day || 0)} />
        <Metric label={t('processes.costSaved')} value={currency(stats?.cost_saved || 0)} tone="text-success" />
        <Metric label={t('processes.slaTarget')} value={process.SLATargetMinutes ?? t('common.na')} />
      </dl>

      <div className="px-4 pb-4">
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
          <span className="text-muted">{t('processes.targetAttainment')}</span>
          <span className={`font-semibold tabular-nums ${ATTAINMENT_TEXT[attainmentTone]}`}>
            {percent(attainment)}
          </span>
        </div>
        <ProgressBar
          value={attainment}
          tone={attainmentTone}
          ariaLabel={t('processes.targetAttainment')}
        />
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/80 px-4 py-3">
        <Badge tone={process.IsActive ? 'success' : 'neutral'} dot>
          {process.IsActive ? t('processes.active') : t('processes.inactive')}
        </Badge>
        {canWrite ? (
          <div className="flex items-center gap-1">
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => onEditRoi(process)}
              aria-label={t('processes.editRoi')}
              title={t('processes.editRoi')}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => onEditSla(process)}
              aria-label={t('processes.editSla')}
              title={t('processes.editSla')}
            >
              <span className="text-[10px] font-semibold">SLA</span>
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => onToggleActive(process)}
              aria-label={process.IsActive ? t('processes.deactivate') : t('processes.activate')}
              title={process.IsActive ? t('processes.deactivate') : t('processes.activate')}
            >
              <Power className={`h-3.5 w-3.5 ${process.IsActive ? 'text-success' : 'text-muted'}`} aria-hidden />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => onDelete(process)}
              aria-label={t('processes.delete')}
              title={t('processes.delete')}
            >
              <Trash2 className="h-3.5 w-3.5 text-danger" aria-hidden />
            </Button>
          </div>
        ) : null}
      </footer>
    </Card>
  )
}
