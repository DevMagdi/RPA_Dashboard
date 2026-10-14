import { motion } from 'framer-motion'
import { ArrowLeft, Bot, Languages, Lock, Moon, ShieldCheck, Sun, User } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation } from 'react-router-dom'

import { useAuth } from '../context/AuthProvider'
import { useBranding } from '../context/BrandingProvider'
import { useTheme } from '../context/ThemeProvider'
import { applyLanguage } from '../i18n'
import { Button, Field, Input, Notice } from '../components/ui'

/** Sign-in screen (password → optional MFA), bilingual (Arabic/English). */
export default function LoginPage() {
  const { t, i18n } = useTranslation()
  const location = useLocation()
  const { login, verifyMfa, cancelMfa, isAuthenticated, mfaChallenge, lastError, clearError } = useAuth()
  const { branding, companyName } = useBranding()
  const { toggleTheme, isDark } = useTheme()

  const [form, setForm] = useState({ username: '', password: '' })
  const [code, setCode] = useState('')
  const [useBackup, setUseBackup] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (lastError) setError(lastError)
  }, [lastError])

  if (isAuthenticated) {
    const target = location.state?.from?.pathname || '/'
    return <Navigate to={target} replace />
  }

  const onSubmit = async (event) => {
    event.preventDefault()
    setError(null)
    clearError?.()
    setSubmitting(true)
    try {
      await login(form)
    } catch (err) {
      setError(err)
    } finally {
      setSubmitting(false)
    }
  }

  const onVerify = async (event) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await verifyMfa(useBackup ? code.trim().toUpperCase() : code.trim())
    } catch (err) {
      setError(err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel — hidden on small screens to keep the form above the fold */}
      <aside className="relative hidden overflow-hidden bg-brand text-brand-fg lg:block">
        <div className="absolute inset-0 opacity-30" style={{ background: 'radial-gradient(circle at 20% 20%, var(--accent), transparent 45%)' }} />
        <div className="relative flex h-full flex-col justify-between p-10">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15 backdrop-blur">
              <Bot className="h-6 w-6" aria-hidden />
            </span>
            <div>
              <p className="text-lg font-semibold">{companyName}</p>
              <p className="text-xs text-white/70">{t('app.tagline')}</p>
            </div>
          </div>

          <div className="space-y-6">
            <h1 className="max-w-md text-3xl font-semibold leading-tight">{t('auth.welcome')}</h1>
            <ul className="space-y-3 text-sm text-white/80">
              {[
                ['dashboard.title', 'dashboard.subtitle'],
                ['capacity.title', 'capacity.subtitle'],
                ['lifecycle.title', 'lifecycle.subtitle'],
              ].map(([title, subtitle]) => (
                <li key={title} className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-4 w-4 text-white/70" aria-hidden />
                  <span>
                    <span className="block font-medium text-white">{t(title)}</span>
                    <span className="block text-xs text-white/60">{t(subtitle)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-white/60">
            {t('app.poweredBy')} · {t('app.version', { version: branding.api_version || '4.0.0' })}
          </p>
        </div>
      </aside>

      <main className="flex items-center justify-center px-5 py-10">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-sm"
        >
          <div className="mb-6 flex items-center justify-between">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-brand-fg lg:hidden">
              <Bot className="h-5 w-5" aria-hidden />
            </span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={() => applyLanguage(i18n.language === 'ar' ? 'en' : 'ar')} aria-label={t('actions.changeLanguage')}>
                <Languages className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={t('actions.toggleTheme')}>
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {mfaChallenge ? (
            <form onSubmit={onVerify} className="space-y-4" noValidate>
              <header>
                <h1 className="text-xl font-semibold text-text">{t('auth.mfaTitle')}</h1>
                <p className="mt-1 text-sm text-muted">{t('auth.mfaSubtitle')}</p>
              </header>

              {error ? <Notice tone="danger" title={error.message} /> : null}

              <Field label={useBackup ? t('auth.backupCode') : t('auth.mfaCode')} required>
                <Input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  inputMode={useBackup ? 'text' : 'numeric'}
                  autoComplete="one-time-code"
                  autoFocus
                  placeholder={useBackup ? 'XXXX-XXXX' : '000000'}
                  className="text-center font-mono text-lg tracking-[0.35em]"
                />
              </Field>

              <Button type="submit" variant="primary" className="w-full justify-center" loading={submitting} disabled={code.length < 4}>
                {t('auth.verify')}
              </Button>

              <div className="flex items-center justify-between text-xs">
                <button type="button" className="text-brand hover:underline" onClick={() => setUseBackup((value) => !value)}>
                  {useBackup ? t('auth.mfaUseTotp') : t('auth.mfaUseBackup')}
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-muted hover:text-text"
                  onClick={() => {
                    cancelMfa()
                    setCode('')
                  }}
                >
                  <ArrowLeft className="h-3 w-3 rtl:rotate-180" aria-hidden />
                  {t('auth.backToLogin')}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <header>
                <h1 className="text-xl font-semibold text-text">{t('auth.welcome')}</h1>
                <p className="mt-1 text-sm text-muted">{t('auth.subtitle')}</p>
              </header>

              {error ? <Notice tone="danger" title={error.message} /> : null}

              <Field label={t('auth.username')} required htmlFor="username">
                <div className="relative">
                  <User className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                  <Input
                    id="username"
                    className="ps-9"
                    value={form.username}
                    onChange={(event) => setForm({ ...form, username: event.target.value })}
                    autoComplete="username"
                    autoFocus
                    required
                  />
                </div>
              </Field>

              <Field label={t('auth.password')} required htmlFor="password">
                <div className="relative">
                  <Lock className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                  <Input
                    id="password"
                    type="password"
                    className="ps-9"
                    value={form.password}
                    onChange={(event) => setForm({ ...form, password: event.target.value })}
                    autoComplete="current-password"
                    required
                  />
                </div>
              </Field>



              <Button type="submit" variant="primary" className="w-full justify-center" loading={submitting}>
                {submitting ? t('auth.signingIn') : t('auth.signIn')}
              </Button>

              <p className="text-center text-[11px] text-muted">
                {t('app.version', { version: branding.api_version || '4.0.0' })} · {t('app.poweredBy')}
              </p>
            </form>
          )}
        </motion.div>
      </main>
    </div>
  )
}
