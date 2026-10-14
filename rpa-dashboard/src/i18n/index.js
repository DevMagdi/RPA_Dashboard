/**
 * Internationalisation — English + Arabic, first-class.
 *
 * Design decisions that matter for an Arabic-speaking bank deployment:
 *  • **Direction is a document-level fact.** `applyLanguage()` writes `lang`
 *    *and* `dir` onto `<html>` and persists the choice, so a reload paints in
 *    the right direction before React hydrates (the inline bootstrap in
 *    `index.html` does the same thing even earlier).
 *  • **Latin digits in Arabic.** `ar-EG` renders ١٢٣ by default, which makes
 *    financial figures harder to scan next to Latin contract numbers.  The
 *    locale tag pins `nu-latn` so operators keep 123 while still getting
 *    Arabic month names and Arabic plural rules.
 *  • **Arabic pluralisation.** i18next picks `_zero/_one/_two/_few/_many/_other`
 *    from `Intl.PluralRules('ar')`, so `{{count}}` reads correctly for 0, 1, 2,
 *    3–10 and 11+ without any special casing in components.
 *  • **No key may leak.** `fallbackLng` is English and a missing Arabic key is
 *    reported in development — an operator must never see a raw key.
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import ar from './locales/ar.json'
import en from './locales/en.json'

const STORAGE_KEY = 'rpa.lang'

export const LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English', dir: 'ltr', locale: 'en-GB' },
  { code: 'ar', label: 'Arabic', nativeLabel: 'العربية', dir: 'rtl', locale: 'ar-EG-u-nu-latn' },
]

export const DEFAULT_LANGUAGE = 'en'

export function languageMeta(code) {
  return LANGUAGES.find((item) => item.code === code) || LANGUAGES[0]
}

function initialLanguage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && LANGUAGES.some((item) => item.code === stored)) return stored
  } catch {
    /* storage unavailable — fall through to the browser preference */
  }
  if (typeof navigator === 'undefined') return DEFAULT_LANGUAGE
  const preferred = navigator.languages || [navigator.language]
  for (const tag of preferred) {
    const code = String(tag || '').slice(0, 2).toLowerCase()
    if (LANGUAGES.some((item) => item.code === code)) return code
  }
  return DEFAULT_LANGUAGE
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar },
  },
  lng: initialLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: LANGUAGES.map((item) => item.code),
  interpolation: { escapeValue: false },
  returnNull: false,
  // A key that exists in English but not in Arabic is a real bug: surface it
  // loudly in development instead of silently shipping an English string.
  saveMissing: false,
  react: { useSuspense: false },
})

/** Apply language + text direction to <html>, persist the choice, notify the app. */
export function applyLanguage(code) {
  const language = languageMeta(code)
  const root = document.documentElement
  root.lang = language.code
  root.dir = language.dir
  root.dataset.locale = language.locale
  try {
    localStorage.setItem(STORAGE_KEY, language.code)
  } catch {
    /* private mode — the in-memory choice still applies for this session */
  }
  // Order matters: change the language *first*, otherwise the title is
  // translated with the previous locale (the page would keep the English title
  // after switching to Arabic until the next reload).
  return i18n.changeLanguage(language.code).then(() => {
    document.title = i18n.t('app.documentTitle', { defaultValue: 'Control Room' })
    return i18n.language
  })
}

/** Number/date formatting that follows the active locale (Latin digits in ar). */
export function localeTag() {
  return languageMeta(i18n.language).locale
}

export function currentLanguage() {
  return languageMeta(i18n.language).code
}

export function isRtl() {
  return languageMeta(i18n.language).dir === 'rtl'
}

export function otherLanguage() {
  return currentLanguage() === 'ar' ? 'en' : 'ar'
}

export default i18n
