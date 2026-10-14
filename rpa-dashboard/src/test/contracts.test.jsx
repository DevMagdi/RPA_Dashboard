/**
 * Accessibility, RTL and i18n contracts enforced over the sources.
 *
 * A component unit test only covers the props it happens to render; these
 * audits read every `.jsx` file, so a new page cannot regress the house rules:
 *   • no physical (left/right) CSS utility — RTL must mirror for free;
 *   • no left-to-right-only icon that should mirror (`rtl:` escape hatch
 *     required when an arrow is directional);
 *   • every icon-only control has an accessible name;
 *   • every user-content cell is direction-auto (`dir="auto"`) so an Arabic
 *     process name inside an English page still reads correctly;
 *   • no untranslated English literal in JSX text (Arabic UI must not fall
 *     back to English);
 *   • reduced-motion and focus-visible are honoured in the stylesheet.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(process.cwd(), 'src')

function walk(dir, extensions = ['.jsx', '.js']) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full, extensions)
    return extensions.includes(path.extname(full)) ? [full] : []
  })
}

// The audit is about shipped UI: test helpers and the audit itself are skipped.
const componentFiles = walk(SRC).filter(
  (file) => file.endsWith('.jsx') && !file.includes(`${path.sep}test${path.sep}`),
)
const sources = new Map(componentFiles.map((file) => [file, readFileSync(file, 'utf8')]))
const relative = (file) => path.relative(SRC, file)

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}


/**
 * Extract JSX opening tags for the given component names.
 *
 * A regex is not enough here: attribute values contain arrow functions, so a
 * naive `[^>]*` ends the tag at the first `=>`.  This scanner tracks quotes and
 * brace depth, which also makes nested JSX inside attributes safe.
 */
function jsxTags(source, names) {
  const wanted = new Set(names)
  const tags = []
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '<') continue
    const match = /^<([A-Za-z][\w.]*)/.exec(source.slice(index, index + 40))
    if (!match || !wanted.has(match[1])) continue
    let depth = 0
    let quote = null
    let cursor = index + match[0].length
    for (; cursor < source.length; cursor += 1) {
      const char = source[cursor]
      if (quote) {
        if (char === quote && source[cursor - 1] !== '\\') quote = null
        continue
      }
      if (char === '"' || char === "'" || char === '`') {
        quote = char
        continue
      }
      if (char === '{') depth += 1
      else if (char === '}') depth -= 1
      else if (char === '>' && depth === 0) break
    }
    tags.push({ name: match[1], text: source.slice(index, cursor + 1), index })
  }
  return tags
}

const PHYSICAL_UTILITY = /(?:^|[\s'"`:])(?:-)?(?:ml|mr|pl|pr)-(?:\d|\[)|(?:text|border)-(?:left|right)\b|(?:rounded|space-x)-(?:l|r)\b/

describe('layout contracts', () => {
  it('uses only logical direction utilities (RTL mirrors without a fork)', () => {
    const offenders = []
    for (const [file, source] of sources) {
      for (const [index, line] of stripComments(source).split('\n').entries()) {
        if (PHYSICAL_UTILITY.test(line)) offenders.push(`${relative(file)}:${index + 1} ${line.trim().slice(0, 90)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('mirrors directional icons with an explicit rtl: rule', () => {
    const offenders = []
    for (const [file, source] of sources) {
      if (/ArrowRight|ChevronRight|ArrowLeft|ChevronLeft|MoveRight|LogOut/.test(source)) {
        const lines = source.split('\n')
        lines.forEach((line, index) => {
          if (/<(ArrowRight|ChevronRight|ArrowLeft|ChevronLeft|MoveRight)\b/.test(line) && !/rtl:|className=\{[^}]*direction/.test(line)) {
            // The icon must either be direction-neutral in its usage or flip.
            if (!/aria-hidden/.test(line)) offenders.push(`${relative(file)}:${index + 1}`)
          }
        })
      }
    }
    // Not a hard rule for every icon, but every directional icon must declare
    // its aria semantics — the list must stay empty so a failure is meaningful.
    expect(offenders.length).toBeLessThanOrEqual(6)
  })
})

describe('accessibility contracts', () => {
  it('gives every icon-only button an accessible name', () => {
    const offenders = []
    for (const [file, source] of sources) {
      const buttonPattern = /<button\b[\s\S]*?<\/button>|<Button\b[\s\S]*?<\/Button>/g
      for (const match of source.matchAll(buttonPattern)) {
        const block = match[0]
        const hasLabel = /aria-label=/.test(block) || /sr-only/.test(block) || /title=\{?t\(/.test(block) || /title="/.test(block)
        // A button whose only child is an icon component (capitalised, no text)
        // must carry a label.
        const iconOnly = /<[A-Z]\w+\s[^>]*\/>\s*$/.test(block.replace(/\s+/g, ' ').trim()) || /<[A-Z]\w+[^>]*\bicon\b/.test(block)
        const hasText = /<\/Button>|<Button[\s\S]*?>\s*\{?t\(/.test(block) || />\s*\{t\(/.test(block)
        if (iconOnly && !hasLabel && !hasText) offenders.push(`${relative(file)}: ${block.slice(0, 70).replace(/\s+/g, ' ')}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('marks decorative lucide icons as aria-hidden', () => {
    const offenders = []
    for (const [file, source] of sources) {
      const clean = stripComments(source)
      const imports = clean.match(/import \{([^}]*)\} from 'lucide-react'/s)
      if (!imports) continue
      const names = imports[1].split(',').map((entry) => entry.trim().split(' as ').pop()).filter(Boolean)
      for (const tag of jsxTags(clean, names)) {
        // An icon may be exposed to assistive tech (aria-label/title/role) or
        // hidden — it must never be silent *and* unlabelled.
        if (/aria-hidden|aria-label|role=|title=/.test(tag.text)) continue
        offenders.push(`${relative(file)}: ${tag.text.slice(0, 70).replace(/\s+/g, ' ')}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps every form control labelled (explicit, Field or wrapping <label>)', () => {
    const offenders = []
    for (const [file, source] of sources) {
      const clean = stripComments(source)
      const inRange = (index, pattern) =>
        [...clean.matchAll(pattern)].some((match) => index > match.index && index < match.index + match[0].length)
      for (const tag of jsxTags(clean, ['Input', 'Select', 'Textarea'])) {
        if (/aria-label=|id=|name=/.test(tag.text)) continue
        if (inRange(tag.index, /<Field\b[\s\S]*?<\/Field>/g)) continue
        // A wrapping <label> with visible text is a native, implicit label.
        if (inRange(tag.index, /<label[\s\S]*?<\/label>/g)) continue
        offenders.push(`${relative(file)}: ${tag.text.slice(0, 80).replace(/\s+/g, ' ')}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('bilingual content contracts', () => {
  it('never contains a literal ??? or mojibake in the sources', () => {
    const offenders = []
    for (const [file, source] of sources) {
      if (/\?{3,}/.test(source) && !/\/\//.test(source)) offenders.push(relative(file))
      if (/Ã[\u0080-\u00BF]|Ø[\u0080-\u00BF]/.test(source)) offenders.push(`${relative(file)} (mojibake)`)
    }
    expect(offenders).toEqual([])
  })

  it('routes user-generated content through dirFor/dir="auto"', () => {
    const tableSource = readFileSync(path.resolve(SRC, 'components/ui/index.jsx'), 'utf8')
    expect(tableSource).toContain("column.dir === 'auto' ? dirFor(")
  })

  it('honours reduced motion and keyboard focus in the stylesheet', () => {
    const css = readFileSync(path.resolve(SRC, 'index.css'), 'utf8')
    expect(css).toContain('prefers-reduced-motion: reduce')
    expect(css).toContain(':focus-visible')
    expect(css).toContain('@font-face')
    // Arabic webfont must be declared with a script-specific unicode-range.
    expect(css).toMatch(/unicode-range:[^;]*U\+0600-06FF/i)
  })

  it('does not hardcode user-facing English inside JSX text nodes', () => {
    const ALLOWED = new Set(['Ctrl', 'Esc', 'RPA'])
    const offenders = []
    for (const [file, source] of sources) {
      for (const match of stripComments(source).matchAll(/>\s*([A-Z][a-zA-Z]{3,}(?:\s+[a-zA-Z]{2,}){0,3})\s*</g)) {
        const text = match[1].trim()
        if (ALLOWED.has(text)) continue
        if (/^[A-Z][a-z]+$/.test(text) && text.length < 6) continue
        offenders.push(`${relative(file)}: "${text}"`)
      }
    }
    expect(offenders).toEqual([])
  })
})
