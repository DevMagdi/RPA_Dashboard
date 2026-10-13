/**
 * UI kit — the design system's building blocks.
 *
 * Everything is theme-agnostic (CSS variables), RTL-safe (logical spacing
 * utilities: `ps-`/`pe-`/`ms-`/`me-`/`start-`/`end-`) and WCAG-minded
 * (focus rings, aria attributes, keyboard interaction, reduced motion).
 */
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, Check, ChevronLeft, ChevronRight, Copy, Inbox, Info, Loader2, Search, X } from 'lucide-react'
import {
  Component,
  forwardRef,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

import { useCountUp } from '../../hooks/ui'
import { compactNumber, currency } from '../../lib/format'

export function cx(...values) {
  return values.filter(Boolean).join(' ')
}

/* ------------------------------------------------------------------ Button */

const BUTTON_VARIANTS = {
  primary: 'bg-brand text-brand-fg hover:opacity-90 shadow-soft',
  secondary: 'bg-surface-2 text-text border border-border hover:bg-surface',
  ghost: 'text-muted hover:text-text hover:bg-surface-2',
  danger: 'bg-danger text-white hover:opacity-90 shadow-soft',
  success: 'bg-success text-white hover:opacity-90 shadow-soft',
  outline: 'border border-brand text-brand hover:bg-brand-soft',
}

const BUTTON_SIZES = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
  icon: 'h-9 w-9 justify-center',
}

export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', loading = false, icon: Icon, children, className, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={props.type || 'button'}
      disabled={disabled || loading}
      className={cx(
        'focus-ring inline-flex items-center rounded-xl font-medium transition-all duration-200 ease-premium disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin-slow" aria-hidden /> : Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
      {children}
    </button>
  )
})

/* -------------------------------------------------------------------- Card */

export function Card({ as: Tag = 'section', className, glass = false, hover = false, children, ...props }) {
  return (
    <Tag
      className={cx(
        'rounded-2xl border border-border shadow-card',
        glass ? 'glass' : 'bg-surface',
        hover && 'card-hover',
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  )
}

export function CardHeader({ title, subtitle, actions, icon: Icon, className }) {
  return (
    <header className={cx('flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3', className)}>
      <div className="flex items-start gap-3">
        {Icon ? (
          <span className="mt-0.5 grid h-8 w-8 place-items-center rounded-xl bg-brand-soft text-brand">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        ) : null}
        <div>
          <h2 className="text-sm font-semibold text-text">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export function CardBody({ className, children }) {
  return <div className={cx('p-4', className)}>{children}</div>
}

/* ------------------------------------------------------------------- Badge */

const BADGE_TONES = {
  neutral: 'bg-surface-2 text-muted border-border',
  brand: 'bg-brand-soft text-brand border-transparent',
  success: 'bg-success-soft text-success border-transparent',
  warning: 'bg-warning-soft text-warning border-transparent',
  danger: 'bg-danger-soft text-danger border-transparent',
  info: 'bg-info-soft text-info border-transparent',
}

export function Badge({ tone = 'neutral', className, children, dot = false }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        BADGE_TONES[tone] || BADGE_TONES.neutral,
        className,
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  )
}

/** Severity badge used by the Capacity Advisor (Info / Warning / Critical). */
export function SeverityBadge({ severity, label }) {
  const tone = severity === 'Critical' ? 'danger' : severity === 'Warning' ? 'warning' : 'info'
  return (
    <Badge tone={tone} dot>
      {label || severity}
    </Badge>
  )
}

export function StatusDot({ color = 'var(--success)', pulse = false, label }) {
  return (
    <span className="inline-flex items-center gap-2" title={label}>
      <span className="relative flex h-2.5 w-2.5">
        {pulse ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" style={{ color }} /> : null}
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      </span>
      {label ? <span className="text-xs text-muted">{label}</span> : null}
    </span>
  )
}

/* --------------------------------------------------------------- Skeletons */

export function Skeleton({ className, style }) {
  return <div className={cx('skeleton', className)} style={style} aria-hidden />
}

export function SkeletonText({ lines = 3, className }) {
  return (
    <div className={cx('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} className="h-3" style={{ width: `${100 - index * 12}%` }} />
      ))}
    </div>
  )
}

export function SkeletonCard({ height = 160 }) {
  return (
    <Card className="p-4">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="mt-3" style={{ height: height - 40 }} />
    </Card>
  )
}

/* ------------------------------------------------------------ Empty states */

export function EmptyState({ icon: Icon = Inbox, title, description, action, className }) {
  return (
    <div className={cx('flex flex-col items-center justify-center gap-3 px-6 py-10 text-center', className)}>
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-muted">
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <div>
        <p className="text-sm font-semibold text-text">{title}</p>
        {description ? <p className="mt-1 max-w-md text-xs text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function ErrorState({ error, onRetry, title, retryLabel = 'Retry' }) {
  return (
    <EmptyState
      icon={AlertCircle}
      title={title || 'Something went wrong'}
      description={error?.message}
      action={
        onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : null
      }
    />
  )
}

/* ------------------------------------------------------------ ErrorBoundary */

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

/* ------------------------------------------------------------------- Modal */

export function Modal({ open, onClose, title, description, children, footer, size = 'md', closeLabel = 'Close' }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
      if (event.key === 'Tab' && ref.current) {
        const nodes = ref.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
        if (!nodes.length) return
        const first = nodes[0]
        const last = nodes[nodes.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Focus the first control so keyboard users are not trapped at page top
    setTimeout(() => ref.current?.querySelector('input, select, textarea, button')?.focus(), 40)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  const widths = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-black/45 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose?.()
          }}
        >
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className={cx('w-full overflow-hidden rounded-t-3xl border border-border bg-surface shadow-pop sm:rounded-3xl', widths[size])}
          >
            <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-text">{title}</h2>
                {description ? <p className="mt-1 text-xs text-muted">{description}</p> : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={closeLabel}
                className="focus-ring rounded-lg p-1.5 text-muted transition hover:bg-surface-2 hover:text-text"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
            {footer ? <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer> : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel, loading, tone = 'danger' }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={tone} loading={loading} onClick={onConfirm}>
            {confirmLabel || 'Confirm'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">{message}</p>
    </Modal>
  )
}

/* -------------------------------------------------------------- Form inputs */

export function Field({ label, hint, error, required, children, htmlFor }) {
  return (
    <div className="space-y-1.5">
      {label ? (
        <label htmlFor={htmlFor} className="block text-xs font-medium text-muted">
          {label}
          {required ? <span className="ms-1 text-danger">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="flex items-center gap-1 text-xs text-danger">
          <AlertCircle className="h-3.5 w-3.5" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  )
}

const CONTROL_CLASS =
  'focus-ring w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-muted transition disabled:opacity-60'

export const Input = forwardRef(function Input({ className, invalid, ...props }, ref) {
  return <input ref={ref} className={cx(CONTROL_CLASS, invalid && 'border-danger', className)} {...props} />
})

export const Textarea = forwardRef(function Textarea({ className, rows = 3, ...props }, ref) {
  return <textarea ref={ref} rows={rows} className={cx(CONTROL_CLASS, 'resize-y', className)} {...props} />
})

export const Select = forwardRef(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cx(CONTROL_CLASS, 'cursor-pointer pe-8', className)} {...props}>
      {children}
    </select>
  )
})

export function Switch({ checked, onChange, label, disabled, id }) {
  const generated = useId()
  const inputId = id || generated
  return (
    <label htmlFor={inputId} className={cx('inline-flex cursor-pointer items-center gap-2.5', disabled && 'opacity-60')}>
      <span className="relative inline-flex">
        <input
          id={inputId}
          type="checkbox"
          className="peer sr-only"
          checked={Boolean(checked)}
          disabled={disabled}
          onChange={(event) => onChange?.(event.target.checked)}
        />
        <span className="h-5 w-9 rounded-full bg-border transition peer-checked:bg-brand" />
        <span className="absolute start-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all peer-checked:start-[1.125rem]" />
      </span>
      {label ? <span className="text-sm text-text">{label}</span> : null}
    </label>
  )
}

export function SearchInput({ value, onChange, placeholder, className, onClear }) {
  return (
    <div className={cx('relative', className)}>
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={cx(CONTROL_CLASS, 'ps-9')}
        aria-label={placeholder}
      />
      {value && onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="focus-ring absolute end-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-muted hover:text-text"
          aria-label="Clear"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------- Tabs */

export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div role="tablist" className={cx('flex flex-wrap items-center gap-1 rounded-xl bg-surface-2 p-1', className)}>
      {tabs.map((tab) => {
        const active = tab.value === value
        return (
          <button
            key={tab.value}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(tab.value)}
            className={cx(
              'focus-ring relative rounded-lg px-3 py-1.5 text-xs font-medium transition',
              active ? 'text-text' : 'text-muted hover:text-text',
            )}
          >
            {active ? (
              <motion.span
                layoutId="tab-pill"
                className="absolute inset-0 rounded-lg bg-surface shadow-soft"
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              />
            ) : null}
            <span className="relative z-10 flex items-center gap-1.5">
              {tab.icon ? <tab.icon className="h-3.5 w-3.5" /> : null}
              {tab.label}
              {tab.count !== undefined ? (
                <span className="rounded-full bg-brand-soft px-1.5 text-[10px] text-brand">{tab.count}</span>
              ) : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/* --------------------------------------------------------------- Tooltip */

export function Tooltip({ content, children, side = 'top' }) {
  const [open, setOpen] = useState(false)
  const positions = {
    top: 'bottom-full start-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full start-1/2 -translate-x-1/2 mt-2',
    start: 'end-full top-1/2 -translate-y-1/2 me-2',
  }
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      <AnimatePresence>
        {open && content ? (
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className={cx(
              'pointer-events-none absolute z-50 max-w-xs whitespace-pre-line rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text shadow-pop',
              positions[side],
            )}
          >
            {content}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </span>
  )
}

export function CopyButton({ value, label, className }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={cx('focus-ring inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted transition hover:bg-surface-2 hover:text-text', className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(String(value ?? ''))
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        } catch {
          setCopied(false)
        }
      }}
      aria-label={label || 'Copy to clipboard'}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      {label || (copied ? 'Copied' : 'Copy')}
    </button>
  )
}

/* ------------------------------------------------------------- Progress bar */

export function ProgressBar({ value = 0, max = 100, tone, className, showLabel = false, label }) {
  const pct = Math.max(0, Math.min(100, (Number(value) / (max || 100)) * 100))
  const colour = tone || (pct >= 90 ? 'var(--danger)' : pct >= 75 ? 'var(--warning)' : 'var(--success)')
  return (
    <div className={cx('flex items-center gap-2', className)}>
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <motion.div
          className="h-full rounded-full"
          style={{ background: colour }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      {showLabel ? <span className="w-12 text-end text-xs text-muted">{pct.toFixed(0)}%</span> : null}
    </div>
  )
}

/* -------------------------------------------------------------- KPI / stats */

export function CountUpStat({ value, format = 'number', className, duration }) {
  const animated = useCountUp(value, duration)
  if (format === 'currency') return <span className={className}>{currency(animated)}</span>
  if (format === 'percent') return <span className={className}>{Number(animated || 0).toFixed(1)}%</span>
  return <span className={className}>{compactNumber(animated)}</span>
}

export function Stat({ label, value, format, hint, tone = 'brand', icon: Icon, delta, className }) {
  const toneClass = {
    brand: 'text-brand bg-brand-soft',
    success: 'text-success bg-success-soft',
    warning: 'text-warning bg-warning-soft',
    danger: 'text-danger bg-danger-soft',
    info: 'text-info bg-info-soft',
  }[tone]

  return (
    <Card className={cx('flex items-start gap-3 p-4', className)}>
      {Icon ? (
        <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', toneClass)}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
      ) : null}
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-muted">{label}</p>
        <p className="mt-1 truncate text-xl font-semibold text-text">
          <CountUpStat value={value} format={format} />
        </p>
        {delta !== undefined && delta !== null ? (
          <p className={cx('mt-0.5 text-xs', delta >= 0 ? 'text-success' : 'text-danger')}>
            {delta >= 0 ? '+' : ''}
            {Number(delta).toFixed(1)}%
          </p>
        ) : hint ? (
          <p className="mt-0.5 truncate text-xs text-muted">{hint}</p>
        ) : null}
      </div>
    </Card>
  )
}

export function InfoTile({ label, value, tone = 'neutral', icon: Icon }) {
  const tones = {
    neutral: 'text-text',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
    info: 'text-info',
  }
  return (
    <div className="rounded-xl border border-border bg-surface-2/60 px-3 py-2">
      <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted">
        {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
        {label}
      </p>
      <p className={cx('mt-0.5 text-sm font-semibold', tones[tone])}>{value}</p>
    </div>
  )
}

/* ---------------------------------------------------------------- DataTable */

/**
 * Accessible, responsive table.
 *
 * On small screens the table switches to a stacked card layout; the header row
 * stays for screen readers.  Columns are declared as
 * `{ key, header, render?, align?, width?, hideBelow? }`.
 */
export function DataTable({
  columns,
  rows,
  rowKey,
  loading,
  empty,
  onRowClick,
  dense = false,
  className,
  footer,
  sort,
  onSortChange,
}) {
  const [internalSort, setInternalSort] = useState(null)
  const activeSort = sort || internalSort

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

  const handleSort = (key) => {
    if (!key) return
    const next = { key, dir: activeSort?.key === key && activeSort.dir === 'asc' ? 'desc' : 'asc' }
    if (onSortChange) onSortChange(next)
    else setInternalSort(next)
  }

  if (loading && !rows?.length) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-9" />
        ))}
      </div>
    )
  }

  if (!loading && !rows?.length) {
    return empty || <EmptyState title="Nothing to show" />
  }

  return (
    <div className={cx('w-full overflow-x-auto', className)}>
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={column.width ? { width: column.width } : undefined}
                className={cx(
                  'select-none px-3 text-start font-medium',
                  dense ? 'py-1.5' : 'py-2.5',
                  column.sortable && 'cursor-pointer hover:text-text',
                  column.align === 'end' && 'text-end',
                  column.align === 'center' && 'text-center',
                )}
                aria-sort={activeSort?.key === column.key ? (activeSort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                onClick={() => column.sortable && handleSort(column.key)}
              >
                {/* Sorting must be keyboard reachable too */}
                {column.sortable ? (
                  <button type="button" className="focus-ring inline-flex items-center gap-1 rounded" onClick={() => handleSort(column.key)}>
                    {column.header}
                    <span className="text-[10px]">{activeSort?.key === column.key ? (activeSort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                  </button>
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => (
            <tr
              key={rowKey ? rowKey(row, index) : index}
              className={cx(
                'border-b border-border/70 transition-colors last:border-0',
                onRowClick && 'cursor-pointer hover:bg-surface-2',
              )}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
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
                  className={cx(
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
        </tbody>
      </table>
      {footer ? <div className="border-t border-border px-3 py-2">{footer}</div> : null}
    </div>
  )
}

export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, labels = {} }) {
  const totalPages = Math.max(1, Math.ceil((total || 0) / (pageSize || 25)))
  const start = (page - 1) * (pageSize || 25) + 1
  const end = Math.min(total || 0, page * (pageSize || 25))
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
      <span>{total ? `${start}–${end} ${labels.of || 'of'} ${total}` : labels.none || '—'}</span>
      <div className="flex items-center gap-2">
        <Select
          className="h-8 w-auto py-0 text-xs"
          value={pageSize}
          onChange={(event) => onPageSizeChange?.(Number(event.target.value))}
          aria-label="Rows per page"
        >
          {[10, 25, 50, 100].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </Select>
        <Button variant="ghost" size="icon" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
        </Button>
        <span className="tabular-nums">
          {page} / {totalPages}
        </span>
        <Button variant="ghost" size="icon" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4 rtl:rotate-180" />
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Notice */

export function Notice({ tone = 'info', title, children, icon: CustomIcon, action, className }) {
  const tones = {
    info: { wrap: 'border-info/30 bg-info-soft', icon: Info, colour: 'text-info' },
    warning: { wrap: 'border-warning/30 bg-warning-soft', icon: AlertCircle, colour: 'text-warning' },
    danger: { wrap: 'border-danger/30 bg-danger-soft', icon: AlertCircle, colour: 'text-danger' },
    success: { wrap: 'border-success/30 bg-success-soft', icon: Check, colour: 'text-success' },
  }
  const config = tones[tone] || tones.info
  const Icon = CustomIcon || config.icon
  return (
    <div className={cx('flex items-start gap-3 rounded-xl border p-3 text-sm', config.wrap, className)} role="status">
      <Icon className={cx('mt-0.5 h-4 w-4 shrink-0', config.colour)} aria-hidden />
      <div className="min-w-0 flex-1">
        {title ? <p className={cx('font-semibold', config.colour)}>{title}</p> : null}
        {children ? <div className="mt-0.5 text-xs text-text/90">{children}</div> : null}
      </div>
      {action}
    </div>
  )
}

export function SectionTitle({ title, subtitle, actions, className }) {
  return (
    <div className={cx('mb-4 flex flex-wrap items-end justify-between gap-3', className)}>
      <div>
        <h1 className="text-lg font-semibold text-text sm:text-xl">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-xs text-muted sm:text-sm">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function Spinner({ className, label }) {
  return (
    <span className={cx('inline-flex items-center gap-2 text-muted', className)} role="status">
      <Loader2 className="h-4 w-4 animate-spin-slow" aria-hidden />
      {label ? <span className="text-xs">{label}</span> : null}
    </span>
  )
}
