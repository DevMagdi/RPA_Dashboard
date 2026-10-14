/**
 * Vitest bootstrap — the browser APIs jsdom does not implement.
 *
 * Only what the product actually touches is stubbed, so a test never passes
 * because of an over-broad mock: the media queries, the observers the layout
 * components rely on, storage and the object URLs used by the export menu.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

import i18n, { applyLanguage } from '../i18n'

/* ----------------------------------------------------------------- matchMedia */
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}

/* --------------------------------------------------------------- observers  */
class ObserverStub {
  constructor(callback) {
    this.callback = callback
  }

  observe() {}

  unobserve() {}

  disconnect() {}

  takeRecords() {
    return []
  }
}

window.ResizeObserver = window.ResizeObserver || ObserverStub
window.IntersectionObserver = window.IntersectionObserver || ObserverStub

/* --------------------------------------------------------------- misc APIs   */
window.scrollTo = window.scrollTo || (() => {})
window.requestIdleCallback = window.requestIdleCallback || ((callback) => window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 8 }), 0))
window.cancelIdleCallback = window.cancelIdleCallback || ((handle) => window.clearTimeout(handle))
if (!URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:test'
  URL.revokeObjectURL = () => {}
}

// `Element.animate` is used by a few easing helpers; jsdom has no WAAPI.
if (!Element.prototype.animate) {
  Element.prototype.animate = () => ({ cancel: () => {}, finished: Promise.resolve(), addEventListener: () => {} })
}

/* ------------------------------------------------------------ deterministic  */
beforeEach(async () => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  document.documentElement.classList.remove('dark')
  delete document.documentElement.dataset.theme
  await applyLanguage('en')
})

afterEach(() => {
  cleanup()
  vi.clearAllTimers()
})

// Keep the report readable: React logs a warning for every "act" deviation and
// for the (intentional) error-boundary tests.
const originalError = console.error
console.error = (...args) => {
  const first = String(args[0] ?? '')
  if (first.includes('Not implemented: navigation') || first.includes('Error: Uncaught')) return
  originalError(...args)
}

export { i18n }
