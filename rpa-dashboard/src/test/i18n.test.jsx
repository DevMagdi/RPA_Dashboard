/**
 * Bilingual / RTL contract tests.
 *
 * These are the regression tests for the defect the client reported: Arabic
 * rendered as ``????``.  They pin, in order:
 *   1. the locale bundles are complete and *actually Arabic* (no placeholders,
 *      no mojibake, no missing key in either direction);
 *   2. switching language flips `<html lang dir data-locale>` and persists the
 *      choice, so a reload paints correctly before React runs;
 *   3. the Arabic locale keeps **Latin digits** (``ar-EG-u-nu-latn``) — banks
 *      print contract numbers next to amounts and ١٢٣ is unreadable there;
 *   4. formatting helpers never emit ``?`` or ``\uFFFD`` for Arabic input.
 */
import { describe, expect, it } from 'vitest'

import i18n, { LANGUAGES, applyLanguage, currentLanguage, isRtl, localeTag, otherLanguage } from '../i18n'
import ar from '../i18n/locales/ar.json'
import en from '../i18n/locales/en.json'
import { compactNumber, currency, date, dirFor, durationFromMinutes, isArabicText, percent, relative } from '../lib/format'

function flatten(value, prefix = '', out = {}) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (child && typeof child === 'object' && !Array.isArray(child)) flatten(child, path, out)
    else out[path] = child
  }
  return out
}

/** i18next picks `_zero/_one/_two/_few/_many/_other` for Arabic plurals. */
const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other']

function baseKey(key) {
  for (const suffix of PLURAL_SUFFIXES) {
    if (key.endsWith(suffix)) return key.slice(0, -suffix.length)
  }
  return key
}

const enKeys = flatten(en)
const arKeys = flatten(ar)

const ARABIC_GLYPH = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/

describe('locale bundles', () => {
  it('has no key missing in Arabic and no key missing in English', () => {
    const missingInArabic = Object.keys(enKeys).filter((key) => !(key in arKeys) && !(baseKey(key) in arKeys))
    const missingInEnglish = Object.keys(arKeys)
      .filter((key) => !PLURAL_SUFFIXES.some((suffix) => key.endsWith(suffix)))
      .filter((key) => !(key in enKeys))
    expect(missingInArabic).toEqual([])
    expect(missingInEnglish).toEqual([])
  })

  it('never ships a placeholder ("?", "??", U+FFFD) in either language', () => {
    for (const [name, bundle] of [
      ['en', enKeys],
      ['ar', arKeys],
    ]) {
      const offenders = Object.entries(bundle)
        .filter(([, value]) => typeof value === 'string')
        .filter(([, value]) => /\?{2,}|\uFFFD/.test(value) || /Ã.|Ø.|Ù.|Â./.test(value))
        .map(([key, value]) => `${name}:${key} -> ${value}`)
      expect(offenders).toEqual([])
    }
  })

  it('writes real Arabic (not transliteration) for the Arabic UI', () => {
    const mustBeArabic = [
      'nav.dashboard',
      'nav.processes',
      'nav.runs',
      'nav.infrastructure',
      'nav.lifecycle',
      'nav.audit',
      'nav.health',
      'nav.users',
      'nav.organization',
      'nav.alerts',
      'nav.settings',
      'actions.refresh',
      'actions.search',
      'actions.commandPalette',
      'auth.signIn',
      'dashboard.commandCenter',
      'dashboard.tour.title',
      'errors.title',
      'common.loading',
      'empty.title',
    ]
    for (const key of mustBeArabic) {
      const value = arKeys[key]
      expect(value, `missing ar key ${key}`).toBeDefined()
      expect(ARABIC_GLYPH.test(String(value)), `ar.${key} is not Arabic: ${value}`).toBe(true)
    }
  })

  it('keeps the tour and command-centre copy in both languages (product contract)', () => {
    for (const key of [
      'dashboard.commandCenter',
      'dashboard.commandCenterSubtitle',
      'dashboard.privateInstallation',
      'dashboard.startTour',
      'dashboard.hero.running',
      'dashboard.hero.processes',
      'dashboard.hero.successRate',
      'dashboard.tour.title',
      'dashboard.tour.subtitle',
      'dashboard.tour.securityNote',
      'dashboard.tour.steps.infrastructure.title',
      'dashboard.tour.steps.processes.description',
      'dashboard.tour.steps.runs.description',
      'dashboard.tour.steps.capacity.description',
      'dashboard.tour.steps.lifecycle.description',
      'palette.placeholder',
      'onboarding.title',
      'a11y.dismiss',
    ]) {
      expect(enKeys[key], `en:${key}`).toBeTruthy()
      expect(arKeys[key], `ar:${key}`).toBeTruthy()
    }
  })
})

describe('language switching', () => {
  it('applies language, direction and locale to <html> and persists the choice', async () => {
    await applyLanguage('ar')

    expect(document.documentElement.lang).toBe('ar')
    expect(document.documentElement.dir).toBe('rtl')
    expect(document.documentElement.dataset.locale).toBe('ar-EG-u-nu-latn')
    expect(window.localStorage.getItem('rpa.lang')).toBe('ar')
    expect(currentLanguage()).toBe('ar')
    expect(isRtl()).toBe(true)
    expect(otherLanguage()).toBe('en')
    // No locale key may leak into a rendered title.
    expect(document.title).not.toMatch(/^app\./) 

    await applyLanguage('en')
    expect(document.documentElement.dir).toBe('ltr')
    expect(document.documentElement.lang).toBe('en')
    expect(isRtl()).toBe(false)
  })

  it('translates the document title in both languages', async () => {
    await applyLanguage('en')
    const english = document.title
    await applyLanguage('ar')
    expect(document.title).not.toBe(english)
    expect(ARABIC_GLYPH.test(document.title)).toBe(true)
  })

  it('declares exactly two first-class languages, Arabic marked RTL', () => {
    expect(LANGUAGES.map((item) => item.code)).toEqual(['en', 'ar'])
    expect(LANGUAGES.find((item) => item.code === 'ar').dir).toBe('rtl')
    expect(LANGUAGES.find((item) => item.code === 'ar').nativeLabel).toBe('العربية')
  })
})

describe('Arabic numerals and plurals', () => {
  it('keeps Latin digits in the Arabic locale', () => {
    expect(localeTag()).toBe('en-GB')
    expect(new Intl.NumberFormat('ar-EG-u-nu-latn').format(1234.5)).toBe('1,234.5')
  })

  it('uses Arabic plural categories through i18next', async () => {
    await applyLanguage('ar')
    const one = i18n.t('common.items', { count: 1 })
    const two = i18n.t('common.items', { count: 2 })
    const many = i18n.t('common.items', { count: 11 })
    expect(one).not.toBe(two)
    expect(two).not.toBe(many)
    expect(ARABIC_GLYPH.test(one)).toBe(true)
    // Interpolation must render the number, in Latin digits.
    expect(many).toContain('11')
  })
})

describe('formatting in both directions', () => {
  it('detects Arabic text and returns the matching direction', () => {
    expect(isArabicText('معالجة الفواتير')).toBe(true)
    expect(isArabicText('Invoice processing')).toBe(false)
    expect(dirFor('معالجة الفواتير')).toBe('rtl')
    expect(dirFor('Invoice processing')).toBe('ltr')
    // Pure numbers/identifiers stay LTR even when the UI is Arabic.
    expect(dirFor('AUTH-2026-0001')).toBe('ltr')
  })

  it('formats numbers, currency and durations without placeholders', async () => {
    await applyLanguage('ar')
    const values = [
      compactNumber(1_250_000),
      currency(98765.4),
      percent(92.456),
      durationFromMinutes(145),
      relative(new Date(Date.now() - 90_000)),
      date(new Date('2026-10-14T09:30:00Z')),
    ]
    for (const value of values) {
      expect(typeof value).toBe('string')
      expect(value).not.toContain('?')
      expect(value).not.toContain('\uFFFD')
    }
    expect(currency(1000, 'EGP', 0)).toMatch(/\d/)
  })
})
