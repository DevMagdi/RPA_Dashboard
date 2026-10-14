/**
 * Draggable / resizable dashboard grid (react-grid-layout v2).
 *
 * Operational users reorder panels to match their shift routine, and the
 * layout is remembered per workstation (`rpa.layout.dashboard`).  Editing is
 * opt-in so an accidental drag can never disturb a live wallboard.
 *
 * Performance: while a card is being dragged or resized its children are
 * replaced by a lightweight placeholder.  Recharts re-renders are the most
 * expensive thing on this screen, and skipping them during interaction is what
 * keeps dragging smooth on a four-year-old bank workstation.
 */
import { MotionConfig, motion } from 'framer-motion'
import { Check, Eye, GripVertical, LayoutGrid, RotateCcw, SlidersHorizontal, Sparkles, X } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ResponsiveGridLayout, useContainerWidth } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'

import { DEFAULT_WIDGET_LAYOUT } from '../../lib/constants'
import storage from '../../lib/storage'
import { Button, Card, Kbd, Notice, Popover, Skeleton, Tooltip, cn } from '../ui'

const LAYOUT_KEY = 'layout.dashboard'
const HIDDEN_KEY = 'widgets.hidden'

export const BREAKPOINTS = { lg: 1200, md: 900, sm: 560, xs: 0 }
export const COLS = { lg: 12, md: 8, sm: 4, xs: 2 }

/** Fit a 12-column layout onto narrower breakpoints without losing items. */
function scaleLayout(layout, cols) {
  return layout.map((item) => {
    const width = Math.min(item.w, cols)
    const x = Math.min(item.x, Math.max(0, cols - width))
    return { ...item, x, w: width, minW: Math.min(item.minW || 1, cols) }
  })
}

function defaultLayouts(enabledIds) {
  const base = DEFAULT_WIDGET_LAYOUT.filter((item) => enabledIds.includes(item.i))
  return Object.fromEntries(Object.entries(COLS).map(([breakpoint, cols]) => [breakpoint, scaleLayout(base, cols)]))
}

function WidgetFrame({ id, title, editing, onHide, children, actions, dragging }) {
  const { t } = useTranslation()
  return (
    <Card className={cn('group flex h-full flex-col overflow-hidden', editing && 'border-brand/25 shadow-pop')}>
      <header className="flex items-center justify-between gap-2 border-b border-border/80 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {editing ? (
            <Tooltip content={t('dashboard.layoutHint')} side="bottom">
              <span className="widget-drag-handle cursor-grab rounded-lg p-1 text-muted transition-colors hover:bg-brand-soft hover:text-brand active:cursor-grabbing">
                <GripVertical className="h-4 w-4"  aria-hidden/>
              </span>
            </Tooltip>
          ) : (
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand/40" />
          )}
          <h2 className="truncate text-sm font-semibold text-text">{title}</h2>
        </div>
        <div className="flex items-center gap-1">
          {actions}
          {editing ? (
            <button
              type="button"
              onClick={() => onHide(id)}
              className="focus-ring grid h-7 w-7 place-items-center rounded-lg text-muted transition-colors hover:bg-danger-soft hover:text-danger"
              aria-label={`${t('dashboard.hideWidget')}: ${title}`}
            >
              <X className="h-3.5 w-3.5"  aria-hidden/>
            </button>
          ) : null}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">{dragging ? <Skeleton className="h-full w-full rounded-none" /> : children}</div>
    </Card>
  )
}

export default function WidgetGrid({ widgets, hidden, onToggleHidden, onReset }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draggingId, setDraggingId] = useState(null)
  const [savedAt, setSavedAt] = useState(null)
  const [hiddenOpen, setHiddenOpen] = useState(false)
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true })

  const enabledIds = useMemo(() => widgets.map((widget) => widget.id), [widgets])

  const [layouts, setLayouts] = useState(() => {
    const saved = storage.get(LAYOUT_KEY, null)
    if (!saved || typeof saved !== 'object') return defaultLayouts(enabledIds)
    // Merge in any widget added since the layout was saved
    const merged = { ...defaultLayouts(enabledIds) }
    Object.entries(saved).forEach(([breakpoint, items]) => {
      if (!Array.isArray(items)) return
      const known = items.filter((item) => enabledIds.includes(item.i))
      const added = merged[breakpoint].filter((item) => !known.some((knownItem) => knownItem.i === item.i))
      merged[breakpoint] = [...known, ...added]
    })
    return merged
  })

  const persist = useCallback((_layout, allLayouts) => {
    setLayouts(allLayouts)
    storage.set(LAYOUT_KEY, allLayouts)
    setSavedAt(Date.now())
  }, [])

  const reset = () => {
    const fresh = defaultLayouts(enabledIds)
    setLayouts(fresh)
    storage.remove(LAYOUT_KEY)
    onReset?.()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs text-muted">
          <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
          {t('dashboard.widgets')}
          {savedAt ? (
            <span className="inline-flex items-center gap-1 text-success">
              <Check className="h-3 w-3" aria-hidden />
              {t('dashboard.savedLayout')}
            </span>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {hidden.length > 0 ? (
            <Popover
              open={hiddenOpen}
              onOpenChange={setHiddenOpen}
              contentClassName="w-64"
              trigger={
                <Button size="sm" variant="ghost" icon={Eye}>
                  {t('dashboard.hidden', { count: hidden.length })}
                </Button>
              }
            >
              <div className="p-2">
                <p className="px-1.5 py-1 text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">{t('dashboard.widgets')}</p>
                <ul className="mt-1 space-y-0.5">
                  {hidden.map((widget) => (
                    <li key={widget.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onToggleHidden(widget.id, false)
                          setHiddenOpen(false)
                        }}
                        className="focus-ring flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-start text-sm text-text-soft transition-colors hover:bg-surface-2"
                      >
                        <span className="truncate">{widget.title}</span>
                        <Sparkles className="h-3.5 w-3.5 text-brand" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </Popover>
          ) : null}
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={reset}>
            {t('actions.resetLayout')}
          </Button>
          <Button
            size="sm"
            variant={editing ? 'success' : 'secondary'}
            icon={editing ? Check : SlidersHorizontal}
            onClick={() => setEditing((value) => !value)}
            aria-pressed={editing}
          >
            {editing ? t('actions.save') : t('actions.customise')}
          </Button>
        </div>
      </div>

      {editing ? (
        <Notice tone="info" icon={SlidersHorizontal}>
          {t('dashboard.layoutHint')} <Kbd className="ms-1">Esc</Kbd>
        </Notice>
      ) : null}

      <div ref={containerRef} className="rpa-grid-container">
        {mounted ? (
          <MotionConfig reducedMotion="user">
            <ResponsiveGridLayout
              width={width}
              breakpoints={BREAKPOINTS}
              cols={COLS}
              layouts={layouts}
              rowHeight={56}
              margin={[14, 14]}
              containerPadding={[0, 0]}
              isDraggable={editing}
              isResizable={editing}
              draggableHandle=".widget-drag-handle"
              onLayoutChange={persist}
              onDragStart={(_layout, _old, item) => setDraggingId(item?.i ?? null)}
              onDragStop={() => setDraggingId(null)}
              onResizeStart={(_layout, _old, item) => setDraggingId(item?.i ?? null)}
              onResizeStop={() => setDraggingId(null)}
              verticalCompact
            >
              {widgets.map((widget, index) => (
                <motion.div
                  key={widget.id}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.36, delay: Math.min(index * 0.05, 0.35), ease: [0.22, 1, 0.36, 1] }}
                  className={cn('transition-shadow duration-200', editing && 'ring-1 ring-brand-soft ring-offset-2 ring-offset-bg rounded-2xl')}
                >
                  <WidgetFrame
                    id={widget.id}
                    title={widget.title}
                    editing={editing}
                    dragging={draggingId === widget.id}
                    onHide={(id) => onToggleHidden(id, true)}
                    actions={widget.actions}
                  >
                    {widget.render()}
                  </WidgetFrame>
                </motion.div>
              ))}
            </ResponsiveGridLayout>
          </MotionConfig>
        ) : (
          <Card className="h-64 animate-pulse-soft" />
        )}
      </div>
    </div>
  )
}

export { LAYOUT_KEY, HIDDEN_KEY }
