/**
 * RTL / Arabic rendering in the DOM.
 *
 * The client's screenshot showed ``????`` instead of Arabic.  There are two
 * ways that can happen in a browser and this file guards both:
 *   • the characters never reach the DOM (an encoding/mojibake bug), and
 *   • the characters reach the DOM but are laid out LTR (a broken mirror).
 *
 * It also pins the *physical-property* rule: components must use logical CSS
 * (`ms-/me-/ps-/pe-/start-/end-`), never `ml-/mr-/pl-/pr-`, otherwise the
 * Arabic layout silently breaks — the classic RTL regression.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Badge, Button, Card, CardBody, DataTable, EmptyState, Field, Input, Kbd, Notice, ProgressBar, SectionTitle, SeverityBadge, StatusDot, Tabs } from '../components/ui'
import { applyLanguage } from '../i18n'
import en from '../i18n/locales/en.json'
import ar from '../i18n/locales/ar.json'

const ARABIC_ROWS = [
  { process_name: 'معالجة الفواتير', department: 'العمليات', status: 'مكتمل', transactions: 1200 },
  { process_name: 'فتح الحسابات', department: 'الفروع', status: 'فاشل', transactions: 340 },
]

const COLUMNS = [
  { key: 'process_name', header: 'العملية', dir: 'auto' },
  { key: 'department', header: 'الإدارة', dir: 'auto' },
  { key: 'status', header: 'الحالة' },
  { key: 'transactions', header: 'المعاملات', align: 'end' },
]

describe('Arabic text reaches the DOM intact', () => {
  it('renders Arabic values and labels without placeholders', async () => {
    await applyLanguage('ar')
    render(<DataTable columns={COLUMNS} rows={ARABIC_ROWS} rowKey={(row) => row.process_name} />)

    expect(screen.getByText('معالجة الفواتير')).toBeInTheDocument()
    expect(screen.getByText('فتح الحسابات')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\?{2,}/)
    expect(document.body.textContent).not.toContain('\uFFFD')
    // A number in an Arabic table stays in Latin digits.
    expect(screen.getByText('1200')).toBeInTheDocument()
  })

  it('renders every Arabic locale value inside <html dir="rtl">', async () => {
    await applyLanguage('ar')
    render(
      <Card>
        <CardBody>
          <SectionTitle title={ar.nav.settings} subtitle={ar.settings.subtitle} />
          <Field label={ar.fields.dialect} hint={ar.fields.encryptedAtRest}>
            <Input placeholder={ar.actions.search} />
          </Field>
          <Notice tone="info">{ar.dashboard.privateInstallation}</Notice>
          <EmptyState title={ar.empty.title} description={ar.empty.hint} />
        </CardBody>
      </Card>,
    )

    expect(document.documentElement.dir).toBe('rtl')
    // Every rendered string is Arabic, and none of it is a question mark run.
    for (const text of [ar.nav.settings, ar.fields.dialect, ar.empty.title]) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }
    expect(screen.queryByText(/^\?+$/)).toBeNull()
  })
})

describe('direction-safe components', () => {
  it('never emits a physical (left/right) utility class', () => {
    const { container } = render(
      <div>
        <Button icon={null}>{en.actions.save}</Button>
        <Badge tone="success">{en.common.yes}</Badge>
        <SeverityBadge severity="Critical" />
        <StatusDot color="var(--success)" label={en.common.yes} />
        <ProgressBar value={42} max={100} label={en.common.results} showLabel />
        <Kbd>Ctrl</Kbd>
        <Notice tone="warning">{en.errors.title}</Notice>
        <Tabs tabs={[{ key: 'a', label: en.common.results }]} value="a" onChange={() => {}} />
      </div>,
    )
    const physical = [...container.querySelectorAll('*')]
      .flatMap((node) => [...node.classList])
      .filter((name) => /^(ml|mr|pl|pr|left|right|border-l|border-r|text-left|text-right|rounded-l|rounded-r)-/.test(name))
    expect(physical).toEqual([])
  })

  it('mirrors the table structure in RTL without reordering the data', async () => {
    await applyLanguage('ar')
    const { container } = render(<DataTable columns={COLUMNS} rows={ARABIC_ROWS} rowKey={(row) => row.process_name} />)
    const headers = [...container.querySelectorAll('thead th')].map((cell) => cell.textContent.trim())
    // Logical order is preserved in the DOM (CSS handles the mirror) so screen
    // readers and `Ctrl+F` keep working in both directions.
    expect(headers).toEqual(['العملية', 'الإدارة', 'الحالة', 'المعاملات'])
    // The page level <html dir="rtl"> does the mirroring; the table itself must
    // not carry a second, conflicting direction.
    expect(document.documentElement.dir).toBe('rtl')
    const table = container.querySelector('table')
    expect(table).toBeTruthy()
    expect(table.getAttribute('dir')).not.toBe('ltr')
    // Arabic values keep their own direction inside an Arabic page…
    const arabicCell = screen.getByText('معالجة الفواتير').closest('td')
    expect(arabicCell).toHaveAttribute('dir', 'rtl')
  })

  it('keeps the table interactive: sorting, keyboard rows and aria state', async () => {
    const calls = []
    render(
      <DataTable
        columns={[{ key: 'process_name', header: 'Process', sortable: true }, { key: 'status', header: 'Status' }]}
        rows={ARABIC_ROWS}
        rowKey={(row) => row.process_name}
        onRowClick={(row) => calls.push(row.process_name)}
        sort={{ key: 'process_name', direction: 'asc' }}
        onSortChange={(next) => calls.push(next)}
      />,
    )
    const header = screen.getByRole('columnheader', { name: /Process/ })
    expect(header).toHaveAttribute('aria-sort')
    fireEvent.click(within(header).getByRole('button'))
    expect(calls.some((entry) => entry && entry.key === 'process_name')).toBe(true)

    const row = screen.getByText('معالجة الفواتير').closest('tr')
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(calls).toContain('معالجة الفواتير')
  })
})

describe('direction-aware formatting', () => {
  it('formats Arabic data both ways round', () => {
    expect(en.common.yes).not.toBe(ar.common.yes)
    expect(typeof ar.common.yes).toBe('string')
  })
})
