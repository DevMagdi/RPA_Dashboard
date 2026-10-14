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
    bg: '#F8F5FF',
    bgSoft: '#F3EEFF',
    surface: '#FFFFFF',
    surface2: '#FAF8FF',
    surface3: '#F3EEFF',
    border: 'rgba(91, 33, 182, 0.08)',
    borderStrong: 'rgba(91, 33, 182, 0.16)',
    line: 'rgba(107, 91, 138, 0.18)',
    text: '#1E0B3A',
    textSoft: '#3B2A5E',
    textMuted: '#6B5B8A',
    navy: '#2E1065',
    navyDeep: '#1E0B3A',
    navyFg: '#FFFFFF',
    brand: '#5B21B6',
    brandStrong: '#4C1D95',
    brandLighter: '#7C3AED',
    accent: '#0D9488',
    accentStrong: '#0F766E',
    orange: '#F58220',
    orangeSoft: 'rgba(245, 130, 32, 0.14)',
    success: '#047857',
    warning: '#B45309',
    danger: '#BE123C',
    info: '#0369A1',
    /* KPI strip tones: bright fills for bars and dots (text uses the AA tokens above). */
    stripNavy: '#5B21B6',
    stripIndigo: '#7C3AED',
    stripGreen: '#10B981',
    stripOrange: '#F58220',
    stripBlue: '#0EA5E9',
    stripTeal: '#C026D3',
    stripRed: '#EF4444',
    chart: ['#5B21B6', '#8B5CF6', '#C026D3', '#0EA5E9', '#F58220', '#4C1D95'],
  },
  dark: {
    bg: '#0B0618',
    bgSoft: '#0F0820',
    surface: '#130B24',
    surface2: '#1A1030',
    surface3: '#22153C',
    border: 'rgba(196, 181, 253, 0.12)',
    borderStrong: 'rgba(196, 181, 253, 0.22)',
    line: 'rgba(184, 169, 212, 0.2)',
    text: '#F5F0FF',
    textSoft: '#DDD3F0',
    textMuted: '#B8A9D4',
    navy: '#2E1065',
    navyDeep: '#1E0B3A',
    navyFg: '#FFFFFF',
    brand: '#A78BFA',
    brandStrong: '#8B5CF6',
    brandLighter: '#C4B5FD',
    accent: '#2DD4BF',
    accentStrong: '#14B8A6',
    orange: '#F58220',
    orangeSoft: 'rgba(245, 130, 32, 0.18)',
    success: '#34D399',
    warning: '#FBBF24',
    danger: '#FB7185',
    info: '#38BDF8',
    stripNavy: '#8B5CF6',
    stripIndigo: '#C4B5FD',
    stripGreen: '#34D399',
    stripOrange: '#F58220',
    stripBlue: '#38BDF8',
    stripTeal: '#E879F9',
    stripRed: '#F87171',
    chart: ['#A78BFA', '#C4B5FD', '#E879F9', '#38BDF8', '#F58220', '#8B5CF6'],
  },
}

/** Approved 4-pt spacing rhythm (px), plus zero for resets. */
export const spacing = [0, 4, 8, 12, 16, 24, 32, 48]

export const radius = {
  sm: '0.6rem',
  md: '0.75rem',
  lg: '1rem',
  card: '1.25rem',
  ctrl: '0.75rem',
  xl: '1.25rem',
  '2xl': '1.5rem',
  full: '999px',
}

/**
 * Static background mesh + glow rings (premium plan, phase 0).
 * Values mirror the CSS custom properties in `src/index.css`.
 */
export const effects = {
  light: {
    mesh1: 'rgba(91, 33, 182, 0.12)',
    mesh2: 'rgba(124, 58, 237, 0.08)',
    glowBrand: '0 0 0 1px var(--brand-soft), 0 14px 34px -14px var(--brand)',
    glowAccent: '0 0 0 1px var(--accent-soft), 0 14px 34px -14px var(--accent)',
  },
  dark: {
    mesh1: 'rgba(167, 139, 250, 0.14)',
    mesh2: 'rgba(139, 92, 246, 0.10)',
    glowBrand: '0 0 0 1px var(--brand-soft), 0 18px 44px -16px color-mix(in srgb, var(--brand) 78%, transparent)',
    glowAccent: '0 0 0 1px var(--accent-soft), 0 18px 44px -16px color-mix(in srgb, var(--accent) 72%, transparent)',
  },
}

export const shadows = {
  xs: '0 1px 2px rgba(15,23,42,.04)',
  soft: '0 1px 3px rgba(15,23,42,.04), 0 8px 24px -12px rgba(15,23,42,.08)',
  card: '0 1px 2px rgba(20,33,58,.04), 0 12px 34px rgba(20,33,58,.06)',
  elevated: '0 2px 6px rgba(20,33,58,.06), 0 22px 50px rgba(30,58,95,.16)',
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

/** Premium type scale: display 680 → page title 650 → section 600 → body 400. */
export const typeScale = {
  display: { size: 'clamp(1.55rem, 3.2vw, 2.3rem)', weight: 680 },
  pageTitle: { size: 'clamp(1.375rem, 2.2vw, 1.5rem)', weight: 650 },
  sectionTitle: { weight: 600 },
  body: { size: '0.875rem', weight: 400 },
  caption: { size: '0.75rem', weight: 400 },
}

export const breakpoints = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 }

export default { colors, spacing, radius, shadows, fonts, motion, typeScale, effects, breakpoints }
