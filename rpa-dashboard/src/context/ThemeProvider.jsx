import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import storage from '../lib/storage'

const ThemeContext = createContext(null)

function systemPrefersDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolve(theme) {
  if (theme === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return theme
}

/**
 * Theme + density + motion provider (light / dark / system), Light first.
 *
 * The `<html>` element carries the state as attributes/classes so *everything*
 * downstream follows automatically:
 *   • `class="dark"`           → Tailwind `dark:` variants + CSS variables
 *   • `data-density="compact"` → row heights and paddings tighten
 *   • `data-motion="reduced"`  → non-essential animation is switched off for
 *     operators who are motion-sensitive or suffer eye fatigue on long shifts
 * Rendering state on the document (instead of a JS branch per component) is
 * what keeps the theme switch instantaneous and flash-free.
 */
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    const savedTheme = storage.get('theme', 'light')
    // `system` was the previous implicit default; migrate those users to Light.
    return savedTheme === 'system' ? 'light' : savedTheme
  })
  const [density, setDensity] = useState(() => storage.get('density', 'comfortable'))
  const [motion, setMotion] = useState(() => storage.get('motion', 'full'))

  const applied = resolve(theme)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', applied === 'dark')
    root.dataset.density = density
    root.dataset.motion = motion
    storage.set('theme', theme)
    storage.set('density', density)
    storage.set('motion', motion)
  }, [applied, theme, density, motion])

  // Follow the OS while the user keeps "system" selected
  useEffect(() => {
    if (theme !== 'system') return undefined
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => document.documentElement.classList.toggle('dark', query.matches)
    query.addEventListener('change', handler)
    return () => query.removeEventListener('change', handler)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const currentResolved = resolve(current)
      return currentResolved === 'dark' ? 'light' : 'dark'
    })
  }, [])

  const value = useMemo(
    () => ({ theme, applied, density, motion, setTheme, setDensity, setMotion, toggleTheme, isDark: applied === 'dark' }),
    [theme, applied, density, motion, toggleTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>')
  return context
}

export default ThemeProvider
