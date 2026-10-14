# Design System — Control Room 4.1

The visual language of the RPA CoE Control Room. It is **light-first** (banks run
day shifts in bright operations rooms) with a complete dark mode for night
shifts, and it is **bidirectional by construction**: every token, component and
motion decision works identically in Arabic (RTL) and English (LTR).

Direction of the design: **Private Operations** — calm, dense, premium. Think
control-room instrument panel, not marketing site. Nothing decorative that does
not carry information.

---

## 1. Foundations

### 1.1 Colour

All colours are CSS custom properties defined in `rpa-dashboard/src/index.css`
and consumed through Tailwind theme keys. `BrandingProvider` can override the
installation's `--brand` / `--accent`, derived contrast/shade/ring tokens and
primary chart series at runtime without a rebuild.

| Token | Light (default) | Dark | Usage |
|---|---|---|---|
| `--bg` | `#F5F7FB` | `#0F1A2E` | application canvas (soft radial mesh via `--mesh-1`/`--mesh-2`) |
| `--surface` | `#FFFFFF` | `#152238` | cards, panels, menus |
| `--surface-2` | `#F8FAFC` | `#1B2A44` | inputs, table headers, hover |
| `--surface-3` | `#F1F5F9` | `#223556` | pressed / selected rows |
| `--border` | `rgba(15, 23, 42, 0.06)` | `rgba(255, 255, 255, 0.07)` | 1px separation, low but visible |
| `--text` | `#14213A` | `#EFF5FF` | primary type (13.9:1 light / 15.4:1 dark on the canvas) |
| `--text-muted` | `#5B6B82` | `#98A8BF` | secondary type, labels (5.06:1 light / 6.4:1 dark) |
| `--brand` | `#4F46E5` | `#818CF8` | **primary identity**: buttons, active nav, focus, selection, charts |
| `--brand-strong` / `--brand-lighter` | `#3730A3` / `#6366F1` | `#6D78F6` / `#A5B4FC` | hover and gradient stops |
| `--navy` / `--navy-deep` | `#1E3A5F` / `#122339` | `#1E3A5F` / `#122339` | **control-room anchor**: verdict band, live badge, KPI strips |
| `--accent` | `#0D9488` | `#2DD4BF` | **live states only**: live dots, pulses, "online" badges. Never body text and never a primary action. |
| `--orange` | `#F58220` | `#F58220` | attention signal (fills, strips, dots) |
| `--success` | `#047857` | `#34D399` | healthy runs |
| `--warning` | `#B45309` | `#FBBF24` | SLA risk, queue growth |
| `--danger` | `#BE123C` | `#FB7185` | failures, breaches |
| `--info` | `#0369A1` | `#38BDF8` | neutral information |

> **Navy · Indigo · Teal · Orange (2026-10).** Deep Indigo `#4F46E5` is the
> dominant brand colour; Navy `#122339` → `#1E3A5F` → Teal `#0D9488`
> (`--hero-from` → `--hero-mid` → `--hero-to`) carries the status console's
> verdict band and the KPI strips. Teal `#0D9488` (light) / `#2DD4BF` (dark) is
> reserved for **live or status states** and must not be used as a decorative or
> primary colour; Orange `#F58220` is the attention signal only. The palette is
> defined identically in `src/index.css`, `src/design-system/tokens.js`,
> `tailwind.config.js`, `index.html` (boot screen), the `BrandingProvider`
> fallbacks and the backend brand defaults (`app/db/bootstrap.py` →
> `DEFAULT_BRAND_PRIMARY = "#4F46E5"`, which also upgrades an installation still
> carrying the retired violet default on boot).
> Dark mode: `BrandingProvider` lifts a tenant's brand colour for dark surfaces
> instead of applying the light value, so an organisation colour never overrides
> the dark theme with a low-contrast light value.
> Static background depth comes from the fixed mesh tokens `--mesh-1`/`--mesh-2`
> (never animated); hover/focus glow is tokenised as `--glow-brand`/`--glow-accent`.
> The semantic trio keeps AA-safe text depths (`#047857` / `#B45309` / `#BE123C`);
> the plan hues are used for fills and `*-soft` backgrounds.

Rules:

* **Status is never colour-only.** Every state pairs colour with an icon, a text
  label or a shape (`SeverityBadge`, `StatusDot` + label, `DeltaChip` with ▲/▼).
* **Contrast** targets WCAG AA: body text ≥ 4.5:1, large/bold ≥ 3:1, UI borders
  ≥ 3:1 against their surface.
* Charts use `CHART_TOKENS` in `src/components/charts/primitives.jsx` — series
  colours are token-driven, so a rebrand recolours the charts too.

### 1.2 Typography

| Role | Family | Notes |
|---|---|---|
| Latin UI | **Inter Variable** (self-hosted, `public/fonts`) | 100–900 axis, `font-feature-settings: 'cv02','cv03','ss01'` for a tighter numeric feel |
| Arabic UI | **Cairo Variable** (self-hosted) | full Arabic coverage with GSUB joining; `unicode-range` scoped to the Arabic blocks |
| Numerals | tabular figures (`.tabular`) | KPI rails and tables align digit-by-digit |
| Monospace | `ui-monospace, SFMono-Regular, Menlo` | IDs, correlation ids, hashes only |

Scale (rem): `2xs .6875` · `xs .75` · `sm .8125` · `base .875` · `lg 1` ·
`xl 1.25` · `2xl 1.5` · `3xl 1.875`. Body copy is 14px — an operator scans
tables, so density beats air. Headline weight ladder (Premium plan):
`.text-display` 680 (status console title only) → `.text-page-title` 650 →
`.text-section-title` 600 → body 400; KPI numbers are tabular figures at 650–680. `text-pretty` is used on descriptions to avoid
widows in both scripts.

**Arabic specifics:** line-height is raised (`1.75`) for Arabic paragraphs
because the script has no ascenders to separate lines visually; the UI never
applies `letter-spacing` to Arabic (it breaks the joins); Italic is never faked.

### 1.3 Space, radius, elevation

* Approved 4-pt spacing rhythm: `4 / 8 / 12 / 16 / 24 / 32 / 48px`; component padding steps follow these tokens.
* Radius: `12px` (`rounded-lg`) for controls, `20px` (`--radius-card: 1.25rem`)
  for main cards; larger dialog radii are used sparingly.
* Elevation: `shadow-xs` (inputs), `shadow-soft` (cards), `shadow-lift`
  (menus/popovers), `shadow-glow` (primary action hover). Dark mode uses
  0.5–0.7 alpha black plus a 1px inner highlight so surfaces stay separable.

### 1.4 Motion

* The CSS easing tokens are `--ease-premium cubic-bezier(.22,1,.36,1)` for
  entrances and `--ease-exit cubic-bezier(.4,0,1,1)` for exits; common state
  transitions run for 120–300 ms.
* Framer Motion handles page, list, tour and dialog transitions; the sidebar
  uses a restrained spring (`stiffness: 420`, `damping: 34`). CSS transitions
  handle hover/press.
* **Reduced motion is a first-class mode**: `prefers-reduced-motion: reduce`
  and the in-app *Reduce motion* preference shorten CSS animations/transitions
  to a single near-instant frame; selected ambient/status-panel animation is disabled.
  Tour and widget-grid motion also follow Framer Motion's user preference.
* Motion never blocks interaction: entrances animate transform/opacity and
  reduced-motion preferences are respected rather than delaying state changes.

---

## 2. Components

Primitives live in `src/components/ui/primitives.jsx` (shadcn/ui architecture:
Radix behaviour + CVA variants + `tailwind-merge`), and the product kit in
`src/components/ui/index.jsx`. Both are re-exported from `src/components/ui`
so pages import from one place.

| Family | Components |
|---|---|
| Actions | `Button` (primary/secondary/outline/ghost/subtle/danger/success/link × xs/sm/md/lg/icon), `CopyButton`, `ConfirmDialog` |
| Surfaces | `Card`, `CardHeader`, `CardBody`, `CardFooter`, `CardContent`, `SectionTitle`, `MiniStat`, `InfoTile`, `Stat` |
| Data | `DataTable` (sortable, sticky header, virtualised ≥ 80 rows, keyboard rows, `dir="auto"` cells), `Pagination`, `ProgressBar`, `Sparkline`, `RadialGauge`, `MiniBars`, `DeltaChip` |
| Feedback | `Spinner`, `Skeleton`, `SkeletonCard`, `Toast`, `Notice`, `EmptyState`, `ErrorState`, `ErrorBoundary`, `RouteFallback` |
| Overlays | `Dialog`, `Modal`, `Popover`, `Tooltip`, `DropdownMenu`, `CommandPalette`, `ShortcutsDialog` |
| Forms | `Field`, `Input`, `SearchInput`, `Select`, `Textarea`, `Switch`, `Checkbox`, `Tabs`, `SegmentedControl` |
| Status | `Badge`, `SeverityBadge`, `StatusDot`, `TrendPill` |

State contract every list/table page implements:

1. **loading** → skeletons shaped like the final content (never a spinner in a
   table body),
2. **empty** → `EmptyState` naming the object and the next action, and
   distinguishing "no data yet" from "no match for the filters" (`empty.filtered`),
3. **error** → `ErrorState` with the translated reason, the request id for the
   bank's support desk, and a Retry action,
4. **stale** → `aria-busy` on the container while a background refetch runs
   (data stays on screen; no layout jump).

---

## 3. RTL rules (non-negotiable)

| Rule | Why |
|---|---|
| Logical CSS properties only — `ms-/me-/ps-/pe-/start-/end-` | physical `ml-/mr-` break the mirror; enforced by `npm test` and `tests/test_frontend_experience_contracts.py` |
| Direction comes from `<html dir>` (`applyLanguage` + the inline bootstrap in `index.html`) | one source of truth; no per-component `dir` guessing |
| User content opts into `dir="auto"` (table cells with `dir: 'auto'`, chat-like text) | an English process name inside an Arabic page still reads left-to-right |
| Icons that imply direction mirror (`rtl:scale-x-[-1]`, or pick `ChevronRight`/`ChevronLeft` from `useDirection()`) | back/forward and next/previous must point the right way |
| Charts reverse the time axis in RTL (`useChartDirection()`) | Arabic reads right → left |
| Numbers, IDs, timestamps, code keep `dir="ltr"` and Latin digits (`ar-EG-u-nu-latn`) | contract numbers and amounts sit in invoices and regulator reports |
| Arabic line-height 1.75, no letter-spacing, no faux italic | legibility of the script |

---

## 4. Accessibility

* Every interactive element has `.focus-ring` (2px brand ring + 2px offset) and
  is reachable by keyboard; the shell ships a **skip-to-content** link.
* Icon-only buttons must carry `aria-label`; decorative icons are `aria-hidden`
  (audited in CI — 97 lucide usages, 0 unlabelled).
* Dialogs trap focus, restore it on close, and label themselves (`aria-modal`,
  `aria-labelledby`) — Radix handles this, custom overlays follow the same rule.
* Live regions: `aria-live="polite"` for the realtime ticker and toasts;
  `role="alert"` only for failures.
* Tables: `scope="col"`, `aria-sort`, roving focus on rows where a row opens a
  detail view.
* Target size ≥ 32×32 px on touch layouts; `useIsMobile()` switches tables to a
  card list instead of horizontal scrolling.

---

## 5. Content & language

* Copy is written in **both** languages at the same time; a missing Arabic key
  fails the test-suite (`src/test/i18n.test.jsx` + contract tests).
* Terminology is bank-native: *process / تشغيلية*, *runner / روبوت*,
  *SLA breach / تجاوز اتفاقية مستوى الخدمة*, *promotion / ترقية إصدار*.
* Numbers and dates are formatted through `src/lib/format.js`
  (`Intl` with the active locale tag), never by hand.
* Errors say what happened, what it means and what to do next — never a bare
  "Something went wrong".

---

## 6. Where to look in the code

| Concern | File |
|---|---|
| Tokens, base layer, utilities (`focus-ring`, `.glass`, `.card`) | `src/index.css` |
| Token → Tailwind mapping | `tailwind.config.js` |
| Component primitives | `src/components/ui/primitives.jsx` |
| Product component kit | `src/components/ui/index.jsx` |
| Charts (tokens, RTL axis, tooltips) | `src/components/charts/primitives.jsx` |
| Formatters & direction helpers | `src/lib/format.js`, `src/lib/direction.js` |
| Shell (sidebar, top bar, palette, shortcuts) | `src/components/layout/*` |
| Design/conformance tests | `src/test/{rtl,contracts,i18n,perf}.test.*`, `tests/test_frontend_experience_contracts.py`, `tests/test_frontend_markup.py` |
