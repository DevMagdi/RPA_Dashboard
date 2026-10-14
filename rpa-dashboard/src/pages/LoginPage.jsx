/**
 * Sign-in screen (password → optional MFA), bilingual (Arabic/English).
 *
 * This is the "first three seconds" of the product, so the left panel is a
 * marketing-grade surface — aurora gradient, live status chips and the
 * on-premises guarantees a bank's security review asks about — while the form
 * itself stays calm, focused and fully keyboard-driven.  It renders in Arabic
 * with the correct direction the moment the language is switched, before login.
 */
import { motion } from 'framer-motion'
import { ArrowLeft, Bot, Eye, EyeOff, KeyRound, Lock, Moon, ShieldCheck, Sun, User, Wifi } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation } from 'react-router-dom'

import { useAuth } from '../context/AuthProvider'
import { useBranding } from '../context/BrandingProvider'
import { useTheme } from '../context/ThemeProvider'
import { applyLanguage, LANGUAGES } from '../i18n'
import { Badge, Button, Field, Input, Kbd, Kbd as Key, Notice, cn } from '../components/ui'

const PILLARS = [
  { titleKey: 'dashboard.title', subtitleKey: 'dashboard.subtitle', icon: Wifi },
  { titleKey: 'capacity.title', subtitleKey: 'capacity.subtitle', icon: KeyRound },
  { titleKey: 'lifecycle.title', subtitleKey: 'lifecycle.subtitle', icon: ShieldCheck },
]

export default function LoginPage() {
  const { t, i18n } = useTranslation()
  const location = useLocation()
  const { login, verifyMfa, cancelMfa, isAuthenticated, mfaChallenge, lastError, clearError } = useAuth()
  const { branding, companyName } = useBranding()
  const { toggleTheme, isDark } = useTheme()

  const [form, setForm] = useState({ username: '', password: '' })
  const [code, setCode] = useState('')
  const [useBackup, setUseBackup] = useState(false)
  const [reveal, setReveal] = useState(false)
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
    <div className="app-shell grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel — hidden on small screens to keep the form above the fold */}
      <aside className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12">
        <span aria-hidden className="command-hero__aurora" />
        <span aria-hidden className="command-hero__grid" />
        <div className="relative z-[2] flex items-center gap-3">
          {branding.logo_url ? (
            <img src={branding.logo_url} alt="" className="h-11 w-11 rounded-2xl object-contain" />
          ) : (
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-gradient text-brand-fg shadow-glow">
              <Bot className="h-6 w-6" aria-hidden />
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold tracking-[-0.01em] text-text">{companyName}</p>
            <p className="truncate text-xs text-muted">{t('app.tagline')}</p>
          </div>
        </div>

        <div className="relative z-[2] max-w-lg space-y-7">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent-soft px-3 py-1 text-[11px] font-semibold text-accent-strong">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
              {t('dashboard.privateInstallation')}
            </span>
            <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-[-0.03em] text-text sm:text-4xl">{t('auth.welcome')}</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted text-pretty">{t('auth.subtitle')}</p>
          </div>

          <ul className="space-y-3.5">
            {PILLARS.map((pillar, index) => (
              <motion.li
                key={pillar.titleKey}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 + index * 0.08, ease: [0.22, 1, 0.36, 1] }}
                className="flex items-start gap-3"
              >
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-border/70 bg-surface/70 text-brand shadow-xs">
                  <pillar.icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-text">{t(pillar.titleKey)}</span>
                  <span className="block text-xs leading-relaxed text-muted text-pretty">{t(pillar.subtitleKey)}</span>
                </span>
              </motion.li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success" dot>
              {t('app.allSystemsOperational')}
            </Badge>
            <Badge tone="neutral">{t('app.secureSession')}</Badge>
          </div>
        </div>

        <p className="relative z-[2] text-xs text-muted">
          {t('app.poweredBy')} · {t('app.version', { version: branding.api_version || '4.1.0' })}
        </p>
      </aside>

      <main className="relative flex items-center justify-center overflow-hidden px-5 py-10">
        {/* strong gradient canvas behind the glass card (plan: login = one frosted panel) */}
        <span aria-hidden className="command-hero__aurora" />
        <span aria-hidden className="command-hero__grid" />
        <div className="absolute end-4 top-4 z-[2] flex items-center gap-1">
          <div className="flex items-center rounded-xl border border-border/70 bg-surface/70 p-0.5 backdrop-blur">
            {LANGUAGES.map((language) => (
              <button
                key={language.code}
                type="button"
                onClick={() => applyLanguage(language.code)}
                aria-pressed={i18n.language === language.code}
                className={cn(
                  'focus-ring rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors',
                  i18n.language === language.code ? 'bg-brand-soft text-brand' : 'text-muted hover:text-text',
                )}
              >
                {language.code.toUpperCase()}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={t('a11y.themeToggle')}>
            {isDark ? <Sun className="h-4 w-4"  aria-hidden/> : <Moon className="h-4 w-4"  aria-hidden/>}
          </Button>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-[2] w-full max-w-sm"
        >
          <div className="glass-premium relative overflow-hidden rounded-3xl p-6 sm:p-7">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/50 to-transparent"
            />

            <div className="mb-5 flex items-center gap-3 lg:hidden">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-gradient text-brand-fg">
                <Bot className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-text">{companyName}</span>
                <span className="block truncate text-[11px] text-muted">{t('app.tagline')}</span>
              </span>
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
                  dir="ltr"
                  placeholder={useBackup ? 'XXXX-XXXX' : '000000'}
                  className="text-center font-mono text-lg tracking-[0.35em]"
                />
              </Field>

              <Button type="submit" variant="primary" block loading={submitting} disabled={code.length < 4}>
                {t('auth.verify')}
              </Button>

              <div className="flex items-center justify-between text-xs">
                <button type="button" className="focus-ring rounded text-brand hover:underline" onClick={() => setUseBackup((value) => !value)}>
                  {useBackup ? t('auth.mfaUseTotp') : t('auth.mfaUseBackup')}
                </button>
                <button
                  type="button"
                  className="focus-ring inline-flex items-center gap-1 rounded text-muted transition-colors hover:text-text"
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
                <h1 className="text-xl font-semibold tracking-[-0.01em] text-text">{t('auth.welcome')}</h1>
                <p className="mt-1 text-sm text-muted">{t('auth.subtitle')}</p>
              </header>

              {error ? <Notice tone="danger" title={error.message} /> : null}

              <Field label={t('auth.username')} required htmlFor="username">
                <Input
                  id="username"
                  icon={User}
                  value={form.username}
                  onChange={(event) => setForm({ ...form, username: event.target.value })}
                  autoComplete="username"
                  autoFocus
                  required
                />
              </Field>

              <Field label={t('auth.password')} required htmlFor="password">
                <div className="relative">
                  <Lock className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                  <Input
                    id="password"
                    type={reveal ? 'text' : 'password'}
                    className="ps-9 pe-9"
                    value={form.password}
                    onChange={(event) => setForm({ ...form, password: event.target.value })}
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setReveal((value) => !value)}
                    aria-label={reveal ? t('actions.hide') : t('actions.show')}
                    className="focus-ring absolute end-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text"
                  >
                    {reveal ? <EyeOff className="h-3.5 w-3.5"  aria-hidden/> : <Eye className="h-3.5 w-3.5"  aria-hidden/>}
                  </button>
                </div>
              </Field>

              <Button type="submit" variant="primary" block loading={submitting}>
                {submitting ? t('auth.signingIn') : t('auth.signIn')}
              </Button>

              <p className="flex flex-wrap items-center justify-center gap-1.5 text-center text-[11px] text-muted">
                <span>{t('app.version', { version: branding.api_version || '4.1.0' })}</span>
                <span aria-hidden>·</span>
                <span>{t('app.poweredBy')}</span>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <Key className="h-3 w-3" aria-hidden />
                  <Kbd>Ctrl</Kbd>
                  <Kbd>K</Kbd>
                </span>
              </p>
            </form>
          )}
          </div>
        </motion.div>
      </main>
    </div>
  )
}
