import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import ar from './locales/ar.json'
import en from './locales/en.json'

const STORAGE_KEY = 'rpa.lang'

export const LANGUAGES = [
  { code: 'en', label: 'English', dir: 'ltr' },
  { code: 'ar', label: 'العربية', dir: 'rtl' },
]

function initialLanguage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return stored
  } catch {
    /* storage unavailable */
  }
  return navigator.language?.startsWith('ar') ? 'ar' : 'en'
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar },
  },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
})

/** Apply language + text direction to <html> and persist the choice. */
export function applyLanguage(code) {
  const language = LANGUAGES.find((item) => item.code === code) || LANGUAGES[0]
  document.documentElement.lang = language.code
  document.documentElement.dir = language.dir
  try {
    localStorage.setItem(STORAGE_KEY, language.code)
  } catch {
    /* ignore */
  }
  return i18n.changeLanguage(language.code)
}

/** Number/date formatting that follows the active locale. */
export function localeTag() {
  return i18n.language === 'ar' ? 'ar-EG' : 'en-GB'
}

export function isRtl() {
  return i18n.language === 'ar'
}

export default i18n
