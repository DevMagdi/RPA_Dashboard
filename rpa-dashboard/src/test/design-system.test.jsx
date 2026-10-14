/** Design System v5 contracts: tokens, variants, Arabic integrity, RTL. */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Badge, Button, Card, Drawer, EmptyState, Skeleton } from '../components/ui'
import tokens, { colors, radius, spacing } from '../design-system/tokens'
import ar from '../i18n/locales/ar.json'
import en from '../i18n/locales/en.json'

describe('design tokens', () => {
  it('is light-first with the requested premium palette', () => {
    expect(colors.light.bg).toBe('#F8FAFC')
    expect(colors.light.surface).toBe('#FFFFFF')
    expect(colors.light.brand).toBe('#4F46E5')
    expect(colors.light.accent).toBe('#0D9488')
    for (const key of ['success', 'warning', 'danger', 'info']) expect(colors.light[key]).toMatch(/^#/)
    expect(colors.dark.bg).not.toBe(colors.light.bg)
    expect(tokens).toBeTruthy()
  })
  it('uses a consistent 4pt spacing scale and soft radius', () => {
    expect(spacing).toEqual([0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64])
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
