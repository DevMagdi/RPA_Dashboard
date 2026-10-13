import { useQuery } from '@tanstack/react-query'
import { Bell, Laptop, Lock, Monitor, Moon, Palette, Sun } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import MfaDialog from '../components/features/MfaDialog'
import { useAuth } from '../context/AuthProvider'
import { useTheme } from '../context/ThemeProvider'
import { useToast } from '../context/ToastProvider'
import { useChangePassword, useRevokeSession, useSessions, useSendTestNotification } from '../hooks/api'
import { applyLanguage } from '../i18n'
import { LANGUAGES } from '../i18n'
import api from '../lib/api'
import { Badge, Button, Card, CardBody, CardHeader, Field, InfoTile, Input, SectionTitle, Select, Switch } from '../components/ui'

function useApiVersion() {
  return useQuery({ queryKey: ['api-version'], queryFn: () => api.get('/api/version'), staleTime: 10 * 60_000 })
}

export default function SettingsPage() {
  const { t, i18n } = useTranslation()
  const { theme, setTheme, density, setDensity } = useTheme()
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

  return (
    <div className="space-y-4">
      <SectionTitle title={t('settings.title')} subtitle={t('settings.subtitle')} />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* -------------------------------------------------- appearance */}
        <Card>
          <CardHeader title={t('settings.appearance')} icon={Palette} />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'light', label: t('settings.themeLight'), icon: Sun },
                { value: 'dark', label: t('settings.themeDark'), icon: Moon },
                { value: 'system', label: t('settings.themeSystem'), icon: Monitor },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTheme(option.value)}
                  className={`focus-ring flex flex-col items-center gap-2 rounded-xl border p-3 text-xs transition ${
                    theme === option.value ? 'border-brand bg-brand-soft text-brand' : 'border-border bg-surface-2 text-muted hover:text-text'
                  }`}
                >
                  <option.icon className="h-5 w-5" aria-hidden />
                  {option.label}
                </button>
              ))}
            </div>

            <Field label={t('settings.density')}>
              <div className="flex items-center gap-3">
                <Switch checked={density === 'compact'} onChange={(value) => setDensity(value ? 'compact' : 'comfortable')} label={t('settings.compact')} />
                <span className="text-xs text-muted">{density === 'compact' ? t('settings.compact') : t('settings.comfortable')}</span>
              </div>
            </Field>

            <Field label={t('settings.language')}>
              <Select value={i18n.language} onChange={(event) => applyLanguage(event.target.value)}>
                {LANGUAGES.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.label}
                  </option>
                ))}
              </Select>
            </Field>
          </CardBody>
        </Card>

        {/* ---------------------------------------------------- security */}
        <Card>
          <CardHeader title={t('settings.security')} icon={Lock} />
          <CardBody className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-2/60 p-3">
              <div>
                <p className="text-sm font-medium text-text">{t('auth.setupMfa')}</p>
                <p className="text-[11px] text-muted">{user?.mfa_enabled ? t('auth.mfaEnabled') : t('auth.setupMfaHint')}</p>
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
            {(sessions.data || []).map((session) => (
              <div key={session.TokenID} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface-2/60 p-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-text">{session.IPAddress}</p>
                  <p className="truncate text-[11px] text-muted">{session.UserAgent}</p>
                  <p className="text-[11px] text-muted">
                    {t('runs.started')}: {session.CreatedAt} · {t('health.lastRun')}: {session.LastUsedAt}
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
            ))}
            {!(sessions.data || []).length ? <p className="text-xs text-muted">{t('common.na')}</p> : null}
          </CardBody>
        </Card>

        {/* ------------------------------------------------------- about */}
        <Card>
          <CardHeader title={t('settings.about')} icon={Bell} />
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <InfoTile label={t('settings.apiVersion')} value={version.data?.api_version || '—'} />
              <InfoTile label={t('app.version', { version: version.data?.version || '—' })} value={version.data?.environment || '—'} />
            </div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(version.data?.features || {}).map(([feature, enabled]) => (
                <Badge key={feature} tone={enabled ? 'success' : 'neutral'}>
                  {feature}
                </Badge>
              ))}
            </div>
            {has('*') ? (
              <Button
                variant="secondary"
                loading={testNotification.isPending}
                onClick={async () => {
                  try {
                    await testNotification.mutateAsync('Info')
                    toast.success(t('settings.about'))
                  } catch (error) {
                    toast.error(t('errors.title'), error.message)
                  }
                }}
              >
                Test notification
              </Button>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <MfaDialog open={mfaOpen} onClose={() => setMfaOpen(false)} />
    </div>
  )
}
