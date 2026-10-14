# Test Report — Control Room 4.0.0 UX / Performance pass

Measured in the Arena sandbox on 2026-10-14 using Python 3.11, SQLite demo data,
Node 22, a Vite production build and the local API. These results validate this
checkout; API timings are **not** a bank-hardware production benchmark.

## 1. Results summary

| Suite / metric | Result | Gate |
|---|---:|---:|
| `pytest` (16 test files) | **318 passed, 3 warnings** | pass |
| Backend statement coverage | **81.10%** | ≥ 80% |
| `scripts/smoke_api.py` | **64/64 checks passed** | all |
| `scripts/verify_dashboard.py` through Vite proxy | **59/59 checks passed** | all |
| Dashboard API latency, latest live verification (n=35) | median **5 ms**, p95 **7 ms** | p95 < 200 ms |
| Cold / warm dashboard API, latest smoke run | **22 ms / 3 ms** | warm < 1.5 s |
| Frontend `npm run lint` (oxlint) | **0 warnings, 0 errors** | 0 |
| Frontend `npm run build` after clean `npm ci` | **passed in 1.17 s** | success |
| Frontend `npm audit` | **0 vulnerabilities** | 0 |
| `ruff check app tests` | **passed** | 0 findings |
| `pyflakes app tests` | **passed** | 0 findings |
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

- The production build keeps route-level chunks; charting and grid/motion code
  remain split instead of being folded into the login entry.
- Dashboard route chunk: **16.45 KB raw / 5.21 KB gzip**.
- Dashboard widgets: **13.56 KB raw / 4.15 KB gzip**.
- Main CSS: **56.98 KB raw / 10.58 KB gzip**.
- Recharts/D3 bundle: **429.93 KB raw / 121.29 KB gzip**, in a separate chunk.
- The latest live dashboard API p95 (**7 ms**) was measured against seeded local
  SQLite through the Vite `/api` proxy. It excludes browser rendering, bank
  network latency and SQL Server hardware.
- Dashboard refresh invalidates only dashboard, capacity and SLA query groups
  rather than marking every query in the SPA stale.

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
| `test_frontend_experience_contracts.py` | EN/AR onboarding, per-user permission-aware tour, scoped refresh, chart loading, Light-first theme migration and v4 shell |

The smoke/API scripts additionally exercised RBAC-sensitive operations, MFA,
agent command acknowledgement, four-eyes approval, audit events, exports,
refresh-token replay prevention and realtime SSE. Existing single-organization
guards remained green.

## 4. Visual / browser-test limitation

A production build and Vite live preview were served successfully, and the
API/SSE flow was exercised end-to-end. However, this sandbox has no
Chromium/Firefox/WebKit executable installed. Playwright is installed but its
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
