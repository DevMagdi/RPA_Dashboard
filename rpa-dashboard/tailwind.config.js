/** @type {import('tailwindcss').Config} */

// Design tokens live in CSS variables (see src/index.css) so that a tenant can
// be re-branded at runtime — the API returns primary/accent colours in
// `GET /api/branding` and the SPA writes them onto :root.  Tailwind therefore
// references the variables instead of fixed hex values.
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        border: 'var(--border)',
        text: 'var(--text)',
        muted: 'var(--text-muted)',
        brand: {
          DEFAULT: 'var(--brand)',
          soft: 'var(--brand-soft)',
          strong: 'var(--brand-strong)',
          fg: 'var(--brand-fg)',
        },
        accent: { DEFAULT: 'var(--accent)', soft: 'var(--accent-soft)' },
        success: { DEFAULT: 'var(--success)', soft: 'var(--success-soft)' },
        warning: { DEFAULT: 'var(--warning)', soft: 'var(--warning-soft)' },
        danger: { DEFAULT: 'var(--danger)', soft: 'var(--danger-soft)' },
        info: { DEFAULT: 'var(--info)', soft: 'var(--info-soft)' },
      },
      fontFamily: {
        sans: ['Inter', 'Cairo', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      borderRadius: { xl: '0.9rem', '2xl': '1.15rem', '3xl': '1.5rem' },
      boxShadow: {
        soft: 'var(--shadow-soft)',
        card: 'var(--shadow-card)',
        pop: 'var(--shadow-pop)',
        glow: '0 0 0 1px var(--brand-soft), 0 12px 30px -12px var(--brand)',
      },
      backdropBlur: { xs: '2px' },
      keyframes: {
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        'slide-up': { from: { opacity: 0, transform: 'translateY(10px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        'slide-in-end': { from: { opacity: 0, transform: 'translateX(var(--slide-from, 12px))' }, to: { opacity: 1, transform: 'translateX(0)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'pulse-soft': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.45 } },
        'spin-slow': { to: { transform: 'rotate(360deg)' } },
      },
      animation: {
        'fade-in': 'fade-in 220ms ease-out both',
        'slide-up': 'slide-up 260ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-in-end': 'slide-in-end 240ms cubic-bezier(0.22, 1, 0.36, 1) both',
        shimmer: 'shimmer 1.6s infinite',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        'spin-slow': 'spin-slow 1.2s linear infinite',
      },
      transitionTimingFunction: { premium: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    },
  },
  plugins: [],
}
