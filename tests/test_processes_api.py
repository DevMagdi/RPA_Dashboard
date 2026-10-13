"""Processes: ROI/SLA configuration, soft-delete semantics, queue telemetry."""

from __future__ import annotations

import uuid

PROCESS = "Invoice_Processing"  # part of the seeded demo dataset


def _new_process(client, headers) -> str:
    name = f"Pytest_Process_{uuid.uuid4().hex[:8]}"
    response = client.post(
        "/api/update-roi",
        json={
            "ProcessName": name,
            "EmpMinutesPerRequest": 9,
            "EmpCostPerRequest": 14,
            "BotCostPerRequest": 0.4,
            "ExpectedRunsPerDay": 10,
            "Department": "Finance",
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return name


def test_list_processes(client, admin_headers):
    response = client.get("/api/processes", headers=admin_headers)
    assert response.status_code == 200
    names = {p.get("ProcessName") for p in response.json()["items"]}
    assert PROCESS in names


def test_processes_require_auth(client):
    assert client.get("/api/processes").status_code == 401


def test_get_process_detail(client, admin_headers):
    response = client.get(f"/api/processes/{PROCESS}", headers=admin_headers)
    assert response.status_code == 200


def test_get_missing_process_404(client, admin_headers):
    assert client.get("/api/processes/Nope_Missing_Process", headers=admin_headers).status_code == 404


def test_update_roi_creates_then_updates(client, admin_headers):
    name = _new_process(client, admin_headers)
    again = client.post(
        "/api/update-roi",
        json={
            "ProcessName": name,
            "EmpMinutesPerRequest": 5,
            "EmpCostPerRequest": 10,
            "BotCostPerRequest": 0.2,
            "ExpectedRunsPerDay": 20,
        },
        headers=admin_headers,
    )
    assert again.status_code == 200
    assert again.json()["created"] is False


def test_update_roi_validation(client, admin_headers):
    response = client.post(
        "/api/update-roi",
        json={"ProcessName": "X", "EmpMinutesPerRequest": -1, "EmpCostPerRequest": 1, "BotCostPerRequest": 1, "ExpectedRunsPerDay": 1},
        headers=admin_headers,
    )
    assert response.status_code == 422


def test_update_sla_full_payload(client, admin_headers):
    response = client.post(
        "/api/update-sla",
        json={"ProcessName": PROCESS, "SLATargetMinutes": 25, "AvgItemProcessingSeconds": 45, "SLAWarningRatio": 0.8},
        headers=admin_headers,
    )
    assert response.status_code == 200


def test_update_sla_partial_target_only(client, admin_headers):
    """Regression: SLA fields are optional — target-only updates must work."""
    _new_process(client, admin_headers)
    name = _new_process(client, admin_headers)
    response = client.post(
        "/api/update-sla", json={"ProcessName": name, "SLATargetMinutes": 40}, headers=admin_headers
    )
    assert response.status_code == 200, response.text


def test_update_sla_partial_processing_only(client, admin_headers):
    name = _new_process(client, admin_headers)
    response = client.post(
        "/api/update-sla", json={"ProcessName": name, "AvgItemProcessingSeconds": 90}, headers=admin_headers
    )
    assert response.status_code == 200, response.text


def test_update_sla_missing_process_rejected(client, admin_headers):
    response = client.post(
        "/api/update-sla", json={"ProcessName": "Ghost_Process", "SLATargetMinutes": 10}, headers=admin_headers
    )
    assert response.status_code == 400


def test_set_active_toggle(client, admin_headers):
    name = _new_process(client, admin_headers)
    off = client.patch(f"/api/processes/{name}/active", json={"IsActive": False}, headers=admin_headers)
    assert off.status_code == 200 and off.json()["is_active"] is False
    on = client.patch(f"/api/processes/{name}/active", json={"IsActive": True}, headers=admin_headers)
    assert on.status_code == 200 and on.json()["is_active"] is True


def test_soft_delete_then_second_delete_404(client, admin_headers):
    """Regression: repeating a soft delete returned success; it must 404."""
    name = _new_process(client, admin_headers)
    first = client.delete(f"/api/processes/{name}", headers=admin_headers)
    assert first.status_code == 200
    second = client.delete(f"/api/processes/{name}", headers=admin_headers)
    assert second.status_code == 404


def test_soft_deleted_process_hidden_from_list(client, admin_headers):
    name = _new_process(client, admin_headers)
    assert client.delete(f"/api/processes/{name}", headers=admin_headers).status_code == 200
    names = {p.get("ProcessName") for p in client.get("/api/processes", headers=admin_headers).json()["items"]}
    assert name not in names


def test_delete_missing_process_404(client, admin_headers):
    assert client.delete("/api/processes/Ghost_Process_XYZ", headers=admin_headers).status_code == 404


def test_queue_telemetry_ingest(client, admin_headers):
    response = client.post(
        "/api/queues/telemetry",
        json={"ProcessName": PROCESS, "PendingItems": 12, "ActiveItems": 3, "AvgItemProcessingSeconds": 42},
        headers=admin_headers,
    )
    assert response.status_code in (200, 201)


def test_departments_meta(client, admin_headers):
    response = client.get("/api/processes-meta/departments", headers=admin_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_roi_summary(client, admin_headers):
    response = client.get("/api/processes-meta/roi-summary?days=30", headers=admin_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list) and response.json()


def test_viewer_cannot_write_roi(client, user_headers):
    response = client.post(
        "/api/update-roi",
        json={
            "ProcessName": "Viewer_Should_Fail",
            "EmpMinutesPerRequest": 1,
            "EmpCostPerRequest": 1,
            "BotCostPerRequest": 1,
            "ExpectedRunsPerDay": 1,
        },
        headers=user_headers("Viewer"),
    )
    assert response.status_code == 403
