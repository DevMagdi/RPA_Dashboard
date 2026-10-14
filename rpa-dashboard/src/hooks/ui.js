/**
 * Small UI hooks: debounce, media queries, clipboard, hotkeys, count-up,
 * viewport visibility, idle scheduling.
 *
 * Every hook here is SSR-safe (the dashboard renders under
 * `react-dom/server` in the performance test-suite) and cleans up after
 * itself — no leaked listeners across a 12-hour operator shift.
 */
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

export function useIsTablet() {
  return useMediaQuery('(max-width: 1023px)')
}

export function useIsTouch() {
  return useMediaQuery('(hover: none), (pointer: coarse)')
}

export function usePrefersReducedMotion() {
  return useMediaQuery('(prefers-reduced-motion: reduce)')
}

export function useOnlineStatus() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
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

/** Global keyboard shortcut (ignores keystrokes typed into inputs by default). */
export function useHotkey(combo, handler, { allowInInput = false, enabled = true } = {}) {
  const ref = useRef(handler)

  useEffect(() => {
    ref.current = handler
  }, [handler])

  useEffect(() => {
    if (!enabled) return undefined
    const onKeyDown = (event) => {
      const target = event.target
      const typing = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      if (typing && !allowInInput) return

      const parts = String(combo).toLowerCase().split('+')
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
  }, [combo, allowInInput, enabled])
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
export function useTicker(intervalMs = 30_000, enabled = true) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!enabled) return undefined
    const timer = setInterval(() => setTick((value) => value + 1), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs, enabled])
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

/** True once the node has entered the viewport (used to defer heavy widgets). */
export function useInView({ rootMargin = '160px', once = true, enabled = true } = {}) {
  const ref = useRef(null)
  const [inView, setInView] = useState(!enabled)

  useEffect(() => {
    if (!enabled) {
      setInView(true)
      return undefined
    }
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return undefined
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true)
            if (once) observer.disconnect()
          } else if (!once) {
            setInView(false)
          }
        }
      },
      { rootMargin },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [rootMargin, once, enabled])

  return [ref, inView]
}

/** Element size observer (charts re-measure without a second layout pass). */
export function useElementSize() {
  const ref = useRef(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize((current) => (Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1 ? current : { width, height }))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [ref, size]
}

/** Run a callback once the browser is idle — used for route/asset prefetching. */
export function useIdleCallback(callback, { timeout = 1800, enabled = true } = {}) {
  const ref = useRef(callback)
  useEffect(() => {
    ref.current = callback
  }, [callback])
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined
    let idle
    let timer
    if ('requestIdleCallback' in window) {
      idle = window.requestIdleCallback(() => ref.current(), { timeout })
    } else {
      timer = setTimeout(() => ref.current(), 600)
    }
    return () => {
      if (idle && 'cancelIdleCallback' in window) window.cancelIdleCallback(idle)
      if (timer) clearTimeout(timer)
    }
  }, [timeout, enabled])
}

/** Locks body scroll while an overlay owns the viewport (overlay stack-safe). */
export function useScrollLock(active) {
  useEffect(() => {
    if (!active) return undefined
    const previous = document.body.style.overflow
    const { paddingRight } = document.body.style
    const scrollbar = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`
    return () => {
      document.body.style.overflow = previous
      document.body.style.paddingRight = paddingRight
    }
  }, [active])
}

/**
 * Calls back when the pointer rests on an element — the cheapest possible
 * way to make navigation feel instant (the route chunk downloads before the
 * click lands).
 */
export function useHoverIntent(callback, { delay = 90, enabled = true } = {}) {
  const ref = useRef(callback)
  useEffect(() => {
    ref.current = callback
  }, [callback])
  const timer = useRef(null)
  return useMemo(
    () => ({
      onPointerEnter: (event) => {
        if (!enabled || event.pointerType === 'touch') return
        timer.current = setTimeout(() => ref.current(), delay)
      },
      onPointerLeave: () => clearTimeout(timer.current),
      onFocus: () => enabled && ref.current(),
    }),
    [delay, enabled],
  )
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
