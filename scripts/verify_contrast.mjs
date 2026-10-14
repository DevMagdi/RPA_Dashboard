#!/usr/bin/env node
/**
 * WCAG contrast verification for the Hybrid Premium Control Room palette.
 *
 * Run: node scripts/verify_contrast.mjs   (exit code 1 if any pair fails)
 *
 * Covers the three surfaces the product actually ships:
 *   • light mode (day shift)  — canvas / surface / surface-2 / surface-3
 *   • dark mode (night shift) — canvas / surface / surface-2
 *   • the navy command hero   — white + muted text over every gradient stop,
 *     with the hero scrim composited exactly as the CSS stacks it.
 */
import tokens from '../rpa-dashboard/src/design-system/tokens.js'

const { colors, hero } = tokens

const luminance = (hex) => {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
  const linear = channels.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

const contrast = (foreground, background) => {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

const parseAlpha = (rgba) => Number.parseFloat(rgba.match(/[\d.]+\)$/)?.[0] ?? '1')

const composite = (baseHex, overlayRgba) => {
  const alpha = parseAlpha(overlayRgba)
  const overlay = overlayRgba.match(/\d+/g).slice(0, 3).map(Number)
  const base = [1, 3, 5].map((start) => Number.parseInt(baseHex.slice(start, start + 2), 16))
  const mixed = base.map((channel, index) => Math.round(alpha * overlay[index] + (1 - alpha) * channel))
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

const rows = []
const check = (label, foreground, background, min = 4.5) => {
  const ratio = contrast(foreground, background)
  rows.push({ label, foreground, background, ratio: ratio.toFixed(2), min, ok: ratio >= min })
}

/* ── light mode ─────────────────────────────────────────────────────────── */
const lightSurfaces = [
  ['canvas', colors.light.bg],
  ['surface', colors.light.surface],
  ['surface-2', colors.light.surface2],
  ['surface-3', colors.light.surface3],
]
for (const [name, background] of lightSurfaces) {
  for (const key of ['text', 'textSoft', 'textMuted', 'brand', 'navy', 'accentStrong', 'success', 'warning', 'danger', 'info']) {
    check(`light ${key} on ${name}`, colors.light[key], background)
  }
}

/* ── dark mode ──────────────────────────────────────────────────────────── */
const darkSurfaces = [
  ['canvas', colors.dark.bg],
  ['surface', colors.dark.surface],
  ['surface-2', colors.dark.surface2],
]
for (const [name, background] of darkSurfaces) {
  for (const key of ['text', 'textSoft', 'textMuted', 'brand', 'accent', 'success', 'warning', 'danger', 'info']) {
    check(`dark ${key} on ${name}`, colors.dark[key], background)
  }
}

/* ── navy hero (gradient stops + scrim) ─────────────────────────────────── */
const scrims = ['rgba(18, 35, 57, 0.34)', 'rgba(13, 32, 50, 0.34)', hero.scrim]
for (const [index, stop] of [hero.from, hero.mid, hero.to].entries()) {
  const effective = composite(stop, scrims[index])
  check(`hero white on stop ${index} (${stop})`, hero.text, effective)
  check(`hero muted on stop ${index} (${stop})`, '#D5E3ED', effective)
}

/* ── report ─────────────────────────────────────────────────────────────── */
let failed = 0
for (const row of rows) {
  const status = row.ok ? 'PASS' : 'FAIL'
  if (!row.ok) failed += 1
  console.log(`${status}  ${row.ratio.padStart(6)}:1  (min ${row.min})  ${row.label}  [${row.foreground} on ${row.background}]`)
}
console.log(`\n${rows.length} pairs checked · ${rows.length - failed} pass · ${failed} fail`)
process.exit(failed > 0 ? 1 : 0)
