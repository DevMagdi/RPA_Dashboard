/**
 * Sidebar — grouped, permission-aware navigation.
 *
 * Premium details that matter to an operator working eight hours in this
 * console: the active pill slides between items (`layoutId`), the rail can be
 * collapsed to icons on wide screens, hovering a destination pre-downloads its
 * route chunk, and the whole thing mirrors perfectly in Arabic (logical CSS
 * only, plus an RTL-aware drawer for mobile).
 */
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronsLeft, ChevronsRight, PanelLeftClose, X } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

import { useAuth } from '../../context/AuthProvider'
import { useBranding } from '../../context/BrandingProvider'
import { useHoverIntent } from '../../hooks/ui'
import { useDirection } from '../../lib/direction'
import { prefetchRoute, sectionsFor } from '../../lib/routeMeta'
import { cn } from '../../lib/utils'
import { Button, ScrollArea, Tooltip, TooltipProvider } from '../ui'

function BrandMark({ collapsed, tagline }) {
  const { branding, companyName } = useBranding()
  return (
    <div className={cn('flex min-w-0 items-center gap-3', collapsed && 'justify-center')}>
      {branding.logo_url ? (
        <img src={branding.logo_url} alt="" className="h-9 w-9 shrink-0 rounded-xl object-contain" />
      ) : (
        <span className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-brand-gradient text-brand-fg shadow-glow">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
            <rect x="3.5" y="5.5" width="17" height="13" rx="3.4" />
            <path d="M12 9.2v5.6M9.2 12h5.6" strokeLinecap="round" />
            <path d="M7.6 5.5V4.2M16.4 5.5V4.2" strokeLinecap="round" />
          </svg>
          <span aria-hidden className="pointer-events-none absolute inset-0 bg-brand-sheen bg-sheen-200 animate-gradient-x opacity-40" />
        </span>
      )}
      {!collapsed ? (
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold tracking-[-0.01em] text-text">{companyName}</span>
          <span className="block truncate text-[11px] text-muted">{tagline}</span>
        </span>
      ) : null}
    </div>
  )
}

function NavEntry({ route, collapsed, onNavigate, badge }) {
  const { t } = useTranslation()
  const hover = useHoverIntent(() => prefetchRoute(route))
  const Icon = route.icon
  const label = t(route.labelKey)

  const link = (
    <NavLink
      to={route.path}
      end={route.path === '/'}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      {...hover}
      className={({ isActive }) =>
        cn(
          'nav-item group',
          collapsed && 'justify-center px-2',
          isActive ? 'bg-brand-soft font-medium text-brand' : 'text-muted hover:bg-surface-2 hover:text-text',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <>
              <motion.span
                layoutId="nav-active-pill"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                className="nav-active-pill absolute inset-0 -z-10 rounded-xl bg-brand-soft"
              />
              <span aria-hidden className="absolute inset-y-1.5 start-1 w-0.5 rounded-full bg-brand" />
            </>
          ) : null}
          <Icon className={cn('h-4 w-4 shrink-0 transition-transform duration-200', 'group-hover:scale-105')} aria-hidden />
          {!collapsed ? (
            <>
              <span className="min-w-0 flex-1 truncate text-start">{label}</span>
              {badge ? (
                <span className="grid min-h-4.5 min-w-4.5 place-items-center rounded-full bg-danger-soft px-1.5 text-[10px] font-bold text-danger">
                  {badge > 99 ? '99+' : badge}
                </span>
              ) : null}
              {route.hotkey && !badge ? (
                <span className="hidden font-mono text-[10px] text-muted/70 opacity-0 transition-opacity duration-200 group-hover:opacity-100 lg:block">
                  {route.hotkey}
                </span>
              ) : null}
            </>
          ) : badge ? (
            <span className="absolute end-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-danger" aria-hidden />
          ) : null}
        </>
      )}
    </NavLink>
  )

  return collapsed ? (
    <Tooltip content={label} side="right">
      <li>{link}</li>
    </Tooltip>
  ) : (
    <li>{link}</li>
  )
}

export default function Sidebar({ collapsed, onToggleCollapsed, mobile, open, onClose, alertCount = 0 }) {
  const { t } = useTranslation()
  const { has } = useAuth()
  const direction = useDirection()
  const sections = sectionsFor(has)
  const handleNavigate = useCallback(() => {
    if (mobile) onClose?.()
  }, [mobile, onClose])

  const body = (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn('flex items-center gap-2 px-4 py-4', collapsed && 'justify-center px-2')}>
        <BrandMark collapsed={collapsed} tagline={t('app.tagline')} />
        {mobile ? (
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t('actions.close')}>
            <X className="h-4 w-4"  aria-hidden/>
          </Button>
        ) : null}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <nav className="px-2 pb-3" aria-label={t('a11y.mainNavigation')}>
          {sections.map((section) => (
            <div key={section.key} className="mb-4">
              {!collapsed ? (
                <p className="px-3 pb-1.5 text-[10px] font-semibold tracking-[0.16em] text-muted/80 uppercase">
                  {t(section.labelKey)}
                </p>
              ) : (
                <div className="mx-2 mb-2 h-px bg-border/70" aria-hidden />
              )}
              <ul className="space-y-0.5">
                {section.routes.map((route) => (
                  <NavEntry
                    key={route.id}
                    route={route}
                    collapsed={collapsed}
                    onNavigate={handleNavigate}
                    badge={route.id === 'alerts' ? alertCount : 0}
                  />
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </ScrollArea>

      {!mobile ? (
        <div className="border-t border-border/80 p-2">
          <Tooltip content={collapsed ? t('nav.expand') : t('nav.collapse')} side="right">
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
              aria-expanded={!collapsed}
              className={cn(
                'focus-ring flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-text',
                collapsed && 'justify-center px-2',
              )}
            >
              {collapsed ? (
                direction === 'rtl' ? <ChevronsLeft className="h-4 w-4"  aria-hidden/> : <ChevronsRight className="h-4 w-4"  aria-hidden/>
              ) : (
                <>
                  <PanelLeftClose className="h-4 w-4 rtl:scale-x-[-1]"  aria-hidden/>
                  <span className="truncate">{t('nav.collapse')}</span>
                </>
              )}
            </button>
          </Tooltip>
        </div>
      ) : null}
    </div>
  )

  if (mobile) {
    return (
      <AnimatePresence>
        {open ? (
          <>
            <motion.button
              type="button"
              aria-label={t('actions.close')}
              className="fixed inset-0 z-[60] cursor-default bg-[color-mix(in_srgb,var(--bg-deep)_58%,transparent)] backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
            />
            <motion.aside
              initial={{ x: direction === 'rtl' ? '100%' : '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: direction === 'rtl' ? '100%' : '-100%' }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              className="sidebar fixed inset-y-0 start-0 z-[62] w-72 border-e border-border shadow-pop"
              aria-label={t('a11y.mainNavigation')}
            >
              {body}
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
    )
  }

  return (
    <TooltipProvider>
      <motion.aside
        animate={{ width: collapsed ? 74 : 264 }}
        initial={false}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        className="sidebar sticky top-0 z-30 hidden h-screen shrink-0 border-e border-border/80 lg:block"
        aria-label={t('a11y.mainNavigation')}
      >
        {body}
      </motion.aside>
    </TooltipProvider>
  )
}
