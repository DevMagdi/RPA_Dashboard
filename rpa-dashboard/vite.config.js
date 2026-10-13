import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dashboard is served either by the FastAPI process itself (production,
// SERVE_FRONTEND=true) or by Vite in development.  In both cases the browser
// talks to *relative* `/api`, `/ws` and `/health` paths, so the same build
// works behind any reverse proxy and no URL is hardcoded (the previous build
// shipped a baked-in `API_BASE`).
const BACKEND = process.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT || 5173),
    strictPort: false,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true, ws: true },
      '/ws': { target: BACKEND, changeOrigin: true, ws: true },
      '/health': { target: BACKEND, changeOrigin: true },
      '/metrics': { target: BACKEND, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Split the heavy charting / drag-drop / animation code so the login
        // screen stays tiny.  Vite 8 (rolldown) requires the callback form.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return 'react'
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'charts'
          if (id.includes('node_modules/framer-motion') || id.includes('node_modules/motion-')) return 'motion'
          if (id.includes('node_modules/react-grid-layout') || id.includes('node_modules/react-resizable')) return 'grid'
          if (id.includes('node_modules/i18next') || id.includes('node_modules/react-i18next')) return 'i18n'
          return 'vendor'
        },
      },
    },
  },
})
