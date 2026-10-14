"""Measured performance budgets for the API and the delivery pipeline.

"Extreme dashboard speed" is a requirement, so it is measured rather than
asserted in prose.  The budgets here are deliberately generous (CI machines are
shared and the database is SQLite) — they catch *structural* regressions:

* an endpoint that fans out into dozens of queries (N+1),
* a dashboard payload that grows unbounded,
* compression or cache headers quietly disappearing,
* the frontend bundle creeping past its budget,
* a route registry that stops being lazily loaded.

The measured numbers are printed so the test report can quote them.
"""

from __future__ import annotations

import gzip
import json
import pathlib
import re
import statistics
import time

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
FRONTEND = REPO_ROOT / "rpa-dashboard"
DIST = FRONTEND / "dist"

BUDGETS = {
    # Wall-clock ceilings for a warm request on the CI runner (SQLite, demo data).
    "dashboard_p95_ms": 1500.0,
    "dashboard_max_ms": 3000.0,
    "alerts_p95_ms": 600.0,
    # Query budget: the dashboard aggregates seven widgets from several tables.
    "dashboard_max_queries": 40,
    # A single-page payload must stay small enough to render instantly on a
    # branch-office link.
    "dashboard_max_bytes": 400_000,
}


def _measure(client, headers, path, samples=6):
    """Return (median_ms, p95_ms, max_ms, final_response)."""
    timings = []
    response = None
    for _ in range(samples):
        started = time.perf_counter()
        response = client.get(path, headers=headers)
        timings.append((time.perf_counter() - started) * 1000)
        assert response.status_code == 200, response.text
    timings.sort()
    p95 = timings[-1] if len(timings) < 5 else timings[int(len(timings) * 0.95) - 1]
    return statistics.median(timings), p95, timings[-1], response


def test_dashboard_payload_is_fast_and_small(client, admin_headers):
    median, p95, worst, response = _measure(client, admin_headers, "/api/dashboard-data?days=90")
    size = len(response.content)
    print(f"[perf] /api/dashboard-data median={median:.1f}ms p95={p95:.1f}ms size={size / 1024:.1f}KiB")

    assert p95 < BUDGETS["dashboard_p95_ms"], f"dashboard p95 {p95:.0f}ms exceeds budget"
    assert worst < BUDGETS["dashboard_max_ms"]
    assert size < BUDGETS["dashboard_max_bytes"], "dashboard payload grew past the budget"


def test_dashboard_does_not_n_plus_one(client, admin_headers):
    """Count the SQL statements a single dashboard render issues."""
    from sqlalchemy import event

    from app.db.session import get_engine

    statements: list[str] = []
    engine = get_engine()

    def _record(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001 - SQLAlchemy hook
        statements.append(statement.split()[0].upper())

    event.listen(engine, "before_cursor_execute", _record)
    try:
        response = client.get("/api/dashboard-data?days=90", headers=admin_headers)
        assert response.status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", _record)

    print(f"[perf] dashboard SQL statements={len(statements)}")
    assert len(statements) <= BUDGETS["dashboard_max_queries"], statements[:20]
    # Nothing may be written during a read-only aggregation.
    assert "INSERT" not in statements and "UPDATE" not in statements and "DELETE" not in statements


def test_alerts_endpoint_stays_interactive(client, admin_headers):
    median, p95, _, response = _measure(client, admin_headers, "/api/alerts?limit=50", samples=5)
    print(f"[perf] /api/alerts median={median:.1f}ms p95={p95:.1f}ms")
    assert p95 < BUDGETS["alerts_p95_ms"]
    assert isinstance(response.json(), (dict, list))


def test_json_responses_are_compressed_when_accepted(client, admin_headers):
    """A dashboard payload must not cross the wire uncompressed.

    The test client transparently decompresses the body, so the assertion is on
    the negotiated header (and on the payload actually being large enough for
    compression to matter).
    """
    response = client.get("/api/dashboard-data?days=365", headers={**admin_headers, "Accept-Encoding": "gzip"})
    assert response.status_code == 200
    assert response.headers.get("content-encoding") == "gzip"
    assert "Accept-Encoding" in response.headers.get("vary", "")
    assert len(response.content) > 1024, "payload is below the compression threshold — budget drifted?"
    json.loads(response.content)


def test_static_assets_are_cached_immutably_and_the_shell_is_not(client):
    """Hashed assets may be cached for a year; index.html never."""
    if not (DIST / "assets").exists():
        pytest.skip("frontend build not present (run `npm run build`)")
    asset = next((DIST / "assets").glob("*.js"))
    response = client.get(f"/assets/{asset.name}")
    assert response.status_code == 200
    assert "immutable" in response.headers.get("cache-control", "")

    shell = client.get("/")
    assert shell.status_code == 200
    assert "no-cache" in shell.headers.get("cache-control", "")


def test_fonts_are_served_from_the_installation(client):
    """Air-gapped banks: the Arabic font must come from the Control Room itself."""
    response = client.get("/fonts/cairo-arabic-wght-normal.woff2")
    assert response.status_code == 200
    assert response.headers["content-type"] in ("font/woff2", "application/octet-stream")
    assert len(response.content) > 10_000


# --------------------------------------------------------------------------- #
# Frontend delivery budget (measured on the real build, skipped without it)
# --------------------------------------------------------------------------- #
def _read_assets():
    if not (DIST / "assets").exists():
        pytest.skip("frontend build not present (run `npm run build`)")
    return sorted((DIST / "assets").glob("*"))


def test_frontend_entry_bundle_stays_small():
    assets = _read_assets()
    entry = [path for path in assets if re.fullmatch(r"index-.*\.js", path.name)]
    assert entry, "no entry chunk found in the build output"
    for path in entry:
        raw = path.read_bytes()
        print(f"[perf] entry {path.name}: {len(raw) / 1024:.1f}KiB raw, {len(gzip.compress(raw)) / 1024:.1f}KiB gzip")
        assert len(raw) < 420_000

    heaviest = max(assets, key=lambda item: item.stat().st_size)
    print(f"[perf] heaviest chunk {heaviest.name}: {heaviest.stat().st_size / 1024:.1f}KiB")


def test_frontend_splits_charts_and_pages():
    assets = _read_assets()
    names = [path.name for path in assets if path.suffix == ".js"]
    assert any(name.startswith("charts") for name in names), "recharts must not sit in the entry chunk"

    route_meta = (FRONTEND / "src" / "lib" / "routeMeta.js").read_text(encoding="utf-8")
    lazy_routes = re.findall(r"load: \(\) => import\('\.\./pages/(\w+)'\)", route_meta)
    assert len(lazy_routes) >= 10, route_meta[:200]
    for page in lazy_routes:
        assert any(name.startswith(f"{page}-") for name in names), f"{page} is not its own chunk"


def test_frontend_test_suite_is_wired_into_ci():
    """The suite only protects the product if CI runs it."""
    workflow = (REPO_ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    assert "npm test" in workflow

    package = json.loads((FRONTEND / "package.json").read_text(encoding="utf-8"))
    assert package["scripts"]["test"].startswith("vitest")
    assert "vite.config.js" in str(sorted(path.name for path in FRONTEND.glob("vite.config.js")))
    vite_config = (FRONTEND / "vite.config.js").read_text(encoding="utf-8")
    assert "environment: 'jsdom'" in vite_config
    assert "manualChunks" in vite_config
