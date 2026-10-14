/** Design System v5 contracts: tokens, variants, Arabic integrity, RTL. */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Badge, Button, Card, Drawer, EmptyState, Skeleton } from '../components/ui'
import tokens, { colors, radius, spacing } from '../design-system/tokens'
import ar from '../i18n/locales/ar.json'
import en from '../i18n/locales/en.json'

describe('design tokens', () => {
  it('is light-first with the requested premium palette', () => {
    expect(colors.light).toMatchObject({
      bg: '#F8FAFC',
      surface: '#FFFFFF',
      surface2: '#F8FAFC',
      border: 'rgba(15, 23, 42, 0.06)',
      text: '#0F172A',
      textMuted: '#64748B',
      brand: '#4F46E5',
      brandStrong: '#3730A3',
      accent: '#0D9488',
      success: '#047857',
      warning: '#B45309',
      danger: '#BE123C',
      info: '#0369A1',
    })
    expect(colors.dark).toMatchObject({
      bg: '#020617',
      surface: '#0F172A',
      surface2: '#131C31',
      border: 'rgba(255, 255, 255, 0.07)',
      text: '#EFF5FF',
      textMuted: '#98A8BF',
      brand: '#818CF8',
      accent: '#2DD4BF',
    })
    for (const key of ['success', 'warning', 'danger', 'info']) expect(colors.light[key]).toMatch(/^#/)
    expect(colors.dark.bg).not.toBe(colors.light.bg)
    expect(tokens).toBeTruthy()
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
    const lightForegrounds = ['text', 'textMuted', 'brand', 'accentStrong', 'success', 'warning', 'danger', 'info']
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
    const variables = ['bg', 'bgSoft', 'surface', 'surface2', 'surface3', 'border', 'borderStrong', 'text', 'textSoft', 'textMuted', 'brand', 'brandStrong', 'brandLighter', 'accent', 'accentStrong', 'success', 'warning', 'danger', 'info']
    const cssName = (name) => name.replace(/([a-z])([0-9])/g, '$1-$2').replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)

    for (const name of variables) {
      expect(lightBlock.toLowerCase()).toContain(`--${cssName(name)}: ${colors.light[name].toLowerCase()};`)
      expect(darkBlock.toLowerCase()).toContain(`--${cssName(name)}: ${colors.dark[name].toLowerCase()};`)
    }
  })

  it('uses a consistent 4pt spacing scale and soft radius', () => {
    expect(spacing).toEqual([0, 4, 8, 12, 16, 24, 32, 48])
    expect(radius.md).toBe('0.75rem')
    expect(radius.lg).toBe('1rem')
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
