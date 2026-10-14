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
    bgSoft: '#F1F5F9',
    surface: '#FFFFFF',
    surface2: '#F8FAFC',
    surface3: '#F1F5F9',
    border: 'rgba(15, 23, 42, 0.06)',
    borderStrong: 'rgba(15, 23, 42, 0.12)',
    text: '#0F172A',
    textSoft: '#334155',
    textMuted: '#64748B',
    brand: '#4F46E5',
    brandStrong: '#3730A3',
    brandLighter: '#6366F1',
    accent: '#0D9488',
    accentStrong: '#0F766E',
    success: '#047857',
    warning: '#B45309',
    danger: '#BE123C',
    info: '#0369A1',
    chart: ['#4F46E5', '#0D9488', '#F59E0B', '#E0479E', '#0EA5E9', '#8B5CF6'],
  },
  dark: {
    bg: '#020617',
    bgSoft: '#0B1120',
    surface: '#0F172A',
    surface2: '#131C31',
    surface3: '#1B2741',
    border: 'rgba(255, 255, 255, 0.07)',
    borderStrong: 'rgba(255, 255, 255, 0.14)',
    text: '#EFF5FF',
    textSoft: '#CED8E8',
    textMuted: '#98A8BF',
    brand: '#818CF8',
    brandStrong: '#6D78F6',
    brandLighter: '#A5B4FC',
    accent: '#2DD4BF',
    accentStrong: '#14B8A6',
    success: '#34D399',
    warning: '#FBBF24',
    danger: '#FB7185',
    info: '#38BDF8',
    chart: ['#818CF8', '#2DD4BF', '#FBBF24', '#F472B6', '#38BDF8', '#A78BFA'],
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
  xs: '0 1px 2px rgba(15,23,42,.04)',
  soft: '0 1px 3px rgba(15,23,42,.04), 0 8px 24px -12px rgba(15,23,42,.08)',
  card: '0 1px 3px rgba(15,23,42,.05), 0 12px 28px -14px rgba(15,23,42,.1)',
  elevated: '0 4px 6px -1px rgba(15,23,42,.05), 0 20px 40px -20px rgba(15,23,42,.18)',
  pop: '0 4px 6px -1px rgba(15,23,42,.06), 0 24px 52px -24px rgba(15,23,42,.24)',
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
