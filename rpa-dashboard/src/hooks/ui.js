/** Small UI primitives: debounce, media queries, clipboard, hotkeys, count-up. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { onRealtimeState } from '../lib/realtime'
import storage from '../lib/storage'

export function useDebouncedValue(value, delay = 350) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )
  useEffect(() => {
    const list = window.matchMedia(query)
    const handler = (event) => setMatches(event.matches)
    list.addEventListener('change', handler)
    setMatches(list.matches)
    return () => list.removeEventListener('change', handler)
  }, [query])
  return matches
}

export function useIsMobile() {
  return useMediaQuery('(max-width: 767px)')
}

export function useCopyToClipboard(resetAfter = 1800) {
  const [copied, setCopied] = useState(null)
  const copy = useCallback(
    async (value, key = 'default') => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(String(value))
        } else {
          const area = document.createElement('textarea')
          area.value = String(value)
          document.body.appendChild(area)
          area.select()
          document.execCommand('copy')
          area.remove()
        }
        setCopied(key)
        setTimeout(() => setCopied(null), resetAfter)
        return true
      } catch {
        return false
      }
    },
    [resetAfter],
  )
  return { copy, copied }
}

/** Global keyboard shortcut (ignores keystrokes typed into inputs). */
export function useHotkey(combo, handler, { allowInInput = false } = {}) {
  const ref = useRef(handler)

  useEffect(() => {
    ref.current = handler
  }, [handler])

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target
      const typing = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      if (typing && !allowInInput) return

      const parts = combo.toLowerCase().split('+')
      const key = parts[parts.length - 1]
      const needCtrl = parts.includes('ctrl') || parts.includes('cmd')
      const needShift = parts.includes('shift')
      const needAlt = parts.includes('alt')

      const ctrlOk = needCtrl ? event.ctrlKey || event.metaKey : !(event.ctrlKey || event.metaKey)
      const shiftOk = needShift ? event.shiftKey : true
      const altOk = needAlt ? event.altKey : true
      if (event.key.toLowerCase() !== key || !ctrlOk || !shiftOk || !altOk) return

      event.preventDefault()
      ref.current(event)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [combo, allowInInput])
}

/** Persisted state helper (falls back to memory when storage is blocked). */
export function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => storage.get(key, initial))
  useEffect(() => {
    storage.set(key, value)
  }, [key, value])
  return [value, setValue]
}

/** Animated count-up used by the KPI cards (respects reduced-motion). */
export function useCountUp(target, duration = 900) {
  const [value, setValue] = useState(0)
  const previous = useRef(0)

  useEffect(() => {
    const from = Number.isFinite(previous.current) ? previous.current : 0
    const to = Number(target || 0)
    if (to === from) {
      setValue(to)
      return undefined
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || duration <= 0) {
      previous.current = to
      setValue(to)
      return undefined
    }
    let frame
    const start = performance.now()
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration)
      // easeOutCubic keeps the motion lively but not distracting
      const eased = 1 - (1 - progress) ** 3
      setValue(from + (to - from) * eased)
      if (progress < 1) frame = requestAnimationFrame(tick)
      else previous.current = to
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, duration])

  return value
}

/**
 * Live connection state for the realtime stream (used by the status pill).
 * Subscribes only — the stream itself is owned by AuthProvider, which
 * starts it after login/refresh and stops it on logout, so mounting this
 * hook while logged out can never trigger `/api/realtime/events` 401s.
 */
export function useRealtimeStatus() {
  const [state, setState] = useState({ status: 'closed', lastEventAt: null, retries: 0 })
  useEffect(() => onRealtimeState(setState), [])
  return state
}

/** Ticks a re-render every `intervalMs` — used for "x minutes ago" labels. */
export function useTicker(intervalMs = 30_000) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
}

/** Point-in-time clock, useful for SLA countdowns. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

/** Filter state synced to the URL so dashboards can be shared/bookmarked. */
export function useUrlFilters(defaults) {
  const [filters, setFilters] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    const next = { ...defaults }
    Object.keys(defaults).forEach((key) => {
      const value = params.get(key)
      if (value !== null) next[key] = typeof defaults[key] === 'number' ? Number(value) : value
    })
    return next
  })

  useEffect(() => {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '' && value !== 'ALL') params.set(key, value)
    })
    const text = params.toString()
    window.history.replaceState({}, '', text ? `?${text}` : window.location.pathname)
  }, [filters])

  const update = useCallback((patch) => setFilters((current) => ({ ...current, ...patch })), [])
  const reset = useCallback(() => setFilters(defaults), [defaults])

  return useMemo(() => ({ filters, update, reset }), [filters, update, reset])
}
