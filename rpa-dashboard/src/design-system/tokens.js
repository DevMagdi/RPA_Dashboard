/**
 * RPA CoE Control Room — Design System tokens (single source of truth).
 *
 * These values mirror the CSS custom properties in `src/index.css`
 * (`:root` / `.dark`). Keep both in sync: CSS drives the app, this module
 * drives charts, canvas, tests and any JS-side theming.
 *
 * Identity: "Hybrid Premium Control Room" — Navy `#1E3A5F` / Navy-deep
 * `#122339` carry the presence (hero, live badge, active nav, KPI strips);
 * Orange `#F58220` is the attention accent (fills, strips, live accents —
 * never a text background); Teal `#0D9488` is reserved for live/telemetry
 * states; a refined Indigo `#3F51B5` serves brand *actions* (buttons, focus).
 *
 * Positioning reminder: single-tenant, On-Premises only — no SaaS/tenancy
 * concepts exist in this system by design.
 */

export const colors = {
  light: {
    bg: '#F5F7FB',
    bgSoft: '#EAEFF7',
    bgDeep: '#E0E7F1',
    surface: '#FFFFFF',
    surface2: '#F8FAFC',
    surface3: '#F1F5F9',
    surfaceSunken: '#E9EEF5',
    border: 'rgba(15, 23, 42, 0.07)',
    borderStrong: 'rgba(15, 23, 42, 0.14)',
    borderSoft: 'rgba(15, 23, 42, 0.04)',
    line: 'rgba(91, 107, 130, 0.22)',
    text: '#14213A',
    textSoft: '#2C4260',
    textMuted: '#5B6B82', /* AA (≥4.5:1) on the #F5F7FB canvas — 5.06:1 */
    navy: '#1E3A5F',
    navyDeep: '#122339',
    navyFg: '#FFFFFF',
    brand: '#4F46E5',
    brandStrong: '#3730A3',
    brandLighter: '#6366F1',
    accent: '#0D9488',
    accentStrong: '#0F766E',
    orange: '#F58220',
    orangeSoft: 'rgba(245, 130, 32, 0.14)',
    success: '#047857',
    warning: '#B45309',
    danger: '#BE123C',
    info: '#0369A1',
    /* KPI strip tones: strong fills for bars and dots (text uses the AA tokens above). */
    stripNavy: '#1E3A5F',
    stripIndigo: '#4F46E5',
    stripGreen: '#10B981',
    stripOrange: '#F58220',
    stripBlue: '#0EA5E9',
    stripTeal: '#14B8A6',
    stripRed: '#EF4444',
    chart: ['#1E3A5F', '#4C63D2', '#14B8A6', '#F58220', '#0EA5E9', '#2B5B9C'],
  },
  dark: {
    bg: '#0F1A2E',
    bgSoft: '#122036',
    bgDeep: '#0A1424',
    surface: '#152238',
    surface2: '#1B2A44',
    surface3: '#243652',
    surfaceSunken: '#0D1930',
    border: 'rgba(163, 190, 228, 0.14)',
    borderStrong: 'rgba(163, 190, 228, 0.24)',
    borderSoft: 'rgba(163, 190, 228, 0.07)',
    line: 'rgba(154, 181, 218, 0.22)',
    text: '#EEF3FA',
    textSoft: '#C7D3E4',
    textMuted: '#A6B4C8',
    navy: '#1E3A5F',
    navyDeep: '#122339',
    navyFg: '#FFFFFF',
    brand: '#818CF8',
    brandStrong: '#6D78F6',
    brandLighter: '#A5B4FC',
    accent: '#2DD4BF',
    accentStrong: '#14B8A6',
    orange: '#FF9640', /* slightly brighter for night-shift strips */
    orangeSoft: 'rgba(255, 150, 64, 0.18)',
    success: '#34D399',
    warning: '#FBBF24',
    danger: '#FB7185',
    info: '#38BDF8',
    stripNavy: '#7FA9DE',
    stripIndigo: '#818CF8',
    stripGreen: '#34D399',
    stripOrange: '#FF9640',
    stripBlue: '#38BDF8',
    stripTeal: '#2DD4BF',
    stripRed: '#F87171',
    chart: ['#7FA9DE', '#A5B4FC', '#2DD4BF', '#FF9640', '#38BDF8', '#9BC0EC'],
  },
}

/**
 * Command-centre hero — the locked navy-dominant gradient
 * (`linear-gradient(135deg, from 0%, mid 45%, to 100%)`) plus the scrim that
 * keeps white/muted text at WCAG AA across every point of that gradient.
 * The hero re-declares its tokens locally so all children adapt automatically.
 */
export const hero = {
  from: '#122339',
  mid: '#1E3A5F',
  to: '#0D9488',
  scrim: 'rgba(10, 26, 42, 0.40)', /* composited over the teal corner → 7.0:1 white, 5.4:1 muted */
  text: '#FFFFFF',
  textSoft: 'rgba(255, 255, 255, 0.92)',
  textMuted: 'rgba(226, 236, 246, 0.94)',
}

/**
 * KPI identity tones (the strip + icon colour of a KPI card). The mapping is
 * stable across the hero strip and the health board: a metric is always the
 * same colour; state is carried by icon + label (and the verdict badge), never
 * by colour alone. Values are `--strip-*` family names.
 */
export const kpiTones = {
  successRate: 'navy',
  runningNow: 'orange',
  costSaved: 'teal',
  runsToday: 'green',
  throughput: 'green',
  sla: 'indigo',
  slaRisk: 'indigo',
  failedToday: 'red',
  totalProcedures: 'navy',
  totalTransactions: 'blue',
  timeSaved: 'indigo',
  onlineRunners: 'teal',
  queueDepth: 'orange',
}

/** Resolve a KPI key to its `--strip-*` CSS custom property. */
export const kpiStripVar = (key) => `var(--strip-${kpiTones[key] || 'navy'})`

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
 * Static background mesh + glow rings. Values mirror the CSS custom properties
 * in `src/index.css`. The mesh is navy/teal-tinted depth — subtle by contract
 * (grid overlay opacity ≤ 0.28, never animated).
 */
export const effects = {
  light: {
    mesh1: 'rgba(30, 58, 95, 0.10)',
    mesh2: 'rgba(13, 148, 136, 0.07)',
    glowBrand: '0 0 0 1px var(--brand-soft), 0 14px 34px -14px var(--brand)',
    glowAccent: '0 0 0 1px var(--accent-soft), 0 14px 34px -14px var(--accent)',
  },
  dark: {
    mesh1: 'rgba(127, 169, 222, 0.12)',
    mesh2: 'rgba(45, 212, 191, 0.08)',
    glowBrand: '0 0 0 1px var(--brand-soft), 0 18px 44px -16px color-mix(in srgb, var(--brand) 78%, transparent)',
    glowAccent: '0 0 0 1px var(--accent-soft), 0 18px 44px -16px color-mix(in srgb, var(--accent) 72%, transparent)',
  },
}

export const shadows = {
  xs: '0 1px 2px rgba(15,23,42,.04)',
  soft: '0 1px 3px rgba(15,23,42,.04), 0 8px 24px -12px rgba(15,23,42,.08)',
  card: '0 1px 2px rgba(20,33,58,.05), 0 12px 34px rgba(20,33,58,.08)',
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

export default { colors, hero, kpiTones, kpiStripVar, spacing, radius, shadows, fonts, motion, typeScale, effects, breakpoints }
