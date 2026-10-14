/**
 * Frontend performance budget.
 *
 * "The dashboard must open and refresh very fast" is only meaningful if it is
 * *measured*.  These assertions run against the real production build
 * (`npm run build`) and against the rendered DOM, so a regression that pulls
 * recharts into the entry chunk, or that stops virtualising long tables, fails
 * the suite instead of quietly shipping.
 *
 * The numbers are budgets, not targets: they are set comfortably above the
 * measured values of the current build so a small dependency bump does not
 * break CI, while a structural regression does.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DataTable } from '../components/ui'
import { queryClient } from '../lib/queryClient'
import { ROUTES } from '../lib/routeMeta'

const DIST = path.resolve(process.cwd(), 'dist')
const BUDGETS = {
  entryJs: 420_000, // critical-path JavaScript the browser must parse first
  anyChunk: 1_200_000,
  css: 140_000,
}

function distFiles() {
  if (!existsSync(DIST)) return null
  const assets = path.join(DIST, 'assets')
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
    )
  return existsSync(assets) ? walk(assets) : []
}

const files = distFiles()

describe('production bundle', () => {
  it.runIf(files)('splits the entry chunk from charts, motion and vendor code', () => {
    const js = files.filter((file) => file.endsWith('.js'))
    const names = js.map((file) => path.basename(file))
    // Manual chunking must keep recharts out of the entry bundle.
    expect(names.some((name) => name.startsWith('charts'))).toBe(true)
    expect(names.some((name) => name.includes('index'))).toBe(true)

    const entry = js.filter((file) => /assets\/index-.*\.js$/.test(file))
    for (const file of entry) {
      const size = readFileSync(file).byteLength
      expect(size, `entry chunk ${path.basename(file)} exceeds the budget`).toBeLessThan(BUDGETS.entryJs)
    }

    for (const file of js) {
      expect(readFileSync(file).byteLength).toBeLessThan(BUDGETS.anyChunk)
    }
  })

  it.runIf(files)('keeps the critical CSS small and compressed-friendly', () => {
    const css = files.filter((file) => file.endsWith('.css'))
    expect(css.length).toBeGreaterThan(0)
    for (const file of css) {
      const raw = readFileSync(file)
      expect(raw.byteLength).toBeLessThan(BUDGETS.css)
      // A stylesheet that does not compress means a lot of repeated literals.
      expect(gzipSync(raw).byteLength).toBeLessThan(raw.byteLength * 0.45)
    }
  })

  it.runIf(files)('ships every route as its own lazy chunk', () => {
    const js = files.filter((file) => file.endsWith('.js'))
    const pageChunks = js.filter((file) => /assets\/(Dashboard|Runs|Audit|Users|Processes|Capacity|Infrastructure|Lifecycle|Health|Organization|Alerts|Settings|[A-Z]\w+)Page-/.test(file))
    expect(pageChunks.length).toBeGreaterThanOrEqual(ROUTES.length)
  })

  it.runIf(files)('preloads the self-hosted fonts instead of blocking on them', () => {
    const html = readFileSync(path.join(DIST, 'index.html'), 'utf8')
    expect(html).toContain('rel="preload"')
    expect(html).toContain('cairo-arabic-wght-normal.woff2')
    expect(html).toContain('crossorigin')
  })
})

describe('render throughput', () => {
  const rows = Array.from({ length: 2_000 }, (_, index) => ({
    process_name: `معالجة الفواتير ${index}`,
    department: 'العمليات',
    status: index % 3 === 0 ? 'فاشل' : 'مكتمل',
    transactions: 1000 + index,
  }))
  const columns = [
    { key: 'process_name', header: 'العملية', dir: 'auto' },
    { key: 'department', header: 'الإدارة' },
    { key: 'status', header: 'الحالة' },
    { key: 'transactions', header: 'المعاملات', align: 'end' },
  ]

  it('renders a 2 000-row Arabic table in a bounded DOM', () => {
    const started = performance.now()
    const { container } = render(<DataTable columns={columns} rows={rows} rowKey={(row) => row.process_name} />)
    const elapsed = performance.now() - started
    const renderedRows = container.querySelectorAll('tbody tr').length

    // Virtualisation must keep the DOM small regardless of the dataset size.
    expect(renderedRows).toBeLessThan(120)
    expect(screen.queryByText('معالجة الفواتير 1999')).toBeNull()
    // Generous ceiling: jsdom is far slower than a browser, this only catches a
    // catastrophic regression such as rendering every row.
    expect(elapsed).toBeLessThan(1500)
  })

  it('caches aggressively enough for an operations console', () => {
    const defaults = queryClient.getDefaultOptions().queries
    expect(defaults.staleTime).toBeGreaterThanOrEqual(10_000)
    expect(defaults.gcTime).toBeGreaterThanOrEqual(5 * 60_000)
    expect(defaults.retry(0, new Error('network'))).toBe(true)
  })

  it('keeps route loaders lazy so the shell never imports a page eagerly', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/App.jsx'), 'utf8')
    expect(source).toContain('routeMeta')
    expect(source).not.toMatch(/import\s+\w+\s+from\s+'\.\/pages\//)
  })
})
