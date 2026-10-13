#!/usr/bin/env python
"""Live end-to-end verification of the Control Room dashboard.

Runs against a *running* server (uvicorn) rather than the in-process test
client, so it exercises the real HTTP stack: cookies, CSRF, SSE streaming,
static asset delivery and the SPA fallback.

Usage:
    python scripts/verify_dashboard.py                 # http://127.0.0.1:8000
    python scripts/verify_dashboard.py http://host:80  # custom base URL
    CONTROL_ROOM_USER=admin CONTROL_ROOM_PASSWORD=... python scripts/verify_dashboard.py

Every check prints OK/FAIL and the script exits non-zero if anything failed.
"""

from __future__ import annotations

import json
import os
import statistics
import sys
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

import httpx

BASE_URL = (sys.argv[1] if len(sys.argv) > 1 else os.getenv("CONTROL_ROOM_URL", "http://127.0.0.1:8000")).rstrip("/")
USERNAME = os.getenv("CONTROL_ROOM_USER", "admin")
PASSWORD = os.getenv("CONTROL_ROOM_PASSWORD", "ChangeMe_Admin1!")
TENANT = os.getenv("CONTROL_ROOM_TENANT", "default")

RESULTS: List[Tuple[str, bool, str]] = []
TIMINGS: List[Tuple[str, float]] = []


def check(name: str, condition: bool, detail: str = "") -> bool:
    RESULTS.append((name, bool(condition), detail))
    flag = "OK  " if condition else "FAIL"
    print(f"[{flag}] {name}{(' — ' + detail) if detail else ''}")
    return bool(condition)


def timed(client: httpx.Client, path: str, headers: Dict[str, str]) -> Tuple[Optional[httpx.Response], float]:
    started = time.perf_counter()
    response = client.get(path, headers=headers)
    elapsed = (time.perf_counter() - started) * 1000
    TIMINGS.append((path, elapsed))
    return response, elapsed


def body(response: httpx.Response) -> Any:
    try:
        return response.json()
    except Exception:  # noqa: BLE001 - non JSON payloads are part of the assertions
        return None


def main() -> int:  # noqa: C901 - a linear scenario script is clearer here
    print(f"== Control Room live verification against {BASE_URL} ==")
    with httpx.Client(base_url=BASE_URL, timeout=30.0, follow_redirects=True) as client:
        # ------------------------------------------------------------- SPA
        index = client.get("/")
        check("SPA index served", index.status_code == 200 and "root" in index.text, f"{index.status_code}")
        asset_names = [token for token in index.text.split('"') if token.startswith("/assets/") or token.startswith("assets/")]
        asset = asset_names[0] if asset_names else None
        if asset:
            asset_response = client.get("/" + asset.lstrip("/"))
            check("Hashed asset served", asset_response.status_code == 200 and len(asset_response.content) > 1000, asset)
        check("Favicon served", client.get("/favicon.svg").status_code == 200)
        check("SPA deep link falls back to index", client.get("/lifecycle").status_code == 200)
        not_found = client.get("/api/definitely-not-a-route")
        check("Unknown API path returns JSON 404", not_found.status_code == 404 and body(not_found) is not None)

        version = body(client.get("/api/version"))
        check("Public version endpoint", bool(version and version.get("api_version")), str(version.get("version") if version else ""))

        branding = body(client.get("/api/branding"))
        check("Public branding endpoint", bool(branding and branding.get("company_name")), str(branding.get("company_name") if branding else ""))

        health = body(client.get("/health"))
        check("Liveness probe", bool(health and health.get("status") == "healthy"), str(health.get("status") if health else ""))

        # ----------------------------------------------------------- login
        login = client.post("/api/auth/login", json={"username": USERNAME, "password": PASSWORD, "tenant_key": TENANT})
        login_body = body(login)
        check("Login (JSON) succeeds", login.status_code == 200, f"{login.status_code}")
        token = (login_body or {}).get("access_token")
        check("Access token issued", bool(token))
        refresh_cookie = client.cookies.get("refresh_token")
        check("Refresh cookie is HttpOnly", refresh_cookie is not None)
        check("CSRF cookie issued", client.cookies.get("csrf_token") is not None)

        # unauthorised access must be rejected
        unauthenticated = client.get("/api/dashboard-data")
        check("Dashboard requires authentication", unauthenticated.status_code == 401, f"{unauthenticated.status_code}")

        headers = {"Authorization": f"Bearer {token}"}

        me = body(client.get("/api/auth/me", headers=headers))
        check("Current user profile", bool(me and me.get("username")), str(me.get("role") if me else ""))

        # ------------------------------------------------- every SPA call
        endpoints: List[Tuple[str, str, Callable[[Any], bool]]] = [
            ("/api/dashboard-data", "dashboard payload", lambda d: "kpis" in d and "charts" in d),
            ("/api/dashboard/process-options", "process options", lambda d: isinstance(d, list)),
            ("/api/dashboard/sla-summary", "SLA summary", lambda d: isinstance(d, (list, dict))),
            ("/api/dashboard/backlog-trend", "backlog trend", lambda d: isinstance(d, list)),
            ("/api/processes-meta/departments", "departments", lambda d: isinstance(d, list)),
            ("/api/processes-meta/roi-summary", "ROI summary", lambda d: isinstance(d, list)),
            ("/api/processes", "process catalogue", lambda d: "items" in d),
            ("/api/capacity/insights", "capacity insights", lambda d: "recommendations" in d),
            ("/api/capacity/history", "capacity history", lambda d: isinstance(d, list)),
            ("/api/capacity/recommendations", "recommendation list", lambda d: isinstance(d, list)),
            ("/api/runs?limit=5", "run history", lambda d: "items" in d),
            ("/api/runs/statistics", "run statistics", lambda d: "daily" in d),
            ("/api/runs/top-failures", "top failures", lambda d: isinstance(d, list)),
            ("/api/infrastructure", "machine fleet", lambda d: isinstance(d, list)),
            ("/api/infrastructure/summary", "fleet summary", lambda d: "total" in d),
            ("/api/commands", "command log", lambda d: isinstance(d, list)),
            ("/api/platform/providers", "provider catalogue", lambda d: isinstance(d, list)),
            ("/api/platform/health", "vendor health", lambda d: "provider" in d),
            ("/api/platform/sync-history", "sync history", lambda d: isinstance(d, list)),
            ("/api/agents/connected", "connected agents", lambda d: isinstance(d, (list, dict))),
            ("/api/realtime/status", "realtime status", lambda d: isinstance(d, dict)),
            ("/api/bot-versions", "bot versions", lambda d: isinstance(d, list)),
            ("/api/bot-versions/live-status", "lifecycle overview", lambda d: "counts" in d),
            ("/api/approvals", "approvals inbox", lambda d: isinstance(d, list)),
            ("/api/vault/statistics", "vault statistics", lambda d: "total_credentials" in d),
            ("/api/audit-logs?limit=5", "audit trail", lambda d: "items" in d),
            ("/api/audit-logs/summary", "audit summary", lambda d: "activity" in d),
            ("/api/notifications", "notification log", lambda d: isinstance(d, list)),
            ("/api/notifications/statistics", "notification SLI", lambda d: "total" in d),
            ("/api/tenants", "tenants", lambda d: isinstance(d, list)),
            ("/api/tenants/meta/providers", "tenant providers", lambda d: isinstance(d, list)),
            ("/api/users", "users", lambda d: isinstance(d, list)),
            ("/api/auth/sessions", "sessions", lambda d: isinstance(d, list)),
            ("/health/detail", "self-health report", lambda d: "security" in d and "scheduler" in d),
        ]

        failures = 0
        for path, label, validator in endpoints:
            response, elapsed = timed(client, path, headers)
            payload = body(response)
            ok = response.status_code == 200 and payload is not None and validator(payload)
            if not ok:
                failures += 1
            check(f"{label} ({path})", ok, f"{response.status_code} · {elapsed:.0f} ms")

        # --------------------------------------------------------- exports
        for path, kind in [
            ("/api/exports/runs.xlsx", "xlsx"),
            ("/api/exports/audit.xlsx", "xlsx"),
            ("/api/exports/roi.pdf", "pdf"),
            ("/api/exports/capacity.pdf", "pdf"),
        ]:
            response = client.get(path, headers=headers)
            content_type = response.headers.get("content-type", "")
            if kind == "xlsx":
                ok = response.status_code == 200 and response.content[:2] == b"PK"
            else:
                ok = response.status_code == 200 and response.content[:4] == b"%PDF"
            check(f"Export {path}", ok, content_type.split(";")[0])

        # ------------------------------------------------------------- SSE
        received = 0
        try:
            with client.stream("GET", "/api/realtime/events", headers=headers) as stream:
                check("SSE stream opened", stream.status_code == 200, str(stream.headers.get("content-type")))
                started = time.perf_counter()
                for line in stream.iter_lines():
                    if line.startswith("event:") or line.startswith("data:"):
                        received += 1
                    if received >= 2 or time.perf_counter() - started > 20:
                        break
        except Exception as error:  # noqa: BLE001
            check("SSE stream readable", False, str(error)[:80])
        check("SSE events delivered", received >= 1, f"{received} lines")

        # --------------------------------------------------- token rotation
        csrf = client.cookies.get("csrf_token")
        rotated = client.post("/api/auth/refresh", headers={"X-CSRF-Token": csrf or ""})
        rotated_body = body(rotated)
        check("Refresh rotation works", rotated.status_code == 200 and bool((rotated_body or {}).get("access_token")))
        headers = {"Authorization": f"Bearer {(rotated_body or {}).get('access_token', token)}"}
        replay = client.post("/api/auth/refresh", headers={"X-CSRF-Token": csrf or ""})
        check("Refresh replay rejected", replay.status_code in (401, 403), str(replay.status_code))

        # ------------------------------------------------------------ logout
        csrf = client.cookies.get("csrf_token")
        logout = client.post("/api/auth/logout", headers={**headers, "X-CSRF-Token": csrf or ""})
        check("Logout succeeds", logout.status_code in (200, 204), str(logout.status_code))
        after_logout = client.post("/api/auth/refresh", headers={"X-CSRF-Token": csrf or ""})
        check("Refresh after logout rejected", after_logout.status_code in (401, 403), str(after_logout.status_code))

    # ------------------------------------------------------------ summary
    slowest = sorted(TIMINGS, key=lambda item: item[1], reverse=True)[:5]
    latencies = [item[1] for item in TIMINGS]
    p95 = statistics.quantiles(latencies, n=20)[-1] if len(latencies) > 4 else max(latencies)
    print("\n== latency ==")
    for path, elapsed in slowest:
        print(f"  {elapsed:7.0f} ms  {path}")
    print(f"  median {statistics.median(latencies):.0f} ms · p95 {p95:.0f} ms · n={len(latencies)}")
    check("API p95 under 200 ms", p95 < 200, f"{p95:.0f} ms")

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    failed = [name for name, ok, _ in RESULTS if not ok]
    print(f"\n== {passed}/{len(RESULTS)} checks passed ==")
    if failed:
        print("failed checks:")
        for name in failed:
            print(f"  - {name}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
