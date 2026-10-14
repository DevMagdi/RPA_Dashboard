/**
 * Product tour — a permission-aware first-use walkthrough.
 *
 * It introduces the existing on-premises modules only (nothing multi-tenant, no
 * cloud concepts), skips any module the signed-in role cannot open, and can be
 * replayed at any time from the hero or the account menu.  Keyboard users can
 * drive it with ← → and Esc.
 */
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Activity, ArrowLeft, ArrowRight, BadgeCheck, Check, Gauge, ListChecks, Server, ShieldCheck, Sparkles, Workflow } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../../context/AuthProvider'
import { useDirection } from '../../lib/direction'
import { Badge, Button, Modal } from '../ui'

const TOUR_STEPS = [
  /* The decision tier comes first: it is the screen an operator lives in. */
  { key: 'dashboard', path: '/dashboard', permission: 'dashboard:read', icon: ListChecks },
  { key: 'infrastructure', path: '/infrastructure', permission: 'infrastructure:read', icon: Server },
  { key: 'processes', path: '/processes', permission: 'processes:read', icon: Workflow },
  { key: 'runs', path: '/runs', permission: 'runs:read', icon: Activity },
  { key: 'capacity', path: '/capacity', permission: 'capacity:read', icon: Gauge },
  { key: 'lifecycle', path: '/lifecycle', permission: 'lifecycle:read', icon: BadgeCheck },
]

export default function ProductTourDialog({ open, onClose, onFinish }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { has } = useAuth()
  const reduceMotion = useReducedMotion()
  const direction = useDirection()
  const rtl = direction === 'rtl'
  const [index, setIndex] = useState(0)

  // Onboarding is explanatory UI, not a way around the existing RBAC gates.
  const steps = useMemo(() => TOUR_STEPS.filter((step) => has(step.permission) || has('*')), [has])
  const step = steps[index]
  const StepIcon = step?.icon || ShieldCheck

  useEffect(() => {
    if (open) setIndex(0)
  }, [open])

  const close = useCallback(() => onClose?.(), [onClose])

  const finish = useCallback(() => {
    onFinish?.()
    close()
  }, [close, onFinish])

  const openCurrentModule = () => {
    if (!step) return close()
    close()
    navigate(step.path)
  }

  const goNext = () => {
    if (index >= steps.length - 1) finish()
    else setIndex((current) => current + 1)
  }

  const goPrevious = () => setIndex((current) => Math.max(0, current - 1))

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        if (rtl) goPrevious()
        else goNext()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        if (rtl) goNext()
        else goPrevious()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const progress = steps.length ? ((index + 1) / steps.length) * 100 : 0

  return (
    <Modal
      open={open && steps.length > 0}
      onClose={close}
      title={t('dashboard.tour.title')}
      description={t('dashboard.tour.subtitle')}
      size="md"
      closeLabel={t('actions.close')}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={close}>
            {t('dashboard.tour.skip')}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={rtl ? ArrowRight : ArrowLeft}
              disabled={index === 0}
              onClick={goPrevious}
            >
              {t('dashboard.tour.previous')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={index === steps.length - 1 ? Check : rtl ? ArrowLeft : ArrowRight}
              onClick={goNext}
            >
              {index === steps.length - 1 ? t('dashboard.tour.finish') : t('dashboard.tour.next')}
            </Button>
          </div>
        </div>
      }
    >
      {step ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.16em] text-muted uppercase">
              <Sparkles className="h-3.5 w-3.5 text-brand" aria-hidden />
              {t('dashboard.tour.step', { current: index + 1, total: steps.length })}
            </span>
            <Badge tone="brand" size="sm">
              {t('tour.progress', { current: index + 1, total: steps.length })}
            </Badge>
          </div>

          <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={index + 1} aria-label={t('dashboard.tour.progress')}>
            <motion.span
              className="absolute inset-y-0 start-0 rounded-full bg-brand-gradient"
              initial={false}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step.key}
              initial={reduceMotion ? false : { opacity: 0, x: rtl ? -14 : 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, x: rtl ? 14 : -14 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="relative overflow-hidden rounded-2xl border border-border/80 bg-surface-2/60 p-5 sm:p-6"
            >
              <span aria-hidden className="pointer-events-none absolute -end-16 -top-16 h-40 w-40 rounded-full bg-brand-soft blur-2xl" />
              <span className="relative grid h-12 w-12 place-items-center rounded-2xl border border-brand/15 bg-surface text-brand shadow-soft">
                <StepIcon className="h-6 w-6" aria-hidden />
              </span>
              <h3 className="relative mt-4 text-lg font-semibold tracking-[-0.01em] text-text">
                {t(`dashboard.tour.steps.${step.key}.title`)}
              </h3>
              <p className="relative mt-2 max-w-lg text-sm leading-relaxed text-muted text-pretty">
                {t(`dashboard.tour.steps.${step.key}.description`)}
              </p>
              <Button variant="outline" size="sm" className="relative mt-5" onClick={openCurrentModule}>
                {t('dashboard.tour.openModule')}
              </Button>
            </motion.div>
          </AnimatePresence>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
            <span>{t('tour.keyboardHint')}</span>
            <span className="flex items-center gap-1" role="tablist" aria-label={t('dashboard.tour.title')}>
              {steps.map((item, itemIndex) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={itemIndex === index}
                  aria-label={t(`dashboard.tour.steps.${item.key}.title`)}
                  onClick={() => setIndex(itemIndex)}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    itemIndex === index ? 'w-7 bg-brand' : itemIndex < index ? 'w-2.5 bg-brand/60' : 'w-2.5 bg-border'
                  }`}
                />
              ))}
            </span>
          </div>

          <p className="rounded-xl border border-border/70 bg-surface-2/50 p-3 text-[11px] leading-relaxed text-muted">
            {t('dashboard.tour.securityNote')}
          </p>
        </div>
      ) : null}
    </Modal>
  )
}
