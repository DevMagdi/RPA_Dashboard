# RPA CoE Control Room — Design System v5 "Hybrid Premium"

Single-tenant, On-Premises only. Light-first, full Dark, full Arabic/RTL.
Tokens: `src/design-system/tokens.js` ⇄ CSS variables in `src/index.css` (`:root` / `.dark`).
Components: `src/components/ui/` (Radix + CVA, shadcn-style), re-exported by `src/design-system/index.js`.

## Colors
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F5F7FB` | `#0F1A2E` | app canvas (fixed radial mesh `--mesh-1`/`--mesh-2`) |
| `--surface` / `--surface-2` | `#FFFFFF` / `#F8FAFC` | `#152238` / `#1B2A44` | cards / raised surfaces |
| `--border` | `rgba(15, 23, 42, 0.07)` | `rgba(163, 190, 228, 0.14)` | dividers and controls |
| `--text` / `--text-muted` | `#14213A` / `#5B6B82` | `#EEF3FA` / `#A6B4C8` | primary / secondary text (AA) |
| `--navy` / `--navy-deep` | `#1E3A5F` / `#122339` | same | **dominant presence**: hero gradient, live badge, active pill, KPI strips |
| `--brand` / `--brand-strong` | `#4F46E5` / `#3730A3` | `#818CF8` / `#6D78F6` | refined Indigo — brand actions only (buttons, focus) |
| `--accent` | `#0D9488` | `#2DD4BF` | teal: live / telemetry states only |
| `--orange` | `#F58220` | `#FF9640` | attention accent (fills, strips, dots — never a text background) |
| `--success/warning/danger` | `#047857/#B45309/#BE123C` | brightened equivalents | semantic status (AA-safe depths of the plan hues) |
| `--strip-*` | navy/indigo/green/orange/blue/teal/red | brightened equivalents | 4px KPI card strips + matching icon tones (`kpiTones`) |

Hero gradient (locked): `linear-gradient(135deg, #122339 0%, #1E3A5F 45%, #0D9488 100%)`
behind `--hero-scrim` (keeps white/muted text ≥ 4.5:1 across the whole gradient).
The hero re-declares text/surface/border/semantic/strip tokens locally, so every
child component adapts without forks.

New utility classes (Hybrid plan): `.glass-premium` (frosted key panels),
`.card-elevated` / `--shadow-elevated` (plan "Elevated" shadow), `.glow-brand`
(token `--glow-brand`, plus `--glow-accent` for the live accent),
`.text-display` 680 / `.text-page-title` 650 / `.text-section-title` 600
(display → page → section weight ladder, RTL-safe), `.stat-flash` (soft value tick),
`.kpi-strip` (4px identity strip), `.nav-pill-active` (navy gradient pill),
`.live-badge` (navy "● N bots online").
Command-centre hero: live status bar (Connected · server clock), an operational
**verdict** as the headline, a demoted greeting line with the circular success
gauge, a five-KPI identity strip (Success · Active · Savings · Runs today · SLA),
a 14-day sparkline and a live-activity ticker of the five most recent real runs.

## Decision tier (v5)
The dashboard is ordered by decision speed, not by widget attractiveness. Three
tiers are **pinned** (never draggable): the hero verdict, `TriageQueue` and
`HealthBoard`. Only the analytics widgets below them use `WidgetGrid`.

| Class | Use |
|---|---|
| `.command-hero__verdict` + `.is-critical/.is-degraded/.is-healthy` | hero headline; tone drives border, mark and background |
| `.triage-row` + `[data-severity]` | one decision per row; the inline-start severity stripe is the only colour it carries |
| `.health-card--breach/--risk` | warm border so a wallboard reads state from across the room |
| `.context-strip` | informational figures, deliberately secondary to the four judged metrics |

All four reuse existing tokens (`--danger`, `--warning`, `--success`, `--strip-*`)
— no new colour was introduced. Severity/verdict copy comes from
`lib/opsSignals.js`, which is the single source for the hero, the queue and the
board, so they can never disagree.

## Type
- Latin: **Inter Variable**, Arabic: **Cairo Variable** — both self-hosted in `public/fonts` (air-gapped banks). Arabic must never render as `????`: the Arabic `@font-face` ships with the product; tests assert no `?`-runs in `ar.json`.
- RTL: logical properties only (`ps/pe/ms/me/start/end`), never `left/right`.

## Components
Button (primary/secondary/ghost/destructive/danger/success/link), Card (+hover), Badge/StatusPill,
Input/Select/Textarea, DataTable (virtualized), Dialog/Modal, Drawer, Skeleton, EmptyState,
Toast, Sidebar, TopBar, CommandPalette (Ctrl/⌘+K), PageHeader (`SectionTitle`), Stat.

## Geometry & motion
Spacing uses the approved 4-pt rhythm (4, 8, 12, 16, 24, 32, 48 px); card radii are 12 px (controls) and 18 px (`--radius-card`) for main cards; soft two-layer shadows.
Framer Motion page fade/slide (280 ms, `cubic-bezier(.22,1,.36,1)`), hover lifts ≤ 2 px (`hover:-translate-y-0.5`),
`prefers-reduced-motion` respected. Performance: lazy routes/charts, React Query caching,
memoized stats, `content-visibility` for below-fold widgets, skeleton-first loading.
