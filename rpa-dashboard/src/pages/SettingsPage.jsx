/**
 * Settings — appearance, language, security, sessions and about.
 *
 * This page is also the reference implementation of the bilingual experience:
 * switching the language here re-orients the entire console (direction, fonts,
 * number/date formats and chart axes) without a reload, and the reduce-motion
 * switch is honoured by every animation through a single `data-motion`
 * attribute on `<html>`.
 */
import { useQuery } from '@tanstack/react-query'
import { Bell, Building2, Check, Keyboard, Laptop, Lock, Monitor, Moon, Palette, RotateCcw, Sparkles, Sun, Type } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import MfaDialog from '../components/features/MfaDialog'
import { useAuth } from '../context/AuthProvider'
import { useTheme } from '../context/ThemeProvider'
import { useToast } from '../context/ToastProvider'
import { useChangePassword, useRevokeSession, useSessions, useSendTestNotification } from '../hooks/api'
import { applyLanguage, LANGUAGES } from '../i18n'
import api from '../lib/api'
import { resetOnboardingProgress } from '../lib/onboarding'
import { relative } from '../lib/format'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  InfoTile,
  Input,
  Kbd,
  SectionTitle,
  SegmentedControl,
  Select,
  Skeleton,
  Switch,
  cn,
} from '../components/ui'

function useApiVersion() {
  return useQuery({ queryKey: ['api-version'], queryFn: () => api.get('/api/version'), staleTime: 10 * 60_000 })
}

const FEATURE_LABELS = {
  mfa: 'MFA',
  single_organization: 'Single organization',
  deployment: 'Deployment',
  multi_vendor: 'Multi-vendor',
  alerting: 'Alerting',
  capacity_advisor: 'Capacity advisor',
  realtime: 'Realtime',
  exports: 'Exports',
  notifications: 'Notifications',
  lifecycle_governance: 'Lifecycle governance',
  metrics: 'Metrics',
}

export default function SettingsPage() {
  const { t, i18n } = useTranslation()
  const { theme, setTheme, density, setDensity, motion, setMotion } = useTheme()
  const { user, has } = useAuth()
  const toast = useToast()

  const [mfaOpen, setMfaOpen] = useState(false)
  const sessions = useSessions()
  const revoke = useRevokeSession()
  const changePassword = useChangePassword()
  const testNotification = useSendTestNotification()
  const version = useApiVersion()

  const onSubmitPassword = async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (form.get('new_password') !== form.get('confirm_password')) {
      toast.error(t('errors.title'), t('validation.required'))
      return
    }
    try {
      await changePassword.mutateAsync({
        current_password: form.get('current_password'),
        new_password: form.get('new_password'),
      })
      toast.success(t('users.passwordChanged'))
      event.currentTarget.reset()
    } catch (error) {
      toast.error(t('errors.title'), error.message)
    }
  }

  const themeOptions = [
    { value: 'light', label: t('settings.themeLight'), icon: Sun },
    { value: 'dark', label: t('settings.themeDark'), icon: Moon },
    { value: 'system', label: t('settings.themeSystem'), icon: Monitor },
  ]

  return (
    <div className="space-y-4">
      <SectionTitle title={t('settings.title')} subtitle={t('settings.subtitle')} icon={Sparkles} />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* -------------------------------------------------- appearance */}
        <Card>
          <CardHeader title={t('settings.appearance')} subtitle={t('settings.appearanceHint')} icon={Palette} />
          <CardBody className="space-y-5">
            <div role="radiogroup" aria-label={t('settings.appearance')} className="grid grid-cols-3 gap-2">
              {themeOptions.map((option) => {
                const active = theme === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setTheme(option.value)}
                    className={cn(
                      'focus-ring relative flex flex-col items-center gap-2 rounded-xl border p-3 text-xs font-medium transition-all duration-200',
                      active ? 'border-brand/50 bg-brand-soft text-brand shadow-soft' : 'border-border bg-surface-2/60 text-muted hover:border-border-strong hover:text-text',
                    )}
                  >
                    {active ? <Check className="absolute end-2 top-2 h-3 w-3" aria-hidden /> : null}
                    <option.icon className="h-5 w-5" aria-hidden />
                    {option.label}
                  </button>
                )
              })}
            </div>

            <Field label={t('settings.density')} hint={t('settings.densityHint')}>
              <SegmentedControl
                value={density}
                onValueChange={setDensity}
                items={[
                  { value: 'comfortable', label: t('settings.comfortable') },
                  { value: 'compact', label: t('settings.compact') },
                ]}
              />
            </Field>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-border/80 bg-surface-2/50 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-text">{t('settings.reduceMotion')}</p>
                <p className="text-[11px] leading-relaxed text-muted">{t('settings.reduceMotionHint')}</p>
              </div>
              <Switch checked={motion === 'reduced'} onChange={(value) => setMotion(value ? 'reduced' : 'full')} />
            </div>

            <Field label={t('settings.language')} hint={t('settings.languageHint')}>
              <Select value={i18n.language} onChange={(event) => applyLanguage(event.target.value)}>
                {LANGUAGES.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.nativeLabel} — {language.dir.toUpperCase()}
                  </option>
                ))}
              </Select>
            </Field>
          </CardBody>
        </Card>

        {/* ---------------------------------------------------- security */}
        <Card>
          <CardHeader title={t('settings.security')} icon={Lock} />
          <CardBody className="space-y-5">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border/80 bg-surface-2/50 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-text">{t('auth.setupMfa')}</p>
                <p className="text-[11px] leading-relaxed text-muted">{user?.mfa_enabled ? t('auth.mfaEnabled') : t('auth.setupMfaHint')}</p>
              </div>
              <Badge tone={user?.mfa_enabled ? 'success' : 'warning'} dot>
                {user?.mfa_enabled ? t('common.yes') : t('common.no')}
              </Badge>
            </div>
            <Button variant={user?.mfa_enabled ? 'secondary' : 'primary'} onClick={() => setMfaOpen(true)}>
              {user?.mfa_enabled ? t('auth.disableMfa') : t('auth.setupMfa')}
            </Button>

            <form onSubmit={onSubmitPassword} className="space-y-3">
              <Field label={t('users.currentPassword')} required>
                <Input name="current_password" type="password" autoComplete="current-password" required />
              </Field>
              <Field label={t('users.newPassword')} required hint={t('validation.minLength', { count: 12 })}>
                <Input name="new_password" type="password" autoComplete="new-password" minLength={12} required />
              </Field>
              <Field label={t('actions.confirm')} required>
                <Input name="confirm_password" type="password" autoComplete="new-password" minLength={12} required />
              </Field>
              <Button type="submit" loading={changePassword.isPending}>
                {t('users.changePassword')}
              </Button>
            </form>
          </CardBody>
        </Card>

        {/* ---------------------------------------------------- sessions */}
        <Card>
          <CardHeader title={t('settings.sessions')} subtitle={t('settings.sessionsHint')} icon={Laptop} />
          <CardBody className="space-y-2">
            {sessions.isLoading ? (
              <>
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </>
            ) : (sessions.data || []).length === 0 ? (
              <EmptyState title={t('common.na')} className="py-6" compact />
            ) : (
              (sessions.data || []).map((session) => (
                <div
                  key={session.TokenID}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-surface-2/50 p-3 transition-colors hover:border-brand/25"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-text" dir="ltr">
                      {session.IPAddress}
                    </p>
                    <p className="truncate text-[11px] text-muted" dir="auto">
                      {session.UserAgent}
                    </p>
                    <p className="text-[11px] text-muted">
                      {t('runs.started')}: {relative(session.CreatedAt)} · {t('health.lastRun')}: {relative(session.LastUsedAt)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={revoke.isPending}
                    onClick={async () => {
                      try {
                        await revoke.mutateAsync(session.TokenID)
                        toast.success(t('users.revokeSession'))
                      } catch (error) {
                        toast.error(t('errors.title'), error.message)
                      }
                    }}
                  >
                    {t('users.revokeSession')}
                  </Button>
                </div>
              ))
            )}
          </CardBody>
        </Card>

        {/* ------------------------------------------------- shortcuts */}
        <Card>
          <CardHeader title={t('settings.shortcuts')} subtitle={t('settings.shortcutsHint')} icon={Keyboard} />
          <CardBody className="space-y-2">
            {[
              { keys: ['Ctrl', 'K'], label: t('shortcuts.palette') },
              { keys: ['?'], label: t('shortcuts.help') },
              { keys: ['Ctrl', 'Shift', 'L'], label: t('shortcuts.language') },
              { keys: ['Ctrl', 'J'], label: t('shortcuts.theme') },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-surface-2">
                <span className="text-sm text-text-soft">{row.label}</span>
                <span className="flex items-center gap-1">
                  {row.keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </span>
              </div>
            ))}
          </CardBody>
        </Card>

        {/* ------------------------------------------------------- about */}
        <Card className="lg:col-span-2">
          <CardHeader title={t('settings.about')} icon={Bell} />
          <CardBody className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <InfoTile label={t('settings.apiVersion')} value={version.data?.api_version || '—'} mono />
              <InfoTile label={t('app.version', { version: '' }).trim()} value={version.data?.version || '—'} />
              <InfoTile label={t('app.environment')} value={version.data?.environment || '—'} />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(version.data?.features && Object.entries(version.data.features)) ? (
                Object.entries(version.data.features).map(([feature, enabled]) => (
                  <Badge key={feature} tone={enabled ? 'success' : 'neutral'} size="sm">
                    {FEATURE_LABELS[feature] || feature}: {typeof enabled === 'boolean' ? (enabled ? t('common.yes') : t('common.no')) : String(enabled)}
                  </Badge>
                ))
              ) : (
                <Skeleton className="h-6 w-64" />
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-4">
              <Button
                variant="secondary"
                size="sm"
                icon={RotateCcw}
                onClick={() => {
                  resetOnboardingProgress()
                  toast.success(t('actions.restartTour'), t('onboarding.checklistTitle'))
                }}
              >
                {t('actions.restartTour')}
              </Button>
              {has('*') ? (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={testNotification.isPending}
                  onClick={async () => {
                    try {
                      await testNotification.mutateAsync('Info')
                      toast.success(t('fields.testNotification'))
                    } catch (error) {
                      toast.error(t('errors.title'), error.message)
                    }
                  }}
                >
                  {t('fields.testNotification')}
                </Button>
              ) : null}
              <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
                <Building2 className="h-3 w-3" aria-hidden />
                {t('organization.singleOrgNotice')}
              </span>
            </div>
          </CardBody>
        </Card>
      </div>

      <MfaDialog open={mfaOpen} onClose={() => setMfaOpen(false)} />
    </div>
  )
}

export { Type }
