/**
 * RPA CoE Control Room — Design System tokens (single source of truth).
 *
 * These values mirror the CSS custom properties in `src/index.css`
 * (`:root` / `.dark`). Keep both in sync: CSS drives the app, this module
 * drives charts, canvas, tests and any JS-side theming.
 * Positioning reminder: single-tenant, On-Premises only — no SaaS/tenancy
 * concepts exist in this system by design.
 */

export const colors = {
  light: {
    bg: '#F8FAFC',
    bgSoft: '#EEF2F7',
    surface: '#FFFFFF',
    surface2: '#F7F9FC',
    surface3: '#EEF2F8',
    border: '#E2E8F0',
    borderStrong: '#CBD5E1',
    text: '#0C1425',
    textSoft: '#33405A',
    textMuted: '#5D6B85',
    brand: '#4F46E5',
    brandStrong: '#4338CA',
    brandLighter: '#6D5EF5',
    accent: '#0D9488',
    accentStrong: '#0F766E',
    success: '#059669',
    warning: '#C2760A',
    danger: '#DC3454',
    info: '#0678B8',
    chart: ['#4F46E5', '#0D9488', '#F59E0B', '#E0479E', '#0EA5E9', '#8B5CF6'],
  },
  dark: {
    bg: '#070B14',
    bgSoft: '#0C1220',
    surface: '#0F1524',
    surface2: '#141B2D',
    surface3: '#1A2236',
    border: '#222C42',
    borderStrong: '#33415C',
    text: '#EEF3FF',
    textSoft: '#C3CDE0',
    textMuted: '#93A2BD',
    brand: '#837BFF',
    brandStrong: '#6D63F5',
    brandLighter: '#9B95FF',
    accent: '#2DD4BF',
    accentStrong: '#14B8A6',
    success: '#34D399',
    warning: '#FBBF24',
    danger: '#FB7185',
    info: '#38BDF8',
    chart: ['#837BFF', '#2DD4BF', '#FBBF24', '#F472B6', '#38BDF8', '#A78BFA'],
  },
}

/** 4-pt spacing scale (px). Use multiples only — no arbitrary gaps. */
export const spacing = [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64]

export const radius = {
  sm: '0.6rem',
  md: '0.75rem',
  lg: '1rem',
  xl: '1.25rem',
  '2xl': '1.5rem',
  full: '999px',
}

export const shadows = {
  xs: '0 1px 1px rgba(15,23,42,.04)',
  soft: '0 1px 2px rgba(15,23,42,.05), 0 2px 6px -2px rgba(15,23,42,.06)',
  card: '0 1px 2px rgba(15,23,42,.04), 0 10px 24px -18px rgba(15,23,42,.28)',
  pop: '0 2px 4px rgba(15,23,42,.05), 0 22px 48px -22px rgba(15,23,42,.32)',
  modal: '0 4px 8px rgba(15,23,42,.06), 0 40px 80px -32px rgba(15,23,42,.45)',
}

export const fonts = {
  latin: "'Inter Variable', 'Segoe UI', system-ui, sans-serif",
  arabic: "'Cairo Variable', 'Segoe UI', Tahoma, system-ui, sans-serif",
  mono: "'JetBrains Mono', Consolas, monospace",
}

export const motion = {
  easePremium: 'cubic-bezier(0.22, 1, 0.36, 1)',
  duration: { fast: 160, base: 220, slow: 320 },
  page: { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } },
}

export const breakpoints = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 }

export default { colors, spacing, radius, shadows, fonts, motion, breakpoints }
