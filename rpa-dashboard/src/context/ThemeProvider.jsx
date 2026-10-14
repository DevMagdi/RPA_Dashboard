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
 * Theme + density provider (light / dark / system), with Light as the default.
 * The `<html>` class is toggled directly so Tailwind's `dark:` variants and the
 * CSS variables in index.css both switch instantly.
 */
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    const savedTheme = storage.get('theme', 'light')
    // `system` was the previous implicit default; migrate those users to Light.
    return savedTheme === 'system' ? 'light' : savedTheme
  })
  const [density, setDensity] = useState(() => storage.get('density', 'comfortable'))

  const applied = resolve(theme)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', applied === 'dark')
    root.dataset.density = density
    storage.set('theme', theme)
    storage.set('density', density)
  }, [applied, theme, density])

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
    () => ({ theme, applied, density, setTheme, setDensity, toggleTheme, isDark: applied === 'dark' }),
    [theme, applied, density, toggleTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>')
  return context
}

export default ThemeProvider
