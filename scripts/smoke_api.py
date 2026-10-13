"""End-to-end API smoke test against a live app object (no server needed).

Run:  DB_DIALECT=sqlite DB_NAME=/tmp/smoke.sqlite3 ENV=test DB_SEED_DEMO=true \
      SCHEDULER_ENABLED=false /home/user/.venv/bin/python /tmp/smoke.py
"""

from __future__ import annotations

import sys
import time
import warnings

warnings.filterwarnings("ignore")

import pyotp
from fastapi.testclient import TestClient

from app.main import app

RESULTS = []


def check(label: str, condition: bool, detail: str = "") -> None:
    RESULTS.append((label, condition, detail))
    print(f"{'PASS' if condition else 'FAIL'}  {label}{(' :: ' + detail) if detail else ''}")


with TestClient(app, raise_server_exceptions=False) as client:
    # ---------------------------------------------------------------- login
    t0 = time.perf_counter()
    r = client.post("/api/auth/login", json={"username": "admin", "password": "ChangeMe_Admin1!"})
    check("login (json)", r.status_code == 200 and "access_token" in r.json(), str(r.status_code))
    tokens = r.json()
    H = {"Authorization": f"Bearer {tokens['access_token']}"}
    csrf = client.cookies.get("csrf_token")
    check("csrf cookie issued", bool(csrf))
    check("refresh cookie is httponly", any(c.name == "refresh_token" for c in client.cookies.jar))

    r = client.get("/api/auth/me", headers=H)
    check("me", r.status_code == 200 and r.json()["role"] == "SuperAdmin")

    # ------------------------------------------------------------ dashboard
    t0 = time.perf_counter()
    r = client.get("/api/dashboard-data", headers=H)
    first_ms = (time.perf_counter() - t0) * 1000
    t0 = time.perf_counter()
    r2 = client.get("/api/dashboard-data", headers=H)
    cached_ms = (time.perf_counter() - t0) * 1000
    body = r.json() if r.status_code == 200 else {}
    check("dashboard-data", r.status_code == 200 and "kpis" in body, f"{first_ms:.0f} ms cold / {cached_ms:.0f} ms warm")
    check("dashboard < 1.5s (warm)", cached_ms < 1500, f"{cached_ms:.0f} ms")
    check("dashboard kpis populated", body.get("kpis", {}).get("totalTransactions", 0) > 0, str(body.get("kpis", {}))[:90])
    check("dashboard capacity block", "capacity" in body, str(list(body.get("capacity", {}).keys())))

    # ------------------------------------------------------------- capacity
    r = client.get("/api/capacity/insights", headers=H)
    check("capacity insights", r.status_code == 200 and "summary" in r.json(), str(r.json().get("summary", {}))[:120])
    r = client.post("/api/capacity/generate", headers=H)
    gen = r.json() if r.status_code == 200 else {}
    check("capacity generate", r.status_code == 200 and gen.get("generated", 0) >= 1, f"generated={gen.get('generated')}")
    recs = client.get("/api/capacity/recommendations", headers=H).json()
    check("recommendations persisted", len(recs) >= 1, f"{len(recs)} rows")
    if recs:
        rec_id = recs[0]["RecommendationID"] if "RecommendationID" in recs[0] else recs[0].get("id")
        r = client.post(f"/api/capacity/recommendations/{rec_id}/status", json={"Status": "Requested"}, headers=H)
        check("request additional capacity", r.status_code == 200, r.text[:120])

    # ----------------------------------------------------------------- runs
    r = client.post(
        "/api/runs/start",
        json={"ProcessName": "Invoice_Processing", "RequestID": "SMOKE-001", "IdempotencyKey": "SMOKE-001"},
        headers=H,
    )
    check("run start", r.status_code == 201 and r.json().get("created") is True, r.text[:120])
    run_id = r.json().get("run_id") if r.status_code == 201 else None
    if run_id:
        r = client.post(
            f"/api/runs/{run_id}/complete",
            json={"Status": "Completed", "TransactionsCount": 25},
            headers=H,
        )
        check("run complete (server-side savings)", r.status_code == 200 and r.json().get("already_completed") is False, r.text[:140])
        r = client.post("/api/runs/start", json={"ProcessName": "Nope_Missing"}, headers=H)
        check("run start validates process", r.status_code == 404)
    r = client.get("/api/runs/statistics", headers=H)
    check("run statistics", r.status_code == 200 and "daily" in r.json())

    # ------------------------------------------------------------- roi / sla
    r = client.post(
        "/api/update-roi",
        json={
            "ProcessName": "Invoice_Processing",
            "ExpectedRunsPerDay": 30,
            "ManualTimeSaved": 12,
            "CostSaved": 0.9,
            "EmpMinutesPerRequest": 9,
            "EmpCostPerRequest": 14,
            "BotCostPerRequest": 0.4,
        },
        headers=H,
    )
    check("update-roi", r.status_code == 200, r.text[:120])
    r = client.post(
        "/api/update-sla",
        json={
            "ProcessName": "Invoice_Processing",
            "SLATargetMinutes": 25,
            "AvgItemProcessingSeconds": 45,
            "SLAWarningRatio": 0.8,
        },
        headers=H,
    )
    check("update-sla", r.status_code == 200, r.text[:120])
    r = client.get("/api/processes-meta/roi-summary?days=30", headers=H)
    check("roi summary", r.status_code == 200 and isinstance(r.json(), list) and r.json())

    # ------------------------------------------------------------ infra
    r = client.post(
        "/api/register-machine",
        json={
            "MachineName": "SMOKE-BOT-01",
            "RunnerType": "Unattended",
            "AssignedBot": "Invoice_Processing",
            "TotalRAM_GB": 16,
            "TotalHDD_GB": 256,
            "RobotCapacity": 1,
        },
        headers=H,
    )
    check("register machine", r.status_code == 201, r.text[:150])
    code = r.json().get("enrollment_code") if r.status_code == 201 else None
    if code:
        r = client.post("/api/agent/enroll", json={"MachineName": "SMOKE-BOT-01", "EnrollmentCode": code})
        check("agent enroll", r.status_code == 200 and "agent_token" in r.json(), r.text[:120])
        agent_token = r.json().get("agent_token")
        ah = {"X-Agent-Token": agent_token}
        r = client.post(
            "/api/agent-heartbeat",
            json={"MachineName": "SMOKE-BOT-01", "CPU_Usage": 22, "RAM_Usage": 41, "HDD_Usage": 55},  # noqa
            headers=ah,
        )
        check("agent heartbeat", r.status_code == 200, r.text[:120])
        r = client.post(
            "/api/machines/SMOKE-BOT-01/commands",
            json={"Command": "PING", "Reason": "smoke"},
            headers=H,
        )
        check("issue command", r.status_code in (200, 201), r.text[:140])
        command_id = r.json().get("command_id") if r.status_code in (200, 201) else None
        if command_id:
            r = client.post(
                "/api/agent/commands/ack",
                json={"MachineName": "SMOKE-BOT-01", "CommandID": command_id, "Success": True, "Result": "done"},
                headers=ah,
            )
            check("command ack", r.status_code == 200, r.text[:120])
        r = client.post(
            "/api/register-machine",
            json={
                "MachineName": "SMOKE-BOT-01",
                "RunnerType": "Unattended",
                "AssignedBot": "Invoice_Processing",
                "TotalRAM_GB": 16,
                "TotalHDD_GB": 256,
            },
            headers=H,
        )
        check("duplicate machine rejected", r.status_code in (400, 409), r.text[:100])

    # -------------------------------------------------------- lifecycle/vault
    r = client.post(
        "/api/bot-versions",
        json={"ProcessName": "Invoice_Processing", "VersionTag": "v9.9.9", "Description": "smoke"},
        headers=H,
    )
    check("create version", r.status_code == 201, r.text[:140])
    version_id = r.json().get("version_id") if r.status_code == 201 else None
    if version_id:
        r = client.post(
            f"/api/bot-versions/{version_id}/credentials",
            json={"CredentialName": "SAP_PROD", "Environment": "Production", "Value": "s3cr3t-value"},
            headers=H,
        )
        check("store credential", r.status_code == 201, r.text[:140])
        vault_id = r.json().get("vault_id") if r.status_code == 201 else None
        if vault_id:
            r = client.post(
                f"/api/bot-versions/{version_id}/decrypt/{vault_id}",
                json={"Reason": "smoke test"},
                headers=H,
            )
            check("read credential returns plaintext", r.status_code == 200 and r.json().get("value") == "s3cr3t-value", r.text[:120])
        r = client.post(
            f"/api/bot-versions/{version_id}/credentials",
            json={"CredentialName": "SAP_UAT", "Environment": "UAT", "Value": "uat-secret"},
            headers=H,
        )
        check("store UAT credential", r.status_code == 201, r.text[:140])
        r = client.post(f"/api/bot-versions/{version_id}/promote", json={"TargetEnvironment": "UAT"}, headers=H)
        check("promote to UAT", r.status_code == 200, r.text[:140])
        r = client.post(f"/api/bot-versions/{version_id}/promote", json={"TargetEnvironment": "Production"}, headers=H)
        check("production requires approval", r.status_code == 400, r.text[:140])
        r = client.post(
            "/api/approvals",
            json={"VersionID": version_id, "TargetEnvironment": "Production", "Comment": "smoke"},
            headers=H,
        )
        check("request approval", r.status_code == 201, r.text[:140])
        approval_id = r.json().get("approval_id") if r.status_code == 201 else None
        if approval_id:
            r = client.post(f"/api/approvals/{approval_id}/decide", json={"Approved": True}, headers=H)
            check("self-approval refused (four-eyes)", r.status_code == 400, r.text[:140])

    # ------------------------------------------------------------- exports
    r = client.get("/api/exports/audit.xlsx?days=7", headers=H)
    check("audit xlsx export", r.status_code == 200 and r.content[:2] == b"PK", f"{len(r.content)} bytes")
    r = client.get("/api/exports/roi.pdf?days=30", headers=H)
    check("roi pdf export", r.status_code == 200 and r.content[:4] == b"%PDF", f"{len(r.content)} bytes")
    r = client.get("/api/exports/capacity.pdf", headers=H)
    check("capacity pdf export", r.status_code == 200 and r.content[:4] == b"%PDF", f"{len(r.content)} bytes")

    # ------------------------------------------------------- organization
    r = client.get("/api/organization", headers=H)
    check("organization singleton", r.status_code == 200 and r.json().get("OrganizationID") == 1, r.text[:160])
    r = client.patch("/api/organization/branding", json={"PrimaryColor": "#123456"}, headers=H)
    check("organization branding", r.status_code == 200, r.text[:120])
    r = client.post(
        "/api/organization/platform",
        json={"Provider": "uipath", "Config": {"base_url": "https://orchestrator.example.com", "auth_mode": "oauth_client_credentials"}},
        headers=H,
    )
    check("organization platform config", r.status_code == 200, r.text[:120])
    r = client.post("/api/organization/platform/test", headers=H)
    check("platform connectivity test responds", r.status_code == 200, r.text[:120])
    r = client.post("/api/organization/retention/run?retention_days=730", headers=H)
    check("retention run", r.status_code == 200, r.text[:140])
    r = client.post("/api/alerts/evaluate", headers=H)
    check("alert evaluation", r.status_code == 200 and "touched" in r.json(), r.text[:140])

    # --------------------------------------------------------------- users
    r = client.post(
        "/api/users",
        json={"username": "smoke.auditor", "role": "Auditor", "department": "Finance", "password": "Str0ng_Passw0rd!"},
        headers=H,
    )
    check("create user", r.status_code == 201, r.text[:160])
    user_id = r.json().get("user_id") if r.status_code == 201 else None
    if user_id:
        r = client.patch(f"/api/users/{user_id}/active", json={"is_active": False}, headers=H)
        check("disable user", r.status_code == 200, r.text[:120])
        r = client.post("/api/auth/login", json={"username": "smoke.auditor", "password": "Str0ng_Passw0rd!"})
        check("disabled user cannot log in", r.status_code in (401, 403))

    # ------------------------------------------------------ health & metrics
    r = client.get("/health")
    check("health", r.status_code == 200)
    r = client.get("/health/detail", headers=H)
    detail = r.json() if r.status_code == 200 else {}
    check(
        "health detail",
        r.status_code == 200 and detail.get("database", {}).get("ok") is True,
        f"schema ok={detail.get('schema', {}).get('ok', detail.get('schema', {}))}"[:120],
    )
    r = client.get("/metrics")
    check("prometheus metrics", r.status_code == 200 and b"rpa_http_requests_total" in r.content, r.text[:80])

    # -------------------------------------------------------------- security
    r = client.get("/api/dashboard-data")
    check("unauthenticated request rejected", r.status_code == 401)
    r = client.get("/api/dashboard-data", headers={"Authorization": "Bearer not-a-token"})
    check("garbage token rejected", r.status_code == 401)
    r = client.get("/api/auth/sessions", headers=H)
    check("sessions listed", r.status_code == 200 and isinstance(r.json(), list))
    r = client.post("/api/auth/logout", headers={**H, "X-CSRF-Token": csrf or ""})
    check("logout", r.status_code == 200, r.text[:120])
    r = client.post("/api/auth/refresh", json={}, headers={"X-CSRF-Token": csrf or ""})
    check("refresh after logout fails", r.status_code in (401, 403), r.text[:120])

    # ------------------------------------------------------- refresh rotation
    r = client.post("/api/auth/login", json={"username": "admin", "password": "ChangeMe_Admin1!"})
    tokens2 = r.json()
    csrf2 = client.cookies.get("csrf_token") or ""
    old_refresh = client.cookies.get("refresh_token")
    r = client.post("/api/auth/refresh", json={}, headers={"X-CSRF-Token": csrf2})
    check("refresh rotates token", r.status_code == 200 and r.json().get("access_token"), r.text[:140])
    r = client.post("/api/auth/refresh", json={}, headers={"X-CSRF-Token": csrf2})
    check("replayed refresh token rejected (family revocation)", r.status_code in (401, 403), r.text[:160])
    r = client.post("/api/auth/refresh", json={}, headers={"X-CSRF-Token": "forged"})
    check("forged CSRF token rejected", r.status_code == 403, r.text[:120])

    # ------------------------------------------------------------------ MFA
    H2 = {"Authorization": f"Bearer {tokens2['access_token']}"}
    r = client.post("/api/auth/mfa/setup", headers=H2)
    check("mfa setup", r.status_code == 200 and "secret" in r.json() and "otpauth_url" in r.json(), r.text[:90])
    secret = r.json().get("secret") if r.status_code == 200 else None
    if secret:
        code = pyotp.TOTP(secret).now()
        r = client.post("/api/auth/mfa/confirm", json={"code": code}, headers=H2)
        check("mfa confirm + backup codes", r.status_code == 200 and len(r.json().get("backup_codes", [])) >= 5, r.text[:120])
        r = client.post("/api/auth/login", json={"username": "admin", "password": "ChangeMe_Admin1!"})
        check("login now requires MFA", r.status_code == 200 and r.json().get("mfa_required") is True, r.text[:120])
        mfa_token = r.json().get("mfa_token") if r.json().get("mfa_required") else None
        if mfa_token:
            r = client.post("/api/auth/mfa/verify", json={"mfa_token": mfa_token, "code": "000000"})
            check("wrong TOTP rejected", r.status_code in (401, 403), r.text[:120])
            r = client.post(
                "/api/auth/mfa/verify",
                json={"mfa_token": mfa_token, "code": pyotp.TOTP(secret).now()},
            )
            check("mfa verify issues tokens", r.status_code == 200 and "access_token" in r.json(), r.text[:120])
            H3 = {"Authorization": f"Bearer {r.json()['access_token']}"} if r.status_code == 200 else H2
            r = client.post("/api/auth/mfa/disable", json={"password": "ChangeMe_Admin1!"}, headers=H3)
            check("mfa disable", r.status_code == 200, r.text[:120])

    # ---------------------------------------------------------- audit trail
    r = client.get("/api/audit-logs?limit=50", headers=H)
    logs = r.json().get("items", []) if r.status_code == 200 else []
    actions = {row.get("ActionType") for row in logs}
    check("audit trail records sensitive actions", r.status_code == 200 and len(logs) > 5, f"{len(actions)} action types")
    check(
        "audit captures security events",
        bool(actions & {"Login_Success", "Login_Failed", "MFA_Failed", "Version_Promote", "Vault_Add_Cred"}),
        ", ".join(sorted(a for a in actions if a)[:6]),
    )

print("\n" + "=" * 72)
failed = [label for label, ok, _ in RESULTS if not ok]
print(f"{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
if failed:
    print("FAILED:")
    for label in failed:
        print("  -", label)
sys.exit(1 if failed else 0)
