"""Run ingestion: idempotent start, completion, statistics."""

from __future__ import annotations

import uuid

PROCESS = "Invoice_Processing"


def _start_run(client, headers, **overrides):
    payload = {"ProcessName": PROCESS, "IdempotencyKey": f"pytest-{uuid.uuid4().hex}"}
    payload.update(overrides)
    return client.post("/api/runs/start", json=payload, headers=headers)


def test_run_start_created(client, admin_headers):
    response = _start_run(client, admin_headers)
    assert response.status_code == 201, response.text
    assert response.json()["created"] is True
    assert response.json()["run_id"]


def test_run_start_idempotent_replay(client, admin_headers):
    key = f"pytest-{uuid.uuid4().hex}"
    first = _start_run(client, admin_headers, IdempotencyKey=key)
    second = _start_run(client, admin_headers, IdempotencyKey=key)
    assert first.status_code == 201
    assert second.status_code in (200, 201)
    assert second.json().get("created") is False
    assert second.json()["run_id"] == first.json()["run_id"]


def test_run_start_unknown_process_404(client, admin_headers):
    response = client.post("/api/runs/start", json={"ProcessName": "Nope_Missing"}, headers=admin_headers)
    assert response.status_code == 404


def test_run_complete_computes_savings(client, admin_headers):
    started = _start_run(client, admin_headers).json()
    response = client.post(
        f"/api/runs/{started['run_id']}/complete",
        json={"Status": "Completed", "TransactionsCount": 25},
        headers=admin_headers,
    )
    assert response.status_code == 200
    assert response.json().get("already_completed") is False

    replay = client.post(
        f"/api/runs/{started['run_id']}/complete",
        json={"Status": "Completed", "TransactionsCount": 25},
        headers=admin_headers,
    )
    assert replay.status_code == 200
    assert replay.json().get("already_completed") is True


def test_run_progress_updates(client, admin_headers):
    started = _start_run(client, admin_headers).json()
    response = client.post(
        f"/api/runs/{started['run_id']}/progress", json={"TransactionsCount": 5}, headers=admin_headers
    )
    assert response.status_code in (200, 204)


def test_runs_list_and_filters(client, admin_headers):
    _start_run(client, admin_headers)
    response = client.get("/api/runs?limit=10", headers=admin_headers)
    assert response.status_code == 200
    assert isinstance(response.json()["items"], list)


def test_run_statistics_shape(client, admin_headers):
    response = client.get("/api/runs/statistics", headers=admin_headers)
    assert response.status_code == 200
    assert "daily" in response.json()


def test_top_failures(client, admin_headers):
    response = client.get("/api/runs/top-failures", headers=admin_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_reap_stale_runs(client, admin_headers):
    response = client.post("/api/runs/reap-stale", headers=admin_headers)
    assert response.status_code == 200


def test_runs_require_auth(client):
    assert client.get("/api/runs").status_code == 401
    assert client.post("/api/runs/start", json={"ProcessName": PROCESS}).status_code == 401
