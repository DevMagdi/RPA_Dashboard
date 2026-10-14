# Changelog

## Unreleased — Premium command-center UI overhaul (plan implementation)

Implements the Premium/Wow command-center plan end-to-end; the palette now
matches the one this Unreleased section always described.

- **Design tokens (P0)**: light canvas `#F8FAFC`, Deep Indigo brand
  `#4F46E5`/hover `#3730A3`, Electric Teal accent `#0D9488`, slate text
  `#0F172A`/`#334155`/`#64748B`, translucent slate borders, plan shadow scale
  (`soft` / `elevated` / `pop`); dark mode `#020617` → `#0B1120` with
  `#0F172A` surfaces, brand `#818CF8`, accent `#2DD4BF`. Synced across
  `index.css`, `tokens.js`, `tailwind.config.js`, `index.html` (theme-color +
  first-paint canvas) and the default organization branding (backend seeds +
  `BrandingProvider` fallback). Semantic trio keeps AA-safe depths of the plan
  hues (`#059669`/`#D97706`/`#E11D48` fail 4.5:1 as text on `#F8FAFC`); their
  `*-soft` backgrounds carry the plan hexes. WCAG contract re-verified (all
  light/dark foreground×surface pairs ≥ 4.5).
- **New utilities (P0)**: `.glass-premium`, `.card-elevated` +
  `--shadow-elevated`, `.glow-brand`, `.text-display` (RTL-safe display face),
  `.stat-flash` (soft brand flash when a live value ticks).
- **CommandCenterHero restructure (P0)**: identity eyebrow
  ("Control Room · Private Operations" + live/on-prem/scope chips) → personalized
  time-of-day greeting (`dashboard.hero.greeting*` en+ar with `{{name}}`) and
  Refresh/Export actions → divider → four-KPI command strip (Success %, Active
  with live pulse, Savings, SLA risk from real `sla-workload` rows) → full-width
  14-day run-volume sparkline strip with series date axis → shift footer
  (freshness, attention count, tour/capacity). Orbit visual removed per
  wireframe; Refresh moved into the hero.
- **KPI rail (P0)**: display-size numbers (`text-2xl` + tabular), always-on
  hover elevation (2 px lift + brand border + elevated shadow), live glow on the
  Active card, real 7v7 trend chips (`lib/stats.js` `seriesDelta`/`rateDelta`)
  for run volume and value saved, compact currency (`currencyCompact`, exact on
  hover) so figures never truncate.
- **Shell (P1)**: shorter top bar with `section › page` breadcrumb, single
  elegant control cluster (live · language · theme · bell · account) and
  rounded search trigger; stronger frosted topbar glass; sidebar active pill
  gains soft glow + leading indicator; command palette gets a spring-sliding
  keyboard highlight, icon-badge empty state and a stronger shared dialog
  backdrop (6 px blur).
- **Login (P1)**: form sits in a `glass-premium` card over an aurora/grid canvas
  with the logo + product name lockup.
- **Micro-interactions (P2)**: widget-grid staggered entrance (50 ms/item,
  capped), KPI/hero count-ups, stat-flash, reduced-motion honoured throughout.
- **Fixes**: `TopBar` user menu referenced an undefined `navigate` (Settings /
  Audit clicks crashed) — now wired via `useNavigate`.
- **Tests**: new `commandCenterHero.test.jsx` (greeting en+ar, KPI strip,
  sparkline axis + deltas, refresh action, always-hover rail) — frontend suite
  61 passed / 4 skipped; `design-system.test.jsx` expectations updated to the
  new palette (tokens + CSS sync + AA all green).

## Unreleased — Design System v5 "Premium" (UI rebuild on 4.1.0 backend)

- **Formal Design System** (`rpa-dashboard/src/design-system/`): machine-readable
  tokens (Light `#F8FAFC`/white surfaces, Indigo `#4F46E5`, Teal `#0D9488`,
  semantic + Dark palettes, 4-pt spacing, 0.75–1rem radius, soft shadows,
  Inter/Cairo Variable, Framer Motion presets) mirrored 1:1 in CSS variables,
  plus `DESIGN_SYSTEM.md`. Still single-tenant, On-Premises only.
- **Components**: Button gains `destructive`, new RTL-aware `Drawer`, premium
  gradient `SectionTitle`/page headers applied to every screen; existing
  Button/Card/Badge/Input/Table/Modal/Skeleton/EmptyState/Toast/Sidebar/
  TopBar/Command Palette (Ctrl+K) contracts unchanged for all pages.
- **Tests**: new `design-system.test.jsx` (tokens, variants, Drawer, Arabic
  `????`-freedom, ar/en key parity). Frontend 52/52, backend suite green
  (coverage gate 80%), production build ~1.1 s, entry chunk ~59 kB,
  Dashboard chunk ~19 kB (charts lazy).



## 4.1.0 — "Private Operations" (2026-10-14)

Accessibility, Arabic and speed release. Everything below is protected by the
automated suite: `pytest` (352 tests, 81.42 % coverage), `scripts/smoke_api.py`
(64/64), `scripts/verify_dashboard.py` (59/59) and `npx vitest run` (46 tests).

### Fixed — the Arabic "????" defect (5 independent layers)
- **SQL Server stored Arabic as `?`.** Every text column was a non-Unicode
  `VARCHAR`; under a Latin collation the characters were destroyed **at write
  time**. All text columns are now SQLAlchemy `Unicode`/`UnicodeText`
  (`NVARCHAR(n)` / `NVARCHAR(MAX)`), including the single-organization baseline
  revision.
- **Existing installations are repaired in place.**
  `app/db/unicode_upgrade.py` generates `db/migrations/sqlserver/005_unicode_nvarchar_upgrade.sql`
  (125 idempotent, type-guarded `ALTER COLUMN`s) and reports index-key risks
  before a DBA runs it. A test fails if the script drifts from the metadata.
- **Arabic file names could not be sent as HTTP headers.** All four export
  endpoints now emit RFC 5987 `filename*=UTF-8''…` with a latin-1-safe fallback
  (`app/core/text.py::content_disposition`) and accept `?locale=ar|en`.
- **PDF export printed boxes instead of Arabic.** Reports embed the shipped
  **Amiri** font and shape the text (`arabic-reshaper` + `python-bidi`), mirror
  tables and right-align; the report sub-title no longer falls back to
  Helvetica. Excel exports set `sheet_view.rightToLeft` with right-aligned
  Arabic cells. Verified by extracting the text back out of the generated PDF.
- **Workstations had no Arabic font** (and bank installs are air-gapped).
  Cairo (UI Arabic) and Inter (Latin) are self-hosted, script-scoped via
  `unicode-range` and preloaded from `index.html`.
- **Service logs lost Arabic to the Windows console code page.** Handlers and
  `stdout`/`stderr` are forced to UTF-8 with `errors="backslashreplace"`, plus an
  optional rotating UTF-8 `LOG_FILE`. An unencodable glyph is escaped rather
  than replaced by `?`.
- Arabic is a first-class locale: `ar-EG-u-nu-latn` (Arabic month names, Latin
  digits for financial values), all six plural categories, key-complete bundles
  in both languages, and `<html lang dir>` set before first paint.

### Added — product experience
- **Command Center dashboard**: live hero with running/process/success-rate
  telemetry, KPI rail with animated counters, draggable-resizable widget grid
  (persisted layout) and a permission-aware first-run tour (`Ctrl+K → Take the
  tour`), scoped per user.
- **Command palette on `Ctrl+K`** with fuzzy navigation, recent destinations,
  theme/language actions and `Shift+?` shortcut reference.
- **Design system** (`docs/DESIGN_SYSTEM.md`): light-first + dark tokens, Inter
  and Cairo variable fonts, Radix/CVA primitives, chart tokens, motion grammar,
  reduced-motion mode, empty/loading/error state contract, RTL rules.
- World-class empty, loading and error states: skeletons shaped like the final
  content, `ErrorState` with the request id and a retry action on every page,
  filter-aware "no match" states.
- Global keyboard model (`Ctrl+K`, `Shift+?`, `Ctrl+Shift+L`, `Ctrl+J`),
  skip-to-content link, `aria-live` realtime ticker, labelled form controls and
  `aria-hidden` decorative icons (audited in CI).

### Performance
- **Entry bundle 57.3 KB raw / 15.8 KB gzip**; recharts (429.9 KB) stays in a
  `charts` chunk that only chart-heavy routes download. Every page is its own
  chunk.
- **Dashboard API: median 5.4 ms / p95 6.3 ms in-process, p95 18 ms over live
  HTTP**, 9.6 KiB payload, **one SQL statement per render** — budgets locked by
  `tests/test_performance_budget.py` (latency, payload size, N+1 guard).
- Gzip negotiation for JSON (≥ 1 KiB, SSE/fonts/images/Office excluded) and
  **immutable 1-year caching** for content-hashed assets while `index.html`
  stays `no-cache`.
- Virtualised tables (2 000-row Arabic table renders ≤ 120 rows), `LazyMount`
  for below-the-fold charts, 30 s `staleTime` / 10 min `gcTime`, scoped
  invalidation on refresh, and role-permission caching.

### Fixed
- **`/api/processes` answered 500 on SQL Server.** The catalogue query emitted
  `ORDER BY c.ProcessName ASC, c.ProcessName ASC` for the default sort; T-SQL
  rejects a repeated column in the order list (*"A column has been specified
  more than once in the order by list"*, error 169) while SQLite/PostgreSQL
  accept it silently. `ORDER BY` terms are now unique and a deterministic
  tiebreaker (`ProcessName`) is added only when the sort column differs.
  Regression-pinned across all three dialects by `tests/test_process_catalogue_sql.py`.
- **Invalid DOM nesting in the dashboard tiles.** The loading placeholder
  (`Skeleton`, a `div`) was rendered inside a `<p>` on the dashboard and
  infrastructure pages, so React logged `<div> cannot be a descendant of <p>`
  and re-parsed the subtree on every load. The value slot is a `div` now;
  `tests/test_frontend_markup.py` audits the JSX sources against a repeat.
- **`/api/processes` ignored the console's paging parameters.** The page sent
  `limit`/`offset` but the route only understood the keyset `page_size`/`after`
  pair, so every page rendered the same rows, the total was never returned and
  the rows-per-page selector did nothing. The route accepts both shapes
  (`limit` as an alias of `page_size`, `offset` for random access, `after` for
  the keyset walk — mutually exclusive), returns `total` for offset paging, and
  the Processes page now sorts server-side so ordering is correct across pages.
- **Authentication audit writes now share the login transaction.** A separate
  audit connection could collide with the still-open user-update transaction in
  SQLite and drop an MFA challenge event. Successful MFA challenges use the
  request session; failed-login counters and their audit rows are committed
  together before returning the authentication error. Regression tests assert
  both the persisted counter/audit row and the challenge event.

### Performance
- **Role permissions are cached** (`perms:role:*`, 60 s TTL, memory or Redis).
  Every authenticated request paid a database round trip for
  `SELECT Permission FROM RolePermissions` — the `permissions.load` slow-query
  warnings in production logs — because the principal *and* the permission
  guard each resolved the role. Failures are never cached, and
  `invalidate_permission_cache()` drops the entries when roles change.
- **Dashboard refresh is scoped** to dashboard, capacity and SLA query keys;
  unrelated active pages are no longer invalidated by a local refresh.
- **Tailwind upgraded to 4.3.3** and the dependency lock refreshed; `npm audit`
  reports zero vulnerabilities. Lazy route chunks and the separate chart bundle
  remain intact.

### Product experience
- Added the Light-first / full dark-mode Private Operations tokens, polished shell,
  responsive command-center dashboard header and permission-aware first-run tour.
- Improved chart loading states, focus/keyboard handling, mobile navigation,
  Arabic RTL drawer direction and the command palette's modal semantics.
- Aligned frontend and environment-template version fallbacks with 4.0.0 and
  updated the default installation palette while retaining per-install branding.
- Added a bilingual frontend contract test and `docs/PRODUCT_UX_PLAN_AR.md`.
- Version aligned to **4.1.0** across the API, SPA, agent, deployment scripts and
  documentation; tests now assert against `app.__version__` so a release bump
  cannot leave a stale literal behind.

## 4.0.0 — Bank Production Ready (2026-10-13)

- **Single-organization, On-Premises only**: removed the multi-organization
  tenancy layer end to end (data model, JWT claims, APIs, UI, docs); one
  seeded `Organization` per installation.
- **Security**: production refuses to start without `FERNET_KEY` (MultiFernet
  rotation); env-driven TrustedHost/ProxyHeaders; agent WebSocket auth via
  header/subprotocol only; token revocation force-disconnects agents;
  12-character password policy + last-5 history + bcrypt pre-hash fix;
  audited vault decryption with mandatory reason.
- **Operations**: run start/heartbeat/complete ingestion with idempotency,
  queue telemetry snapshots, HMAC-signed agent command & control with an
  allowed-process whitelist and scheduling (agents actually start bots),
  and a rules-based alerting engine (SMTP/Teams/Slack, dedupe + cooldown).
- **Governance**: strict Dev → UAT → Prod promotions, four-eyes Production
  approval, target-environment secret checks.
- **Frontend**: canonical `src/api/client.js`, alerts bell + page,
  organization page, Arabic/English + RTL, version 4.0.0 everywhere.
- **Ops/CI**: On-Premises bank deployment runbook, Windows Service scripts,
  ruff + vulnerability scans + gitleaks in CI.


## 3.0.0 — Control Room 3.0 (2026-10-13)

### Added
- **Test suite**: `tests/` — 12 files, **257 tests** (unit + API + live-server
  SSE), `conftest.py` fixtures, `pytest.ini`, `.coveragerc` with an **80 %
  coverage gate** (measured 80.55 %).
- **Docker**: `Dockerfile` (API, non-root, gunicorn + uvicorn workers, MS ODBC
  Driver 18), `rpa-dashboard/Dockerfile` (Vite build → nginx),
  `deploy/nginx.conf` (SSE with buffering disabled, WebSocket upgrade,
  security headers, immutable asset caching), `docker-compose.yml`
  (PostgreSQL default, SQL Server under the `mssql` profile, Redis),
  `.dockerignore`.
- **CI**: `.github/workflows/ci.yml` — backend (pyflakes + pytest + smoke),
  frontend (oxlint + production build), security (pip-audit, npm audit,
  gitleaks).
- **Docs**: rewritten `README.md`, `docs/ARCHITECTURE.md`,
  `docs/TEST_REPORT.md`, `docs/CTO_REVIEW.md` (12 residual risks R1–R12),
  `docs/DEPLOYMENT_ON_PREM_BANK.md`, `docs/DEPLOYMENT_CLOUD.md`,
  6 ADRs (`docs/adr/`), vendor payload samples (`docs/samples/`), `HANDOFF.md`.

### Fixed (found by the new tests)
- **Scope isolation**: organization administration requires the installation
  SuperAdmin guard. Previously a broad `require_permission("*")` check let
  over-privileged local admins reach global administration endpoints.
- **Status normalisation**: `normalize_status` is separator-insensitive
  (`"In Progress"`, `"InProgress"`, `IN_PROGRESS` …) and UiPath queue stats go
  through it — `"In Progress"` work was silently not counted as active.
- **Provider catalogue**: `CAPABILITIES` is declared per adapter class and the
  registry no longer instantiates adapters to describe them (HTTP adapters
  raised without credentials, emptying their capability matrix).
  `HttpAdapterConfig.base_url` now defaults to empty.
- **SSE auth**: `/api/realtime/events` accepts `?token=` as a fallback —
  browsers' `EventSource` cannot send an `Authorization` header.
- **Job starts**: `POST /api/jobs/start` accepts `IdempotencyKey`, passes it
  to the adapter, and always returns `external_id` (the native adapter
  generates `job-<uuid>` when no key is supplied).
- **Soft delete**: deleting an already-deleted process now returns `404`
  instead of a fake success (the update only touches live rows).
- **SLA updates**: `SLATargetMinutes` / `AvgItemProcessingSeconds` are
  optional; omitted fields keep their current values (partial updates).
- **Dependencies**: added `gunicorn` and `email-validator`; `pyodbc` is no
  longer excluded on Linux (the Docker image ships unixODBC + MS Driver 18).
- **`.env.example`**: documents all **80** `Settings` fields (verified by
  `tests/test_config.py::test_env_example_covers_every_setting`).

### Changed
- The previous revision of `requirements.txt` was UTF-16 encoded and pinned
  an abandoned bcrypt/streamlit stack; it is now a clean, pinned manifest.

## 2.x

Streamlit/React dashboard generations (see git history and
`docs/CODE_REVIEW_AR.md`).
