/**
 * Namespaced, versioned localStorage helpers.
 *
 * Everything the SPA persists is a *preference* (theme, language, widget
 * layout, last filters) — never a credential.  Storage can be unavailable
 * (Safari private mode, hardened bank images with cookies/storage disabled),
 * so every access is guarded and falls back to an in-memory map.
 */

const PREFIX = 'rpa.'
const memory = new Map()

function available() {
  try {
    const probe = `${PREFIX}__probe`
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

const hasStorage = typeof window !== 'undefined' && available()

export const storage = {
  get(key, fallback = null) {
    const full = `${PREFIX}${key}`
    try {
      const raw = hasStorage ? window.localStorage.getItem(full) : memory.get(full)
      if (raw === null || raw === undefined) return fallback
      return JSON.parse(raw)
    } catch {
      return fallback
    }
  },

  set(key, value) {
    const full = `${PREFIX}${key}`
    const raw = JSON.stringify(value)
    try {
      if (hasStorage) window.localStorage.setItem(full, raw)
      else memory.set(full, raw)
    } catch {
      memory.set(full, raw)
    }
    return value
  },

  remove(key) {
    const full = `${PREFIX}${key}`
    try {
      if (hasStorage) window.localStorage.removeItem(full)
    } catch {
      /* ignore */
    }
    memory.delete(full)
  },

  /** Remove every preference this app owns (used on sign-out of shared PCs). */
  clearApp() {
    try {
      if (hasStorage) {
        Object.keys(window.localStorage)
          .filter((key) => key.startsWith(PREFIX))
          .forEach((key) => window.localStorage.removeItem(key))
      }
    } catch {
      /* ignore */
    }
    memory.clear()
  },
}

export default storage
