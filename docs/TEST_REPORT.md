# Test Report — Control Room 4.1.0 UX / Arabic / Performance pass

Measured in the Arena sandbox on 2026-10-14 using Python 3.11, SQLite demo data,
Node 22, a Vite production build and the local API. These results validate this
checkout; API timings are **not** a bank-hardware production benchmark.

## 1. Results summary

| Suite / metric | Result | Gate |
|---|---:|---:|
| `pytest` (20 test files) | **352 passed, 3 Starlette deprecation warnings** | pass |
| Backend statement coverage | **81.52%** | ≥ 80% |
| `scripts/smoke_api.py` | **64/64 checks passed** | all |
| `scripts/verify_dashboard.py` through the live Vite proxy | **59/59 checks passed** | all |
| Dashboard API latency, in-process (n=6, latest budget run) | median **6.4 ms**, p95 **6.6 ms** | p95 < 1 500 ms |
| Dashboard API latency, live over HTTP (n=35, Vite proxy, latest run) | median **7 ms**, p95 **12 ms** | p95 < 200 ms |
| Dashboard payload | **9.6 KiB** (gzip-negotiated on the wire) | < 400 KiB |
| Dashboard SQL statements per render | **1** | ≤ 40 |
| Frontend `npx vitest run` | **61 tests passed** (11 files) | all |
| Frontend `npm run lint` (oxlint) | **0 warnings, 0 errors** (69 files) | 0 |
| Frontend `npm run build` | **passed in 1.58 s** | success |
| Frontend `npm audit` | **0 vulnerabilities** | 0 |
| `ruff check app tests` and `pyflakes app tests` | **passed** | 0 findings |
| Arabic + English JSON and product-contract tests | **passed** | both locales |

The three pytest warnings are Starlette deprecations (`TestClient`'s httpx
integration and the old 422 status constant); they did not fail any test.
The smoke run also reports environment-only notes: its example UiPath host cannot
resolve in this network-restricted sandbox, the optional Python PNG QR encoder
is absent (the frontend renders MFA QR codes with `qrcode.react`), and expected
CSRF failures are logged for negative refresh-token checks. **No SQLite audit
write lock recurred** after login-attempt counters and their audit events were
moved into the same transaction.

## 2. Performance observations

Bundle (production build, `vite build`, 48 files / 1.88 MB total):

| Chunk | Raw | gzip |
|---|---:|---:|
| `charts-*.js` (Recharts, lazy routes only) | 368.26 KB | 100.55 KB |
| `chart-data-*.js` (D3 primitives, split from Recharts) | 62.29 KB | 20.25 KB |
| `react-*.js` (React, React DOM, router) | 247.32 KB | 78.80 KB |
| `motion-*.js` (Framer Motion) | 135.84 KB | 44.93 KB |
| `radix-*.js` (Radix primitives + CVA) | 130.23 KB | 41.29 KB |
| `index-*.css` (design system + Tailwind) | 92.83 KB | 16.06 KB |
| `ui-*.js` (component kit, shared) | 91.84 KB | 29.73 KB |
| **entry `index-*.js`** (shell, router, providers) | **59.48 KB** | **16.57 KB** |

- Every page is its own chunk (14 route chunks + dashboard sub-chunks); the
  login screen and the app shell never download recharts, the grid layout or the
  chart-heavy pages.  `src/test/perf.test.jsx` fails the build if the entry
  crosses 420 KB, if a `charts` chunk disappears, or if a page stops being
  lazily loaded.
- Static assets are content-hashed and served `immutable, max-age=1y` by the
  API process; `index.html` is served `no-cache` so a deploy is picked up on the
  next reload (`StaticAssetCacheMiddleware`).
- JSON payloads cross the wire gzipped (`GZipMiddleware`, ≥ 1 KiB); SSE, fonts,
  images and Office/PDF downloads are excluded on purpose.
- The dashboard renders a 6-query aggregation in **a single SQL statement**
  (`test_performance_budget.py::test_dashboard_does_not_n_plus_one`).
- The latest performance-budget run measured in-process dashboard latency at **6.4 ms median / 6.6 ms p95** (n=6); the most recent live HTTP run measured **7 ms median / 12 ms p95** through the Vite proxy (n=35). These numbers exclude browser rendering, bank network latency and SQL Server hardware, and are therefore *not* a production benchmark.
- Dashboard refresh invalidates only the `dashboard`, `capacity` and `sla`
  query groups instead of marking every query in the SPA stale; `staleTime` is
  30 s with a 10-minute `gcTime`, and a 2 000-row Arabic table renders
  virtualised (≤ 120 `<tbody>` rows).

## 3. What the tests cover

| Test file | Focus |
|---|---|
| `test_auth_api.py` | Login, persisted failed-attempt counters and audit events, refresh rotation/replay, logout, users, password change and MFA |
| `test_security.py` | Password/JWT/TOTP/CSRF/vault security contracts |
| `test_organization.py` | One-organization guard, platform configuration, secret references, branding and alerts |
| `test_processes_api.py`, `test_process_catalogue_sql.py`, `test_dialect_sqlserver.py` | Process API, paging and database-dialect contracts |
| `test_runs_api.py` | Run start/completion, idempotency and statistics |
| `test_dashboard_api.py`, `test_capacity_api.py` | Dashboard payload/cache, SSE, capacity and recommendation permissions |
| `test_infrastructure_api.py`, `test_platforms_*.py` | Agent lifecycle, commands and vendor adapters |
| `test_misc_api.py` | Health, lifecycle, four-eyes approval, vault, audit, export and realtime |
| `test_frontend_markup.py` | Invalid block-in-paragraph JSX audit |
| `test_arabic_rendering.py` | **The `????` defect, layer by layer**: Unicode DDL + migration drift, API round-trip of an Arabic name, RFC 5987 download headers, RTL Excel, shaped Arabic PDF (text re-extracted), bilingual report copy, self-hosted Cairo/Amiri coverage, UTF-8 service logs |
| `test_performance_budget.py` | Measured budgets: dashboard latency/size/SQL count, gzip negotiation, immutable asset caching, self-hosted fonts, entry-chunk and chunk-splitting budgets, CI wiring |
| `test_frontend_experience_contracts.py` | EN/AR copy parity, Arabic-only and mojibake-free values, per-user permission-aware tour, scoped refresh, chart loading, RTL logical-utility audit, labelled form controls, hidden decorative icons, Light-first theme migration and v4 shell |
| `src/test/*` (Vitest, 61 tests) | API client contracts, runtime branding, route permissions, RTL DOM direction, command-palette acknowledgement/localization, process card/table views and URL jumps, design-token parity and AA contrast, bundle budgets |

The smoke/API scripts additionally exercised RBAC-sensitive operations, MFA,
agent command acknowledgement, four-eyes approval, audit events, exports,
refresh-token replay prevention and realtime SSE. Existing single-organization
guards remained green.

## 4. Visual / browser-test limitation

A production build, a live Vite dev server (`:5173`) and the real uvicorn API
(`:8000`) were served successfully, and the full API/SSE/export/CSRF flow was
exercised end-to-end by `scripts/verify_dashboard.py` (59/59). However, this
sandbox has no Chromium/Firefox/WebKit executable installed. Playwright is installed but its
browser binary is absent, and downloading browser binaries is not available in
this environment. **Automated screenshot/visual-regression tests, browser LCP,
INP and CLS were therefore not run.** The proposed browser visual suite and
bank-device Web Vitals remain explicit release gates in
[`PRODUCT_UX_PLAN_AR.md`](PRODUCT_UX_PLAN_AR.md); no 100% visual/performance
claim is made without those measurements.

## 5. Reproduce

```bash
.venv/bin/python -m pytest -q -o addopts='' \
  --strict-markers --cov=app --cov-report=term-missing:skip-covered \
  --cov-config=.coveragerc
.venv/bin/ruff check app tests
.venv/bin/pyflakes app tests

rm -f /tmp/rpa-dashboard-smoke.sqlite3*
DB_DIALECT=sqlite DB_NAME=/tmp/rpa-dashboard-smoke.sqlite3 ENV=test \
  DB_SEED_DEMO=true SCHEDULER_ENABLED=false REALTIME_ENABLED=false \
  .venv/bin/python scripts/smoke_api.py

# Start API and Vite with a fresh SQLite demo database, then:
.venv/bin/python scripts/verify_dashboard.py http://127.0.0.1:5173

cd rpa-dashboard
npm ci
npm run lint
npm run build
npm audit
```
