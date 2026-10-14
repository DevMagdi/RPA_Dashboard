import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Activity, ArrowLeft, ArrowRight, Check, Gauge, Server, ShieldCheck, Workflow } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../../context/AuthProvider'
import { isRtl } from '../../i18n'
import { Button, Modal } from '../ui'

const TOUR_STEPS = [
  { key: 'infrastructure', path: '/infrastructure', permission: 'infrastructure:read', icon: Server },
  { key: 'processes', path: '/processes', permission: 'processes:read', icon: Workflow },
  { key: 'runs', path: '/runs', permission: 'runs:read', icon: Activity },
  { key: 'capacity', path: '/capacity', permission: 'capacity:read', icon: Gauge },
  { key: 'lifecycle', path: '/lifecycle', permission: 'lifecycle:read', icon: ShieldCheck },
]

/** A permission-aware first-use walkthrough. It introduces the existing on-prem modules only. */
export default function ProductTourDialog({ open, onClose }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { has } = useAuth()
  const reduceMotion = useReducedMotion()
  const [index, setIndex] = useState(0)

  const steps = useMemo(() => TOUR_STEPS.filter((step) => has(step.permission) || has('*')), [has])
  const step = steps[index]
  const StepIcon = step?.icon || ShieldCheck
  const rtl = isRtl()

  useEffect(() => {
    if (open) setIndex(0)
  }, [open])

  const close = useCallback(() => onClose?.(), [onClose])
  const openCurrentModule = () => {
    if (!step) return close()
    close()
    navigate(step.path)
  }

  const goNext = () => {
    if (index >= steps.length - 1) close()
    else setIndex((current) => current + 1)
  }

  const goPrevious = () => setIndex((current) => Math.max(0, current - 1))

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
          <Button variant="ghost" size="sm" onClick={close}>{t('dashboard.tour.skip')}</Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" icon={rtl ? ArrowRight : ArrowLeft} disabled={index === 0} onClick={goPrevious}>
              {t('dashboard.tour.previous')}
            </Button>
            <Button variant="primary" size="sm" icon={index === steps.length - 1 ? Check : rtl ? ArrowLeft : ArrowRight} onClick={goNext}>
              {index === steps.length - 1 ? t('dashboard.tour.finish') : t('dashboard.tour.next')}
            </Button>
          </div>
        </div>
      }
    >
      {step ? (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              {t('dashboard.tour.step', { current: index + 1, total: steps.length })}
            </span>
            <div className="flex items-center gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={index + 1} aria-label={t('dashboard.tour.progress')}>
              {steps.map((item, itemIndex) => (
                <span
                  key={item.key}
                  className={`h-1.5 rounded-full transition-all duration-300 ${itemIndex === index ? 'w-8 bg-brand' : itemIndex < index ? 'w-3 bg-brand/60' : 'w-3 bg-border'}`}
                />
              ))}
            </div>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step.key}
              initial={reduceMotion ? false : { opacity: 0, x: rtl ? -10 : 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, x: rtl ? 10 : -10 }}
              transition={{ duration: 0.2 }}
              className="rounded-2xl border border-border bg-surface-2/70 p-5 sm:p-6"
            >
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand shadow-soft">
                <StepIcon className="h-6 w-6" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-lg font-semibold tracking-tight text-text">{t(`dashboard.tour.steps.${step.key}.title`)}</h3>
              <p className="mt-2 max-w-lg text-sm leading-6 text-muted">{t(`dashboard.tour.steps.${step.key}.description`)}</p>
              <Button variant="outline" size="sm" className="mt-5" onClick={openCurrentModule}>
                {t('dashboard.tour.openModule')}
              </Button>
            </motion.div>
          </AnimatePresence>

          <p className="text-xs leading-5 text-muted">{t('dashboard.tour.securityNote')}</p>
        </div>
      ) : null}
    </Modal>
  )
}
