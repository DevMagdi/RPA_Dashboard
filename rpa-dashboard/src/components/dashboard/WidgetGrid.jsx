/**
 * Draggable / resizable dashboard grid (react-grid-layout v2).
 *
 * Operational users reorder panels to match their shift routine, and the
 * layout is remembered per browser (`rpa.layout.dashboard`).  Editing is opt-in
 * so an accidental drag can never disturb a live wallboard.
 */
import { MotionConfig } from 'framer-motion'
import { Check, GripVertical, RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ResponsiveGridLayout, useContainerWidth } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'

import { DEFAULT_WIDGET_LAYOUT } from '../../lib/constants'
import storage from '../../lib/storage'
import { Button, Card, cx } from '../ui'

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
  return Object.fromEntries(
    Object.entries(COLS).map(([breakpoint, cols]) => [breakpoint, scaleLayout(base, cols)]),
  )
}

function WidgetFrame({ id, title, editing, onHide, children, actions }) {
  const { t } = useTranslation()
  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {editing ? (
            <span className="widget-drag-handle cursor-grab text-muted active:cursor-grabbing" title={t('actions.customise')}>
              <GripVertical className="h-4 w-4" />
            </span>
          ) : null}
          <h2 className="truncate text-sm font-semibold text-text">{title}</h2>
        </div>
        <div className="flex items-center gap-1">
          {actions}
          {editing ? (
            <button
              type="button"
              onClick={() => onHide(id)}
              className="focus-ring rounded-lg p-1 text-muted transition hover:bg-danger-soft hover:text-danger"
              aria-label={`${t('actions.dismiss')} ${title}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </Card>
  )
}

export default function WidgetGrid({ widgets, hidden, onToggleHidden, onReset }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
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
  }, [])

  const reset = () => {
    const fresh = defaultLayouts(enabledIds)
    setLayouts(fresh)
    storage.remove(LAYOUT_KEY)
    onReset?.()
  }

  const avoidCollisionProps = { verticalCompact: true }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">{t('actions.customise')}</p>
        <div className="flex items-center gap-2">
          {hidden.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              {hidden.map((widget) => (
                <Button key={widget.id} size="sm" variant="ghost" onClick={() => onToggleHidden(widget.id, false)}>
                  + {widget.title}
                </Button>
              ))}
            </div>
          ) : null}
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={reset}>
            {t('actions.resetLayout')}
          </Button>
          <Button
            size="sm"
            variant={editing ? 'success' : 'secondary'}
            icon={editing ? Check : SlidersHorizontal}
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? t('actions.save') : t('actions.customise')}
          </Button>
        </div>
      </div>

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
              {...avoidCollisionProps}
            >
              {widgets.map((widget) => (
                <div key={widget.id} className={cx('transition-shadow', editing && 'ring-1 ring-brand-soft')}>
                  <WidgetFrame id={widget.id} title={widget.title} editing={editing} onHide={(id) => onToggleHidden(id, true)} actions={widget.actions}>
                    {widget.render()}
                  </WidgetFrame>
                </div>
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
