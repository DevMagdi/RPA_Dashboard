/**
 * Text-direction plumbing.
 *
 * A bilingual product must never *guess* its direction: the source of truth is
 * `<html dir>`, written before first paint (see `index.html`) and updated by
 * `applyLanguage()`.  `useDirection()` subscribes to that attribute so Radix
 * overlays (menus, dialogs, tooltips) and Framer Motion slide-ins always open
 * on the correct side in Arabic without every component threading a prop.
 */
import { useEffect, useState } from 'react'

export const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ur'])

export function directionOf(language) {
  return RTL_LANGUAGES.has(String(language || '').slice(0, 2).toLowerCase()) ? 'rtl' : 'ltr'
}

export function documentDirection() {
  if (typeof document === 'undefined') return 'ltr'
  return document.documentElement.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr'
}

export function isRtlDirection(direction = documentDirection()) {
  return direction === 'rtl'
}

/** Live `dir` of the document; re-renders when the language switches. */
export function useDirection() {
  const [direction, setDirection] = useState(documentDirection)

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined
    const observer = new MutationObserver(() => setDirection(documentDirection()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['dir'] })
    setDirection(documentDirection())
    return () => observer.disconnect()
  }, [])

  return direction
}

/** Convenience boolean for the many `rtl ? … : …` decisions in layout code. */
export function useIsRtl() {
  return useDirection() === 'rtl'
}

/**
 * Direction-aware horizontal offset.
 *
 * Framer Motion's `x` is physical, so a slide-in animation must be mirrored in
 * RTL or the panel flies in from the wrong edge.
 */
export function slideX(direction, distance = 12) {
  return direction === 'rtl' ? -Math.abs(distance) : Math.abs(distance)
}
