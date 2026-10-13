import { localeTag } from '../i18n'

/**
 * Parse the many timestamp shapes the API can return (ISO strings, naive UTC
 * strings from SQLite, Date objects) into a Date without pulling in a date
 * library — bank deployments are often air-gapped and every dependency must
 * be justified.
 */
export function toDate(value) {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const text = String(value)
  // Naive timestamps from the database are UTC
  const normalized = /Z$|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(' ', 'T')}Z`
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Compact number formatting: 1.2k / 3.4M (used in KPI cards). */
export function compactNumber(value, digits = 1) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return '—'
  const abs = Math.abs(amount)
  if (abs >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(digits)}B`
  if (abs >= 1_000_000) return `${(amount / 1_000_000).toFixed(digits)}M`
  if (abs >= 10_000) return `${(amount / 1_000).toFixed(0)}k`
  if (abs >= 1_000) return `${(amount / 1_000).toFixed(digits)}k`
  return amount.toLocaleString(localeTag(), { maximumFractionDigits: 0 })
}

export function number(value, digits = 0) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '—'
  return parsed.toLocaleString(localeTag(), { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** Money with an optional ISO currency (defaults to the CoE reporting currency). */
export function currency(value, code = 'EGP', digits = 0) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '—'
  try {
    return new Intl.NumberFormat(localeTag(), {
      style: 'currency',
      currency: code,
      maximumFractionDigits: digits,
    }).format(parsed)
  } catch {
    return `${parsed.toLocaleString(localeTag())} ${code}`
  }
}

export function percent(value, digits = 1) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '—'
  return `${parsed.toFixed(digits)}%`
}

/** 92 → "1h 32m" */
export function durationFromMinutes(value) {
  const minutes = Number(value)
  if (!Number.isFinite(minutes)) return '—'
  if (minutes < 1) return `${Math.round(minutes * 60)}s`
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  if (hours === 0) return `${rest}m`
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

export function durationFromSeconds(value) {
  return durationFromMinutes(Number(value) / 60)
}

/** Human time saved: hours → "3.5 months of work" is overkill; keep hours/days. */
export function hoursSaved(value) {
  const hours = Number(value || 0)
  if (hours >= 24) return `${(hours / 24).toFixed(1)}d`
  return `${hours.toFixed(1)}h`
}

export function dateTime(value) {
  const parsed = toDate(value)
  if (!parsed) return value ? String(value) : '—'
  return new Intl.DateTimeFormat(localeTag(), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}

export function date(value) {
  const parsed = toDate(value)
  if (!parsed) return value ? String(value) : '—'
  return new Intl.DateTimeFormat(localeTag(), { dateStyle: 'medium' }).format(parsed)
}

export function time(value) {
  const parsed = toDate(value)
  if (!parsed) return value ? String(value) : '—'
  return new Intl.DateTimeFormat(localeTag(), { timeStyle: 'short' }).format(parsed)
}

/** "3 minutes ago" — used for heartbeats and cache freshness. */
export function relative(value) {
  const parsed = toDate(value)
  if (!parsed) return value ? String(value) : '—'
  const diffSeconds = (parsed.getTime() - Date.now()) / 1000
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ]
  try {
    const formatter = new Intl.RelativeTimeFormat(localeTag(), { numeric: 'auto' })
    for (const [unit, seconds] of units) {
      if (Math.abs(diffSeconds) >= seconds || unit === 'second') {
        return formatter.format(Math.round(diffSeconds / seconds), unit)
      }
    }
  } catch {
    return '—'
  }
  return '—'
}

/** Seconds a machine's heartbeat is allowed to lag before we flag it. */
export function heartbeatState(lastPing, staleSeconds = 180) {
  const parsed = toDate(lastPing)
  if (!parsed) return { state: 'offline', seconds: null }
  const seconds = (Date.now() - parsed.getTime()) / 1000
  if (seconds > staleSeconds) return { state: 'offline', seconds }
  if (seconds > staleSeconds / 3) return { state: 'warning', seconds }
  return { state: 'online', seconds }
}

/** Colour tokens keyed by severity/status so charts and badges stay consistent. */
export const STATUS_COLORS = {
  success: 'var(--success)',
  danger: 'var(--danger)',
  warning: 'var(--warning)',
  info: 'var(--info)',
  muted: 'var(--text-muted)',
  brand: 'var(--brand)',
  accent: 'var(--accent)',
}

export function severityColor(severity) {
  if (severity === 'Critical') return STATUS_COLORS.danger
  if (severity === 'Warning') return STATUS_COLORS.warning
  return STATUS_COLORS.info
}

export function runStatusColor(status) {
  const normalized = String(status || '').toLowerCase()
  if (normalized.includes('complete') || normalized.includes('success')) return STATUS_COLORS.success
  if (normalized.includes('fail') || normalized.includes('fault') || normalized.includes('abort')) return STATUS_COLORS.danger
  if (normalized.includes('run')) return STATUS_COLORS.info
  if (normalized.includes('stop') || normalized.includes('cancel')) return STATUS_COLORS.warning
  return STATUS_COLORS.muted
}

export function machineStatusColor(status) {
  const normalized = String(status || '').toLowerCase()
  if (normalized === 'online') return STATUS_COLORS.success
  if (normalized === 'warning') return STATUS_COLORS.warning
  if (normalized === 'maintenance') return STATUS_COLORS.info
  return STATUS_COLORS.danger
}

export function truncate(value, length = 42) {
  const text = String(value ?? '')
  return text.length > length ? `${text.slice(0, length - 1)}…` : text
}

export function titleCase(value) {
  const text = String(value ?? '')
  return text
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim()
}
