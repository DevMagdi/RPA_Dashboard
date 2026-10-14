"""Frontend contract checks for the bilingual product experience.

These read the SPA sources (no browser required — CI has none) and enforce the
promises the redesign makes:

* **Arabic is first-class**: self-hosted fonts, RTL by document direction,
  logical CSS properties only, real translations in both bundles, and the tour
  copy that explains the product to a new operator.
* **The product shell** keeps its light-first theme contract, the command
  centre hero and the reduced-motion escape hatch.
* **Correctness gates** that the automated suite enforces in JS (`npm test`)
  are not silently dropped from the build pipeline.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
FRONTEND = REPO_ROOT / "rpa-dashboard"
SRC = FRONTEND / "src"

#: The UI, the API and the agent must all report the same version.  It is read
#: from the Python package so a release only ever bumps one number by hand.
import app  # noqa: E402  (import after the path constants for readability)

EXPECTED_VERSION = app.__version__

#: Tailwind utilities that break RTL: physical left/right properties.  The
#: design system uses logical ones (`ms-/me-/ps-/pe-/start-/end-`).
PHYSICAL_UTILITY = re.compile(
    r"""(?:^|[\s'"`:])(?:-)?(?:ml|mr|pl|pr)-(?:\d|\[)"""
    r"""|(?:text|border)-(?:left|right)\b"""
    r"""|(?:rounded|space-x)-(?:l|r)\b"""
)


def _translations(language: str) -> dict:
    return json.loads((SRC / "i18n" / "locales" / f"{language}.json").read_text(encoding="utf-8"))


def _nested(data: dict, path: str):
    value = data
    for part in path.split("."):
        value = value[part]
    return value


def _flatten(data: dict, prefix: str = "") -> dict:
    flat: dict = {}
    for key, value in data.items():
        path = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            flat.update(_flatten(value, path))
        else:
            flat[path] = value
    return flat


def _sources(*suffixes: str) -> list[Path]:
    wanted = suffixes or (".jsx",)
    return sorted(path for path in SRC.rglob("*") if path.suffix in wanted and "test" not in path.parts)


def _strip_comments(source: str) -> str:
    return re.sub(r"/\*.*?\*/", "", source, flags=re.DOTALL)


def _jsx_tags(source: str, names: set[str]) -> list[tuple[int, str]]:
    """``(offset, jsx opening tag)`` for the given component names.

    A naive ``[^>]*`` regex stops at the ``>`` of an arrow function inside an
    attribute, which is exactly how a real accessibility bug hides.  Quotes and
    brace depth are tracked instead, so nested JSX in an attribute is safe.
    """
    tags: list[tuple[int, str]] = []
    for match in re.finditer(r"<([A-Za-z][\w.]*)", source):
        if match.group(1) not in names:
            continue
        depth = 0
        quote = None
        cursor = match.end()
        while cursor < len(source):
            char = source[cursor]
            if quote:
                if char == quote and source[cursor - 1] != "\\":
                    quote = None
            elif char in "\"'`":
                quote = char
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
            elif char == ">" and depth == 0:
                break
            cursor += 1
        tags.append((match.start(), source[match.start() : cursor + 1]))
    return tags


# --------------------------------------------------------------------------- #
# Copy & onboarding
# --------------------------------------------------------------------------- #
def test_command_center_and_tour_copy_exist_in_both_locales():
    """New first-run UI must never leak untranslated keys in Arabic or English."""
    keys = (
        "dashboard.commandCenter",
        "dashboard.commandCenterSubtitle",
        "dashboard.privateInstallation",
        "dashboard.startTour",
        "dashboard.hero.running",
        "dashboard.hero.processes",
        "dashboard.hero.successRate",
        "dashboard.tour.title",
        "dashboard.tour.subtitle",
        "dashboard.tour.securityNote",
        "dashboard.tour.steps.infrastructure.title",
        "dashboard.tour.steps.processes.description",
        "dashboard.tour.steps.runs.description",
        "dashboard.tour.steps.capacity.description",
        "dashboard.tour.steps.lifecycle.description",
    )
    for language in ("en", "ar"):
        translations = _translations(language)
        for key in keys:
            assert _nested(translations, key), f"missing {language} translation: {key}"


def test_product_tour_filters_modules_by_server_permission_contract():
    """Onboarding is explanatory UI, not a way around the existing RBAC gates."""
    source = (SRC / "components" / "dashboard" / "ProductTourDialog.jsx").read_text(encoding="utf-8")
    assert "has(step.permission) || has('*')" in source
    assert "infrastructure:read" in source
    assert "lifecycle:read" in source


def test_first_run_tour_completion_is_scoped_to_the_authenticated_user():
    """A shared workstation should not hide onboarding from another operator.

    The key is versioned: the v5 dashboard introduced the decision tier (verdict
    + triage queue + health board) and a matching tour step, so an operator who
    dismissed the v4 tour must see the new one exactly once.
    """
    source = (SRC / "pages" / "DashboardPage.jsx").read_text(encoding="utf-8")
    assert "onboarding.control-room.v5.${user?.user_id ?? 'current'}" in source
    assert "storage.get(tourStorageKey" in source


def test_dashboard_refresh_is_scoped_to_the_data_it_changes():
    """Refreshing the command center must not invalidate every query in the SPA."""
    source = (SRC / "pages" / "DashboardPage.jsx").read_text(encoding="utf-8")
    assert "client.invalidateQueries({ queryKey: ['dashboard'] })" in source
    assert "client.invalidateQueries({ queryKey: ['capacity'] })" in source
    assert "client.invalidateQueries()" not in source


def test_chart_frame_distinguishes_loading_from_an_empty_result():
    """Empty chart data has a skeleton while pending and an empty state after success."""
    source = (SRC / "components" / "dashboard" / "Widgets.jsx").read_text(encoding="utf-8")
    assert "loading && isEmpty" in source
    assert "isEmpty={rows.length === 0}" in source
    assert 'aria-busy="true"' in source


# --------------------------------------------------------------------------- #
# Product shell
# --------------------------------------------------------------------------- #
def test_product_shell_has_light_dark_tokens_and_reduced_motion_support():
    css = (SRC / "index.css").read_text(encoding="utf-8")
    theme_provider = (SRC / "context" / "ThemeProvider.jsx").read_text(encoding="utf-8")
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    assert ":root {" in css
    assert ".dark {" in css
    assert "--bg: #0f1a2e;" in css
    assert "prefers-reduced-motion: reduce" in css
    assert ".command-hero" in css
    assert "storage.get('theme', 'light')" in theme_provider
    assert "return savedTheme === 'system' ? 'light' : savedTheme" in theme_provider
    assert '<html lang="en" dir="ltr">' in html
    assert "JSON.parse(savedTheme) : 'light'" in html
    assert "if (theme === 'system') theme = 'light'" in html


def test_control_room_palette_is_navy_indigo_teal_orange_everywhere():
    """Identity contract: one locked palette in the CSS tokens, the JS tokens,
    the boot screen and the seeded backend brand — Navy presence · refined
    Indigo actions · Teal live-only · Orange accents.

    The violet identity (``#5B21B6`` on a ``#F8F5FF`` canvas) was replaced
    wholesale; a single leftover hex is enough to make the sidebar, the top bar
    and the charts disagree with each other, so every source is asserted.
    """
    css = (SRC / "index.css").read_text(encoding="utf-8")
    tokens = (SRC / "design-system" / "tokens.js").read_text(encoding="utf-8")
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    tailwind = (FRONTEND / "tailwind.config.js").read_text(encoding="utf-8")
    branding = (SRC / "context" / "BrandingProvider.jsx").read_text(encoding="utf-8")
    bootstrap = (REPO_ROOT / "app" / "db" / "bootstrap.py").read_text(encoding="utf-8")

    root_block = css[css.index(":root {") : css.index(".dark {")]
    dark_block = css[css.index(".dark {") :]
    for declaration in (
        "--bg: #f5f7fb;",
        "--surface-2: #f8fafc;",
        "--text: #14213a;",
        "--text-muted: #5b6b82;",
        "--brand: #4f46e5;",
        "--brand-strong: #3730a3;",
        "--brand-lighter: #6366f1;",
        "--navy: #1e3a5f;",
        "--navy-deep: #122339;",
        "--accent: #0d9488;",
        "--orange: #f58220;",
        "--hero-from: #122339;",
        "--hero-mid: #1e3a5f;",
        "--hero-to: #0d9488;",
        "--strip-navy: #1e3a5f;",
        "--strip-indigo: #4f46e5;",
        "--strip-teal: #14b8a6;",
        "--chart-1: #1e3a5f;",
        "--border: rgba(15, 23, 42, 0.07);",
        "--radius-card: 1.25rem;",
        "--radius-ctrl: 0.75rem;",
    ):
        assert declaration in root_block, declaration
    for declaration in ("--bg: #0f1a2e;", "--surface: #152238;", "--brand: #818cf8;", "--hero-to: #0d9488;"):
        assert declaration in dark_block, declaration

    # The JS mirror (charts, canvas, tests) carries the same palette.
    assert "navy: '#1E3A5F'" in tokens and "brand: '#4F46E5'" in tokens
    assert "orange: '#F58220'" in tokens and "accent: '#0D9488'" in tokens

    # First paint agrees with the app: boot canvas, spinner and theme-color.
    assert 'content="#F5F7FB"' in html and "background: #f5f7fb;" in html
    assert "border-top-color: #1e3a5f;" in html  # navy presence on the boot spinner

    # The locked hero gradient is assembled from its stop tokens (45% mid, teal end).
    assert "background: linear-gradient(135deg, var(--hero-from) 0%, var(--hero-mid) 45%, var(--hero-to) 100%);" in css
    assert "'hero-gradient'" in tailwind and "'navy-gradient'" in tailwind

    # The backend seeds the same brand the SPA falls back to.
    assert "DEFAULT_PRIMARY = '#4F46E5'" in branding
    assert 'DEFAULT_BRAND_PRIMARY = "#4F46E5"' in bootstrap

    # No violet leftover anywhere in the shipped sources.  ``#a78bfa`` stays out
    # of the list on purpose: it is the target palette's *dark-mode* chart-6 hue,
    # not part of the retired light-mode identity.
    for path in (SRC / "index.css", SRC / "design-system" / "tokens.js", FRONTEND / "index.html"):
        body = path.read_text(encoding="utf-8").lower()
        for violet in ("#5b21b6", "#4c1d95", "#7c3aed", "#2e1065", "#1e0b3a", "#f8f5ff", "#0b0618", "#6d28d9", "#6b5b8a"):
            assert violet not in body, f"{path.name} still carries {violet}"

    assert ".kpi-strip" in css and ".nav-pill-active" in css and ".live-badge" in css

def test_top_nav_and_collapsed_rail_stay_wired_to_the_shell():
    """Primary navigation is the centred pill; the sidebar is a collapsed rail."""
    topbar = (SRC / "components" / "layout" / "TopBar.jsx").read_text(encoding="utf-8")
    top_nav = (SRC / "components" / "layout" / "TopNav.jsx").read_text(encoding="utf-8")
    shell = (SRC / "components" / "layout" / "AppShell.jsx").read_text(encoding="utf-8")

    assert "<TopNav />" in topbar and "BotsOnlineBadge" in topbar
    assert "useConnectedAgents({ refetchInterval: 30_000 })" in topbar  # shared hook, real API
    assert "PRIMARY_NAV_IDS = ['dashboard', 'processes', 'runs', 'alerts', 'capacity']" in top_nav
    assert "usePersistentState('shell.collapsed', true)" in shell


def test_command_hero_layers_and_min_height_follow_the_redesign_plan():
    """Hero: aurora 0 → scrim/grid 1 → content 2, isolated and clipped, min-height 220–240px."""
    css = (SRC / "index.css").read_text(encoding="utf-8")
    hero = css[css.index(".command-hero {") :]
    assert "isolation: isolate;" in hero[:800]
    assert "overflow: hidden;" in hero[:800]
    assert "min-height: 232px;" in hero[:800]
    for layer, z in (
        (".command-hero__aurora", "z-index: 0"),
        (".command-hero__scrim", "z-index: 1"),
        (".command-hero__grid", "z-index: 1"),
        (".command-hero__content", "z-index: 2"),
    ):
        block = hero[hero.index(layer + " {") :]
        assert z in block[: block.index("}")], layer
    # Desktop two-column hero: the gauge gains its breathing room from 1280px up.
    assert "@media (min-width: 1280px)" in css[css.index(".command-hero__visual") - 400 : css.index(".command-hero__visual") + 400]


def test_global_header_is_a_single_row():
    """The header's second "first-run affordance" row is gone for good.

    It repeated what the command palette and the dashboard tour already say, on
    every screen, at every scroll position — and it pushed the data down by a
    row on wide displays. With one row the bar keeps its height on every
    breakpoint, so the sticky dashboard toolbar never jumps.
    """
    topbar = (SRC / "components" / "layout" / "TopBar.jsx").read_text(encoding="utf-8")
    top_nav = (SRC / "components" / "layout" / "TopNav.jsx").read_text(encoding="utf-8")

    assert "onboarding.tourHint" not in topbar
    assert "nav.commandHint" not in topbar
    assert topbar.count("<header") == 1
    # the dead copy is removed from *both* bundles (parity is enforced below)
    for language in ("en", "ar"):
        assert "tourHint" not in _translations(language)["onboarding"]
        assert "commandHint" not in _translations(language)["nav"]
    # a single row means the labels can come back one breakpoint earlier
    assert "xl:not-sr-only" in top_nav and "2xl:not-sr-only" not in top_nav
    assert "xl:inline" in topbar
    # the sticky offset is still measured, never guessed
    assert "--header-height" in topbar and "ResizeObserver" in topbar



def test_locked_hybrid_palette_and_kpi_identity_map():
    """The hybrid palette is locked: navy presence, orange accents, teal live-only,
    and one identity strip colour per KPI metric in both locales of the system."""
    css = (SRC / "index.css").read_text(encoding="utf-8")
    tokens = (SRC / "design-system" / "tokens.js").read_text(encoding="utf-8")
    hero_component = (SRC / "components" / "dashboard" / "CommandCenterHero.jsx").read_text(encoding="utf-8")

    dark_block = css[css.index(".dark {") :]
    for declaration in (
        "--bg: #0f1a2e;",
        "--surface: #152238;",
        "--surface-2: #1b2a44;",
        "--orange: #ff9640;",  # night-shift strips run slightly brighter
    ):
        assert declaration in dark_block, declaration

    # KPI identity mapping from the plan (metric → strip family), shared by the
    # hero strip and the health board so a metric never changes colour.
    for pair in (
        "totalProcedures: 'navy'",
        "runsToday: 'green'",
        "costSaved: 'teal'",
        "runningNow: 'orange'",
    ):
        assert pair in tokens, pair
    assert "kpiStripVar" in tokens and "kpiStripVar(" in hero_component

    # hero KPI tiles carry the 4px strip and the icon matches it — token-driven
    assert 'className="kpi-strip"' in hero_component
    assert "kpiStripVar(metric)" in hero_component and "'--strip': tone" in hero_component

    # Arabic typography contract: line-height 1.75, no letter-spacing in RTL
    assert "line-height: 1.75" in css
    assert "html[dir='rtl'] *" in css and "letter-spacing: normal" in css


def test_dashboard_leads_with_a_pinned_decision_tier():
    """Decision-first layout: verdict → triage queue → health board → analytics.

    The dashboard used to open with six equally weighted KPI cards (including a
    static configuration count) and never surfaced the failed runs, SLA breaches
    or open alerts it already had in its payload — so nobody could tell what to
    do first. These assertions lock the ordering and the fact that the decision
    tier is pinned rather than draggable.
    """
    page = (SRC / "pages" / "DashboardPage.jsx").read_text(encoding="utf-8")
    constants = (SRC / "lib" / "constants.js").read_text(encoding="utf-8")
    signals = (SRC / "lib" / "opsSignals.js").read_text(encoding="utf-8")
    queue = (SRC / "components" / "dashboard" / "TriageQueue.jsx").read_text(encoding="utf-8")
    board = (SRC / "components" / "dashboard" / "HealthBoard.jsx").read_text(encoding="utf-8")

    # One derivation feeds every tier, so they can never contradict each other.
    assert "buildOpsSignals" in page and "buildHealthMetrics" in page
    assert page.index("signals={signals}") < page.index("<TriageQueue") < page.index("<HealthBoard")
    assert page.index("<HealthBoard") < page.index("<WidgetGrid")

    # Classic banded layout: toolbar → hero → KPI row → decisions.
    assert page.index("<DashboardToolbar") < page.index("<CommandCenterHero") < page.index("<KpiGrid")
    assert page.index("<CommandCenterHero") < page.index("<TriageQueue")
    kpi_grid = (SRC / "components" / "dashboard" / "KpiGrid.jsx").read_text(encoding="utf-8")
    assert "kpi-strip" in kpi_grid and "var(--strip-" in kpi_grid
    toolbar = (SRC / "components" / "dashboard" / "DashboardToolbar.jsx").read_text(encoding="utf-8")
    assert "sticky top-[var(--header-height)]" in toolbar

    # The decision tier is pinned: the draggable grid holds analytics only.
    assert "{ i: 'kpis'" not in constants
    assert page.index('<section id="triage-queue"') < page.index("dashboard.analytics.title")

    # Every signal cites a field the server actually sends.
    for field in ("failureDetailsAll", "SLAStatus", "SLATargetMinutes", "online_runners", "queue_depth", "recommendations"):
        assert field in signals, field

    # The queue is actionable, and the alert it acknowledges is a real mutation.
    assert "onAcknowledge" in queue and "onDecide" in queue
    assert "useSetAlertStatus" in page and "useUpdateRecommendationStatus" in page

    # The health board judges every metric against a target.
    assert "targetKey" in board and "verdictKey" in board


def test_triage_and_health_copy_exist_in_both_locales():
    """The decision tier must never leak untranslated keys into the Arabic UI."""
    keys = (
        "dashboard.verdict.critical",
        "dashboard.verdict.degraded",
        "dashboard.verdict.healthy",
        "dashboard.verdict.allClear",
        "dashboard.verdict.reasons.sla",
        "dashboard.verdict.reasons.failures",
        "dashboard.verdict.reasons.alerts",
        "dashboard.triage.title",
        "dashboard.triage.allClear",
        "dashboard.triage.titles.sla",
        "dashboard.triage.titles.failures",
        "dashboard.triage.evidence.slaBreach",
        "dashboard.triage.links.runs",
        "dashboard.health.title",
        "dashboard.health.verdicts.breach",
        "dashboard.health.targets.successRate",
        "dashboard.analytics.title",
        "dashboard.tour.steps.dashboard.title",
        "alerts.acknowledged",
    )
    for language in ("en", "ar"):
        translations = _translations(language)
        for key in keys:
            assert _nested(translations, key), f"missing {language} translation: {key}"


def test_rtl_grid_mirrors_positions_and_uses_the_logical_resize_corner():
    """RGL positions are physical, so the grid mirrors x in code and resizes from the bottom-left in RTL.

    The mirrored layout must be memoised and persistence must skip unchanged layouts; otherwise
    react-grid-layout reports a change on every render and React throws "Maximum update depth".
    """
    grid = (SRC / "components" / "dashboard" / "WidgetGrid.jsx").read_text(encoding="utf-8")
    assert "const gridLayouts = useMemo(() => (rtl ? mirrorLayouts(layouts) : layouts), [layouts, rtl])" in grid
    assert "resizeConfig={rtl ? RESIZE_CONFIG_RTL : RESIZE_CONFIG_LTR}" in grid
    assert "const RESIZE_CONFIG_RTL = { handles: ['sw'] }" in grid
    assert "const RESIZE_CONFIG_LTR = { handles: ['se'] }" in grid
    assert "if (JSON.stringify(logical) === JSON.stringify(layoutsRef.current)) return" in grid
    css = (SRC / "index.css").read_text(encoding="utf-8")
    assert ".rpa-grid-container .react-grid-layout {\n  direction: ltr;" in css


def test_ui_version_stays_aligned_with_control_room_v4():
    branding = (SRC / "context" / "BrandingProvider.jsx").read_text(encoding="utf-8")
    shell = (SRC / "components" / "layout" / "AppShell.jsx").read_text(encoding="utf-8")
    assert f"api_version: '{EXPECTED_VERSION}'" in branding
    assert f"branding.api_version || '{EXPECTED_VERSION}'" in shell
    assert "'3.0.0'" not in shell


# --------------------------------------------------------------------------- #
# Arabic / RTL
# --------------------------------------------------------------------------- #
def test_both_locales_are_complete_and_arabic_is_real_arabic():
    english, arabic = _flatten(_translations("en")), _flatten(_translations("ar"))
    plural_suffixes = ("_zero", "_one", "_two", "_few", "_many", "_other")

    missing_in_arabic = [
        key
        for key in english
        if key not in arabic and not any(f"{key}{suffix}" in arabic for suffix in plural_suffixes)
    ]
    missing_in_english = [
        key for key in arabic if key not in english and not key.endswith(plural_suffixes)
    ]
    assert missing_in_arabic == [], f"Arabic is missing: {missing_in_arabic[:10]}"
    assert missing_in_english == [], f"English is missing: {missing_in_english[:10]}"

    # No placeholders or mojibake may ever ship, in either language.
    for language, bundle in (("en", english), ("ar", arabic)):
        offenders = [
            f"{language}:{key}"
            for key, value in bundle.items()
            if isinstance(value, str) and (re.search(r"\?{2,}|\ufffd", value) or "Ã" in value or "Ø" in value)
        ]
        assert offenders == [], offenders[:10]

    arabic_glyph = re.compile(r"[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]")
    for key in ("nav.dashboard", "nav.runs", "actions.refresh", "dashboard.commandCenter", "errors.title"):
        assert arabic_glyph.search(str(arabic[key])), f"ar.{key} is not Arabic: {arabic[key]}"


def test_arabic_fonts_are_self_hosted_with_a_script_specific_unicode_range():
    """An air-gapped bank has no font CDN — the glyphs must ship with the app."""
    css = (SRC / "index.css").read_text(encoding="utf-8")
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    fonts = FRONTEND / "public" / "fonts"
    for name in ("cairo-arabic-wght-normal.woff2", "cairo-latin-wght-normal.woff2", "inter-latin-wght-normal.woff2"):
        asset = fonts / name
        assert asset.exists(), f"missing self-hosted font {name}"
        assert asset.stat().st_size > 10_000
    assert "@font-face" in css
    assert re.search(r"unicode-range:[^;]*U\+0600-06FF", css), "Arabic font needs its own unicode-range"
    assert "/fonts/cairo-arabic-wght-normal.woff2" in html and "rel=\"preload\"" in html
    assert (fonts / "LICENSE-Cairo-OFL.txt").exists(), "OFL licence text must ship with the font"


def test_no_physical_direction_utility_anywhere_in_the_spa():
    """RTL must mirror for free — a `ml-3` would break the Arabic layout."""
    offenders: list[str] = []
    for path in _sources(".jsx", ".js"):
        for number, line in enumerate(_strip_comments(path.read_text(encoding="utf-8")).splitlines(), 1):
            if PHYSICAL_UTILITY.search(line):
                offenders.append(f"{path.relative_to(SRC)}:{number} {line.strip()[:80]}")
    assert offenders == [], offenders[:10]


def test_every_lucide_icon_is_hidden_from_assistive_tech():
    """Icons are decorative; the accessible name belongs to the control."""
    offenders: list[str] = []
    for path in _sources(".jsx"):
        source = _strip_comments(path.read_text(encoding="utf-8"))
        imports = re.search(r"import \{([^}]*)\} from 'lucide-react'", source, re.DOTALL)
        if not imports:
            continue
        names = {entry.strip().split(" as ")[-1] for entry in imports.group(1).split(",") if entry.strip()}
        for _, tag in _jsx_tags(source, names):
            if re.search(r"aria-hidden|aria-label|role=|title=", tag):
                continue
            offenders.append(f"{path.relative_to(SRC)}: {tag[:70]}")
    assert offenders == [], offenders[:10]


def test_form_controls_are_labelled():
    """Filters are heavily used by operators — every control needs a name."""
    offenders: list[str] = []
    for path in _sources(".jsx"):
        source = _strip_comments(path.read_text(encoding="utf-8"))
        field_ranges = [(m.start(), m.end()) for m in re.finditer(r"<Field\b.*?</Field>", source, re.DOTALL)]
        label_ranges = [(m.start(), m.end()) for m in re.finditer(r"<label\b.*?</label>", source, re.DOTALL)]
        for offset, tag in _jsx_tags(source, {"Input", "Select", "Textarea"}):
            if re.search(r"aria-label=|id=|name=", tag):
                continue
            if any(start < offset < stop for start, stop in field_ranges + label_ranges):
                continue
            offenders.append(f"{path.relative_to(SRC)}: {tag[:70]}")
    assert offenders == [], offenders[:10]


def test_arabic_is_applied_to_the_document_before_first_paint():
    """Language + direction must be set in index.html, not after hydration."""
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    i18n = (SRC / "i18n" / "index.js").read_text(encoding="utf-8")
    assert "document.documentElement.lang = lang" in html
    assert "document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'" in html
    assert "root.dir = language.dir" in i18n
    assert "ar-EG-u-nu-latn" in i18n, "Arabic must keep Latin digits for financial values"
    assert "localStorage.setItem(STORAGE_KEY, language.code)" in i18n


# --------------------------------------------------------------------------- #
# Test + build wiring
# --------------------------------------------------------------------------- #
def test_frontend_test_suite_exists_and_is_wired():
    """The RTL/Arabic and accessibility contracts must actually run in CI."""
    package = json.loads((FRONTEND / "package.json").read_text(encoding="utf-8"))
    assert package["version"] == EXPECTED_VERSION
    assert package["scripts"]["test"].startswith("vitest")

    specs = sorted((SRC / "test").glob("*.test.*"))
    names = {path.name for path in specs}
    assert {"i18n.test.jsx", "rtl.test.jsx", "apiClient.test.js", "contracts.test.jsx", "perf.test.jsx"} <= names
    assert (SRC / "test" / "setup.js").exists()

    workflow = (REPO_ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    assert "npm test" in workflow

    vite_config = (FRONTEND / "vite.config.js").read_text(encoding="utf-8")
    assert "environment: 'jsdom'" in vite_config
    assert "manualChunks" in vite_config


def test_every_route_is_lazily_loaded_from_the_shared_registry():
    """A page imported eagerly would slow the first paint of the whole shell."""
    route_meta = (SRC / "lib" / "routeMeta.js").read_text(encoding="utf-8")
    modules = re.findall(r"load: \(\) => import\('\.\./pages/(\w+)'\)", route_meta)
    assert len(modules) >= 10
    assert len(set(modules)) == len(modules)

    app_source = (SRC / "App.jsx").read_text(encoding="utf-8")
    assert "routeMeta" in app_source
    assert not re.search(r"import \w+ from '\./pages/", app_source)
