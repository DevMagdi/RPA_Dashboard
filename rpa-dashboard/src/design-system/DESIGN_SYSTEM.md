# RPA CoE Control Room — Design System v5 "Premium"

Single-tenant, On-Premises only. Light-first, full Dark, full Arabic/RTL.
Tokens: `src/design-system/tokens.js` ⇄ CSS variables in `src/index.css` (`:root` / `.dark`).
Components: `src/components/ui/` (Radix + CVA, shadcn-style), re-exported by `src/design-system/index.js`.

## Colors
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F5F7FB` | `#0F1A2E` | app canvas (fixed radial mesh `--mesh-1`/`--mesh-2`) |
| `--surface` / `--surface-2` | `#FFFFFF` / `#F8FAFC` | `#152238` / `#1B2A44` | cards / raised surfaces |
| `--border` | `rgba(15, 23, 42, 0.06)` | `rgba(255, 255, 255, 0.07)` | dividers and controls |
| `--text` / `--text-muted` | `#14213A` / `#5B6B82` | `#EFF5FF` / `#98A8BF` | primary / secondary text (AA) |
| `--brand` / `--brand-strong` | `#4F46E5` / `#3730A3` | `#818CF8` / `#6D78F6` | Deep Indigo primary identity |
| `--navy` / `--navy-deep` | `#1E3A5F` / `#122339` | same | control-room anchor: verdict band, live badge, KPI strips |
| `--accent` | `#0D9488` | `#2DD4BF` | teal: live / status states only |
| `--orange` | `#F58220` | `#F58220` | attention signal (fills, strips, dots) — never body text |
| `--success/warning/danger` | `#047857/#B45309/#BE123C` | brightened equivalents | semantic status (AA-safe depths of the plan hues) |

New utility classes (Premium plan): `.glass-premium` (frosted key panels),
`.card-elevated` / `--shadow-elevated` (plan "Elevated" shadow), `.glow-brand`
(token `--glow-brand`, plus `--glow-accent` for the live accent),
`.text-display` 680 / `.text-page-title` 650 / `.text-section-title` 600
(display → page → section weight ladder, RTL-safe), `.stat-flash` (soft value tick).
Status console (`.status-panel`): a **light** card that opens with the
operational **verdict** over a navy gradient band, then three evidence cards
(success rate gauge + 14-day sparkline, hours saved, SLA risk) and a
live-activity ticker of the five most recent real runs. It replaces the
full-bleed navy hero: the panel inherits the theme tokens instead of
re-declaring white text, so it reads correctly in dark mode too.

## Classic banded layout (v6)
The dashboard is a stack of **titled bands** read top to bottom, ordered by
decision speed rather than by widget attractiveness. Nothing above the analytics
grid is draggable, so a wallboard operator always finds the same thing in the
same place.

| # | Band | Component | Contract |
|---|---|---|---|
| 1 | Toolbar | `DashboardToolbar` | one row, `sticky top-[var(--header-height)]`, owns the page's only `h1`, every filter change flows through `useUrlFilters` |
| 2 | KPI row | `KpiGrid` | six `.kpi-strip` cards with token-driven colour strips; never inside the draggable grid |
| 3 | Status console | `CommandCenterHero` → `.status-panel` | verdict + three evidence cards + activity ticker |
| 4 | Decisions | `TriageQueue` | `#triage-queue`, one decision per row, all-clear renders a success `EmptyState` |
| 5 | Health | `HealthBoard` | `.health-card--breach/--risk` warm border, readable across a room |
| 6 | Analytics | `WidgetGrid` + `Widgets` | the only draggable tier (volume, capacity, savings, runs, SLA) |
| 7 | Departments | `DepartmentBars` | half-width beside `OnboardingChecklist` |

| Class | Use |
|---|---|
| `.dashboard-toolbar` / `.dashboard-toolbar__mark` | the sticky band and its navy→indigo→teal identity mark |
| `.status-panel__verdict` + `.is-critical/.is-degraded/.is-healthy` | verdict headline; tone drives border, mark and background |
| `.kpi-grid` + `.kpi-strip` | the pinned KPI row and each card's inline-start colour strip |
| `.triage-row` + `[data-severity]` | one decision per row; the inline-start severity stripe is the only colour it carries |
| `.context-strip` | informational figures, deliberately secondary to the four judged metrics |

All of them reuse existing tokens (`--danger`, `--warning`, `--success`,
`--strip-*`) — no new colour was introduced. Severity/verdict copy comes from
`lib/opsSignals.js`, which is the single source for the console, the queue and
the board, so they can never disagree.

## Type
- Latin: **Inter Variable**, Arabic: **Cairo Variable** — both self-hosted in `public/fonts` (air-gapped banks). Arabic must never render as `????`: the Arabic `@font-face` ships with the product; tests assert no `?`-runs in `ar.json`.
- RTL: logical properties only (`ps/pe/ms/me/start/end`), never `left/right`.

## Components
Button (primary/secondary/ghost/destructive/danger/success/link), Card (+hover), Badge/StatusPill,
Input/Select/Textarea, DataTable (virtualized), Dialog/Modal, Drawer, Skeleton, EmptyState,
Toast, Sidebar, TopBar, CommandPalette (Ctrl/⌘+K), PageHeader (`SectionTitle`), Stat.

## Geometry & motion
Spacing uses the approved 4-pt rhythm (4, 8, 12, 16, 24, 32, 48 px); card radii are 12 px (`--radius-ctrl`) for controls and 20 px (`--radius-card`) for main cards; soft two-layer shadows.
Framer Motion page fade/slide (280 ms, `cubic-bezier(.22,1,.36,1)`), hover lifts ≤ 2 px (`hover:-translate-y-0.5`),
`prefers-reduced-motion` respected. Performance: lazy routes/charts, React Query caching,
memoized stats, `content-visibility` for below-fold widgets, skeleton-first loading.
