# RPA CoE Control Room — Frontend

The React/Vite client for the single-organization, on-premises RPA operations console. It supports English and Arabic (RTL), a light-first theme with full dark mode, and lazy-loaded operations pages.

## Local development

```bash
npm ci
npm run dev
```

Vite serves on port `5173` and proxies `/api`, `/ws`, `/health`, and `/metrics` to `http://127.0.0.1:8000` by default. Set `VITE_BACKEND_URL` when the FastAPI service runs elsewhere; browser code continues to use relative URLs.

## Validation

```bash
npm test
npm run lint
npm run build
```

Vitest covers UI primitives, route/loading contracts, Arabic translations and RTL, runtime branding, command-palette actions, process card/table views, and production bundle budgets. The build self-hosts Inter and Cairo fonts under `public/fonts` for air-gapped deployments.

## Structure

- `src/design-system/` — theme tokens and component-kit documentation
- `src/components/ui/` — accessible Radix/CVA primitives and product components
- `src/components/layout/` — sidebar, top bar, command palette and app shell
- `src/pages/` — route-level pages, loaded with `React.lazy`
- `src/i18n/locales/` — complete English and Arabic translations
