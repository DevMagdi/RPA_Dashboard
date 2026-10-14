# RPA CoE Control Room — Design System v5 "Premium"

Single-tenant, On-Premises only. Light-first, full Dark, full Arabic/RTL.
Tokens: `src/design-system/tokens.js` ⇄ CSS variables in `src/index.css` (`:root` / `.dark`).
Components: `src/components/ui/` (Radix + CVA, shadcn-style), re-exported by `src/design-system/index.js`.

## Colors
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F3F6FA` | `#070B14` | app canvas |
| `--surface` / `--surface-2` | `#FFFFFF` / `#F7F9FC` | `#101827` / `#141F30` | cards / raised surfaces |
| `--border` | `#E1E7F0` | `#253249` | dividers and controls |
| `--text` / `--text-muted` | `#111827` / `#657286` | `#EFF5FF` / `#98A8BF` | primary / secondary text |
| `--brand` / hover | `#6254E8` / `#5145C5` | `#7F72FF` / `#7969FF` | primary indigo; dark foreground tuned for AA |
| `--accent` | `#0F9F91` | `#2DD4BF` | teal accent |
| `--success/warning/danger` | `#047857/#B45309/#BE123C` | brightened equivalents | semantic status |

## Type
- Latin: **Inter Variable**, Arabic: **Cairo Variable** — both self-hosted in `public/fonts` (air-gapped banks). Arabic must never render as `????`: the Arabic `@font-face` ships with the product; tests assert no `?`-runs in `ar.json`.
- RTL: logical properties only (`ps/pe/ms/me/start/end`), never `left/right`.

## Components
Button (primary/secondary/ghost/destructive/danger/success/link), Card (+hover), Badge/StatusPill,
Input/Select/Textarea, DataTable (virtualized), Dialog/Modal, Drawer, Skeleton, EmptyState,
Toast, Sidebar, TopBar, CommandPalette (Ctrl/⌘+K), PageHeader (`SectionTitle`), Stat.

## Geometry & motion
Spacing uses the approved 4-pt rhythm (4, 8, 12, 16, 24, 32, 48 px); card radii are 12 or 16 px; soft two-layer shadows.
Framer Motion page fade/slide (280 ms, `cubic-bezier(.22,1,.36,1)`), hover lifts ≤ 3 px,
`prefers-reduced-motion` respected. Performance: lazy routes/charts, React Query caching,
memoized stats, `content-visibility` for below-fold widgets, skeleton-first loading.
