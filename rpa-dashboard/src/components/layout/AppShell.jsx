import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity,
  BadgeCheck,
  Bell,
  Bot,
  ChevronDown,
  Gauge,
  KeyRound,
  Languages,
  LayoutDashboard,
  LogOut,
  Menu,
  MonitorCog,
  Moon,
  ScrollText,
  Server,
  Settings as SettingsIcon,
  Shield,
  Sun,
  UserCircle2,
  Users,
  Workflow,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '../../context/AuthProvider'
import { useBranding } from '../../context/BrandingProvider'
import { useTheme } from '../../context/ThemeProvider'
import { useAlertCount, useProcessOptions, useRealtimeSync } from '../../hooks/api'
import { useHotkey, useIsMobile, useRealtimeStatus } from '../../hooks/ui'
import { applyLanguage } from '../../i18n'
import { relative } from '../../lib/format'
import { Button, ErrorBoundary, StatusDot, cx } from '../ui'
import CommandPalette from './CommandPalette'
import MfaDialog from '../features/MfaDialog'

const NAV_CONFIG = [
  {
    section: 'nav.sections.operations',
    items: [
      { to: '/', label: 'nav.dashboard', icon: LayoutDashboard, permission: 'dashboard:read' },
      { to: '/capacity', label: 'nav.capacity', icon: Gauge, permission: 'capacity:read' },
      { to: '/processes', label: 'nav.processes', icon: Workflow, permission: 'processes:read' },
      { to: '/runs', label: 'nav.runs', icon: Activity, permission: 'runs:read' },
      { to: '/infrastructure', label: 'nav.infrastructure', icon: Server, permission: 'infrastructure:read' },
    ],
  },
  {
    section: 'nav.sections.governance',
    items: [
      { to: '/lifecycle', label: 'nav.lifecycle', icon: BadgeCheck, permission: 'lifecycle:read' },
      { to: '/audit', label: 'nav.audit', icon: ScrollText, permission: 'audit:read' },
      { to: '/health', label: 'nav.health', icon: Shield, permission: 'audit:read' },
    ],
  },
  {
    section: 'nav.sections.administration',
    items: [
      { to: '/users', label: 'nav.users', icon: Users, permission: 'users:read' },
      { to: '/organization', label: 'nav.organization', icon: KeyRound, permission: '*' },
      { to: '/alerts', label: 'nav.alerts', icon: Bell, permission: null },
      { to: '/settings', label: 'nav.settings', icon: SettingsIcon, permission: null },
    ],
  },
]

function BrandMark({ compact, tagline }) {
  const { branding, companyName } = useBranding()
  return (
    <div className="flex items-center gap-3">
      {branding.logo_url ? (
        <img src={branding.logo_url} alt="" className="h-9 w-9 rounded-xl object-contain" />
      ) : (
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-brand-fg shadow-soft">
          <Bot className="h-5 w-5" aria-hidden />
        </span>
      )}
      {!compact ? (
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-text">{companyName}</span>
          <span className="block truncate text-[11px] text-muted">{tagline}</span>
        </span>
      ) : null}
    </div>
  )
}

function LivePill() {
  const { t } = useTranslation()
  const { status, lastEventAt, retries } = useRealtimeStatus()
  const tone = status === 'open' ? 'var(--success)' : status === 'connecting' ? 'var(--warning)' : 'var(--danger)'
  const label = status === 'open' ? t('app.live') : retries > 0 ? t('app.reconnecting') : t('app.offline')
  return (
    <span
      className="hidden items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs text-muted sm:inline-flex"
      title={lastEventAt ? relative(new Date(lastEventAt)) : undefined}
    >
      <StatusDot color={tone} pulse={status === 'open'} />
      {label}
    </span>
  )
}

function AlertBell() {
  const { t } = useTranslation()
  const { data } = useAlertCount()
  const count = data?.open || 0
  return (
    <NavLink
      to="/alerts"
      aria-label={t('nav.alerts')}
      className="focus-ring relative inline-flex rounded-xl p-2 text-muted transition hover:bg-surface-2 hover:text-text"
    >
      <Bell className="h-4 w-4" />
      {count > 0 ? (
        <span className="absolute -end-0.5 -top-0.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-bold text-white">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </NavLink>
  )
}

function UserMenu({ onOpenMfa }) {
  const { t } = useTranslation()
  const { user, logout, has } = useAuth()
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="focus-ring flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-2.5 py-1.5 text-sm transition hover:bg-surface"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <UserCircle2 className="h-4 w-4 text-muted" aria-hidden />
        <span className="hidden max-w-[9rem] truncate sm:block">{user?.username}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted" aria-hidden />
      </button>
      <AnimatePresence>
        {open ? (
          <>
            <button type="button" className="fixed inset-0 z-40 cursor-default" aria-hidden onClick={() => setOpen(false)} />
            <motion.div
              role="menu"
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.16 }}
              className="absolute end-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-border bg-surface shadow-pop"
            >
              <div className="border-b border-border px-4 py-3">
                <p className="text-sm font-semibold text-text">{user?.full_name || user?.username}</p>
                <p className="text-xs text-muted">{user?.role}</p>
                <p className="mt-1 text-[11px] text-muted">
                  {t('users.department')}: {user?.department || 'ALL'}
                </p>
                {user?.mfa_enabled ? (
                  <BadgeInline>{t('auth.mfaEnabled')}</BadgeInline>
                ) : (
                  <button
                    type="button"
                    className="mt-2 text-[11px] font-medium text-brand underline-offset-2 hover:underline"
                    onClick={() => {
                      setOpen(false)
                      onOpenMfa()
                    }}
                  >
                    {t('auth.setupMfa')}
                  </button>
                )}
              </div>
              <NavLink
                to="/settings"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-text transition hover:bg-surface-2"
                role="menuitem"
              >
                <SettingsIcon className="h-4 w-4 text-muted" aria-hidden />
                {t('nav.settings')}
              </NavLink>
              {has('audit:read') ? (
                <NavLink
                  to="/audit?who=me"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-text transition hover:bg-surface-2"
                  role="menuitem"
                >
                  <ScrollText className="h-4 w-4 text-muted" aria-hidden />
                  {t('nav.audit')}
                </NavLink>
              ) : null}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  logout()
                }}
                className="flex w-full items-center gap-3 border-t border-border px-4 py-2.5 text-sm text-danger transition hover:bg-danger-soft"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                {t('actions.signOut')}
              </button>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function BadgeInline({ children }) {
  return (
    <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-medium text-success">
      {children}
    </span>
  )
}

export default function AppShell() {
  const { t, i18n } = useTranslation()
  const location = useLocation()
  const isMobile = useIsMobile()
  const { has, user } = useAuth()
  const { branding, companyName } = useBranding()
  const { toggleTheme, isDark } = useTheme()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [mfaOpen, setMfaOpen] = useState(false)
  const mobileSlideFrom = i18n.dir() === 'rtl' ? '100%' : '-100%'

  const { data: processes } = useProcessOptions()
  useRealtimeSync()
  useHotkey('ctrl+k', () => setPaletteOpen(true))

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!isMobile || !mobileOpen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isMobile, mobileOpen])

  const navigation = useMemo(
    () =>
      NAV_CONFIG.map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.permission || has(item.permission)),
      })).filter((group) => group.items.length > 0),
    [has],
  )

  const activeLabel = useMemo(() => {
    const flat = navigation.flatMap((group) => group.items)
    const match = flat.find((item) => (item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)))
    return match ? t(match.label) : t('app.name')
  }, [navigation, location.pathname, t])

  const switchLanguage = () => applyLanguage(i18n.language === 'ar' ? 'en' : 'ar')

  return (
    <div className="app-shell flex min-h-screen bg-bg">
      <AnimatePresence>
        {isMobile && mobileOpen ? (
          <motion.button
            type="button"
            aria-label={t('actions.close')}
            className="fixed inset-0 z-40 cursor-default bg-black/55 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMobileOpen(false)}
          />
        ) : null}
      </AnimatePresence>

      {/* Sidebar — persistent on desktop, drawer on mobile */}
      <AnimatePresence>
        {(mobileOpen || !isMobile) && (
          <motion.aside
            initial={isMobile ? { x: mobileSlideFrom } : false}
            animate={{ x: 0, width: collapsed && !isMobile ? 76 : 264 }}
            exit={isMobile ? { x: mobileSlideFrom } : undefined}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            className={cx(
              'z-50 flex flex-col border-e border-border bg-surface/95 backdrop-blur-xl',
              isMobile ? 'fixed inset-y-0 start-0 w-64 shadow-pop' : 'sticky top-0 h-screen shrink-0',
            )}
            aria-label={t('app.name')}
          >
            <div className="flex items-center justify-between gap-2 px-4 py-4">
              <BrandMark compact={collapsed && !isMobile} tagline={t('app.tagline')} />
              {isMobile ? (
                <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label={t('actions.close')}>
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
            </div>

            <nav className="flex-1 overflow-y-auto px-2 pb-4">
              {navigation.map((group) => (
                <div key={group.section} className="mb-4">
                  {!(collapsed && !isMobile) ? (
                    <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted">
                      {t(group.section)}
                    </p>
                  ) : null}
                  <ul className="space-y-0.5">
                    {group.items.map((item) => (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          end={item.to === '/'}
                          className={({ isActive }) =>
                            cx(
                              'focus-ring group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all duration-200',
                              isActive ? 'bg-brand-soft font-medium text-brand' : 'text-muted hover:bg-surface-2 hover:text-text',
                            )
                          }
                          title={collapsed ? t(item.label) : undefined}
                        >
                          {({ isActive }) => (
                            <>
                              {isActive ? (
                                <motion.span
                                  layoutId="nav-active"
                                  className="absolute inset-y-1 start-0 w-1 rounded-full bg-brand"
                                  transition={{ duration: 0.22 }}
                                />
                              ) : null}
                              <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                              {!(collapsed && !isMobile) ? <span className="truncate">{t(item.label)}</span> : null}
                            </>
                          )}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>

            {!isMobile ? (
              <button
                type="button"
                onClick={() => setCollapsed((value) => !value)}
                className="focus-ring m-2 flex items-center justify-center gap-2 rounded-xl border border-border py-2 text-xs text-muted transition hover:bg-surface-2 hover:text-text"
                aria-label={t('actions.customise')}
              >
                <MonitorCog className="h-4 w-4" />
                {!collapsed ? <span>{t('actions.customise')}</span> : null}
              </button>
            ) : null}
          </motion.aside>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-border bg-bg/85 px-3 py-2.5 backdrop-blur-xl sm:px-5">
          {isMobile ? (
            <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label={t('app.name')}>
              <Menu className="h-5 w-5" />
            </Button>
          ) : null}

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-text">{activeLabel}</p>
            <p className="hidden truncate text-[11px] text-muted sm:block">{companyName}</p>
          </div>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label={`${t('actions.commandPalette')} (Ctrl+K)`}
            className="focus-ring inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-2 py-1.5 text-xs text-muted transition hover:border-brand/25 hover:bg-surface md:px-3"
          >
            <SearchIcon />
            <span className="hidden md:inline">{t('actions.search')}</span>
            <kbd className="hidden rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] md:inline-flex">Ctrl K</kbd>
          </button>

          <LivePill />

          <Button variant="ghost" size="icon" onClick={switchLanguage} aria-label={t('actions.changeLanguage')} title={t('actions.changeLanguage')}>
            <Languages className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={t('actions.toggleTheme')}>
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <AlertBell />
          <UserMenu onOpenMfa={() => setMfaOpen(true)} />
        </header>

        <main className="min-w-0 flex-1 px-3 py-4 sm:px-5 sm:py-6">
          <ErrorBoundary>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              <Outlet />
            </motion.div>
          </ErrorBoundary>
        </main>

        <footer className="border-t border-border px-4 py-3 text-[11px] text-muted">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {companyName} · {t('app.poweredBy')}
            </span>
            <span>
              {t('app.version', { version: branding.api_version || '4.0.0' })} · {user?.username}
            </span>
          </div>
        </footer>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} processes={processes} />
      <MfaDialog open={mfaOpen} onClose={() => setMfaOpen(false)} />
    </div>
  )
}

function SearchIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}
