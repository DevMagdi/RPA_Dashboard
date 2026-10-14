/**
 * AppShell — the frame every authenticated screen renders inside.
 *
 * Responsibilities: sidebar + top bar composition, the command palette and
 * shortcut sheet, the realtime subscription, page transitions, the offline
 * banner and the footer identity strip.  It is deliberately thin: all visual
 * language lives in the design system, all navigation facts in `routeMeta`.
 */
import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '../../context/AuthProvider'
import { useBranding } from '../../context/BrandingProvider'
import { useAlertCount, useProcessOptions, useRealtimeSync } from '../../hooks/api'
import { useHotkey, useIdleCallback, useIsMobile, useOnlineStatus, usePersistentState } from '../../hooks/ui'
import { applyLanguage, otherLanguage } from '../../i18n'
import { prefetchAll } from '../../lib/routeMeta'
import { Button, ErrorBoundary, TooltipProvider, cn } from '../ui'
import MfaDialog from '../features/MfaDialog'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import CommandPalette from './CommandPalette'
import ShortcutsDialog from './ShortcutsDialog'
import RouteFallback from '../common/RouteFallback'

function OfflineBanner() {
  const { t } = useTranslation()
  const online = useOnlineStatus()
  return (
    <AnimatePresence>
      {!online ? (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden border-b border-warning/30 bg-warning-soft"
          role="status"
        >
          <p className="px-4 py-2 text-center text-xs font-medium text-warning">{t('errors.offline')}</p>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

export default function AppShell() {
  const { t } = useTranslation()
  const location = useLocation()
  const isMobile = useIsMobile()
  const { has, user } = useAuth()
  const { branding, companyName } = useBranding()
  // Hybrid layout: the centred top pill is the primary navigation, so the sidebar
  // rail starts collapsed on desktop. Users who expand it keep their choice.
  const [collapsed, setCollapsed] = usePersistentState('shell.collapsed', true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [mfaOpen, setMfaOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  const { data: processes } = useProcessOptions()
  const { data: alertCount } = useAlertCount()
  useRealtimeSync()

  useHotkey('ctrl+k', () => setPaletteOpen(true))
  useHotkey('shift+?', () => setShortcutsOpen(true), { allowInInput: true })
  useHotkey('ctrl+shift+l', () => applyLanguage(otherLanguage()), { allowInInput: true })
  useHotkey('ctrl+j', () => document.querySelector('[data-theme-toggle]')?.click(), { allowInInput: true })

  // Warm the remaining route chunks once the first screen is idle: navigating
  // to Capacity/Runs later is then instant, at zero cost to time-to-interactive.
  useIdleCallback(() => prefetchAll(has), { timeout: 2500 })

  const isDashboard = location.pathname === '/'

  return (
    <TooltipProvider>
      <div className="app-shell flex min-h-screen bg-bg">
        <a
          href="#main-content"
          className="focus-ring sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-[90] focus:rounded-xl focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-pop"
        >
          {t('a11y.skipToContent')}
        </a>

        <Sidebar
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((value) => !value)}
          mobile={isMobile}
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          alertCount={alertCount?.open || 0}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <OfflineBanner />
          <TopBar
            onOpenPalette={() => setPaletteOpen(true)}
            onOpenMobileNav={() => setMobileOpen(true)}
            onOpenShortcuts={() => setShortcutsOpen(true)}
            onOpenMfa={() => setMfaOpen(true)}
          />

          <main id="main-content" className="min-w-0 flex-1 px-3 py-4 sm:px-5 sm:py-6">
            <ErrorBoundary title={t('errors.sectionFailed')}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={location.pathname}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                >
                  <ErrorBoundary fallback={() => <RouteFallback variant={isDashboard ? 'dashboard' : 'default'} />}>
                    <Outlet />
                  </ErrorBoundary>
                </motion.div>
              </AnimatePresence>
            </ErrorBoundary>
          </main>

          <footer className="border-t border-border/70 px-4 py-3 text-[11px] text-muted">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
                {companyName} · {t('app.poweredBy')}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <span className={cn('chip')}>{t('app.secureSession')}</span>
                <span>
                  {t('app.version', { version: branding.api_version || '4.1.0' })} · {user?.username}
                </span>
              </span>
            </div>
          </footer>
        </div>

        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} processes={processes || []} />
        <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        <MfaDialog open={mfaOpen} onClose={() => setMfaOpen(false)} />
      </div>
    </TooltipProvider>
  )
}

export { Button }
