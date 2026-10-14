/** Design System v5 contracts: tokens, variants, Arabic integrity, RTL. */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Badge, Button, Card, Drawer, EmptyState, Skeleton } from '../components/ui'
import tokens, { colors, effects, hero, kpiStripVar, kpiTones, radius, spacing, typeScale } from '../design-system/tokens'
import ar from '../i18n/locales/ar.json'
import en from '../i18n/locales/en.json'

describe('design tokens', () => {
  it('is light-first with the hybrid palette (Navy presence · Orange accents · Teal live-only)', () => {
    expect(colors.light).toMatchObject({
      bg: '#F5F7FB',
      surface: '#FFFFFF',
      surface2: '#F8FAFC',
      surface3: '#F1F5F9',
      border: 'rgba(15, 23, 42, 0.07)',
      text: '#14213A',
      textMuted: '#5B6B82',
      navy: '#1E3A5F',
      navyDeep: '#122339',
      brand: '#3F51B5',
      brandStrong: '#33439C',
      brandLighter: '#6C7CE0',
      accent: '#0D9488',
      orange: '#F58220',
      stripGreen: '#10B981',
      stripBlue: '#0EA5E9',
      stripRed: '#EF4444',
      info: '#0369A1',
    })
    expect(colors.dark).toMatchObject({
      bg: '#0F1A2E',
      surface: '#152238',
      surface2: '#1B2A44',
      border: 'rgba(163, 190, 228, 0.14)',
      text: '#EEF3FA',
      textMuted: '#A6B4C8',
      brand: '#A5B4FC',
      accent: '#2DD4BF',
      navy: '#1E3A5F',
      orange: '#FF9640',
    })
    for (const key of ['success', 'warning', 'danger', 'info']) expect(colors.light[key]).toMatch(/^#/)
    expect(colors.dark.bg).not.toBe(colors.light.bg)
    expect(tokens).toBeTruthy()
  })

  it('locks the navy hero gradient and the KPI identity strip map', () => {
    expect(hero).toMatchObject({ from: '#122339', mid: '#1E3A5F', to: '#0D9488' })
    // the mapping from the hybrid plan, plus the derived metrics
    expect(kpiTones).toMatchObject({
      totalProcedures: 'navy',
      runsToday: 'green',
      costSaved: 'teal',
      runningNow: 'orange',
      successRate: 'navy',
      failedToday: 'red',
      sla: 'indigo',
    })
    expect(kpiStripVar('costSaved')).toBe('var(--strip-teal)')
    expect(kpiStripVar('unknown-metric')).toBe('var(--strip-navy)')
    // every tone resolves to a real strip token in both themes
    for (const tone of new Set(Object.values(kpiTones))) {
      expect(colors.light[`strip${tone[0].toUpperCase()}${tone.slice(1)}`]).toBeTruthy()
      expect(colors.dark[`strip${tone[0].toUpperCase()}${tone.slice(1)}`]).toBeTruthy()
    }
  })
  it('keeps primary, muted and semantic text at WCAG AA contrast on key surfaces', () => {
    const luminance = (hex) => {
      const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
      const linear = channels.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
    }
    const contrast = (foreground, background) => {
      const [lighter, darker] = [luminance(foreground), luminance(background)].toSorted((a, b) => b - a)
      return (lighter + 0.05) / (darker + 0.05)
    }
    const lightForegrounds = ['text', 'textMuted', 'brand', 'accentStrong', 'navy', 'success', 'warning', 'danger', 'info']
    const darkForegrounds = ['text', 'textSoft', 'textMuted', 'brand', 'accent', 'success', 'warning', 'danger', 'info']

    for (const background of [colors.light.bg, colors.light.surface2, colors.light.surface]) {
      for (const foreground of lightForegrounds) {
        expect(contrast(colors.light[foreground], background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5)
      }
    }
    for (const background of [colors.dark.surface, colors.dark.surface2]) {
      for (const foreground of darkForegrounds) {
        expect(contrast(colors.dark[foreground], background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('keeps runtime CSS variables synchronized with the light and dark token objects', () => {
    const css = readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8')
    const lightBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] || ''
    const darkBlock = css.match(/\.dark\s*\{([\s\S]*?)\n\}/)?.[1] || ''
    const variables = ['bg', 'bgSoft', 'surface', 'surface2', 'surface3', 'border', 'borderStrong', 'line', 'text', 'textSoft', 'textMuted', 'navy', 'navyDeep', 'brand', 'brandStrong', 'brandLighter', 'accent', 'accentStrong', 'orange', 'success', 'warning', 'danger', 'info', 'stripNavy', 'stripIndigo', 'stripGreen', 'stripOrange', 'stripBlue', 'stripTeal', 'stripRed', 'heroFrom', 'heroMid', 'heroTo', 'heroScrim']
    const cssName = (name) => name.replace(/([a-z])([0-9])/g, '$1-$2').replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)
    /* hero stops live on the `hero` object and are identical in both themes
       (the command centre stays navy at night); everything else is per-theme. */
    const heroValues = { heroFrom: hero.from, heroMid: hero.mid, heroTo: hero.to, heroScrim: hero.scrim }

    for (const name of variables) {
      expect(lightBlock.toLowerCase()).toContain(`--${cssName(name)}: ${(heroValues[name] || colors.light[name]).toLowerCase()};`)
      expect(darkBlock.toLowerCase()).toContain(`--${cssName(name)}: ${(heroValues[name] || colors.dark[name]).toLowerCase()};`)
    }
  })

  it('uses a consistent 4pt spacing scale and soft radius', () => {
    expect(spacing).toEqual([0, 4, 8, 12, 16, 24, 32, 48])
    expect(radius.md).toBe('0.75rem')
    expect(radius.lg).toBe('1rem')
  })

  it('keeps hero text ≥ AA across the whole navy gradient once the scrim is composited', () => {
    const luminance = (hex) => {
      const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
      const linear = channels.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
    }
    const contrast = (foreground, background) => {
      const [lighter, darker] = [luminance(foreground), luminance(background)].toSorted((a, b) => b - a)
      return (lighter + 0.05) / (darker + 0.05)
    }
    const parseAlpha = (rgba) => Number.parseFloat(rgba.match(/[\d.]+\)$/)?.[0] || '1')
    const composite = (baseHex, overlayRgba) => {
      const alpha = parseAlpha(overlayRgba)
      const overlay = overlayRgba.match(/\d+/g).slice(0, 3).map(Number)
      const base = [1, 3, 5].map((start) => Number.parseInt(baseHex.slice(start, start + 2), 16))
      const mixed = base.map((channel, index) => Math.round(alpha * overlay[index] + (1 - alpha) * channel))
      return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
    }
    // the scrim darkens each gradient stop (heaviest at the teal corner)
    const scrims = ['rgba(18, 35, 57, 0.34)', 'rgba(13, 32, 50, 0.34)', hero.scrim]
    const stops = [hero.from, hero.mid, hero.to]
    for (const [index, stop] of stops.entries()) {
      const effective = composite(stop, scrims[index])
      expect(contrast(hero.text, effective), `white on ${effective} (${stop} + scrim)`).toBeGreaterThanOrEqual(4.5)
      expect(contrast('#D5E3ED', effective), `muted on ${effective}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('ships the hybrid mesh, glow and card-radius tokens in both themes', () => {
    const css = readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8')
    const lightBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] || ''
    const darkBlock = css.match(/\.dark\s*\{([\s\S]*?)\n\}/)?.[1] || ''
    const shell = css.slice(css.indexOf('.app-shell'))

    // static background mesh tokens exist per theme and drive the app canvas
    expect(effects.light.mesh1).toBe('rgba(30, 58, 95, 0.10)')
    expect(effects.dark.mesh1).toBe('rgba(127, 169, 222, 0.12)')
    expect(lightBlock).toContain('--mesh-1: rgba(30, 58, 95, 0.10);')
    expect(lightBlock).toContain('--mesh-2: rgba(13, 148, 136, 0.07);')
    expect(darkBlock).toContain('--mesh-1: rgba(127, 169, 222, 0.12);')
    expect(darkBlock).toContain('--mesh-2: rgba(45, 212, 191, 0.08);')
    expect(shell).toContain('radial-gradient(1100px 620px at 100% -12%, var(--mesh-1)')
    expect(shell).toContain('radial-gradient(880px 520px at -10% 108%, var(--mesh-2)')

    // the locked navy → teal hero gradient, assembled from its stop tokens
    expect(lightBlock).toContain('--hero-from: #122339;')
    expect(lightBlock).toContain('--hero-mid: #1e3a5f;')
    expect(lightBlock).toContain('--hero-to: #0d9488;')
    expect(css).toContain('background: linear-gradient(135deg, var(--hero-from) 0%, var(--hero-mid) 45%, var(--hero-to) 100%);')

    // glow rings are tokens (not inline literals) and feed the Tailwind glow shadows
    expect(lightBlock).toContain('--glow-brand:')
    expect(lightBlock).toContain('--glow-accent:')
    expect(darkBlock).toContain('--glow-brand:')
    expect(darkBlock).toContain('--glow-accent:')
    const tailwindConfig = readFileSync(path.resolve(process.cwd(), 'tailwind.config.js'), 'utf8')
    expect(tailwindConfig).toContain("glow: 'var(--glow-brand)'")
    expect(tailwindConfig).toContain("'glow-accent': 'var(--glow-accent)'")

    // main cards are 20px; controls stay at 12px
    expect(lightBlock).toContain('--radius-card: 1.25rem;')
    expect(lightBlock).toContain('--radius-ctrl: 0.75rem;')
    expect(css).toMatch(/\.card\s*\{[^}]*border-radius: var\(--radius-card\)/s)

    // type scale weights: display 680, page title 650, section 600
    expect(css).toMatch(/\.text-display\s*\{[^}]*font-weight: 680/s)
    expect(css).toMatch(/\.text-page-title\s*\{[^}]*font-weight: 650/s)
    expect(css).toMatch(/\.text-section-title\s*\{[^}]*font-weight: 600/s)
    expect(typeScale.display.weight).toBe(680)
    expect(typeScale.pageTitle.weight).toBe(650)
    expect(radius.card).toBe('1.25rem')
    expect(radius.ctrl).toBe('0.75rem')
  })

  it('gives Arabic its line-height 1.75 and strips letter-spacing in RTL', () => {
    const css = readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8')
    expect(css).toMatch(/html\[dir='rtl'\] body \{[^}]*line-height: 1\.75/s)
    // the RTL reset is unlayered so it beats any tracking utility
    expect(css).toMatch(/html\[dir='rtl'\] \* \{[^}]*letter-spacing: normal/s)
    expect(css.indexOf("html[dir='rtl'] *")).toBeGreaterThan(css.indexOf('@layer utilities'))
  })
})

describe('components', () => {
  it('renders all button variants including destructive', () => {
    render(<><Button variant="primary">حفظ</Button><Button variant="secondary">إلغاء</Button><Button variant="ghost">عرض</Button><Button variant="destructive">حذف</Button></>)
    for (const label of ['حفظ', 'إلغاء', 'عرض', 'حذف']) expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
  })
  it('renders badge, card, skeleton and empty state', () => {
    const { container } = render(<Card><Badge tone="success" dot>نشط</Badge><Skeleton className="h-4" /><EmptyState title="لا توجد بيانات" description="جرّب لاحقًا" /></Card>)
    expect(screen.getByText('نشط')).toBeInTheDocument()
    expect(screen.getByText('لا توجد بيانات')).toBeInTheDocument()
    expect(container.querySelector('.skeleton')).toBeTruthy()
  })
  it('drawer renders its title when open', () => {
    render(<Drawer open onOpenChange={() => {}} title="التفاصيل"><p>محتوى الدرج</p></Drawer>)
    expect(screen.getByText('التفاصيل')).toBeInTheDocument()
    expect(screen.getByText('محتوى الدرج')).toBeInTheDocument()
  })
})

describe('Arabic integrity', () => {
  const flat = (obj, out = []) => { for (const v of Object.values(obj)) { if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') flat(v, out) } return out }
  it('Arabic locale has no ???? corruption and covers English keys', () => {
    const arText = flat(ar).join(' ')
    expect(arText).not.toMatch(/\?{2,}/)
    expect(flat(ar).length).toBeGreaterThan(100)
    expect(Object.keys(ar).toSorted()).toEqual(Object.keys(en).toSorted())
    expect(arText).toMatch(/[\u0600-\u06FF]/)
  })
})
