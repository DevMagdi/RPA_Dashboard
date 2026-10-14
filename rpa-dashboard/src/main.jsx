import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import { applyLanguage } from './i18n'
import i18n from './i18n'
import './index.css'

// Text direction and language must be right before the first paint.
applyLanguage(i18n.language || 'en')

// The inline boot splash in index.html disappears the moment React takes over.
if (typeof window !== 'undefined' && window.__RPA_BOOT__) {
  const boot = window.__RPA_BOOT__
  boot.style.transition = 'opacity 200ms ease'
  boot.style.opacity = '0'
  setTimeout(() => boot.remove(), 220)
  delete window.__RPA_BOOT__
}

const container = document.getElementById('root')
if (!container) throw new Error('Root container #root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
