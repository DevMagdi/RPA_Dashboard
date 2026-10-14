/**
 * Chart toolkit — the visual language for data.
 *
 * Everything here reads the same CSS variables as the rest of the design
 * system, so charts follow the organization brand, the light/dark theme *and*
 * the text direction:
 *  • Arabic (RTL) time series are drawn right-to-left (`reversed` axes) and
 *    the value axis moves to the leading side — how an Arabic reader expects
 *    a timeline to run.
 *  • Tooltips are real React nodes (rounded, blurred, theme-aware) instead of
 *    recharts' default white box.
 *  • Gradients are generated with unique ids per instance (`useId`), which
 *    prevents the "two charts share one gradient" artefact.
 */
import { useId } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'

import { useDirection } from '../../lib/direction'
import { compactNumber, currency, percent as formatPercent } from '../../lib/format'
import { cn } from '../../lib/utils'

export const CHART_TOKENS = {
  brand: 'var(--chart-1)',
  accent: 'var(--chart-2)',
  warning: 'var(--chart-3)',
  pink: 'var(--chart-4)',
  info: 'var(--chart-5)',
  violet: 'var(--chart-6)',
  success: 'var(--success)',
  danger: 'var(--danger)',
  muted: 'var(--text-muted)',
  grid: 'var(--chart-grid)',
  axis: 'var(--chart-axis)',
}

export const OUTCOME_TOKENS = {
  Completed: 'var(--success)',
  Failed: 'var(--danger)',
  Stopped: 'var(--warning)',
  Running: 'var(--info)',
  Pending: 'var(--text-muted)',
  Cancelled: 'var(--text-muted)',
}

export function useChartDirection() {
  const direction = useDirection()
  const rtl = direction === 'rtl'
  return {
    direction,
    rtl,
    /** Time flows right→left in Arabic. */
    reverseTimeAxis: rtl,
    /** Numeric axis belongs on the leading edge. */
    valueAxisOrientation: rtl ? 'right' : 'left',
  }
}

export function axisProps({ dim = false } = {}) {
  return {
    stroke: CHART_TOKENS.axis,
    fontSize: 11,
    tickLine: false,
    axisLine: false,
    tickMargin: 8,
    ...(dim ? { tick: { fill: CHART_TOKENS.axis } } : null),
  }
}

/** Shared margins: leave room for the axis labels without wasting canvas. */
export function chartMargin({ rtl = false, compact = true } = {}) {
  return compact
    ? { top: 8, right: rtl ? 4 : 8, left: rtl ? 8 : 4, bottom: 4 }
    : { top: 12, right: 16, left: rtl ? 16 : 0, bottom: 8 }
}

/* --------------------------------------------------------------- gradients */

export function AreaGradient({ id, color, from = 0.42, to = 0.02 }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={from} />
      <stop offset="55%" stopColor={color} stopOpacity={from * 0.4} />
      <stop offset="100%" stopColor={color} stopOpacity={to} />
    </linearGradient>
  )
}

export function useGradientId(prefix) {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
}

/* --------------------------------------------------------------- tooltips */

function formatTooltipValue(value, format) {
  if (value === null || value === undefined) return '—'
  if (typeof format === 'function') return format(value)
  if (format === 'currency') return currency(value)
  if (format === 'percent') return formatPercent(value)
  if (format === 'compact') return compactNumber(value)
  return typeof value === 'number' ? value.toLocaleString() : String(value)
}

/**
 * Premium tooltip card.
 *
 * Recharts injects `active/payload/label`; `formats` maps a dataKey to a
 * formatter so each series can be rendered with its own unit (currency,
 * duration, percentage).
 */
export function ChartTooltipCard({ active, payload, label, labelFormatter, formats = {}, totalLabel }) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((sum, item) => sum + (Number(item.value) || 0), 0)
  return (
    <div className="pointer-events-none min-w-[10rem] rounded-xl border border-border bg-popover/95 p-2.5 shadow-pop backdrop-blur-md">
      {label !== undefined && label !== null ? (
        <p className="mb-1.5 text-[11px] font-semibold text-muted" dir="auto">
          {labelFormatter ? labelFormatter(label) : label}
        </p>
      ) : null}
      <ul className="space-y-1">
        {payload.map((item) => (
          <li key={`${item.dataKey}-${item.name}`} className="flex items-center justify-between gap-4 text-xs">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.color || item.payload?.fill }} aria-hidden />
              <span className="truncate text-muted" dir="auto">
                {item.name}
              </span>
            </span>
            <span className="shrink-0 font-semibold tabular text-text">
              {formatTooltipValue(item.value, formats[item.dataKey])}
            </span>
          </li>
        ))}
      </ul>
      {totalLabel && payload.length > 1 ? (
        <p className="mt-1.5 flex items-center justify-between gap-4 border-t border-border/70 pt-1.5 text-[11px] text-muted">
          <span>{totalLabel}</span>
          <span className="font-semibold tabular text-text">{total.toLocaleString()}</span>
        </p>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------- sparkline */

/**
 * Dependency-light sparkline: a hand-built SVG path.
 *
 * Used in KPI cards and the command-centre hero where a full recharts instance
 * per tile would cost far more than the pixels are worth (~2 kB of DOM vs
 * ~40 kB of chart runtime).
 */
export function Sparkline({ data = [], dataKey = 'value', color = 'var(--chart-1)', height = 34, strokeWidth = 2, className, fill = true, ariaLabel }) {
  const gradientId = useGradientId('spark')
  const values = data.map((point) => Number(point?.[dataKey] ?? point ?? 0)).filter((value) => Number.isFinite(value))
  if (values.length < 2) return <div className={cn('h-full w-full', className)} aria-hidden />

  const width = 100
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const step = width / (values.length - 1)
  const points = values.map((value, index) => [index * step, height - ((value - min) / span) * (height - 6) - 3])

  const line = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const area = `${line} L${width},${height} L0,${height} Z`

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn('h-full w-full', className)}
      role={ariaLabel ? 'img' : 'presentation'}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <defs>
        <AreaGradient id={gradientId} color={color} from={0.32} to={0} />
      </defs>
      {fill ? <path d={area} fill={`url(#${gradientId})`} /> : null}
      <path d={line} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/* ------------------------------------------------------------ radial gauge */

/** Compact utilisation gauge (capacity advisor, SLA panels). */
export function RadialGauge({ value = 0, max = 100, size = 108, thickness = 9, label, tone, className }) {
  const safeMax = max || 100
  const ratio = Math.max(0, Math.min(1, Number(value) / safeMax))
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  const color = tone || (ratio >= 0.9 ? 'var(--danger)' : ratio >= 0.75 ? 'var(--warning)' : 'var(--success)')

  return (
    <div className={cn('relative inline-grid place-items-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-3)" strokeWidth={thickness} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-center">
        <span className="text-lg font-semibold tabular text-text">{Math.round(ratio * 100)}%</span>
        {label ? <span className="text-[10px] tracking-wide text-muted uppercase">{label}</span> : null}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------- delta chips */

export function DeltaChip({ value, suffix = '%', invert = false, className }) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return null
  const neutral = Math.abs(amount) < 0.05
  const positive = invert ? amount < 0 : amount > 0
  const Icon = neutral ? Minus : positive ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
        neutral ? 'bg-surface-3 text-muted' : positive ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
        className,
      )}
    >
      <Icon className="h-2.5 w-2.5" aria-hidden />
      {Math.abs(amount).toFixed(1)}
      {suffix}
    </span>
  )
}

/** Rounded bars used for tiny in-row distributions (no chart runtime). */
export function MiniBars({ values = [], color = 'var(--chart-1)', height = 26, className, ariaLabel }) {
  const max = Math.max(...values.map((value) => Number(value) || 0), 1)
  return (
    <span className={cn('flex items-end gap-0.5', className)} style={{ height }} role="img" aria-label={ariaLabel}>
      {values.map((value, index) => (
        <span
          key={index}
          className="w-1 rounded-full transition-[height] duration-500"
          style={{
            height: `${Math.max(8, ((Number(value) || 0) / max) * 100)}%`,
            background: color,
            opacity: 0.35 + (index / Math.max(1, values.length - 1)) * 0.65,
          }}
        />
      ))}
    </span>
  )
}
