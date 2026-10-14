# RPA CoE Control Room — Design System v5 "Premium"

Single-tenant, On-Premises only. Light-first, full Dark, full Arabic/RTL.
Tokens: `src/design-system/tokens.js` ⇄ CSS variables in `src/index.css` (`:root` / `.dark`).
Components: `src/components/ui/` (Radix + CVA, shadcn-style), re-exported by `src/design-system/index.js`.

## Colors
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F8FAFC` | `#070B14` | app canvas |
| `--surface` | `#FFFFFF` | `#0F1524` | cards |
| `--brand` | `#4F46E5` | `#837BFF` | primary indigo/violet |
| `--accent` | `#0D9488` | `#2DD4BF` | teal accent |
| `--success/warning/danger/info` | `#059669/#C2760A/#DC3454/#0678B8` | brightened equivalents | semantics |

## Type
- Latin: **Inter Variable**, Arabic: **Cairo Variable** — both self-hosted in `public/fonts` (air-gapped banks). Arabic must never render as `????`: the Arabic `@font-face` ships with the product; tests assert no `?`-runs in `ar.json`.
- RTL: logical properties only (`ps/pe/ms/me/start/end`), never `left/right`.

## Components
Button (primary/secondary/ghost/destructive/danger/success/link), Card (+hover), Badge/StatusPill,
Input/Select/Textarea, DataTable (virtualized), Dialog/Modal, Drawer, Skeleton, EmptyState,
Toast, Sidebar, TopBar, CommandPalette (Ctrl/⌘+K), PageHeader (`SectionTitle`), Stat.

## Geometry & motion
Spacing 4-pt scale; radius 0.75–1rem (cards 1rem+); soft two-layer shadows.
Framer Motion page fade/slide (280 ms, `cubic-bezier(.22,1,.36,1)`), hover lifts ≤ 3 px,
`prefers-reduced-motion` respected. Performance: lazy routes/charts, React Query caching,
memoized stats, `content-visibility` for below-fold widgets, skeleton-first loading.
