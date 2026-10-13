import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import { applyLanguage } from './i18n'
import i18n from './i18n'
import './index.css'

// Text direction and language must be right before the first paint.
applyLanguage(i18n.language || 'en')

const container = document.getElementById('root')
if (!container) throw new Error('Root container #root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
