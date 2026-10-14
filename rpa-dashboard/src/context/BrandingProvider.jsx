import { useQuery } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useMemo } from 'react'

import api from '../lib/api'
import { qk } from '../lib/queryClient'
import { useOptionalTheme } from './ThemeProvider'

const BrandingContext = createContext(null)

/* Built-in hybrid identity: refined Indigo (Indigo-600) for brand *actions*
   (buttons, focus); Navy `#1E3A5F` carries the static presence and is never
   re-coloured here. Matches --brand in src/index.css. */
const DEFAULT_PRIMARY = '#4F46E5'

const FALLBACK = {
  name: 'RPA CoE Control Room',
  company_name: '',
  primary_color: DEFAULT_PRIMARY,
  accent_color: '#0D9488',
  locale: 'en',
  logo_url: null,
  api_version: '4.1.0',
  features: {},
}

/** Convert '#3f51b5' into an 'r, g, b' triple so CSS can build translucent variants. */
function rgbTriple(hex) {
  const value = String(hex || '').replace('#', '')
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value
  const int = Number.parseInt(full || '4f46e5', 16)
  /* eslint-disable no-bitwise */
  return `${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}`
  /* eslint-enable no-bitwise */
}

function shade(hex, amount) {
  const value = String(hex || '').replace('#', '')
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value
  const int = Number.parseInt(full || '4f46e5', 16)
  /* eslint-disable no-bitwise */
  const clamp = (channel) => Math.max(0, Math.min(255, Math.round(channel * (1 + amount))))
  const r = clamp((int >> 16) & 255)
  const g = clamp((int >> 8) & 255)
  const b = clamp(int & 255)
  /* eslint-enable no-bitwise */
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

/** Mix a colour towards white by `weight` (0–1). Used to lift a brand for dark surfaces. */
function lift(hex, weight) {
  const value = String(hex || '').replace('#', '')
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value
  const int = Number.parseInt(full || '4f46e5', 16)
  /* eslint-disable no-bitwise */
  const mix = (channel) => Math.round(channel + (255 - channel) * weight)
  const parts = [mix((int >> 16) & 255), mix((int >> 8) & 255), mix(int & 255)]
  /* eslint-enable no-bitwise */
  return `#${parts.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

const BRAND_VARIABLES = ['--brand', '--brand-strong', '--brand-lighter', '--brand-soft', '--brand-ring', '--brand-fg', '--chart-1']

/**
 * White-label branding.
 *
 * Fetches the organization's colours/logo/name (public endpoint, needed before
 * login) so an On-Premises install can rebrand without a rebuild.
 */
export function BrandingProvider({ children }) {
  const isDark = useOptionalTheme()?.isDark === true

  const { data } = useQuery({
    queryKey: qk.branding,
    queryFn: () => api.get('/api/branding').catch(() => FALLBACK),
    staleTime: 5 * 60_000,
  })

  const branding = data || FALLBACK

  useEffect(() => {
    const root = document.documentElement
    const primary = branding.primary_color || FALLBACK.primary_color
    const accent = branding.accent_color || FALLBACK.accent_color

    if (String(primary).toLowerCase() === DEFAULT_PRIMARY.toLowerCase()) {
      // Built-in identity: let the theme tokens (light and dark) decide, so the
      // dark palette is never overridden by an inline light-theme colour.
      BRAND_VARIABLES.forEach((name) => root.style.removeProperty(name))
    } else if (isDark) {
      // Dark theme: an org colour must be lifted to stay readable on dark surfaces.
      const lifted = lift(primary, 0.45)
      root.style.setProperty('--brand', lifted)
      root.style.setProperty('--brand-strong', primary)
      root.style.setProperty('--brand-lighter', lift(primary, 0.65))
      root.style.setProperty('--brand-soft', `rgba(${rgbTriple(lifted)}, 0.18)`)
      root.style.setProperty('--brand-ring', `rgba(${rgbTriple(lifted)}, 0.5)`)
      root.style.setProperty('--brand-fg', '#0f1a2e')
      root.style.setProperty('--chart-1', lifted)
    } else {
      root.style.setProperty('--brand', primary)
      root.style.setProperty('--brand-strong', shade(primary, -0.22))
      root.style.setProperty('--brand-lighter', shade(primary, 0.18))
      root.style.setProperty('--brand-soft', `rgba(${rgbTriple(primary)}, 0.14)`)
      root.style.setProperty('--brand-ring', `rgba(${rgbTriple(primary)}, 0.38)`)
      root.style.setProperty('--chart-1', primary)
      root.style.setProperty(
        '--brand-fg',
        Number.parseInt(String(primary).replace('#', '').slice(0, 2) || '00', 16) > 170 ? '#131826' : '#ffffff',
      )
    }
    root.style.setProperty('--accent', accent)
    root.style.setProperty('--accent-strong', shade(accent, -0.2))
    root.style.setProperty('--accent-soft', `rgba(${rgbTriple(accent)}, 0.16)`)
    root.style.setProperty('--chart-2', accent)
    document.title = branding.name ? `${branding.name} · Control Room` : 'Control Room'
  }, [branding, isDark])

  const value = useMemo(
    () => ({
      branding,
      companyName: branding.company_name || branding.name || FALLBACK.name,
      features: branding.features || {},
    }),
    [branding],
  )

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>
}

export function useBranding() {
  const context = useContext(BrandingContext)
  if (!context) throw new Error('useBranding must be used inside <BrandingProvider>')
  return context
}

export default BrandingProvider
