"""Health, lifecycle & vault, approvals, exports, audit, notifications."""

from __future__ import annotations


def test_health_liveness(client):
    response = client.get("/health")
    assert response.status_code == 200


def test_health_detail(client, admin_headers):
    response = client.get("/health/detail", headers=admin_headers)
    assert response.status_code == 200
    assert response.json().get("database", {}).get("ok") is True


def test_health_ready(client):
    assert client.get("/health/ready").status_code == 200


def test_version_endpoint(client):
    response = client.get("/api/version")
    assert response.status_code == 200
    body = response.json()
    assert body["version"] == "3.0.0"
    assert body["features"]["multi_tenant"] is True
    assert body["features"]["multi_vendor"] is True


def test_metrics_endpoint(client):
    response = client.get("/metrics")
    assert response.status_code == 200
    assert b"rpa_http_requests_total" in response.content


def test_security_headers_present(client):
    response = client.get("/health")
    assert response.headers.get("x-content-type-options") == "nosniff"
    assert "content-security-policy" in {k.lower() for k in response.headers}


def test_correlation_id_header(client):
    response = client.get("/health")
    assert response.headers.get("x-correlation-id")


# --------------------------------------------------------------------------- #
# Lifecycle & vault
# --------------------------------------------------------------------------- #
def _create_version(client, headers):
    import uuid

    response = client.post(
        "/api/bot-versions",
        json={
            "ProcessName": "Invoice_Processing",
            "VersionTag": f"v-test-{uuid.uuid4().hex[:6]}",
            "Description": "pytest",
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()["version_id"]


def test_create_version_and_history(client, admin_headers):
    _create_version(client, admin_headers)
    response = client.get("/api/bot-versions/Invoice_Processing/history", headers=admin_headers)
    assert response.status_code == 200


def test_list_versions(client, admin_headers):
    response = client.get("/api/bot-versions", headers=admin_headers)
    assert response.status_code == 200


def test_credential_vault_roundtrip(client, admin_headers):
    version_id = _create_version(client, admin_headers)
    stored = client.post(
        f"/api/bot-versions/{version_id}/credentials",
        json={"CredentialName": "SAP_PROD", "Environment": "Production", "Value": "s3cr3t-value"},
        headers=admin_headers,
    )
    assert stored.status_code == 201, stored.text
    vault_id = stored.json()["vault_id"]

    read = client.post(
        f"/api/bot-versions/{version_id}/decrypt/{vault_id}", json={"Reason": "pytest"}, headers=admin_headers
    )
    assert read.status_code == 200
    assert read.json()["value"] == "s3cr3t-value"

    listing = client.get(f"/api/bot-versions/{version_id}/credentials", headers=admin_headers)
    assert listing.status_code == 200
    assert "s3cr3t-value" not in listing.text  # listings never leak plaintext


def test_promote_to_uat_and_production_gate(client, admin_headers):
    version_id = _create_version(client, admin_headers)
    uat = client.post(
        f"/api/bot-versions/{version_id}/promote", json={"TargetEnvironment": "UAT"}, headers=admin_headers
    )
    assert uat.status_code == 200
    production = client.post(
        f"/api/bot-versions/{version_id}/promote", json={"TargetEnvironment": "Production"}, headers=admin_headers
    )
    assert production.status_code == 400  # requires an approval first (four-eyes)


def test_approval_four_eyes(client, admin_headers, create_user, login):
    version_id = _create_version(client, admin_headers)
    # Lifecycle path is Development -> UAT -> Production: promote first.
    promoted = client.post(
        f"/api/bot-versions/{version_id}/promote", json={"TargetEnvironment": "UAT"}, headers=admin_headers
    )
    assert promoted.status_code == 200, promoted.text
    requested = client.post(
        "/api/approvals",
        json={"VersionID": version_id, "TargetEnvironment": "Production", "Comment": "pytest"},
        headers=admin_headers,
    )
    assert requested.status_code == 201, requested.text
    approval_id = requested.json()["approval_id"]

    self_decision = client.post(
        f"/api/approvals/{approval_id}/decide", json={"Approved": True}, headers=admin_headers
    )
    assert self_decision.status_code == 400  # requester cannot approve own request

    approver = create_user(role="CoE_Manager", department="ALL")
    approver_headers = login(approver["username"], approver["password"])
    decided = client.post(
        f"/api/approvals/{approval_id}/decide", json={"Approved": True}, headers=approver_headers
    )
    assert decided.status_code == 200, decided.text


def test_approvals_list(client, admin_headers):
    response = client.get("/api/approvals", headers=admin_headers)
    assert response.status_code == 200


def test_live_status(client, admin_headers):
    assert client.get("/api/bot-versions/live-status", headers=admin_headers).status_code == 200


def test_vault_statistics_and_delete(client, admin_headers):
    version_id = _create_version(client, admin_headers)
    stored = client.post(
        f"/api/bot-versions/{version_id}/credentials",
        json={"CredentialName": "TEMP", "Environment": "UAT", "Value": "x"},
        headers=admin_headers,
    )
    vault_id = stored.json()["vault_id"]
    assert client.get("/api/vault/statistics", headers=admin_headers).status_code == 200
    assert client.delete(f"/api/vault/{vault_id}", headers=admin_headers).status_code in (200, 204)


# --------------------------------------------------------------------------- #
# Exports / audit / notifications
# --------------------------------------------------------------------------- #
def test_audit_xlsx_export(client, admin_headers):
    response = client.get("/api/exports/audit.xlsx?days=7", headers=admin_headers)
    assert response.status_code == 200
    assert response.content[:2] == b"PK"


def test_runs_xlsx_export(client, admin_headers):
    response = client.get("/api/exports/runs.xlsx?days=7", headers=admin_headers)
    assert response.status_code == 200
    assert response.content[:2] == b"PK"


def test_roi_pdf_export(client, admin_headers):
    response = client.get("/api/exports/roi.pdf?days=30", headers=admin_headers)
    assert response.status_code == 200
    assert response.content[:4] == b"%PDF"


def test_capacity_pdf_export(client, admin_headers):
    response = client.get("/api/exports/capacity.pdf", headers=admin_headers)
    assert response.status_code == 200
    assert response.content[:4] == b"%PDF"


def test_audit_logs_record_actions(client, admin_headers):
    response = client.get("/api/audit-logs?limit=50", headers=admin_headers)
    assert response.status_code == 200
    items = response.json().get("items", [])
    assert len(items) > 5


def test_audit_summary(client, admin_headers):
    response = client.get("/api/audit-logs/summary", headers=admin_headers)
    assert response.status_code == 200


def test_notifications_endpoints(client, admin_headers):
    assert client.get("/api/notifications", headers=admin_headers).status_code == 200
    assert client.get("/api/notifications/statistics", headers=admin_headers).status_code == 200
    assert client.post("/api/notifications/test", json={}, headers=admin_headers).status_code in (200, 400, 503)


def test_exports_require_auth(client):
    assert client.get("/api/exports/audit.xlsx").status_code == 401


# --------------------------------------------------------------------------- #
# Service-layer units: sync, scheduler, notifications, realtime hub
# --------------------------------------------------------------------------- #
def test_sync_tenant_and_history(client):  # client bootstraps the DB
    from app.services import sync_service

    result = sync_service.sync_tenant(1)
    assert result["ok"] is True
    assert result["provider"] == "generic_sql"  # native provider: already local
    history = sync_service.sync_history(1, limit=5)
    assert isinstance(history, list)


def test_scheduler_housekeeping_jobs(client):
    from app.services.scheduler import Scheduler

    scheduler = Scheduler()
    status = scheduler.status()
    assert isinstance(status, dict)
    assert isinstance(scheduler._reap_runs(), dict)
    assert isinstance(scheduler._sweep_commands(), dict)
    assert isinstance(scheduler._housekeeping(), dict)
    retention = scheduler._retention()
    assert isinstance(retention, dict)


async def test_scheduler_platform_sync_and_capacity(client):
    from app.services.scheduler import Scheduler

    scheduler = Scheduler()
    synced = await scheduler._platform_sync()
    assert isinstance(synced, dict)
    capacity = await scheduler._capacity_refresh()
    assert isinstance(capacity, dict)


async def test_scheduler_start_stop(client):
    from app.services.scheduler import Scheduler

    scheduler = Scheduler()
    await scheduler.start()
    await scheduler.stop()


def test_notification_service_units(client):
    from app.db.session import session_scope
    from app.services import notification_service

    with session_scope() as session:
        stats = notification_service.notification_statistics(session, tenant_id=1)
        assert isinstance(stats, dict)
        listed = notification_service.list_notifications(session, tenant_id=1, limit=5)
        assert isinstance(listed, list)
        test_result = notification_service.send_test_notification(session, tenant_id=1)
        assert isinstance(test_result, dict)
        sent = notification_service.notify(
            session,
            tenant_id=1,
            subject="Pytest notification",
            body="coverage",
            severity="Info",
            dedupe_key="pytest:unit",
            force=True,
        )
        assert isinstance(sent, dict)


async def test_realtime_hub_publish_and_snapshot():
    from app.services.realtime import RealtimeHub

    hub = RealtimeHub()
    delivered = await hub.publish("data_changed", {"reason": "pytest"}, tenant_id=1)
    assert delivered == 0  # no subscribers yet
    snapshot = hub.snapshot()
    assert isinstance(snapshot, dict)
    await hub.close_all()


async def test_realtime_hub_sse_subscribe_receives_connected():
    import asyncio

    from app.services.realtime import RealtimeHub

    hub = RealtimeHub()
    stream = hub.subscribe_sse(subscriber_id="t:1:x", tenant_id=1, user_id=1, department="ALL", role="SuperAdmin")
    first = await asyncio.wait_for(stream.__anext__(), timeout=5)
    assert "connected" in first
    await hub.publish("kpi", {"value": 1}, tenant_id=1)
    second = await asyncio.wait_for(stream.__anext__(), timeout=5)
    assert "kpi" in second
    await stream.aclose()
    await hub.close_all()


def test_agent_websocket_rejects_bad_token(client, admin_headers):
    name = f"WS-BOT-{id(client) % 10000}"
    client.post(
        "/api/register-machine",
        json={
            "MachineName": name,
            "RunnerType": "Unattended",
            "AssignedBot": "Invoice_Processing",
            "TotalRAM_GB": 8,
            "TotalHDD_GB": 128,
        },
        headers=admin_headers,
    )
    from starlette.websockets import WebSocketDisconnect

    try:
        with client.websocket_connect(f"/ws/agent/{name}?token=forged") as ws:
            ws.receive_text()
        raise AssertionError("websocket should have been rejected")
    except WebSocketDisconnect:
        pass  # rejected with 1008 as designed


def _enrolled_ws_agent(client, admin_headers):
    import uuid as _uuid

    name = f"WS-BOT-{_uuid.uuid4().hex[:6]}"
    registered = client.post(
        "/api/register-machine",
        json={
            "MachineName": name,
            "RunnerType": "Unattended",
            "AssignedBot": "Invoice_Processing",
            "TotalRAM_GB": 8,
            "TotalHDD_GB": 128,
        },
        headers=admin_headers,
    )
    code = registered.json()["enrollment_code"]
    enrolled = client.post("/api/agent/enroll", json={"MachineName": name, "EnrollmentCode": code})
    return name, enrolled.json()["agent_token"]


def test_agent_websocket_heartbeat_flow(client, admin_headers):
    import json as _json

    name, token = _enrolled_ws_agent(client, admin_headers)
    with client.websocket_connect(f"/ws/agent/{name}?token={token}") as ws:
        ws.send_text(_json.dumps({"type": "heartbeat", "CPU_Usage": 10, "RAM_Usage": 20, "HDD_Usage": 30}))
        ws.send_text(_json.dumps({"type": "command_ack", "command_id": 0, "success": True, "result": "ok"}))
        ws.send_text("not-json")  # malformed frames are ignored, socket stays up
    # After disconnect the machine is marked offline (no exception = clean close)


def test_vault_rotate_key_dry_run(client, admin_headers):
    response = client.post("/api/vault/rotate-key?dry_run=true", headers=admin_headers)
    assert response.status_code == 200


def test_rollback_requires_existing_version(client, admin_headers):
    response = client.post(
        "/api/bot-versions/rollback",
        json={"ProcessName": "Invoice_Processing", "ToVersionID": 999999, "Reason": "pytest"},
        headers=admin_headers,
    )
    assert response.status_code == 400


def test_notify_capacity_recommendations_unit(client):
    from app.db.session import session_scope
    from app.services import notification_service

    with session_scope() as session:
        count = notification_service.notify_capacity_recommendations(
            session,
            tenant_id=1,
            recommendations=[{"ProcessName": "Invoice_Processing", "Kind": "add_runner", "Severity": "Warning"}],
        )
        assert isinstance(count, int)


def test_resolve_tenant_header_rules(client, admin_headers, user_headers):
    from app.api.deps import platform_tenant_id
    from app.db.session import session_scope

    with session_scope() as session:
        assert platform_tenant_id(session) == 1
