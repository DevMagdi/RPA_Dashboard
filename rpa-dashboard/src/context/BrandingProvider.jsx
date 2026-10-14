import { useQuery } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useMemo } from 'react'

import api from '../lib/api'
import { qk } from '../lib/queryClient'

const BrandingContext = createContext(null)

const FALLBACK = {
  name: 'RPA CoE Control Room',
  company_name: '',
  primary_color: '#6D5DFC',
  accent_color: '#0F9F91',
  locale: 'en',
  logo_url: null,
  api_version: '4.1.0',
  features: {},
}

/** Convert '#4b367c' into an 'r, g, b' triple so CSS can build translucent variants. */
function rgbTriple(hex) {
  const value = String(hex || '').replace('#', '')
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value
  const int = Number.parseInt(full || '4b367c', 16)
  /* eslint-disable no-bitwise */
  return `${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}`
  /* eslint-enable no-bitwise */
}

function shade(hex, amount) {
  const value = String(hex || '').replace('#', '')
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value
  const int = Number.parseInt(full || '4b367c', 16)
  /* eslint-disable no-bitwise */
  const clamp = (channel) => Math.max(0, Math.min(255, Math.round(channel * (1 + amount))))
  const r = clamp((int >> 16) & 255)
  const g = clamp((int >> 8) & 255)
  const b = clamp(int & 255)
  /* eslint-enable no-bitwise */
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

/**
 * White-label branding.
 *
 * Fetches the organization's colours/logo/name (public endpoint, needed before
 * login) so an On-Premises install can rebrand without a rebuild.
 */
export function BrandingProvider({ children }) {

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
    root.style.setProperty('--brand', primary)
    root.style.setProperty('--brand-strong', shade(primary, -0.22))
    root.style.setProperty('--brand-soft', `rgba(${rgbTriple(primary)}, 0.14)`)
    root.style.setProperty('--accent', accent)
    root.style.setProperty('--accent-soft', `rgba(${rgbTriple(accent)}, 0.16)`)
    root.style.setProperty(
      '--brand-fg',
      Number.parseInt(String(primary).replace('#', '').slice(0, 2) || '00', 16) > 170 ? '#131826' : '#ffffff',
    )
    document.title = branding.name ? `${branding.name} · Control Room` : 'Control Room'
  }, [branding])

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
