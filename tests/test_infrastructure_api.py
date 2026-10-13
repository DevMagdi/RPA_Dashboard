"""Infrastructure fleet, agent enrolment, commands and job control."""

from __future__ import annotations

import uuid

PROCESS = "Invoice_Processing"


def _register_machine(client, headers, name=None):
    name = name or f"PYTEST-BOT-{uuid.uuid4().hex[:6]}"
    response = client.post(
        "/api/register-machine",
        json={
            "MachineName": name,
            "RunnerType": "Unattended",
            "AssignedBot": PROCESS,
            "TotalRAM_GB": 16,
            "TotalHDD_GB": 256,
            "RobotCapacity": 1,
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return name, response.json()


def _enrolled_agent(client, headers):
    name, payload = _register_machine(client, headers)
    code = payload.get("enrollment_code")
    assert code
    enrolled = client.post("/api/agent/enroll", json={"MachineName": name, "EnrollmentCode": code})
    assert enrolled.status_code == 200, enrolled.text
    return name, {"X-Agent-Token": enrolled.json()["agent_token"]}


def test_infrastructure_list(client, admin_headers):
    response = client.get("/api/infrastructure", headers=admin_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_infrastructure_summary(client, admin_headers):
    response = client.get("/api/infrastructure/summary", headers=admin_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), dict)


def test_register_machine_returns_enrollment_code(client, admin_headers):
    _name, payload = _register_machine(client, admin_headers)
    assert payload.get("enrollment_code")


def test_duplicate_machine_rejected(client, admin_headers):
    name, _payload = _register_machine(client, admin_headers)
    response = client.post(
        "/api/register-machine",
        json={
            "MachineName": name,
            "RunnerType": "Unattended",
            "AssignedBot": PROCESS,
            "TotalRAM_GB": 16,
            "TotalHDD_GB": 256,
        },
        headers=admin_headers,
    )
    assert response.status_code in (400, 409)


def test_agent_enroll_and_heartbeat(client, admin_headers):
    name, agent_headers = _enrolled_agent(client, admin_headers)
    response = client.post(
        "/api/agent-heartbeat",
        json={"MachineName": name, "CPU_Usage": 22, "RAM_Usage": 41, "HDD_Usage": 55},
        headers=agent_headers,
    )
    assert response.status_code == 200


def test_heartbeat_requires_agent_token(client, admin_headers):
    name, _payload = _register_machine(client, admin_headers)
    response = client.post(
        "/api/agent-heartbeat", json={"MachineName": name, "CPU_Usage": 1, "RAM_Usage": 1, "HDD_Usage": 1}
    )
    assert response.status_code in (401, 403, 422)  # missing agent token header


def test_command_issue_and_ack(client, admin_headers):
    name, agent_headers = _enrolled_agent(client, admin_headers)
    issued = client.post(
        f"/api/machines/{name}/commands", json={"Command": "PING", "Reason": "pytest"}, headers=admin_headers
    )
    assert issued.status_code in (200, 201), issued.text
    command_id = issued.json().get("command_id")
    assert command_id
    ack = client.post(
        "/api/agent/commands/ack",
        json={"MachineName": name, "CommandID": command_id, "Success": True, "Result": "done"},
        headers=agent_headers,
    )
    assert ack.status_code == 200


def test_command_history(client, admin_headers):
    response = client.get("/api/commands?limit=10", headers=admin_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_connected_agents(client, admin_headers):
    response = client.get("/api/agents/connected", headers=admin_headers)
    assert response.status_code == 200


def test_update_machine(client, admin_headers):
    name, _payload = _register_machine(client, admin_headers)
    response = client.post(
        "/api/update-machine",
        params={"machine_name": name},
        json={"AssignedBot": PROCESS, "RobotCapacity": 2},
        headers=admin_headers,
    )
    assert response.status_code in (200, 204)


def test_revoke_and_regenerate_tokens(client, admin_headers):
    name, _payload = _register_machine(client, admin_headers)
    revoked = client.post(f"/api/machines/{name}/revoke-token", headers=admin_headers)
    assert revoked.status_code in (200, 204)
    regenerated = client.post(f"/api/regenerate-enrollment-code/{name}", headers=admin_headers)
    assert regenerated.status_code in (200, 201)


def test_delete_machine(client, admin_headers):
    name, _payload = _register_machine(client, admin_headers)
    response = client.delete(f"/api/machines/{name}", headers=admin_headers)
    assert response.status_code in (200, 204)


# --------------------------------------------------------------------------- #
# Job control (idempotency)
# --------------------------------------------------------------------------- #
def test_start_job_always_returns_external_id(client, admin_headers):
    response = client.post(
        "/api/jobs/start", json={"ProcessName": PROCESS}, headers=admin_headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["external_id"]  # never null for an accepted job


def test_start_job_echoes_idempotency_key(client, admin_headers):
    key = f"order-{uuid.uuid4().hex}"
    response = client.post(
        "/api/jobs/start", json={"ProcessName": PROCESS, "IdempotencyKey": key}, headers=admin_headers
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["idempotency_key"] == key
    assert body["external_id"] == key  # native adapter echoes the key as job id


def test_start_job_unknown_process_404(client, admin_headers):
    response = client.post("/api/jobs/start", json={"ProcessName": "Ghost_Process"}, headers=admin_headers)
    assert response.status_code == 404


def test_stop_job(client, admin_headers):
    started = client.post("/api/jobs/start", json={"ProcessName": PROCESS}, headers=admin_headers).json()
    response = client.post(f"/api/jobs/{started['external_id']}/stop", headers=admin_headers)
    assert response.status_code == 200


def test_jobs_require_permission(client, user_headers):
    response = client.post("/api/jobs/start", json={"ProcessName": PROCESS}, headers=user_headers("Viewer"))
    assert response.status_code == 403


def test_platform_health_and_sync(client, admin_headers):
    assert client.get("/api/platform/health", headers=admin_headers).status_code == 200
    synced = client.post("/api/platform/sync", headers=admin_headers)
    assert synced.status_code in (200, 202)
    assert client.get("/api/platform/sync-history", headers=admin_headers).status_code == 200
