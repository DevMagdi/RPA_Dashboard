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
    bg: '#F3F6FA',
    bgSoft: '#F7F9FC',
    surface: '#FFFFFF',
    surface2: '#F7F9FC',
    surface3: '#E9EEF5',
    border: '#E1E7F0',
    borderStrong: '#C6D0DE',
    text: '#111827',
    textSoft: '#344154',
    textMuted: '#657286',
    brand: '#6254E8',
    brandStrong: '#5145C5',
    brandLighter: '#7A6FF0',
    accent: '#0F9F91',
    accentStrong: '#0A7E74',
    success: '#047857',
    warning: '#B45309',
    danger: '#BE123C',
    info: '#0369A1',
    chart: ['#6254E8', '#0F9F91', '#F59E0B', '#E0479E', '#0EA5E9', '#8B5CF6'],
  },
  dark: {
    bg: '#070B14',
    bgSoft: '#0B1220',
    surface: '#101827',
    surface2: '#141F30',
    surface3: '#1C2A3D',
    border: '#253249',
    borderStrong: '#3A4A66',
    text: '#EFF5FF',
    textSoft: '#CED8E8',
    textMuted: '#98A8BF',
    brand: '#7F72FF',
    brandStrong: '#7969FF',
    brandLighter: '#9C93FF',
    accent: '#2DD4BF',
    accentStrong: '#14B8A6',
    success: '#34D399',
    warning: '#FBBF24',
    danger: '#FB7185',
    info: '#38BDF8',
    chart: ['#7F72FF', '#2DD4BF', '#FBBF24', '#F472B6', '#38BDF8', '#A78BFA'],
  },
}

/** Approved 4-pt spacing rhythm (px), plus zero for resets. */
export const spacing = [0, 4, 8, 12, 16, 24, 32, 48]

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
