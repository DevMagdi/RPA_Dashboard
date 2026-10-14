# Changelog

## Unreleased — Hybrid Premium Control Room (v7): navy hero + banded dashboard

Three asks, one release: make **every** colour match the Navy · Indigo · Teal ·
Orange identity, delete the header's second row, and re-lay the dashboard as a
classic BI screen — while keeping the **navy command hero** the spec locks in.
This reconciles the "status panel" direction (which replaced the hero with a
light card and drifted from the locked gradient) back onto the exact spec, and
keeps everything useful that came with it.

- **Palette (everywhere)**: light canvas `#F5F7FB`, surface `#FFFFFF`/`#F8FAFC`,
  text `#14213A` / muted `#5B6B82`, brand Deep Indigo `#4F46E5`
  (`--brand-strong #3730A3`, `--brand-lighter #6366F1`), navy anchor `#1E3A5F` /
  `#122339`, accent Electric Teal `#0D9488`, attention Orange `#F58220`; dark
  canvas `#0F1A2E`, surfaces `#152238`/`#1B2A44`/`#223556`, brand `#818CF8`,
  text `#EFF5FF`. One palette in six places that must never disagree:
  `src/index.css`, `src/design-system/tokens.js`, `tailwind.config.js`,
  `index.html` (boot screen + `theme-color`), the `BrandingProvider` fallbacks
  and the backend defaults. Border locked at `rgba(15,23,42,0.07)`.
- **Backend brand follows**: `bootstrap.DEFAULT_BRAND_PRIMARY = "#4F46E5"`,
  `tables.Organization.BrandPrimaryColor` server default, the
  `organization_service` / `export_service` fallbacks and the Teams/Slack/email
  notification colours all moved off violet. An installation still carrying the
  *seeded* violet default is upgraded on boot; a colour an admin chose on
  purpose is never rewritten (`LEGACY_BRAND_PRIMARY`).
- **Header is one row** (`TopBar`, `TopNav`): the second "first-run affordance"
  row (tour hint + `Ctrl+K` hint + help) is gone — it repeated what the command
  palette and the dashboard tour already say, on every screen, at every scroll
  position. The dead keys (`onboarding.tourHint`, `nav.commandHint`) were removed
  from **both** locale bundles, and the labels now un-hide one breakpoint earlier
  (`xl:not-sr-only`) because the row is shorter.
- **Navy command hero stays** (`.command-hero`, spec-locked): full-bleed
  `linear-gradient(135deg, #122339 0%, #1E3A5F 45%, #0D9488 100%)` with a
  tokenised contrast scrim, time-aware greeting + one context line, large SVG
  success gauge, full-width 14-day sparkline, a five-KPI command strip on
  identity strips (`kpiTones`: totalProcedures navy · running orange · costSaved
  teal · runsToday green · timeSaved indigo), Refresh/Export/Tour inside the
  hero, and local token overrides so the strips stay legible on the gradient.
- **Classic banded dashboard** (`DashboardPage`): seven titled bands read top to
  bottom — toolbar → command hero → KPI row → decisions → health → active run →
  analytics → departments. New `DashboardToolbar` (sticky at `--header-height`,
  owns the page's only `h1`, carries the scope chips, live chip, server clock,
  refresh, export, tour and every filter) and `KpiGrid` (six `.kpi-strip` cards,
  pinned, never draggable). Only the analytics band uses `WidgetGrid`.
- **Docs**: `docs/DESIGN_SYSTEM.md` and `src/design-system/DESIGN_SYSTEM.md`
  for the locked palette; `docs/HYBRID_UI_PLAN_AR.md` is the plan + honest
  audit (incl. the reconciliation with the "status panel" direction in §6);
  `docs/UI_NAVY_REDESIGN_PLAN_AR.md` kept as history with a supersession note.
- **Tests**: frontend `npm test` 119 passed — hero suites restored
  (`commandCenterHero`, `hybridControlRoom`) alongside `dashboardToolbar` (8)
  and `dashboardLayout` (5, adapted to hero-first order); the light-panel suite
  (`statusPanel`) is gone with its premise. Backend contracts lock the palette
  hexes in all six sources, the single-row header, the hero layer stack and the
  band order (`test_control_room_palette_is_navy_indigo_teal_orange_everywhere`,
  `test_global_header_is_a_single_row`,
  `test_command_hero_layers_and_min_height_follow_the_redesign_plan`).
  `npm run lint` 0/0; `verify_contrast.mjs` 73/73 (incl. the hero scrim).

## Unreleased — Decision-first dashboard (v5): verdict, triage queue, health board

The dashboard rendered metrics; it did not support decisions. Every signal an
operator needed was already in the payload but nothing ranked it, judged it or
offered an action for it — `kpis.failureDetailsAll` was never read, `/api/alerts`
was never called, and an SLA breach only ever surfaced as a count. The screen is
now ordered by how fast an operator can act. **No colour, token, theme or RTL
value changed.**

- **Operational verdict** (`CommandCenterHero`): the hero now leads with one word
  — Operational / Degraded / Critical — plus the factual reasons behind it
  (breaching processes, failed runs today, open alerts, points below target) and
  a jump-to-queue action. The time-of-day greeting is demoted to a context line;
  the aurora, grid, glass, gauge, server clock, sparkline strip and live ticker
  are unchanged.
- **Triage queue** (`TriageQueue`, new): SLA breaches, today's failed/stopped
  runs (grouped per process with the most frequent reason), open capacity
  recommendations and queues that have work but **no online runner** — merged,
  ranked by severity and each carrying the action that resolves it
  (Acknowledge / Request capacity / Inspect runs / Runners). An alert that
  describes a condition already listed is folded into that row instead of
  double-counting it. An all-clear operation renders an explicit all-clear.
- **Health board** (`HealthBoard`, new, replaces the six-card KPI rail): the four
  metrics that carry a decision, each with an explicit target and a verdict —
  success rate vs the 95% operating threshold, failed runs today vs zero, SLA
  breaches vs zero, runs today vs the server-provided `kpis.targetRuns`. The
  informational figures (processes, transactions, hours saved, value saved,
  online runners, queue depth) move to a compact context strip. `KpiGrid.jsx` is
  removed; the `.kpi-strip` / `--strip-*` token mechanism it used is kept.
- **Decision engine** (`lib/opsSignals.js`, new): a pure, dependency-free
  derivation from payload → verdict + ranked items + metrics. One derivation
  feeds the hero, the queue and the board, so they cannot contradict each other.
  Thresholds are declared once in `OPS_THRESHOLDS`. `successRate === 0` means
  "no runs in this window", never a failure, so a fresh installation does not
  open on a false red screen.
- **Pinned decision tier**: the draggable grid now holds the analytics tier only
  (`kpis` removed from `DEFAULT_WIDGET_LAYOUT`), so the verdict, queue and health
  board are always in the same place — on a laptop and on a wallboard.
- **Product tour**: a new first step explains the decision tier; the completion
  key is bumped to `onboarding.control-room.v5.*` so operators see it once.
- **Docs**: `docs/PREMIUM_UI_PLAN_AR.md` corrected and extended. Its previous
  audit claimed the shipped brand was Indigo `#4F46E5`; the code has always been
  Deep Violet `#5B21B6` (`src/index.css:76`, `tokens.js:27`,
  `bootstrap.py:110`, and `GET /api/branding`). The document now matches the
  code — the palette itself was not touched.
- **Tests**: frontend `npm test` 101 passed (baseline 73) — 22 new tests across
  `opsSignals.test.js` and `decisionDashboard.test.jsx`; backend 357 passed,
  including two new source contracts
  (`test_dashboard_leads_with_a_pinned_decision_tier`,
  `test_triage_and_health_copy_exist_in_both_locales`). `npm run lint` reports
  0 warnings / 0 errors; entry chunk 65 kB against a 420 kB budget.

## Unreleased — Purple-first control room: overlap, RTL and palette fixes

- **Palette (purple-first)**: light `--brand` `#5B21B6`, `--brand-strong` `#4C1D95`,
  `--brand-lighter` `#7C3AED`, canvas `#F8F5FF`, text `#1E0B3A`, muted text
  `#6B5B8A`; dark canvas `#0B0618`, surface `#130B24`, brand `#A78BFA`, text
  `#F5F0FF`. Teal `#0D9488` (dark `#2DD4BF`) is reserved for live/status states.
  Applied identically in `index.css`, `tokens.js`, `tailwind.config.js`,
  `index.html`, `BrandingProvider` fallbacks and backend brand defaults
  (`bootstrap`, `tables` server default, `organization_service`, `export_service`).
  Existing database rows keep their stored brand colour; no migration runs.
- **Dark mode branding**: `BrandingProvider` no longer writes light-theme
  variables over `.dark`; dark mode lifts the organisation colour instead.
- **Hero**: four KPI tiles in one row at ≥1280 (the "Runs today" tile is removed),
  full-width sparkline, static aurora at z 0, grid z 1, content z 2, KPI tiles z 3,
  `overflow: hidden` and `isolation: isolate`. Two-column layout at ≥1280;
  single column below.
- **Dashboard grid**: fixed the widget overlap (react-grid-layout transforms were
  overridden by the framer-motion wrapper). RTL mirrors the grid positions in code
  and uses the bottom-left resize corner; persistence is guarded against
  unchanged layouts, which previously caused a render loop.
- **Shell**: the sticky filter bar sits below the measured top-bar height
  (`--header-height`, ResizeObserver). The "bots online" label and the top-nav
  item labels move to ≥1536px (icons with tooltips and screen-reader text below), so
  the top bar no longer collides at 1280–1535px, including in Arabic.
- **Spacing and motion**: 4/8/12/16/24/32 scale and 16px grid and KPI gaps; hover
  lift is `-translate-y-0.5` (2px); reduced-motion rules remain in place.
- **Accessibility**: hero muted text is `rgba(233, 224, 255, 0.92)` so it stays
  ≥4.5:1 across the whole hero gradient.
- **Tests**: design-system and frontend contract tests updated to the purple-first
  values, including the hero `--hero-to` and the RTL resize-corner contract.

## Unreleased — Hybrid control-room UI (Navy · Indigo · Teal · Orange)

Implements `docs/HYBRID_UI_PLAN_AR.md` (the audit confirms the plan was not on
`master` before this change; the earlier Premium plan is a different palette).

- **Tokens**: Navy `#1E3A5F` / `#122339`, Orange `#F58220`, canvas `#F5F7FB`,
  muted text `#5B6B82` (AA 5.06:1; the plan's `#64748B` measured 4.44:1),
  dark canvas `#0F1A2E` / surface `#152238`. Card radius 20px (`--radius-card:
  1.25rem`), control radius 12px (`--radius-ctrl`). KPI strip tones
  (`--strip-*`). Semantic text keeps AA depths; bright plan hues are for fills.
- **Top pill nav**: five primary modules inline (Dashboard, Processes, Runs,
  Alerts, Capacity) and a permission-aware "More" menu; the active module is
  lit with the brand gradient. Sidebar stays collapsible and starts collapsed
  on desktop.
- **Live badge**: navy "N bots online" from the real connected-agents API
  (refreshed every 30 s).
- **Hero**: Navy → Indigo/Teal gradient with white type (local token scope),
  radial success gauge (SVG, reduced-motion aware).
- **KPI rail**: coloured 4px top strip and matching icon per card.
- **Filters**: the day-range select becomes a segmented control.
- **Tests**: new `hybridControlRoom.test.jsx`; design-system contracts updated to
  the new palette; `test_frontend_experience_contracts` gains a Hybrid contract.

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
