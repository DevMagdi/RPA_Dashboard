/**
 * The UI kit — one import surface for the whole dashboard.
 *
 * Layer 1: `./primitives.jsx` — shadcn/ui-style building blocks (Radix + CVA).
 * Layer 2: this file — the *product* components composed from them (data table,
 *          stat cards, section headers, notices, modals, pagination…).
 *
 * Compatibility: every component name the pages already import keeps its
 * original signature, so the redesign never turned into a 400-file refactor.
 * New props (`virtual`, `stickyHeader`, `zebra`, `tone`, …) are additive.
 *
 * Everything is theme-agnostic (CSS variables), RTL-correct (logical spacing)
 * and WCAG-minded (focus rings, aria attributes, keyboard interaction,
 * reduced-motion).
 */
import { motion } from 'framer-motion'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Inbox,
  Info,
  Loader2,
  Minus,
  Search,
  X,
} from 'lucide-react'
import { Component, memo, useCallback, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useCountUp, useIsMobile } from '../../hooks/ui'
import { useDirection } from '../../lib/direction'
import { compactNumber, currency, dirFor } from '../../lib/format'
import { cn } from '../../lib/utils'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
  DropdownSeparator,
  Input,
  Kbd,
  Label,
  Popover,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  Separator,
  Skeleton,
  SkeletonText,
  SwitchControl,
  TabsContent,
  TabsList,
  TabsRoot,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipProvider,
  TooltipRoot,
} from './primitives'

export * from './primitives'
export { cn, cn as cx }

/* ------------------------------------------------------------------ toasts */

/** Imperative-free toast stack used by ToastProvider (kept for compatibility). */
export function ToastCard({ tone = 'info', title, description, action, onClose }) {
  const tones = {
    info: { icon: Info, className: 'text-info', border: 'border-info/25' },
    success: { icon: Check, className: 'text-success', border: 'border-success/25' },
    warning: { icon: AlertTriangle, className: 'text-warning', border: 'border-warning/25' },
    danger: { icon: AlertCircle, className: 'text-danger', border: 'border-danger/25' },
  }
  const config = tones[tone] || tones.info
  const Icon = config.icon
  return (
    <div className={cn('pointer-events-auto flex w-[min(92vw,23rem)] items-start gap-3 rounded-2xl border bg-surface/95 p-3.5 shadow-pop backdrop-blur-xl', config.border)}>
      <span className={cn('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-xl bg-surface-2', config.className)}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        {title ? <p className="text-sm font-semibold text-text">{title}</p> : null}
        {description ? <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p> : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
      {onClose ? (
        <button type="button" onClick={onClose} className="focus-ring rounded-lg p-1 text-muted transition-colors hover:bg-surface-2 hover:text-text" aria-label="close">
          <X className="h-3.5 w-3.5"  aria-hidden/>
        </button>
      ) : null}
    </div>
  )
}

/* ---------------------------------------------------------------- statuses */

/** Severity badge used by the Capacity Advisor (Info / Warning / Critical). */
export function SeverityBadge({ severity, label, className }) {
  const { t } = useTranslation()
  const tone = severity === 'Critical' ? 'danger' : severity === 'Warning' ? 'warning' : 'info'
  const key = `capacity.severity.${severity}`
  const text = label || t(key, { defaultValue: severity })
  return (
    <Badge tone={tone} dot className={className}>
      {text}
    </Badge>
  )
}

/** Pulsing live dot — used by machine rows, the realtime pill and run cards. */
export function StatusDot({ color = 'var(--success)', pulse = false, label, className }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)} title={label}>
      <span className="relative flex h-2.5 w-2.5">
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        {pulse ? <span className="live-dot absolute inset-0" style={{ color }} aria-hidden /> : null}
      </span>
      {label ? <span className="text-xs text-muted">{label}</span> : null}
    </span>
  )
}

/* ------------------------------------------------------------- empty/error */

export function EmptyState({ icon: Icon = Inbox, title, description, action, secondaryAction, className, tone = 'brand', compact = false }) {
  const tones = {
    brand: 'from-brand-soft/70 text-brand',
    muted: 'from-surface-3/70 text-muted',
    success: 'from-success-soft/70 text-success',
    danger: 'from-danger-soft/70 text-danger',
  }
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 text-center', compact ? 'px-4 py-6' : 'px-6 py-12', className)}>
      <span className={cn('grid h-13 w-13 place-items-center rounded-2xl border border-border/80 bg-gradient-to-br to-surface-2 shadow-soft', tones[tone] || tones.brand)}>
        <Icon className="h-5.5 w-5.5" aria-hidden />
      </span>
      <div className="max-w-md">
        <p className="text-sm font-semibold text-text">{title}</p>
        {description ? <p className="mt-1 text-xs leading-relaxed text-muted text-pretty">{description}</p> : null}
      </div>
      {action || secondaryAction ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  )
}

export function ErrorState({ error, onRetry, title, retryLabel, className, compact = false }) {
  const { t } = useTranslation()
  const code = error?.code
  const message =
    error?.message ||
    (code === 'network_error' ? t('errors.network') : t('errors.title'))
  return (
    <EmptyState
      tone="danger"
      icon={AlertCircle}
      className={className}
      compact={compact}
      title={title || t('errors.title')}
      description={
        <>
          {message}
          {error?.requestId ? (
            <span className="mt-1 block font-mono text-[10px] text-muted/80" dir="ltr">
              {t('errors.requestId')}: {error.requestId}
            </span>
          ) : null}
        </>
      }
      action={
        onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {retryLabel || t('actions.retry')}
          </Button>
        ) : null
      }
    />
  )
}

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // In a bank deployment this is where the SPA would ship the error to the
    // backend log collector; the console keeps it for support tickets.
    console.error('UI error boundary', error, info)
  }

  render() {
    const { error } = this.state
    const { children, fallback, title } = this.props
    if (!error) return children
    if (fallback) return typeof fallback === 'function' ? fallback(error, () => this.setState({ error: null })) : fallback
    return (
      <Card className="m-2">
        <EmptyState
          tone="danger"
          icon={AlertCircle}
          title={title || 'This section failed to render'}
          description={error.message}
          action={
            <Button variant="secondary" size="sm" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
          }
        />
      </Card>
    )
  }
}

/* ------------------------------------------------------------------ spacing */

export function CardBody({ className, children }) {
  return <CardContent className={className}>{children}</CardContent>
}

/** Section heading used at the top of every page. */
export function SectionTitle({ title, subtitle, actions, className, eyebrow, breadcrumb, icon: Icon }) {
  return (
    <div className={cn('mb-5 flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        {breadcrumb ? <div className="mb-1.5 flex items-center gap-1.5 text-2xs text-muted">{breadcrumb}</div> : null}
        {eyebrow ? <p className="mb-1.5 text-2xs font-semibold tracking-[0.16em] text-brand uppercase">{eyebrow}</p> : null}
        <h1 className="flex items-center gap-3 text-xl font-semibold tracking-[-0.02em] text-text sm:text-2xl">
          {Icon ? (
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-gradient text-brand-fg shadow-glow" aria-hidden>
              <Icon className="h-5 w-5" />
            </span>
          ) : null}
          <span className="min-w-0">{title}</span>
        </h1>
        {subtitle ? <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted sm:text-sm text-pretty">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function Spinner({ className, label }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-muted', className)} role="status">
      <Loader2 className="h-4 w-4 animate-spin-slow" aria-hidden />
      {label ? <span className="text-xs">{label}</span> : null}
    </span>
  )
}

/** Inline skeleton block for cards (kept for compatibility). */
export function SkeletonCard({ height = 160 }) {
  return (
    <Card className="p-4">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="mt-3" style={{ height: height - 40 }} />
    </Card>
  )
}

export function Notice({ tone = 'info', title, children, icon: CustomIcon, action, className, onDismiss }) {
  const tones = {
    info: { wrap: 'border-info/25 bg-info-soft/70', icon: Info, colour: 'text-info' },
    warning: { wrap: 'border-warning/25 bg-warning-soft/70', icon: AlertTriangle, colour: 'text-warning' },
    danger: { wrap: 'border-danger/25 bg-danger-soft/70', icon: AlertCircle, colour: 'text-danger' },
    success: { wrap: 'border-success/25 bg-success-soft/70', icon: Check, colour: 'text-success' },
  }
  const config = tones[tone] || tones.info
  const Icon = CustomIcon || config.icon
  return (
    <div className={cn('flex items-start gap-3 rounded-2xl border p-3.5 text-sm shadow-xs', config.wrap, className)} role="status">
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', config.colour)} aria-hidden />
      <div className="min-w-0 flex-1">
        {title ? <p className={cn('text-sm font-semibold', config.colour)}>{title}</p> : null}
        {children ? <div className={cn('text-xs leading-relaxed text-text-soft', title && 'mt-0.5')}>{children}</div> : null}
      </div>
      {action}
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className="focus-ring rounded-lg p-1 text-muted transition-colors hover:bg-surface-2 hover:text-text" aria-label="dismiss">
          <X className="h-3.5 w-3.5"  aria-hidden/>
        </button>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------- forms */

export function Field({ label, hint, error, required, children, htmlFor, className }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label ? (
        <Label htmlFor={htmlFor} required={required}>
          {label}
        </Label>
      ) : null}
      {children}
      {error ? (
        <p className="flex items-center gap-1.5 text-xs text-danger" role="alert">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p className="text-2xs leading-relaxed text-muted">{hint}</p>
      ) : null}
    </div>
  )
}

export function Switch({ checked, onChange, label, disabled, id, className }) {
  const generated = useId()
  const inputId = id || generated
  return (
    <div className={cn('inline-flex items-center gap-2.5', className)}>
      <SwitchControl id={inputId} checked={Boolean(checked)} onCheckedChange={(value) => onChange?.(value)} disabled={disabled} />
      {label ? (
        <label htmlFor={inputId} className={cn('cursor-pointer text-sm text-text', disabled && 'cursor-not-allowed opacity-60')}>
          {label}
        </label>
      ) : null}
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder, className, onClear, icon: Icon = Search, autoFocus = false, inputRef }) {
  const { t } = useTranslation()
  return (
    <div className={cn('relative', className)}>
      <Icon className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
      <Input
        ref={inputRef}
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="ps-9 pe-9"
        aria-label={placeholder}
      />
      {value ? (
        <button
          type="button"
          onClick={() => (onClear ? onClear() : onChange(''))}
          className="focus-ring absolute end-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text"
          aria-label={t('actions.clear')}
        >
          <X className="h-3.5 w-3.5"  aria-hidden/>
        </button>
      ) : null}
    </div>
  )
}

export function CopyButton({ value, label, className, size = 'icon-sm' }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size={size}
      className={className}
      title={label || t('actions.copy')}
      aria-label={label || t('actions.copy')}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(String(value ?? ''))
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        } catch {
          /* clipboard blocked — silently ignore, the value is still visible */
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success"  aria-hidden/> : <Copy className="h-3.5 w-3.5"  aria-hidden/>}
    </Button>
  )
}

/* -------------------------------------------------------------------- tabs */

/** Legacy prop-driven tabs: `tabs=[{ value, label, icon, badge }]`. */
export function Tabs({ tabs = [], value, onChange, className, contentClassName, children }) {
  return (
    <TabsRoot value={value} onValueChange={onChange} className={className}>
      <TabsList>
        {tabs.map((tab, index) => {
          const tabValue = tab.value ?? tab.key ?? String(index)
          return (
            <TabsTrigger key={tabValue} value={tabValue} disabled={tab.disabled}>
              {tab.icon ? <tab.icon className="h-3.5 w-3.5" aria-hidden /> : null}
              {tab.label}
              {tab.badge ? <Badge tone={tab.badgeTone || 'neutral'} size="sm">{tab.badge}</Badge> : null}
            </TabsTrigger>
          )
        })}
      </TabsList>
      {children ? <TabsContent className={contentClassName}>{children}</TabsContent> : null}
    </TabsRoot>
  )
}

/* ---------------------------------------------------------------- progress */

export function ProgressBar({ value = 0, max = 100, tone, className, showLabel = false, label, ariaLabel, size = 'md' }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Progress
        value={value}
        max={max}
        tone={tone}
        aria-label={ariaLabel || label}
        className={cn(size === 'sm' ? 'h-1' : 'h-1.5')}
      />
      {showLabel ? (
        <span className="w-10 shrink-0 text-end text-2xs tabular text-muted">{Math.round(max ? (value / max) * 100 : 0)}%</span>
      ) : null}
      {label ? <span className="shrink-0 text-2xs text-muted">{label}</span> : null}
    </div>
  )
}

/* ------------------------------------------------------------------- stats */

export function CountUpStat({ value, format = 'number', className, duration = 900, suffix }) {
  const animated = useCountUp(value, duration)
  const rendered =
    format === 'currency'
      ? currency(animated)
      : format === 'percent'
        ? `${Number(animated).toFixed(1)}%`
        : format === 'compact'
          ? compactNumber(animated)
          : Math.round(Number(animated) || 0).toLocaleString()
  return (
    <span className={cn('stat-number', className)}>
      {rendered}
      {suffix ? <span className="ms-0.5 text-2xs font-medium text-muted">{suffix}</span> : null}
    </span>
  )
}

const STAT_TONES = {
  brand: 'bg-brand-soft text-brand ring-brand/12',
  info: 'bg-info-soft text-info ring-info/12',
  success: 'bg-success-soft text-success ring-success/12',
  warning: 'bg-warning-soft text-warning ring-warning/12',
  danger: 'bg-danger-soft text-danger ring-danger/12',
  accent: 'bg-accent-soft text-accent-strong ring-accent/12',
}

export const Stat = memo(function Stat({ label, value, format, hint, tone = 'brand', icon: Icon, delta, className, layout = 'card', onClick }) {
  const interactive = Boolean(onClick)
  return (
    <Card
      hover={interactive}
      onClick={onClick}
      className={cn('relative overflow-hidden', layout === 'card' ? 'p-4' : 'p-3', interactive && 'cursor-pointer', className)}
    >
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/25 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted">{label}</p>
          <p className="mt-1 truncate text-xl font-semibold text-text">
            {typeof value === 'number' ? <CountUpStat value={value} format={format} /> : value}
          </p>
          {delta !== undefined && delta !== null ? (
            <p className={cn('mt-0.5 inline-flex items-center gap-0.5 text-xs font-medium', Number(delta) >= 0 ? 'text-success' : 'text-danger')}>
              {Number(delta) >= 0 ? <ArrowUpRight className="h-3 w-3" aria-hidden /> : <ArrowDownRight className="h-3 w-3" aria-hidden />}
              {Number(delta).toFixed(1)}%
            </p>
          ) : hint ? (
            <p className="mt-0.5 truncate text-2xs text-muted" dir="auto">
              {hint}
            </p>
          ) : null}
        </div>
        {Icon ? (
          <span className={cn('grid h-9.5 w-9.5 shrink-0 place-items-center rounded-xl ring-1', STAT_TONES[tone] || STAT_TONES.brand)}>
            <Icon className="h-4.5 w-4.5" aria-hidden />
          </span>
        ) : null}
      </div>
    </Card>
  )
})

export function InfoTile({ label, value, tone = 'neutral', icon: Icon, className, mono = false }) {
  const tones = {
    neutral: 'text-text',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
    info: 'text-info',
    muted: 'text-muted',
  }
  return (
    <div className={cn('rounded-xl border border-border/80 bg-surface-2/60 px-3 py-2 transition-colors hover:border-border-strong', className)}>
      <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.1em] text-muted uppercase">
        {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
        {label}
      </p>
      <p className={cn('mt-1 text-sm font-semibold tabular', tones[tone] || tones.neutral, mono && 'font-mono text-xs')} dir="auto">
        {value}
      </p>
    </div>
  )
}

/** Compact trend indicator used in cards and tables. */
export function TrendPill({ value, invert = false, suffix = '%', className }) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return <span className="text-muted">—</span>
  const positive = invert ? amount < 0 : amount > 0
  const neutral = amount === 0
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold',
        neutral ? 'bg-surface-2 text-muted' : positive ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
        className,
      )}
    >
      {neutral ? <Minus className="h-3 w-3" aria-hidden /> : positive ? <ArrowUpRight className="h-3 w-3" aria-hidden /> : <ArrowDownRight className="h-3 w-3" aria-hidden />}
      {Math.abs(amount).toFixed(1)}
      {suffix}
    </span>
  )
}

/* ---------------------------------------------------------------- datatable */

const DEFAULT_ROW_HEIGHT = 45

/**
 * Accessible, responsive, optionally **virtualised** table.
 *
 * Columns: `{ key, header, render?, align?, width?, sortable?, className?, dir? }`.
 * Small screens get a stacked card layout; a large result set (400+ rows, e.g.
 * audit history) only renders the ~15 rows on screen thanks to
 * `@tanstack/react-virtual`, which is what keeps the page at 60 fps.
 */
export function DataTable({
  columns = [],
  rows = [],
  rowKey,
  loading,
  empty,
  onRowClick,
  dense = false,
  className,
  footer,
  sort,
  onSortChange,
  virtual = true,
  maxHeight = 560,
  stickyHeader = true,
  zebra = false,
  caption,
}) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const [internalSort, setInternalSort] = useState(null)
  const activeSort = sort || internalSort
  const scrollRef = useRef(null)

  const sorted = useMemo(() => {
    if (!activeSort || !activeSort.key || onSortChange) return rows || []
    const list = [...(rows || [])]
    const { key, dir } = activeSort
    list.sort((a, b) => {
      const left = a?.[key]
      const right = b?.[key]
      if (left === right) return 0
      if (left === null || left === undefined) return 1
      if (right === null || right === undefined) return -1
      if (typeof left === 'number' && typeof right === 'number') return dir === 'asc' ? left - right : right - left
      return dir === 'asc' ? String(left).localeCompare(String(right)) : String(right).localeCompare(String(left))
    })
    return list
  }, [rows, activeSort, onSortChange])

  const rowHeight = dense ? 38 : DEFAULT_ROW_HEIGHT
  const shouldVirtualize = virtual && !isMobile && sorted.length >= 80

  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? sorted.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  })

  const handleSort = useCallback(
    (key) => {
      if (!key) return
      const next = { key, dir: activeSort?.key === key && activeSort.dir === 'asc' ? 'desc' : 'asc' }
      if (onSortChange) onSortChange(next)
      else setInternalSort(next)
    },
    [activeSort, onSortChange],
  )

  if (loading && !rows?.length) {
    return (
      <div className="space-y-2 p-4" aria-busy="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-8" style={{ opacity: 1 - index * 0.12 }} />
        ))}
      </div>
    )
  }

  if (!loading && !rows?.length) {
    return empty || <EmptyState title={t('common.nothingToShow')} description={t('common.noDataHint')} />
  }

  const virtualItems = shouldVirtualize ? virtualizer.getVirtualItems() : null
  const paddingTop = virtualItems?.length ? virtualItems[0].start : 0
  const paddingBottom = virtualItems?.length ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end : 0
  const visibleRows = virtualItems ? virtualItems.map((item) => sorted[item.index]) : sorted

  const headerRow = (
    <tr className="border-b border-border bg-surface-2/70 text-[10px] font-semibold tracking-[0.1em] text-muted uppercase">
      {columns.map((column) => (
        <th
          key={column.key}
          scope="col"
          style={column.width ? { width: column.width } : undefined}
          className={cn(
            'select-none px-3 text-start font-semibold',
            dense ? 'py-1.5' : 'py-2.5',
            column.align === 'end' && 'text-end',
            column.align === 'center' && 'text-center',
          )}
          aria-sort={activeSort?.key === column.key ? (activeSort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
        >
          {column.sortable ? (
            <button
              type="button"
              onClick={() => handleSort(column.key)}
              className="focus-ring inline-flex items-center gap-1 rounded text-[10px] tracking-[0.1em] uppercase transition-colors hover:text-text"
            >
              {column.header}
              <span className="text-[9px] opacity-70">
                {activeSort?.key === column.key ? (activeSort.dir === 'asc' ? '▲' : '▼') : '↕'}
              </span>
            </button>
          ) : (
            column.header
          )}
        </th>
      ))}
    </tr>
  )

  return (
    <div className={cn('w-full', className)}>
      <div ref={scrollRef} className="relative w-full overflow-auto" style={shouldVirtualize ? { maxHeight } : undefined}>
        <table className={cn('data-table w-full min-w-[680px] border-collapse text-sm', stickyHeader && 'border-separate border-spacing-0')}>
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead className={cn(stickyHeader && 'sticky top-0 z-10 bg-surface-2/95 backdrop-blur-sm')}>{headerRow}</thead>
          <tbody>
            {paddingTop > 0 ? <tr aria-hidden style={{ height: paddingTop }} /> : null}
            {visibleRows.map((row, index) => (
              <tr
                key={rowKey ? rowKey(row, index) : index}
                className={cn(
                  'border-b border-border/70 transition-colors last:border-0 hover:bg-brand-soft/40',
                  onRowClick && 'cursor-pointer focus-within:bg-brand-soft/50',
                  zebra && index % 2 === 1 && 'bg-surface-2/40',
                )}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                style={shouldVirtualize ? { height: rowHeight } : undefined}
                onKeyDown={
                  onRowClick
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onRowClick(row)
                        }
                      }
                    : undefined
                }
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    dir={column.dir === 'auto' ? dirFor(row?.[column.key]) : undefined}
                    className={cn(
                      'px-3 align-middle text-text',
                      dense ? 'py-1.5' : 'py-2.5',
                      column.align === 'end' && 'text-end',
                      column.align === 'center' && 'text-center',
                      column.className,
                    )}
                  >
                    {column.render ? column.render(row, index) : (row?.[column.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
            {paddingBottom > 0 ? <tr aria-hidden style={{ height: paddingBottom }} /> : null}
          </tbody>
        </table>
      </div>
      {footer ? <div className="border-t border-border px-3 py-2.5">{footer}</div> : null}
    </div>
  )
}

export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, labels = {}, className }) {
  const { t, i18n } = useTranslation()
  const direction = useDirection()
  const totalPages = Math.max(1, Math.ceil((total || 0) / (pageSize || 25)))
  const start = total ? (page - 1) * (pageSize || 25) + 1 : 0
  const end = Math.min(total || 0, page * (pageSize || 25))
  const digits = new Intl.NumberFormat(i18n.language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB')
  const PreviousIcon = direction === 'rtl' ? ChevronRight : ChevronLeft
  const NextIcon = direction === 'rtl' ? ChevronLeft : ChevronRight

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 text-xs text-muted', className)}>
      <span className="tabular">
        {total
          ? labels.range
            ? labels.range
            : t('pagination.range', { start: digits.format(start), end: digits.format(end), total: digits.format(total) })
          : (labels.none || t('common.na'))}
      </span>
      <div className="flex items-center gap-2">
        {onPageSizeChange ? (
          <Select
            className="h-8 w-auto py-0 text-xs"
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            aria-label={t('pagination.rowsPerPage')}
          >
            {[10, 25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>
        ) : null}
        <Button variant="ghost" size="icon-sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label={t('pagination.previous')}>
          <PreviousIcon className="h-4 w-4" />
        </Button>
        <span className="tabular">
          {digits.format(page)} / {digits.format(totalPages)}
        </span>
        <Button variant="ghost" size="icon-sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label={t('pagination.next')}>
          <NextIcon className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ modals */

export function Modal({ open, onClose, title, description, children, footer, size = 'md', closeLabel, bodyClassName, initialFocus }) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose?.() : undefined)}>
      {open ? (
        <DialogContent
          title={title}
          description={description}
          footer={footer}
          size={size}
          closeLabel={closeLabel || t('actions.close')}
          className={bodyClassName}
          initialFocus={initialFocus}
        >
          {children}
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel, cancelLabel, loading, tone = 'danger', children }) {
  const { t } = useTranslation()
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title || t('actions.confirm')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {cancelLabel || t('actions.cancel')}
          </Button>
          <Button variant={tone} loading={loading} onClick={onConfirm}>
            {confirmLabel || t('actions.confirm')}
          </Button>
        </>
      }
    >
      {message ? <p className="text-sm leading-relaxed text-muted">{message}</p> : null}
      {children}
    </Modal>
  )
}

/* ------------------------------------------------------------------ misc ui */

/** Small metric used inside dense layouts (table footers, side panels). */
export function MiniStat({ label, value, tone = 'neutral', className }) {
  const tones = { neutral: 'text-text', success: 'text-success', warning: 'text-warning', danger: 'text-danger', brand: 'text-brand', info: 'text-info' }
  return (
    <div className={cn('min-w-0', className)}>
      <p className="truncate text-[10px] font-semibold tracking-[0.1em] text-muted uppercase">{label}</p>
      <p className={cn('mt-0.5 truncate text-sm font-semibold tabular', tones[tone])} dir="auto">
        {value}
      </p>
    </div>
  )
}

/** Animated page wrapper: fade + 8px rise, mirrored in RTL. */
export function PageTransition({ children, className, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1], delay }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export {
  AlertCircle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
  DropdownSeparator,
  Input,
  Kbd,
  Label,
  Popover,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  Separator,
  Skeleton,
  SkeletonText,
  SwitchControl,
  TabsContent,
  TabsList,
  TabsRoot,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipProvider,
  TooltipRoot,
}
