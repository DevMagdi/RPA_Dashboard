import { motion, useReducedMotion } from 'framer-motion'
import { Activity, Bot, CheckCircle2, Clock3, Sparkles, Workflow } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { localeTag } from '../../i18n'
import { compactNumber } from '../../lib/format'
import { Button, cx } from '../ui'

function formatSuccess(value) {
  return `${new Intl.NumberFormat(localeTag(), { maximumFractionDigits: 1 }).format(Number(value) || 0)}%`
}

/** A high-signal overview header: brand promise, live context and three operational KPIs. */
export default function CommandCenterHero({ kpis, successRate, generatedAt, loading, refreshing, onRefresh, onOpenTour, actions }) {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const running = Number(kpis?.runningNow || 0)
  const updatedAt = generatedAt
    ? new Intl.DateTimeFormat(localeTag(), { hour: '2-digit', minute: '2-digit' }).format(new Date(generatedAt))
    : '—'

  const stats = [
    { key: 'running', label: t('dashboard.hero.running'), value: loading ? '—' : compactNumber(running), icon: Activity, tone: 'cyan' },
    { key: 'processes', label: t('dashboard.hero.processes'), value: loading ? '—' : compactNumber(kpis?.totalProcedures ?? 0), icon: Workflow, tone: 'violet' },
    { key: 'success', label: t('dashboard.hero.successRate'), value: loading ? '—' : formatSuccess(successRate), icon: CheckCircle2, tone: 'green' },
  ]

  return (
    <motion.section
      aria-labelledby="command-center-title"
      className="command-hero"
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="command-hero__glow command-hero__glow--primary" aria-hidden="true" />
      <div className="command-hero__glow command-hero__glow--accent" aria-hidden="true" />
      <div className="command-hero__grid" aria-hidden="true" />

      <div className="command-hero__content">
        <div className="command-hero__copy">
          <div className="flex flex-wrap items-center gap-2">
            <span className="command-hero__eyebrow">
              <span className="command-hero__eyebrow-dot" />
              {t('dashboard.privateInstallation')}
            </span>
            <span className="command-hero__updated">
              <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
              {t('dashboard.hero.lastUpdated', { time: updatedAt })}
            </span>
          </div>

          <h1 id="command-center-title" className="command-hero__title">
            {t('dashboard.commandCenter')}
          </h1>
          <p className="command-hero__subtitle">{t('dashboard.commandCenterSubtitle')}</p>

          <div className="command-hero__stats" aria-label={t('dashboard.hero.snapshot')}>
            {stats.map(({ key, label, value, icon: Icon, tone }, index) => (
              <motion.div
                key={key}
                className="command-hero__stat"
                initial={reduceMotion ? false : { opacity: 0, y: 7 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.26, delay: reduceMotion ? 0 : 0.08 + index * 0.05 }}
              >
                <span className={cx('command-hero__stat-icon', `command-hero__stat-icon--${tone}`)}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="command-hero__stat-label">{label}</span>
                  <span className="command-hero__stat-value" dir="ltr">{value}</span>
                </span>
              </motion.div>
            ))}
          </div>

          <div className="command-hero__actions">
            <Button variant="secondary" size="sm" icon={Sparkles} onClick={onOpenTour}>
              {t('dashboard.startTour')}
            </Button>
            <Button variant="ghost" size="sm" icon={Activity} loading={refreshing} onClick={onRefresh} className="command-hero__refresh">
              {t('actions.refresh')}
            </Button>
            {actions}
          </div>
        </div>

        <div className="command-hero__visual" aria-hidden="true">
          <div className="command-orbit command-orbit--outer" />
          <div className="command-orbit command-orbit--inner" />
          <div className="command-orbit__node command-orbit__node--one" />
          <div className="command-orbit__node command-orbit__node--two" />
          <div className="command-orbit__node command-orbit__node--three" />
          <motion.div
            className="command-core"
            animate={reduceMotion ? undefined : { y: [0, -5, 0] }}
            transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
          >
            <span className="command-core__halo" />
            <span className="command-core__icon"><Bot className="h-8 w-8" /></span>
            <span className="command-core__signal" />
          </motion.div>
          <span className="command-hero__visual-label">{t('dashboard.hero.controlPlane')}</span>
        </div>
      </div>
    </motion.section>
  )
}
