/**
 * Getting-started checklist.
 *
 * A bank does not roll out an automation CoE in a day: machines must be
 * enrolled, process ownership and manual cost captured, the capacity advisor
 * reviewed and the governance loop started.  This card turns that rollout into
 * four visible steps with real links, remembers progress per workstation and
 * disappears for good once dismissed.
 */
import { CheckCircle2, Circle, X } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useAuth } from '../../context/AuthProvider'
import { usePersistentState } from '../../hooks/ui'
import { Badge, Button, Card, cn } from '../ui'

const STEPS = [
  { key: 'stepConnect', to: '/infrastructure', permission: 'infrastructure:read' },
  { key: 'stepProcesses', to: '/processes', permission: 'processes:read' },
  { key: 'stepCapacity', to: '/capacity', permission: 'capacity:read' },
  { key: 'stepReview', to: '/lifecycle', permission: 'lifecycle:read' },
]

export default function OnboardingChecklist({ done = {}, className }) {
  const { t } = useTranslation()
  const { has } = useAuth()
  const [hidden, setHidden] = usePersistentState('onboarding.checklist.hidden', false)

  const steps = useMemo(() => STEPS.filter((step) => has(step.permission) || has('*')), [has])
  const completed = steps.filter((step) => done[step.key]).length
  const progress = steps.length ? (completed / steps.length) * 100 : 0

  if (hidden || steps.length === 0) return null

  return (
    <Card className={cn('relative overflow-hidden', className)}>
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/40 to-transparent" />
      <header className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text">{t('onboarding.checklistTitle')}</h2>
          <p className="mt-0.5 text-xs text-muted">{t('onboarding.checklistSubtitle')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={completed === steps.length ? 'success' : 'brand'} size="sm">
            {t('onboarding.progress', { done: completed, total: steps.length })}
          </Badge>
          <button
            type="button"
            onClick={() => setHidden(true)}
            aria-label={t('onboarding.hideChecklist')}
            className="focus-ring grid h-7 w-7 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <X className="h-3.5 w-3.5"  aria-hidden/>
          </button>
        </div>
      </header>

      <div className="h-1 w-full bg-surface-3">
        <div className="h-full rounded-full bg-brand-gradient transition-[width] duration-500" style={{ width: `${progress}%` }} />
      </div>

      <ul className="divide-y divide-border/70">
        {steps.map((step) => {
          const isDone = Boolean(done[step.key])
          return (
            <li key={step.key} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/50">
              {isDone ? (
                <CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-success" aria-hidden />
              ) : (
                <Circle className="h-4.5 w-4.5 shrink-0 text-border-strong" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className={cn('truncate text-sm', isDone ? 'text-muted line-through' : 'font-medium text-text')}>
                  {t(`onboarding.${step.key}`)}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-muted">{t(`onboarding.${step.key}Hint`)}</p>
              </div>
              {isDone ? (
                <Badge tone="success" size="sm">
                  {t('onboarding.done')}
                </Badge>
              ) : (
                <Button asChild variant="ghost" size="xs" className="shrink-0">
                  <Link to={step.to}>{t('onboarding.go')}</Link>
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
