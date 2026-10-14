/**
 * Top bar — the operator's cockpit strip.
 *
 * Contains the global search trigger (with the platform-aware ⌘/Ctrl hint), the
 * live-stream pill, the notification popover, the language switcher, the theme
 * toggle and the account menu.  Everything is a real button with an accessible
 * name, and every overlay is a Radix primitive so focus management, escape and
 * outside-click follow the platform conventions.
 */
import { motion } from 'framer-motion'
import {
  Bell,
  BellOff,
  Check,
  ChevronRight,
  ChevronsUpDown,
  Keyboard,
  Languages,
  LogOut,
  Menu,
  Moon,
  ScrollText,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Sun,
} from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../../context/AuthProvider'
import { useBranding } from '../../context/BrandingProvider'
import { useTheme } from '../../context/ThemeProvider'
import { useAlertCount, useAlerts, useConnectedAgents } from '../../hooks/api'
import { useIsMobile, useRealtimeStatus, useTicker } from '../../hooks/ui'
import { applyLanguage, currentLanguage, LANGUAGES } from '../../i18n'
import { relative, severityColor } from '../../lib/format'
import { matchRoute, ROUTE_SECTIONS } from '../../lib/routeMeta'
import { cn } from '../../lib/utils'
import { Badge, Button, DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, Kbd, Popover, Tooltip } from '../ui'
import TopNav from './TopNav'

export function LivePill() {
  const { t } = useTranslation()
  const { status, lastEventAt, retries } = useRealtimeStatus()
  const tone = status === 'open' ? 'var(--success)' : status === 'connecting' ? 'var(--warning)' : 'var(--danger)'
  const label = status === 'open' ? t('app.live') : retries > 0 ? t('app.reconnecting') : t('app.offline')
  return (
    <Tooltip
      content={
        <span className="block text-start">
          <span className="block font-semibold">{label}</span>
          {lastEventAt ? <span className="block text-[10px] text-muted">{relative(lastEventAt)}</span> : null}
        </span>
      }
    >
      <span className="hidden items-center gap-1.5 rounded-full px-2 py-1 text-xs text-muted sm:inline-flex">
        <span className="relative flex h-2 w-2">
          <span className="h-2 w-2 rounded-full" style={{ background: tone }} />
          {status === 'open' ? <span className="live-dot absolute inset-0" style={{ color: tone }} aria-hidden /> : null}
        </span>
        {label}
      </span>
    </Tooltip>
  )
}

/**
 * Navy "bots online" badge — the live count of connected automation agents,
 * read from the real `/api/agents/connected` inventory (refreshed every 30s).
 */
export function BotsOnlineBadge() {
  const { t } = useTranslation()
  const { data } = useConnectedAgents({ refetchInterval: 30_000 })
  const count = Number(data?.count) || 0
  return (
    <span
      className="live-badge hidden h-8 shrink-0 items-center gap-2 rounded-full px-3 text-xs font-semibold tabular whitespace-nowrap lg:inline-flex"
      data-testid="bots-online"
      aria-label={t('shell.botsOnlineLabel', { count })}
      title={t('shell.botsOnlineLabel', { count })}
    >
      <span className="relative flex h-2 w-2" aria-hidden>
        <span className="h-2 w-2 rounded-full" style={{ background: count > 0 ? 'var(--strip-green)' : 'var(--text-muted)' }} />
        {count > 0 ? <span className="live-dot absolute inset-0" style={{ color: 'var(--strip-green)' }} /> : null}
      </span>
      <span>{count}</span>
      <span className="hidden font-medium opacity-80 xl:inline">{t('shell.botsOnline', { count })}</span>
    </span>
  )
}

function NotificationMenu() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: countData } = useAlertCount()
  const { data } = useAlerts({ status: 'open', limit: 6 })
  const [open, setOpen] = useState(false)
  const count = countData?.open || 0
  const rows = Array.isArray(data) ? data : (data?.items || [])

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      contentClassName="w-[min(92vw,23rem)]"
      trigger={
        <button
          type="button"
          aria-label={t('a11y.notifications', { count })}
          className="focus-ring relative grid h-8 w-8 place-items-center rounded-xl text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <Bell className="h-4 w-4"  aria-hidden/>
          {count > 0 ? (
            <motion.span
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="absolute -end-1 -top-1 grid min-h-4.5 min-w-4.5 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white shadow-soft"
            >
              {count > 99 ? '99+' : count}
            </motion.span>
          ) : null}
        </button>
      }
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/80 px-4 py-3">
        <p className="text-sm font-semibold text-text">{t('nav.alerts')}</p>
        {count > 0 ? (
          <Badge tone="danger" size="sm">
            {count}
          </Badge>
        ) : null}
      </div>
      <div className="max-h-72 overflow-y-auto p-2">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <BellOff className="h-5 w-5 text-muted" aria-hidden />
            <p className="text-xs text-muted">{t('alerts.empty')}</p>
          </div>
        ) : (
          <ul className="space-y-1">
            {rows.map((alert, index) => (
              <li key={alert.id ?? alert.ID ?? index}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    navigate('/alerts')
                  }}
                  className="focus-ring flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-start transition-colors hover:bg-surface-2"
                >
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: severityColor(alert.severity || alert.Severity) }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-text" dir="auto">
                      {alert.message || alert.Message || alert.rule || alert.Rule}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-muted">{relative(alert.created_at || alert.CreatedAt || alert.last_seen)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="border-t border-border/80 p-2">
        <Button variant="ghost" size="sm" block onClick={() => { setOpen(false); navigate('/alerts') }}>
          {t('actions.viewAll')}
        </Button>
      </div>
    </Popover>
  )
}

function LanguageMenu() {
  const { t } = useTranslation()
  const active = currentLanguage()
  const [open, setOpen] = useState(false)
  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      align="end"
      trigger={
        <button
          type="button"
          aria-label={t('a11y.languageToggle')}
          className="focus-ring hidden h-8 items-center gap-1.5 rounded-xl px-2 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text sm:inline-flex"
        >
          <Languages className="h-4 w-4"  aria-hidden/>
          {LANGUAGES.find((item) => item.code === active)?.nativeLabel}
          <ChevronsUpDown className="h-3 w-3 opacity-60"  aria-hidden/>
        </button>
      }
    >
      <DropdownLabel>{t('settings.language')}</DropdownLabel>
      {LANGUAGES.map((language) => (
        <DropdownItem
          key={language.code}
          icon={language.code === active ? Check : undefined}
          onClick={() => {
            setOpen(false)
            applyLanguage(language.code)
          }}
        >
          <span className="flex items-center justify-between gap-3">
            <span dir={language.dir}>{language.nativeLabel}</span>
            <span className="text-[10px] uppercase text-muted">{language.code}</span>
          </span>
        </DropdownItem>
      ))}
      <DropdownSeparator />
      <p className="px-2.5 py-1 text-2xs leading-relaxed text-muted">{t('settings.languageHint')}</p>
    </DropdownMenu>
  )
}

function UserMenu({ onOpenMfa, onOpenShortcuts }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, logout, has } = useAuth()
  const [open, setOpen] = useState(false)
  const roleKey = `users.roleDescriptions.${user?.role}`
  const roleLabel = t(roleKey, { defaultValue: user?.role })

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      align="end"
      contentClassName="w-64"
      trigger={
        <button
          type="button"
          aria-label={t('a11y.userMenu')}
          className="focus-ring flex h-8 items-center gap-2 rounded-xl px-1.5 text-sm transition-colors hover:bg-surface-2"
        >
          <span className="grid h-6 w-6 place-items-center rounded-lg bg-brand-soft text-[10px] font-bold text-brand">
            {String(user?.username || 'U').slice(0, 2).toUpperCase()}
          </span>
          <span className="hidden max-w-[9rem] truncate sm:block">{user?.username}</span>
          <ChevronsUpDown className="h-3 w-3 text-muted" aria-hidden />
        </button>
      }
    >
      <div className="px-3 py-2">
        <p className="truncate text-sm font-semibold text-text" dir="auto">
          {user?.full_name || user?.username}
        </p>
        <p className="truncate text-xs text-muted" dir="auto">
          {roleLabel}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge tone={user?.mfa_enabled ? 'success' : 'warning'} size="sm" dot={!user?.mfa_enabled}>
            {user?.mfa_enabled ? t('auth.mfaEnabled') : t('auth.setupMfa')}
          </Badge>
          {user?.department && user.department !== 'ALL' ? (
            <Badge tone="neutral" size="sm">
              {user.department}
            </Badge>
          ) : null}
        </div>
      </div>
      <DropdownSeparator />
      {!user?.mfa_enabled ? (
        <DropdownItem
          icon={ShieldCheck}
          onClick={() => {
            setOpen(false)
            onOpenMfa()
          }}
        >
          {t('auth.setupMfa')}
        </DropdownItem>
      ) : null}
      <DropdownItem
        icon={SettingsIcon}
        onClick={() => {
          setOpen(false)
          navigate('/settings')
        }}
      >
        {t('nav.settings')}
      </DropdownItem>
      {has('audit:read') ? (
        <DropdownItem
          icon={ScrollText}
          onClick={() => {
            setOpen(false)
            navigate('/audit?who=me')
          }}
        >
          {t('nav.audit')}
        </DropdownItem>
      ) : null}
      <DropdownItem
        icon={Keyboard}
        onClick={() => {
          setOpen(false)
          onOpenShortcuts()
        }}
      >
        {t('shortcuts.title')}
      </DropdownItem>
      <DropdownSeparator />
      <DropdownItem
        icon={LogOut}
        destructive
        onClick={() => {
          setOpen(false)
          logout()
        }}
      >
        {t('actions.signOut')}
      </DropdownItem>
    </DropdownMenu>
  )
}

export default function TopBar({ onOpenPalette, onOpenMobileNav, onOpenShortcuts, onOpenMfa }) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const { toggleTheme, isDark } = useTheme()
  const { branding, companyName } = useBranding()
  const location = useLocation()
  useTicker(45_000)
  const headerRef = useRef(null)

  // Publish the real bar height (it is two rows at xl+ and may wrap) so sticky
  // surfaces such as the dashboard filter bar sit exactly under it, never behind it.
  useLayoutEffect(() => {
    const node = headerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return undefined
    const publish = () => document.documentElement.style.setProperty('--header-height', `${node.offsetHeight}px`)
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const route = useMemo(() => matchRoute(location.pathname), [location.pathname])
  const title = route ? t(route.labelKey) : t('app.name')
  const subtitle = route ? t(route.descriptionKey) : companyName
  const sectionLabel = route?.section ? t(ROUTE_SECTIONS.find((item) => item.key === route.section)?.labelKey || '') : ''
  const modifier = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl'

  return (
    <header ref={headerRef} className="topbar sticky top-0 z-40 border-b border-border/70">
      <div className="flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-5">
        {isMobile ? (
          <Button variant="ghost" size="icon" onClick={onOpenMobileNav} aria-label={t('nav.expand')}>
            <Menu className="h-5 w-5"  aria-hidden/>
          </Button>
        ) : null}

        {/* On desktop the centred pill nav names the active module, so the title block steps aside. */}
        <div className="min-w-0 flex-1 lg:hidden">
          <div className="flex items-center gap-1.5">
            {sectionLabel ? (
              <>
                <span className="hidden text-2xs font-semibold tracking-[0.1em] text-muted uppercase sm:inline">{sectionLabel}</span>
                <ChevronRight className="hidden h-3 w-3 shrink-0 text-muted/70 rtl:rotate-180 sm:block" aria-hidden />
              </>
            ) : null}
            <h1 className="truncate text-sm font-semibold tracking-[-0.01em] text-text">{title}</h1>
            <Badge tone="neutral" size="sm" className="hidden xl:inline-flex">
              {t('app.environment')}: {branding.api_version || '4.1.0'}
            </Badge>
          </div>
          <p className="hidden truncate text-[11px] text-muted sm:block">{subtitle}</p>
        </div>

        <div className="hidden min-w-0 flex-1 justify-center lg:flex">
          <TopNav />
        </div>

        <BotsOnlineBadge />

        <button
          type="button"
          onClick={onOpenPalette}
          aria-label={`${t('palette.title')} (${modifier}+K)`}
          className="focus-ring group inline-flex h-9 items-center gap-2 rounded-full border border-border/80 bg-surface-2/60 px-3 text-xs text-muted transition-colors hover:border-brand/35 hover:bg-surface hover:text-text sm:px-2.5 sm:justify-center 2xl:min-w-[15rem] 2xl:justify-between 2xl:px-3"
        >
          <span className="flex items-center gap-2">
            <Search className="h-4 w-4"  aria-hidden/>
            <span className="hidden 2xl:inline">{t('palette.placeholder')}</span>
          </span>
          <span className="hidden items-center gap-1 2xl:flex">
            <Kbd>{modifier}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>

        {/* one elegant control cluster: live status · language · theme · bell · account */}
        <div className="flex items-center gap-0.5 rounded-2xl border border-border/60 bg-surface/60 p-1 shadow-xs backdrop-blur-sm">
          <LivePill />
          <LanguageMenu />
          <Tooltip content={isDark ? t('settings.themeLight') : t('settings.themeDark')}>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={t('a11y.themeToggle')}
              className="focus-ring grid h-8 w-8 place-items-center rounded-xl text-muted transition-colors hover:bg-surface-2 hover:text-text"
            >
              <motion.span key={isDark ? 'dark' : 'light'} initial={{ rotate: -35, opacity: 0, scale: 0.8 }} animate={{ rotate: 0, opacity: 1, scale: 1 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}>
                {isDark ? <Sun className="h-4 w-4"  aria-hidden/> : <Moon className="h-4 w-4"  aria-hidden/>}
              </motion.span>
            </button>
          </Tooltip>
          <NotificationMenu />
          <span className="mx-0.5 hidden h-5 w-px bg-border/80 sm:block" aria-hidden />
          <UserMenu onOpenMfa={onOpenMfa} onOpenShortcuts={onOpenShortcuts} />
        </div>
      </div>
    </header>
  )
}

export { NotificationMenu as NotificationsBell }

export function BrandFooterLine({ children }) {
  return <span className={cn('text-[11px] text-muted')}>{children}</span>
}
