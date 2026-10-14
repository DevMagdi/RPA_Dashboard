/** @type {import('tailwindcss').Config} */

/**
 * Design system — Tailwind bridge.
 *
 * Every value resolves to a CSS variable declared in `src/index.css`, so a
 * single source of truth drives:
 *   • the light-first premium theme (and its dark counterpart),
 *   • runtime white-labelling (organization branding rewrites --brand/--accent),
 *   • shadcn/ui-style primitives (background/foreground/card/primary/ring/…).
 *
 * Two naming families are exposed on purpose:
 *   1. the product tokens (`bg-surface`, `text-muted`, `border-border`, …) that
 *      the whole application already speaks, and
 *   2. the shadcn/ui conventional tokens (`bg-background`, `text-foreground`,
 *      `bg-card`, `ring-ring`, `border-input`, …) so a shadcn component can be
 *      dropped into `src/components/ui/` with zero re-mapping.
 */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* --- product tokens ------------------------------------------- */
        bg: { DEFAULT: 'var(--bg)', soft: 'var(--bg-soft)', deep: 'var(--bg-deep)' },
        surface: {
          DEFAULT: 'var(--surface)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
          sunken: 'var(--surface-sunken)',
        },
        border: { DEFAULT: 'var(--border)', strong: 'var(--border-strong)', soft: 'var(--border-soft)' },
        text: { DEFAULT: 'var(--text)', soft: 'var(--text-soft)' },
        muted: { DEFAULT: 'var(--text-muted)', foreground: 'var(--text-muted)', surface: 'var(--surface-2)' },
        navy: { DEFAULT: 'var(--navy)', deep: 'var(--navy-deep)', fg: 'var(--navy-fg)' },
        orange: { DEFAULT: 'var(--orange)', soft: 'var(--orange-soft)', fg: 'var(--orange-fg)' },
        brand: {
          DEFAULT: 'var(--brand)',
          strong: 'var(--brand-strong)',
          soft: 'var(--brand-soft)',
          lighter: 'var(--brand-lighter)',
          fg: 'var(--brand-fg)',
          ring: 'var(--brand-ring)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          strong: 'var(--accent-strong)',
          soft: 'var(--accent-soft)',
          fg: 'var(--accent-fg)',
          ui: 'var(--ui-accent)',
        },
        success: { DEFAULT: 'var(--success)', soft: 'var(--success-soft)', strong: 'var(--success-strong)' },
        warning: { DEFAULT: 'var(--warning)', soft: 'var(--warning-soft)', strong: 'var(--warning-strong)' },
        danger: { DEFAULT: 'var(--danger)', soft: 'var(--danger-soft)', strong: 'var(--danger-strong)' },
        info: { DEFAULT: 'var(--info)', soft: 'var(--info-soft)', strong: 'var(--info-strong)' },

        /* --- shadcn/ui conventional tokens ---------------------------- */
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: { DEFAULT: 'var(--card)', foreground: 'var(--card-foreground)' },
        popover: { DEFAULT: 'var(--popover)', foreground: 'var(--popover-foreground)' },
        primary: { DEFAULT: 'var(--primary)', foreground: 'var(--primary-foreground)' },
        secondary: { DEFAULT: 'var(--secondary)', foreground: 'var(--secondary-foreground)' },
        destructive: { DEFAULT: 'var(--destructive)', foreground: 'var(--destructive-foreground)' },
        input: 'var(--input)',
        ring: 'var(--ring)',

        /* --- data-visualisation palette ------------------------------ */
        chart: {
          1: 'var(--chart-1)',
          2: 'var(--chart-2)',
          3: 'var(--chart-3)',
          4: 'var(--chart-4)',
          5: 'var(--chart-5)',
          6: 'var(--chart-6)',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        display: ['var(--font-display)'],
        arabic: ['var(--font-arabic)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.01em' }],
        xs: ['0.75rem', { lineHeight: '1.1rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.875rem', { lineHeight: '1.45rem' }],
        lg: ['1rem', { lineHeight: '1.55rem' }],
        xl: ['1.125rem', { lineHeight: '1.7rem' }],
        '2xl': ['1.375rem', { lineHeight: '1.85rem', letterSpacing: '-0.01em' }],
        '3xl': ['1.75rem', { lineHeight: '2.1rem', letterSpacing: '-0.02em' }],
        '4xl': ['2.25rem', { lineHeight: '2.6rem', letterSpacing: '-0.025em' }],
        '5xl': ['3rem', { lineHeight: '3.25rem', letterSpacing: '-0.03em' }],
      },
      spacing: { 4.5: '1.125rem', 13: '3.25rem', 18: '4.5rem', 22: '5.5rem', 30: '7.5rem' },
      borderRadius: {
        sm: '0.4rem',
        md: '0.6rem',
        lg: '0.75rem',
        xl: '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '1.9rem',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        soft: 'var(--shadow-soft)',
        card: 'var(--shadow-card)',
        elevated: 'var(--shadow-elevated)',
        pop: 'var(--shadow-pop)',
        modal: 'var(--shadow-modal)',
        glow: 'var(--glow-brand)',
        'glow-accent': 'var(--glow-accent)',
        inset: 'var(--shadow-inset)',
      },
      backdropBlur: { xs: '2px', '2xl': '30px' },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, var(--brand) 0%, var(--brand-strong) 55%, var(--brand-lighter) 130%)',
        'brand-sheen': 'linear-gradient(120deg, transparent 20%, color-mix(in srgb, var(--brand-fg) 26%, transparent) 50%, transparent 80%)',
        grid: 'linear-gradient(var(--border-soft) 1px, transparent 1px), linear-gradient(90deg, var(--border-soft) 1px, transparent 1px)',
        'surface-sheen': 'linear-gradient(150deg, color-mix(in srgb, var(--surface) 96%, var(--brand)) 0%, var(--surface) 45%, color-mix(in srgb, var(--surface) 97%, var(--brand-lighter)) 100%)',
      },
      backgroundSize: { grid: '34px 34px', 'sheen-200': '200% 100%' },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-out': { from: { opacity: '1' }, to: { opacity: '0' } },
        'slide-up': { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'slide-down': { from: { opacity: '0', transform: 'translateY(-8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'slide-in-end': { from: { opacity: '0', transform: 'translateX(var(--slide-from, 12px))' }, to: { opacity: '1', transform: 'translateX(0)' } },
        'scale-in': { from: { opacity: '0', transform: 'scale(0.96)' }, to: { opacity: '1', transform: 'scale(1)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'pulse-soft': { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.42' } },
        'pulse-ring': {
          '0%': { transform: 'scale(0.85)', opacity: '0.7' },
          '70%': { transform: 'scale(1.9)', opacity: '0' },
          '100%': { transform: 'scale(1.9)', opacity: '0' },
        },
        'spin-slow': { to: { transform: 'rotate(360deg)' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        'aurora-drift': {
          '0%': { transform: 'translate3d(-3%, -2%, 0) scale(1.05)' },
          '50%': { transform: 'translate3d(4%, 3%, 0) scale(1.12)' },
          '100%': { transform: 'translate3d(-3%, -2%, 0) scale(1.05)' },
        },
        'gradient-x': { '0%,100%': { backgroundPosition: '0% 50%' }, '50%': { backgroundPosition: '100% 50%' } },
        rise: { from: { opacity: '0', transform: 'translateY(18px) scale(0.99)' }, to: { opacity: '1', transform: 'translateY(0) scale(1)' } },
        'ticker-in': { from: { opacity: '0', transform: 'translateY(60%)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'sweep': { '0%': { transform: 'translateX(-120%)' }, '100%': { transform: 'translateX(220%)' } },
      },
      animation: {
        'fade-in': 'fade-in 240ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-out': 'fade-out 160ms ease-out both',
        'slide-up': 'slide-up 300ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-down': 'slide-down 220ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-in-end': 'slide-in-end 260ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'scale-in': 'scale-in 180ms cubic-bezier(0.22, 1, 0.36, 1) both',
        shimmer: 'shimmer 1.6s infinite',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        'pulse-ring': 'pulse-ring 2.4s cubic-bezier(0.22, 1, 0.36, 1) infinite',
        'spin-slow': 'spin-slow 1.2s linear infinite',
        float: 'float 6s ease-in-out infinite',
        'aurora-drift': 'aurora-drift 26s ease-in-out infinite',
        'gradient-x': 'gradient-x 8s ease infinite',
        rise: 'rise 420ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'ticker-in': 'ticker-in 380ms cubic-bezier(0.22, 1, 0.36, 1) both',
        sweep: 'sweep 2.6s cubic-bezier(0.4, 0, 0.2, 1) infinite',
      },
      transitionTimingFunction: {
        premium: 'cubic-bezier(0.22, 1, 0.36, 1)',
        exit: 'cubic-bezier(0.4, 0, 1, 1)',
      },
      transitionDuration: { 250: '250ms', 400: '400ms' },
      zIndex: { 60: '60', 70: '70', 80: '80', 90: '90' },
      screens: { xs: '420px' },
    },
  },
  plugins: [],
}
