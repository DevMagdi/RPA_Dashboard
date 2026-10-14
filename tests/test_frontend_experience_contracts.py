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
    """A shared workstation should not hide onboarding from another operator."""
    source = (SRC / "pages" / "DashboardPage.jsx").read_text(encoding="utf-8")
    assert "onboarding.control-room.v4.${user?.user_id ?? 'current'}" in source
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
    assert "--bg: #020617" in css
    assert "prefers-reduced-motion: reduce" in css
    assert ".command-hero" in css
    assert "storage.get('theme', 'light')" in theme_provider
    assert "return savedTheme === 'system' ? 'light' : savedTheme" in theme_provider
    assert '<html lang="en" dir="ltr">' in html
    assert "JSON.parse(savedTheme) : 'light'" in html
    assert "if (theme === 'system') theme = 'light'" in html


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
