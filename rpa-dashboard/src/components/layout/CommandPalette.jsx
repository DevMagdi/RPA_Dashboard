import { AnimatePresence, motion } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  BadgeCheck,
  Bot,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Moon,
  RefreshCw,
  ScrollText,
  Search,
  Server,
  Settings as SettingsIcon,
  Shield,
  Sun,
  Users,
  Workflow,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../../context/AuthProvider'
import { useBranding } from '../../context/BrandingProvider'
import { useTheme } from '../../context/ThemeProvider'
import { useToast } from '../../context/ToastProvider'
import { startRealtime } from '../../lib/realtime'
import { cx } from '../ui'

/**
 * Command palette (⌘K / Ctrl+K).
 *
 * Actions first, then navigation, then live search over processes — the fastest
 * path for an operator during an incident ("find the failing process", "toggle
 * theme", "refresh everything").
 */
export default function CommandPalette({ open, onClose, processes = [] }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const client = useQueryClient()
  const toast = useToast()
  const { toggleTheme, isDark } = useTheme()
  const { has } = useAuth()
  const { companyName } = useBranding()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
      setTimeout(() => inputRef.current?.focus(), 40)
    }
  }, [open])

  const items = useMemo(() => {
    const navigation = [
      { id: 'nav-dashboard', label: t('nav.dashboard'), icon: LayoutDashboard, run: () => navigate('/') },
      { id: 'nav-capacity', label: t('nav.capacity'), icon: Gauge, run: () => navigate('/capacity') },
      { id: 'nav-processes', label: t('nav.processes'), icon: Workflow, run: () => navigate('/processes') },
      { id: 'nav-runs', label: t('nav.runs'), icon: Activity, run: () => navigate('/runs') },
      { id: 'nav-infra', label: t('nav.infrastructure'), icon: Server, run: () => navigate('/infrastructure') },
      { id: 'nav-lifecycle', label: t('nav.lifecycle'), icon: BadgeCheck, run: () => navigate('/lifecycle') },
      { id: 'nav-audit', label: t('nav.audit'), icon: ScrollText, run: () => navigate('/audit') },
      { id: 'nav-health', label: t('nav.health'), icon: Shield, run: () => navigate('/health') },
      { id: 'nav-settings', label: t('nav.settings'), icon: SettingsIcon, run: () => navigate('/settings') },
    ]
    if (has('users:read')) navigation.push({ id: 'nav-users', label: t('nav.users'), icon: Users, run: () => navigate('/users') })
    if (has('*')) navigation.push({ id: 'nav-tenants', label: t('nav.tenants'), icon: KeyRound, run: () => navigate('/tenants') })

    const actions = [
      {
        id: 'action-refresh',
        label: t('actions.refresh'),
        icon: RefreshCw,
        run: () => {
          client.invalidateQueries()
          toast.success(t('actions.refresh'), companyName)
        },
      },
      {
        id: 'action-theme',
        label: t('actions.toggleTheme'),
        icon: isDark ? Sun : Moon,
        run: toggleTheme,
      },
      { id: 'action-reconnect', label: t('app.live'), icon: Activity, run: () => startRealtime() },
      {
        id: 'action-generate',
        label: t('capacity.generate'),
        icon: Bot,
        run: async () => {
          try {
            const { api } = await import('../../lib/api')
            await api.post('/api/capacity/generate', {})
            client.invalidateQueries({ queryKey: ['capacity'] })
            toast.success(t('capacity.generate'))
          } catch (error) {
            toast.error(t('errors.title'), error.message)
          }
        },
      },
    ]

    const processItems = (processes || []).slice(0, 40).map((name) => ({
      id: `process-${name}`,
      label: name,
      hint: t('nav.processes'),
      icon: Workflow,
      run: () => navigate(`/processes?process=${encodeURIComponent(name)}`),
    }))

    const all = [...actions, ...navigation, ...processItems]
    if (!query.trim()) return all
    const needle = query.trim().toLowerCase()
    return all.filter((item) => item.label.toLowerCase().includes(needle))
  }, [t, navigate, client, toast, companyName, toggleTheme, isDark, has, processes, query])

  useEffect(() => setCursor(0), [query])

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCursor((value) => Math.min(items.length - 1, value + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor((value) => Math.max(0, value - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const item = items[cursor]
      if (item) {
        item.run()
        onClose?.()
      }
    } else if (event.key === 'Escape') {
      onClose?.()
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[95] flex items-start justify-center bg-black/45 p-4 backdrop-blur-sm sm:pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}
        >
          <motion.div
            role="dialog"
            aria-label={t('actions.commandPalette')}
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="glass w-full max-w-xl overflow-hidden rounded-2xl border border-border shadow-pop"
          >
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <Search className="h-4 w-4 text-muted" aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder={`${t('actions.search')}…`}
                className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
                aria-label={t('actions.search')}
                aria-controls="command-palette-results"
                role="combobox"
                aria-expanded="true"
              />
              <kbd className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">ESC</kbd>
            </div>
            <ul id="command-palette-results" role="listbox" className="max-h-[55vh] overflow-y-auto p-2">
              {items.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-muted">{t('common.na')}</li>
              ) : (
                items.map((item, index) => (
                  <li key={item.id} role="option" aria-selected={index === cursor}>
                    <button
                      type="button"
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => {
                        item.run()
                        onClose?.()
                      }}
                      className={cx(
                        'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-sm transition',
                        index === cursor ? 'bg-brand-soft text-brand' : 'text-text hover:bg-surface-2',
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.hint ? <span className="text-[10px] uppercase tracking-wide text-muted">{item.hint}</span> : null}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
