# RPA CoE Control Room — Design System v5 "Premium"

Single-tenant, On-Premises only. Light-first, full Dark, full Arabic/RTL.
Tokens: `src/design-system/tokens.js` ⇄ CSS variables in `src/index.css` (`:root` / `.dark`).
Components: `src/components/ui/` (Radix + CVA, shadcn-style), re-exported by `src/design-system/index.js`.

## Colors
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F8F5FF` | `#0B0618` | app canvas (fixed radial mesh `--mesh-1`/`--mesh-2`) |
| `--surface` / `--surface-2` | `#FFFFFF` / `#FAF8FF` | `#130B24` / `#1A1030` | cards / raised surfaces |
| `--border` | `rgba(91, 33, 182, 0.08)` | `rgba(196, 181, 253, 0.12)` | dividers and controls |
| `--text` / `--text-muted` | `#1E0B3A` / `#6B5B8A` | `#F5F0FF` / `#B8A9D4` | primary / secondary text (AA) |
| `--brand` / `--brand-strong` | `#5B21B6` / `#4C1D95` | `#A78BFA` / `#8B5CF6` | purple-first primary identity |
| `--accent` | `#0D9488` | `#2DD4BF` | teal: live / status states only |
| `--success/warning/danger` | `#047857/#B45309/#BE123C` | brightened equivalents | semantic status (AA-safe depths of the plan hues) |

New utility classes (Premium plan): `.glass-premium` (frosted key panels),
`.card-elevated` / `--shadow-elevated` (plan "Elevated" shadow), `.glow-brand`
(token `--glow-brand`, plus `--glow-accent` for the live accent),
`.text-display` 680 / `.text-page-title` 650 / `.text-section-title` 600
(display → page → section weight ladder, RTL-safe), `.stat-flash` (soft value tick).
Command-centre hero: live status bar (Connected · server clock), five-KPI strip
(+ Runs today), 14-day sparkline and a live-activity ticker of the five most
recent real runs.

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
