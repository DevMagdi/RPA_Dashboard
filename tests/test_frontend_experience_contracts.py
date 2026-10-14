"""Frontend contract checks for bilingual product experience and shared UI gates."""

from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
FRONTEND = REPO_ROOT / "rpa-dashboard"


def _translations(language: str) -> dict:
    return json.loads((FRONTEND / "src" / "i18n" / "locales" / f"{language}.json").read_text(encoding="utf-8"))


def _nested(data: dict, path: str):
    value = data
    for part in path.split("."):
        value = value[part]
    return value


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
    source = (FRONTEND / "src" / "components" / "dashboard" / "ProductTourDialog.jsx").read_text(encoding="utf-8")
    assert "has(step.permission) || has('*')" in source
    assert "infrastructure:read" in source
    assert "lifecycle:read" in source


def test_first_run_tour_completion_is_scoped_to_the_authenticated_user():
    """A shared workstation should not hide onboarding from another operator."""
    source = (FRONTEND / "src" / "pages" / "DashboardPage.jsx").read_text(encoding="utf-8")
    assert "onboarding.control-room.v4.${user?.user_id ?? 'current'}" in source
    assert "storage.get(tourStorageKey" in source


def test_dashboard_refresh_is_scoped_to_the_data_it_changes():
    """Refreshing the command center must not invalidate every query in the SPA."""
    source = (FRONTEND / "src" / "pages" / "DashboardPage.jsx").read_text(encoding="utf-8")
    assert "client.invalidateQueries({ queryKey: ['dashboard'] })" in source
    assert "client.invalidateQueries({ queryKey: ['capacity'] })" in source
    assert "client.invalidateQueries()" not in source


def test_chart_frame_distinguishes_loading_from_an_empty_result():
    """Empty chart data has a skeleton while pending and an empty state after success."""
    source = (FRONTEND / "src" / "components" / "dashboard" / "Widgets.jsx").read_text(encoding="utf-8")
    assert "loading && isEmpty" in source
    assert "isEmpty={rows.length === 0}" in source
    assert "aria-busy=\"true\"" in source


def test_product_shell_has_light_dark_tokens_and_reduced_motion_support():
    css = (FRONTEND / "src" / "index.css").read_text(encoding="utf-8")
    theme_provider = (FRONTEND / "src" / "context" / "ThemeProvider.jsx").read_text(encoding="utf-8")
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    assert ":root {" in css
    assert ".dark {" in css
    assert "--bg: #070b14" in css
    assert "prefers-reduced-motion: reduce" in css
    assert ".command-hero" in css
    assert "storage.get('theme', 'light')" in theme_provider
    assert "return savedTheme === 'system' ? 'light' : savedTheme" in theme_provider
    assert '<html lang="en" dir="ltr">' in html
    assert "JSON.parse(savedTheme) : 'light'" in html
    assert "if (theme === 'system') theme = 'light'" in html


def test_ui_version_stays_aligned_with_control_room_v4():
    branding = (FRONTEND / "src" / "context" / "BrandingProvider.jsx").read_text(encoding="utf-8")
    shell = (FRONTEND / "src" / "components" / "layout" / "AppShell.jsx").read_text(encoding="utf-8")
    assert "api_version: '4.0.0'" in branding
    assert "branding.api_version || '4.0.0'" in shell
    assert "'3.0.0'" not in shell
