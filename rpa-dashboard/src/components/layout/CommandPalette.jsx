/**
 * Command palette (Ctrl+K / ⌘K).
 *
 * The single fastest path through the product: navigate modules, jump to a
 * process, or run an action — without touching the mouse.
 *
 * Engineering notes:
 *  • Built on the Radix Dialog primitive, so focus is trapped, `Esc` closes and
 *    the rest of the page is `aria-hidden` automatically.
 *  • `fuzzyMatch()` scores *and* returns match indices, so results are ranked
 *    and the matched characters are highlighted — including in Arabic
 *    (diacritics/hamza are normalised, see `lib/utils.js`).
 *  • The result list is memoised on `query` only, and the keyboard handler runs
 *    through `useDeferredValue` so a 5 000-item catalogue cannot drop frames.
 *  • Recents are persisted per workstation — an operator reopening the palette
 *    mid-incident gets yesterday's shortcuts first.
 */
import { AnimatePresence, motion } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  ArrowRight,
  Bell,
  CornerDownLeft,
  FileSpreadsheet,
  FileText,
  Gauge,
  Languages,
  Moon,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Sun,
  Workflow,
} from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../../context/AuthProvider'
import { useBranding } from '../../context/BrandingProvider'
import { useTheme } from '../../context/ThemeProvider'
import { useToast } from '../../context/ToastProvider'
import { useAlerts, useSetAlertStatus } from '../../hooks/api'
import { applyLanguage, otherLanguage, LANGUAGES } from '../../i18n'
import { highlightSegments, fuzzyMatch } from '../../lib/utils'
import storage from '../../lib/storage'
import { startRealtime } from '../../lib/realtime'
import { prefetchRoute, routesFor } from '../../lib/routeMeta'
import { cn } from '../../lib/utils'
import { Dialog, DialogContent, Kbd } from '../ui'

const RECENTS_KEY = 'palette.recents'
const MAX_RECENTS = 5

function useRecents() {
  const [recents, setRecents] = useState(() => storage.get(RECENTS_KEY, []) || [])
  const remember = useCallback((id) => {
    setRecents((current) => {
      const next = [id, ...current.filter((item) => item !== id)].slice(0, MAX_RECENTS)
      storage.set(RECENTS_KEY, next)
      return next
    })
  }, [])
  return { recents, remember }
}

function Highlight({ text, indices }) {
  const segments = useMemo(() => highlightSegments(text, indices), [text, indices])
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark key={index} className="rounded-[3px] bg-brand/18 px-0.5 text-brand">
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  )
}

export default function CommandPalette({ open, onClose, processes = [] }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const client = useQueryClient()
  const toast = useToast()
  const { toggleTheme, isDark } = useTheme()
  const { has } = useAuth()
  const { companyName } = useBranding()
  const { recents, remember } = useRecents()
  const { data: openAlerts = [] } = useAlerts({ status: 'Open', limit: 20 }, { enabled: open })
  const { mutateAsync: acknowledgeAlert } = useSetAlertStatus()

  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const deferredQuery = useDeferredValue(query)

  useEffect(() => {
    if (!open) return undefined
    setQuery('')
    setCursor(0)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open])

  const items = useMemo(() => {
    const navigation = routesFor(has).map((route) => ({
      id: `nav-${route.id}`,
      group: 'navigation',
      label: t(route.labelKey),
      hint: t(route.descriptionKey),
      icon: route.icon,
      keywords: `${route.id} ${t(route.labelKey)} ${t(route.descriptionKey)}`,
      run: () => {
        prefetchRoute(route)
        navigate(route.path)
      },
    }))

    const theme = isDark ? t('settings.themeLight') : t('settings.themeDark')
    const alertActions = (openAlerts || []).slice(0, 5).map((alert) => ({
      id: `action-ack-alert-${alert.AlertID}`,
      group: 'actions',
      label: t('palette.acknowledgeAlert', { alert: alert.Title || `#${alert.AlertID}` }),
      hint: alert.Severity || t('alerts.title'),
      icon: Bell,
      keywords: `acknowledge alert ${alert.Title || ''} ${alert.Severity || ''} إقرار تنبيه`,
      run: async () => {
        try {
          await acknowledgeAlert({ id: alert.AlertID, status: 'Acknowledged' })
          toast.success(t('alerts.acknowledge'), alert.Title)
        } catch (error) {
          toast.error(t('errors.title'), error.message)
        }
      },
    }))
    const actions = [
      {
        id: 'action-theme',
        group: 'actions',
        label: t('palette.toggleTheme', { theme }),
        icon: isDark ? Sun : Moon,
        keywords: 'theme dark light مظهر داكن فاتح',
        run: toggleTheme,
      },
      {
        id: 'action-language',
        group: 'actions',
        label: t('palette.switchLanguage', { language: LANGUAGES.find((l) => l.code === otherLanguage())?.nativeLabel }),
        icon: Languages,
        keywords: 'language arabic english لغة عربي انجليزي',
        run: () => applyLanguage(otherLanguage()),
      },
      {
        id: 'action-refresh',
        group: 'actions',
        label: t('palette.refreshDashboard'),
        icon: RefreshCw,
        keywords: 'refresh reload تحديث',
        run: () => {
          client.invalidateQueries()
          toast.success(t('actions.refresh'), companyName)
        },
      },
      {
        id: 'action-reconnect',
        group: 'actions',
        label: t('a11y.realtimeReconnecting'),
        icon: Activity,
        keywords: 'realtime live stream بث مباشر',
        run: () => startRealtime(),
      },
      {
        id: 'action-export-excel',
        group: 'actions',
        label: t('palette.exportExcel'),
        icon: FileSpreadsheet,
        keywords: 'excel export تصدير',
        run: () => navigate('/?export=xlsx'),
      },
      {
        id: 'action-export-pdf',
        group: 'actions',
        label: t('palette.exportPdf'),
        icon: FileText,
        keywords: 'pdf report export تصدير تقرير',
        run: () => navigate('/?export=pdf'),
      },
      {
        id: 'action-capacity',
        group: 'actions',
        label: t('capacity.generate'),
        icon: Gauge,
        keywords: 'capacity advisor سعة توصيات',
        permission: 'capacity:act',
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
      ...alertActions,
    ].filter((item) => !item.permission || has(item.permission) || has('*'))

    const processItems = (processes || []).slice(0, 60).map((name) => ({
      id: `process-${name}`,
      group: 'processes',
      label: name,
      hint: t('palette.gotoProcess'),
      icon: Workflow,
      keywords: name,
      run: () => navigate(`/processes?process=${encodeURIComponent(name)}`),
    }))

    const all = [...actions, ...navigation, ...processItems]

    const needle = deferredQuery.trim()
    if (!needle) {
      // Without a query: recents first (in the order the operator used them),
      // then quick actions, then navigation.
      const recalled = recents
        .map((id) => all.find((item) => item.id === id))
        .filter(Boolean)
        .map((item) => ({ ...item, group: 'recents' }))
      const rest = all.filter((item) => !recents.includes(item.id))
      return [...recalled, ...rest]
    }

    const scored = []
    for (const item of all) {
      const direct = fuzzyMatch(item.label, needle)
      const indirect = direct || fuzzyMatch(item.keywords || '', needle)
      if (!indirect) continue
      scored.push({ ...item, score: indirect.score + (direct ? 40 : 0), indices: direct?.indices || [] })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 40)
  }, [t, has, processes, deferredQuery, recents, isDark, toggleTheme, client, toast, companyName, navigate, openAlerts, acknowledgeAlert])

  useEffect(() => {
    setCursor(0)
  }, [deferredQuery])

  useEffect(() => {
    if (!listRef.current) return
    const node = listRef.current.querySelector(`[data-index="${cursor}"]`)
    node?.scrollIntoView?.({ block: 'nearest' })
  }, [cursor, items])

  const run = useCallback(
    (item) => {
      if (!item) return
      remember(item.id)
      onClose?.()
      item.run()
    },
    [onClose, remember],
  )

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCursor((value) => Math.min(items.length - 1, value + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor((value) => Math.max(0, value - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      run(items[cursor])
    } else if (event.key === 'Home' && event.ctrlKey) {
      event.preventDefault()
      setCursor(0)
    } else if (event.key === 'End' && event.ctrlKey) {
      event.preventDefault()
      setCursor(items.length - 1)
    }
  }

  const groupLabels = {
    recents: t('palette.recents'),
    actions: t('palette.quickActions'),
    navigation: t('palette.navigation'),
    processes: t('palette.processes'),
  }

  const rendered = useMemo(() => {
    const buckets = []
    let lastGroup = null
    items.forEach((item, index) => {
      if (item.group !== lastGroup) {
        buckets.push({ type: 'label', key: `label-${item.group}-${index}`, label: groupLabels[item.group] || '' })
        lastGroup = item.group
      }
      buckets.push({ type: 'item', key: item.id, item, index })
    })
    return buckets
  }, [items, groupLabels])

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose?.() : undefined)}>
      {open ? (
        <DialogContent hideClose size="sm" className="max-w-[min(96vw,40rem)] overflow-hidden p-0">
          <div className="flex items-center gap-3 border-b border-border/80 px-4 py-3.5">
            <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t('palette.placeholder')}
              aria-label={t('palette.label')}
              role="combobox"
              aria-expanded="true"
              aria-controls="command-palette-results"
              aria-activedescendant={items[cursor] ? `command-option-${cursor}` : undefined}
              className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted/80"
            />
            <Kbd>ESC</Kbd>
          </div>

          <ul id="command-palette-results" ref={listRef} role="listbox" className="max-h-[min(58vh,26rem)] overflow-y-auto overscroll-contain p-2">
            {items.length === 0 ? (
              <li className="flex flex-col items-center gap-1.5 px-4 py-10 text-center">
                <Search className="h-5 w-5 text-muted/70" aria-hidden />
                <p className="text-sm font-medium text-text">{t('palette.empty')}</p>
                <p className="max-w-xs text-xs leading-relaxed text-muted">{t('palette.emptyHint')}</p>
              </li>
            ) : (
              rendered.map((entry) =>
                entry.type === 'label' ? (
                  <li key={entry.key} className="px-2.5 pt-3 pb-1 text-[10px] font-semibold tracking-[0.14em] text-muted uppercase">
                    {entry.label}
                  </li>
                ) : (
                  <li
                    key={entry.key}
                    id={`command-option-${entry.index}`}
                    role="option"
                    aria-selected={entry.index === cursor}
                    data-index={entry.index}
                  >
                    <button
                      type="button"
                      onMouseMove={() => setCursor(entry.index)}
                      onClick={() => run(entry.item)}
                      className={cn(
                        'group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-start text-sm transition-colors duration-150',
                        entry.index === cursor ? 'bg-brand-soft text-brand' : 'text-text-soft hover:bg-surface-2',
                      )}
                    >
                      <span
                        className={cn(
                          'grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-border/70 bg-surface-2',
                          entry.index === cursor && 'border-brand/30 bg-surface text-brand',
                        )}
                      >
                        {entry.item.icon ? <entry.item.icon className="h-3.5 w-3.5" aria-hidden /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate" dir="auto">
                          <Highlight text={entry.item.label} indices={entry.item.indices} />
                        </span>
                        {entry.item.hint ? (
                          <span className="mt-0.5 block truncate text-[11px] text-muted" dir="auto">
                            {entry.item.hint}
                          </span>
                        ) : null}
                      </span>
                      {entry.index === cursor ? (
                        <motion.span initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className="shrink-0 text-brand/70">
                          <CornerDownLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
                        </motion.span>
                      ) : (
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted/0 rtl:rotate-180" aria-hidden />
                      )}
                    </button>
                  </li>
                ),
              )
            )}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/80 bg-surface-2/60 px-4 py-2.5 text-[11px] text-muted">
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                {t('palette.hintNavigate')}
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>↵</Kbd>
                {t('palette.hintSelect')}
              </span>
              <span className="hidden items-center gap-1.5 sm:flex">
                <Kbd>Esc</Kbd>
                {t('palette.hintClose')}
              </span>
            </span>
            {query ? <span>{t('palette.resultsCount', { count: items.length })}</span> : null}
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

export { AnimatePresence, SettingsIcon }
