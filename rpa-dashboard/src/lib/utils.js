/**
 * Shared utilities — the tiny, dependency-free toolkit the UI leans on.
 *
 * `cn()` is the shadcn/ui class composer (clsx + tailwind-merge): conditional
 * classes *and* conflict resolution (`px-2 px-4` keeps the last one), which is
 * what makes the component API pleasant to call from application code.
 */
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

/** Legacy alias kept so existing call sites keep working. */
export const cx = cn

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function uid(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function groupBy(rows, keyFn) {
  const out = new Map()
  for (const row of rows || []) {
    const key = keyFn(row)
    const bucket = out.get(key)
    if (bucket) bucket.push(row)
    else out.set(key, [row])
  }
  return out
}

export function uniqBy(rows, keyFn) {
  const seen = new Set()
  return (rows || []).filter((row) => {
    const key = keyFn(row)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function pick(object, keys) {
  const out = {}
  for (const key of keys) if (object?.[key] !== undefined) out[key] = object[key]
  return out
}

export function omit(object, keys) {
  const out = { ...object }
  for (const key of keys) delete out[key]
  return out
}

export function debounce(fn, wait = 180) {
  let timer
  const wrapped = (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
  wrapped.cancel = () => clearTimeout(timer)
  return wrapped
}

/** rAF-coalesced callback: used for scroll/resize handlers (never more than 1/frame). */
export function rafThrottle(fn) {
  let frame = null
  let lastArgs = []
  return (...args) => {
    lastArgs = args
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = null
      fn(...lastArgs)
    })
  }
}

export function safeJsonParse(raw, fallback = null) {
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Deep merge used by widget layouts / filter defaults (arrays are replaced). */
export function deepMerge(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch === undefined ? base : patch
  const out = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value
  }
  return out
}

export function formatBytes(bytes, locale = 'en') {
  const value = Number(bytes) || 0
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB']
  let size = value / 1024
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toLocaleString(locale, { maximumFractionDigits: 1 })} ${units[unit]}`
}

/* ------------------------------------------------------------------ search */

const DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED\u0640]/g

/**
 * Normalise a string for search.
 *
 * Handles the two things that break naive search in a bilingual product:
 *  • Arabic diacritics / tatweel and the alef & hamza variants (أ إ آ → ا),
 *    so «الاحصائيات» finds «الإحصائيات»,
 *  • the Arabic-Indic digits that appear in pasted filter values.
 */
export function normalizeForSearch(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(DIACRITICS, '')
    .replace(/[\u0622\u0623\u0625\u0627\u0671]/g, '\u0627')
    .replace(/\u0649/g, '\u064a')
    .replace(/\u0629/g, '\u0647')
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .trim()
}

/**
 * Subsequence fuzzy match with a small bonus model (word starts, adjacency,
 * exact prefix).  Returns `null` when the query does not match, otherwise
 * `{ score, indices }` so the caller can highlight the matched characters.
 */
export function fuzzyMatch(text, query) {
  const haystack = normalizeForSearch(text)
  const needle = normalizeForSearch(query)
  if (!needle) return { score: 0, indices: [] }
  if (haystack.includes(needle)) {
    const at = haystack.indexOf(needle)
    const boundary = at === 0 || /[\s\-_/·.]/.test(haystack[at - 1])
    return {
      score: 100 - at + (boundary ? 24 : 0) + needle.length * 2,
      indices: Array.from({ length: needle.length }, (_, index) => at + index),
    }
  }

  const indices = []
  let score = 0
  let cursor = 0
  let previous = -2
  for (const char of needle) {
    const found = haystack.indexOf(char, cursor)
    if (found === -1) return null
    const isBoundary = found === 0 || /[\s\-_/·.]/.test(haystack[found - 1])
    score += 6 + (found === previous + 1 ? 8 : 0) + (isBoundary ? 12 : 0) - Math.min(found - cursor, 6)
    previous = found
    cursor = found + 1
    indices.push(found)
  }
  return { score, indices }
}

/** Split a string into highlighted / plain segments for <mark> rendering. */
export function highlightSegments(text, indices) {
  const source = String(text ?? '')
  if (!indices?.length) return [{ text: source, match: false }]
  const set = new Set(indices)
  const segments = []
  let buffer = ''
  let bufferMatch = set.has(0)
  for (let index = 0; index < source.length; index += 1) {
    const isMatch = set.has(index)
    if (isMatch !== bufferMatch && buffer) {
      segments.push({ text: buffer, match: bufferMatch })
      buffer = ''
    }
    bufferMatch = isMatch
    buffer += source[index]
  }
  if (buffer) segments.push({ text: buffer, match: bufferMatch })
  return segments
}

/** Stable, locale-aware collator (Arabic sorting is *not* codepoint order). */
export function makeCollator(locale = 'en') {
  try {
    return new Intl.Collator(locale, { numeric: true, sensitivity: 'base' })
  } catch {
    return new Intl.Collator('en')
  }
}
