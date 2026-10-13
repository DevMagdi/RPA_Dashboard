"""Vendor adapters: payload mapping, queue stats, registry catalogue."""

from __future__ import annotations

import pytest

from app.platforms.base import CanonicalStatus, JobStartRequest
from app.platforms.generic_sql import GenericSQLAdapter
from app.platforms.registry import available_providers


class StubUiPath:
    """UiPath adapter with the HTTP layer stubbed out."""

    @staticmethod
    def make(items):
        from app.platforms.uipath import UiPathOrchestratorAdapter

        adapter = UiPathOrchestratorAdapter({"base_url": "https://orchestrator.example.com"})
        adapter.request = lambda method, path, params=None, json_body=None: {"value": items}  # type: ignore[method-assign]
        return adapter


class StubAA:
    @staticmethod
    def make(items):
        from app.platforms.automation_anywhere import AutomationAnywhereAdapter

        adapter = AutomationAnywhereAdapter({"base_url": "https://aa.example.com"})
        adapter.request = lambda method, path, params=None, json_body=None: {"list": items}  # type: ignore[method-assign]
        return adapter


# --------------------------------------------------------------------------- #
# Registry catalogue (class-level CAPABILITIES — no credentials needed)
# --------------------------------------------------------------------------- #
def test_provider_catalogue_without_credentials():
    catalogue = {row["provider"]: row for row in available_providers()}
    assert set(catalogue) == {"generic_sql", "uipath", "automation_anywhere"}
    for row in catalogue.values():
        assert row["capabilities"], f"empty capabilities for {row['provider']}"
        assert row["display_name"]
    assert catalogue["uipath"]["capabilities"]["start_job"] is True
    assert catalogue["automation_anywhere"]["capabilities"]["stop_job"] is True
    assert catalogue["generic_sql"]["capabilities"]["queue_items"] is False


def test_http_adapters_instantiable_without_credentials():
    """Regression: instantiating a vendor adapter with {} used to raise."""
    from app.platforms.automation_anywhere import AutomationAnywhereAdapter
    from app.platforms.uipath import UiPathOrchestratorAdapter

    assert UiPathOrchestratorAdapter({}).capabilities()["read_runs"] is True
    assert AutomationAnywhereAdapter({}).capabilities()["read_machines"] is True


def test_capabilities_are_class_level_and_copied():
    from app.platforms.uipath import UiPathOrchestratorAdapter

    caps = UiPathOrchestratorAdapter({}).capabilities()
    caps["start_job"] = False  # mutating the copy must not poison the class
    assert UiPathOrchestratorAdapter.CAPABILITIES["start_job"] is True


# --------------------------------------------------------------------------- #
# UiPath mapping
# --------------------------------------------------------------------------- #
def test_uipath_job_mapping():
    adapter = StubUiPath.make(
        [
            {
                "Key": "job-1",
                "State": "Successful",
                "StartTime": "2026-01-01T10:00:00Z",
                "EndTime": "2026-01-01T10:05:00Z",
                "Release": {"Key": "rel-1", "Name": "Invoice_Processing"},
                "Robot": {"Name": "BOT-01"},
            },
            {"Key": "job-2", "State": "Faulted", "Release": {"Name": "KYC"}, "Robot": {}},
        ]
    )
    runs = adapter.get_runs()
    assert runs[0].external_id == "job-1"
    assert runs[0].status is CanonicalStatus.COMPLETED
    assert runs[0].computed_duration() == 5.0
    assert runs[1].status is CanonicalStatus.FAULTED


@pytest.mark.parametrize(
    "vendor_status,pending,active,failed",
    [
        ("New", 1, 0, 0),
        # Regression: queue items written as "In Progress" were not counted active.
        ("In Progress", 0, 1, 0),
        ("InProgress", 0, 1, 0),
        ("Failed", 0, 0, 1),
        ("Abandoned", 0, 0, 1),
        ("Successful", 0, 0, 0),
    ],
)
def test_uipath_queue_stats_status_buckets(vendor_status, pending, active, failed):
    adapter = StubUiPath.make(
        [{"Status": vendor_status, "QueueDefinition": {"Name": "Invoices"}, "CreationTime": "2026-01-01T10:00:00Z"}]
    )
    stats = adapter.get_queue_stats()
    assert len(stats) == 1
    assert (stats[0].pending, stats[0].active, stats[0].failed) == (pending, active, failed)


# --------------------------------------------------------------------------- #
# Automation Anywhere mapping
# --------------------------------------------------------------------------- #
def test_aa_run_mapping_in_progress():
    adapter = StubAA.make(
        [
            {
                "id": "dep-9",
                "automationName": "Invoice_Processing",
                "status": "In Progress",
                "startDateTime": "2026-01-01T09:00:00Z",
                "deviceName": "RUNNER-02",
            },
            {"id": "dep-10", "automationName": "KYC", "status": "Completed"},
        ]
    )
    runs = adapter.get_runs()
    assert runs[0].status is CanonicalStatus.RUNNING  # "In Progress" must match
    assert runs[0].machine_name == "RUNNER-02"
    assert runs[1].status is CanonicalStatus.COMPLETED


# --------------------------------------------------------------------------- #
# Native (generic SQL) adapter control actions
# --------------------------------------------------------------------------- #
def test_generic_sql_start_job_always_returns_external_id():
    adapter = GenericSQLAdapter({"tenant_id": 1})
    without_key = adapter.start_job(JobStartRequest(process_key="Invoice_Processing"))
    assert without_key.accepted
    assert without_key.external_id  # never None for an accepted job
    assert without_key.external_id.startswith("job-")

    with_key = adapter.start_job(JobStartRequest(process_key="P", idempotency_key="order-123"))
    assert with_key.external_id == "order-123"


def test_generic_sql_stop_job():
    adapter = GenericSQLAdapter({"tenant_id": 1})
    handle = adapter.stop_job("job-abc")
    assert handle.accepted
    assert handle.external_id == "job-abc"
    assert handle.status is CanonicalStatus.STOPPED


# --------------------------------------------------------------------------- #
# HTTP plumbing (auth strategies, retry/error mapping, envelope unwrapping)
# --------------------------------------------------------------------------- #
import httpx as _httpx

from app.platforms.automation_anywhere import AutomationAnywhereAdapter
from app.platforms.http_base import (
    HttpAdapterConfig,
    PlatformAuthError,
    PlatformUnavailable,
)
from app.platforms.uipath import UiPathOrchestratorAdapter


def _mock_adapter(monkeypatch, handler, **config):
    adapter = UiPathOrchestratorAdapter({"base_url": "https://orch.example.com", "max_retries": 0, **config})
    transport = _httpx.MockTransport(handler)
    monkeypatch.setattr(adapter, "_client", lambda: _httpx.Client(transport=transport))
    return adapter


def test_http_config_from_dict_splits_extra():
    config = HttpAdapterConfig.from_dict({"base_url": "https://x", "timeout": 5, "custom_key": 1})
    assert config.base_url == "https://x"
    assert config.timeout == 5
    assert config.extra == {"custom_key": 1}


def test_http_config_defaults_without_credentials():
    config = HttpAdapterConfig.from_dict({})
    assert config.base_url == ""  # instantiable with zero credentials
    assert config.auth_mode == "bearer"


def test_request_success(monkeypatch):
    adapter = _mock_adapter(monkeypatch, lambda req: _httpx.Response(200, json={"value": [1, 2]}))
    assert adapter.request("GET", "/odata/Jobs") == {"value": [1, 2]}


def test_request_auth_error(monkeypatch):
    adapter = _mock_adapter(monkeypatch, lambda req: _httpx.Response(401, text="bad credentials"))
    with pytest.raises(PlatformAuthError):
        adapter.request("GET", "/odata/Jobs")


def test_request_server_error_unavailable(monkeypatch):
    adapter = _mock_adapter(monkeypatch, lambda req: _httpx.Response(503, text="down"))
    with pytest.raises(PlatformUnavailable):
        adapter.request("GET", "/odata/Jobs")


def test_request_client_error_runtime(monkeypatch):
    adapter = _mock_adapter(monkeypatch, lambda req: _httpx.Response(404, text="missing"))
    with pytest.raises(RuntimeError):
        adapter.request("GET", "/odata/Jobs")


def test_request_no_content(monkeypatch):
    adapter = _mock_adapter(monkeypatch, lambda req: _httpx.Response(204))
    assert adapter.request("POST", "/x") == {}


def test_request_network_error(monkeypatch):
    def handler(req):
        raise _httpx.ConnectError("refused", request=req)

    adapter = _mock_adapter(monkeypatch, handler)
    with pytest.raises(PlatformUnavailable):
        adapter.request("GET", "/odata/Jobs")


def test_auth_headers_bearer_and_api_key():
    bearer = UiPathOrchestratorAdapter({"base_url": "https://x", "auth_mode": "bearer", "token": "tok-1"})
    assert bearer._auth_headers().get("Authorization") == "Bearer tok-1"
    keyed = UiPathOrchestratorAdapter({"base_url": "https://x", "auth_mode": "api_key", "api_key": "k-1"})
    headers = keyed._auth_headers()
    assert headers.get("Authorization") == "Bearer k-1"


@pytest.mark.parametrize(
    "payload,keys,expected",
    [
        ([1, 2], (), [1, 2]),
        ({"value": [1]}, (), [1]),
        ({"data": {"items": [3]}}, (), [3]),
        ({"list": [9]}, ("list",), [9]),
        ({"nope": 1}, (), []),
        ("garbage", (), []),
    ],
)
def test_unwrap_list(payload, keys, expected):
    assert UiPathOrchestratorAdapter.unwrap_list(payload, *keys) == expected


# --------------------------------------------------------------------------- #
# Vendor adapters: remaining mapped surfaces (stubbed HTTP)
# --------------------------------------------------------------------------- #
def test_uipath_processes_and_machines():
    adapter = StubUiPath.make(
        [
            {"Key": "rel-1", "Name": "Invoice_Processing", "IsLatestVersion": True},
            {"Key": "rel-2", "Name": "Old_Process", "IsLatestVersion": False, "IsDeleted": True},
        ]
    )
    processes = adapter.get_processes()
    assert [p.key for p in processes] == ["rel-1", "rel-2"]

    machines_adapter = StubUiPath.make([{"Id": 5, "Name": "BOT-01", "RobotVersionsCount": 2}])
    machines = machines_adapter.get_machines()
    assert machines[0].name == "BOT-01"
    assert machines[0].status == "Online"


def test_uipath_queue_items_and_bots():
    adapter = StubUiPath.make(
        [{"Id": 11, "Status": "InProgress", "Priority": "High", "Reference": "INV-1", "CreationTime": "2026-01-01T00:00:00Z"}]
    )
    items = adapter.get_queue_items(process_key="Invoices")
    assert items[0].item_id == "11"
    assert items[0].reference == "INV-1"

    bots_adapter = StubUiPath.make([{"Name": "BOT-01", "State": "Available"}])
    bots = bots_adapter.get_bot_status()
    assert bots  # mapped without error


def test_uipath_start_and_stop_job(monkeypatch):
    adapter = UiPathOrchestratorAdapter({"base_url": "https://orch.example.com"})
    adapter.request = lambda method, path, params=None, json_body=None: {"value": [{"Id": 77}]}  # type: ignore[method-assign]
    handle = adapter.start_job(JobStartRequest(process_key="rel-1", machine_keys=["1"]))
    assert handle.accepted

    adapter.request = lambda method, path, params=None, json_body=None: {}  # type: ignore[method-assign]
    stopped = adapter.stop_job("77")
    assert stopped.accepted
    assert stopped.status is CanonicalStatus.STOPPED


def test_aa_processes_machines_bots():
    adapter = StubAA.make(
        [{"id": 3, "name": "Invoice_Processing", "status": "published", "path": "/bots/invoice"}]
    )
    processes = adapter.get_processes()
    assert processes[0].name == "Invoice_Processing"
    assert processes[0].is_active

    machines_adapter = StubAA.make([{"id": 8, "hostName": "RUNNER-01", "status": "CONNECTED"}])
    machines = machines_adapter.get_machines()
    assert machines[0].status == "Online"

    bots = StubAA.make([{"id": 8, "status": "connected"}]).get_bot_status()
    assert bots[0].status == "Online"


def test_aa_queue_stats_and_items():
    adapter = StubAA.make([{"id": 1, "status": "In Progress"}])
    items = adapter.get_queue_items(process_key="Invoice_Processing")
    assert isinstance(items, list)


def test_aa_start_and_stop_job():
    adapter = AutomationAnywhereAdapter({"base_url": "https://aa.example.com"})
    adapter.request = lambda method, path, params=None, json_body=None: {"deploymentId": "dep-1"}  # type: ignore[method-assign]
    handle = adapter.start_job(JobStartRequest(process_key="42"))
    assert handle.accepted and handle.external_id == "dep-1"

    adapter.request = lambda method, path, params=None, json_body=None: {}  # type: ignore[method-assign]
    stopped = adapter.stop_job("dep-1")
    assert stopped.status is CanonicalStatus.STOPPED


# --------------------------------------------------------------------------- #
# Native adapter reads against the seeded database
# --------------------------------------------------------------------------- #
def test_generic_sql_reads_seeded_data(client):  # client bootstraps the DB
    adapter = GenericSQLAdapter({"tenant_id": 1})
    processes = adapter.get_processes()
    assert any(p.name == "Invoice_Processing" for p in processes)
    runs = adapter.get_runs(limit=5)
    assert runs
    queues = adapter.get_queue_stats()
    assert isinstance(queues, list)
    machines = adapter.get_machines()
    assert isinstance(machines, list)
    bots = adapter.get_bot_status()
    assert isinstance(bots, list)
    health = adapter.health()
    assert health.provider == "generic_sql"
