"""Dashboard payloads + realtime SSE authentication."""

from __future__ import annotations

import threading
import time

import httpx
import pytest


@pytest.fixture(scope="module")
def live_url():
    """Real uvicorn server (TestClient deadlocks on infinite SSE streams)."""
    import uvicorn

    from app.main import app

    config = uvicorn.Config(app, host="127.0.0.1", port=8791, log_level="error")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 30
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    assert server.started
    yield "http://127.0.0.1:8791"
    server.should_exit = True
    thread.join(timeout=10)


def test_dashboard_data_shape(client, admin_headers):
    response = client.get("/api/dashboard-data", headers=admin_headers)
    assert response.status_code == 200
    body = response.json()
    assert "kpis" in body
    assert "capacity" in body
    assert body["scope"]["role"] == "SuperAdmin"


def test_dashboard_kpis_populated_from_demo_seed(client, admin_headers):
    body = client.get("/api/dashboard-data", headers=admin_headers).json()
    assert body["kpis"].get("totalTransactions", 0) > 0


def test_dashboard_process_filter(client, admin_headers):
    response = client.get("/api/dashboard-data?process=Invoice_Processing&days=30", headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["scope"]["process"] == "Invoice_Processing"


def test_dashboard_requires_auth(client):
    assert client.get("/api/dashboard-data").status_code == 401


def test_process_options(client, admin_headers):
    response = client.get("/api/dashboard/process-options", headers=admin_headers)
    assert response.status_code == 200
    assert "Invoice_Processing" in response.json()


def test_sla_summary(client, admin_headers):
    response = client.get("/api/dashboard/sla-summary", headers=admin_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), dict)


def test_backlog_trend(client, admin_headers):
    response = client.get("/api/dashboard/backlog-trend", headers=admin_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_dashboard_refresh_endpoint(client, admin_headers):
    response = client.post("/api/dashboard/refresh", headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["status"] == "success"


def test_sse_with_query_token(live_url, admin_token):
    """EventSource cannot send headers: ?token= must authenticate the stream."""
    with httpx.Client(base_url=live_url, timeout=10) as http:
        with http.stream("GET", f"/api/realtime/events?token={admin_token}") as response:
            assert response.status_code == 200
            assert response.headers["content-type"].startswith("text/event-stream")
            first = next(response.iter_lines())
            assert "connected" in first


def test_sse_with_bearer_header(live_url, admin_headers):
    with httpx.Client(base_url=live_url, timeout=10) as http:
        with http.stream("GET", "/api/realtime/events", headers=admin_headers) as response:
            assert response.status_code == 200
            first = next(response.iter_lines())
            assert "connected" in first


def test_sse_without_token_rejected(live_url):
    with httpx.Client(base_url=live_url, timeout=10) as http:
        with http.stream("GET", "/api/realtime/events") as response:
            assert response.status_code == 401


def test_sse_with_garbage_token_rejected(live_url):
    with httpx.Client(base_url=live_url, timeout=10) as http:
        with http.stream("GET", "/api/realtime/events?token=garbage") as response:
            assert response.status_code == 401


def test_realtime_status(client, admin_headers):
    response = client.get("/api/realtime/status", headers=admin_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), dict)


def test_realtime_broadcast(client, admin_headers):
    response = client.post("/api/realtime/broadcast", json={"reason": "pytest"}, headers=admin_headers)
    assert response.status_code == 200
    assert "delivered" in response.json()
