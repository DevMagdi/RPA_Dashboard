"""Platform domain model: status normalisation, timestamps, capabilities."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.platforms.base import (
    CanonicalStatus,
    JobStartRequest,
    RunRecord,
    normalize_status,
    register_status_alias,
    summarize_runs,
    to_utc,
)


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Successful", CanonicalStatus.COMPLETED),
        ("success", CanonicalStatus.COMPLETED),
        ("Completed", CanonicalStatus.COMPLETED),
        ("done", CanonicalStatus.COMPLETED),
        ("Failed", CanonicalStatus.FAILED),
        ("Error", CanonicalStatus.FAILED),
        ("Faulted", CanonicalStatus.FAULTED),
        ("Terminated", CanonicalStatus.STOPPED),
        ("Cancelled", CanonicalStatus.STOPPED),
        ("canceled", CanonicalStatus.STOPPED),
        ("Running", CanonicalStatus.RUNNING),
        ("Executing", CanonicalStatus.RUNNING),
        # Regression: "In Progress" (Automation Anywhere) did not match.
        ("In Progress", CanonicalStatus.RUNNING),
        ("InProgress", CanonicalStatus.RUNNING),
        ("IN_PROGRESS", CanonicalStatus.RUNNING),
        ("in-progress", CanonicalStatus.RUNNING),
        ("In  Progress", CanonicalStatus.RUNNING),
        ("Pending", CanonicalStatus.PENDING),
        ("Queued", CanonicalStatus.PENDING),
        ("New", CanonicalStatus.PENDING),
        ("Paused", CanonicalStatus.SUSPENDED),
        ("On Hold", CanonicalStatus.SUSPENDED),
        ("Abandoned", CanonicalStatus.FAILED),
        ("SomethingNewFromVendor", CanonicalStatus.UNKNOWN),
        ("", CanonicalStatus.UNKNOWN),
        (None, CanonicalStatus.UNKNOWN),
    ],
)
def test_normalize_status(raw, expected):
    assert normalize_status(raw) is expected


def test_normalize_status_passthrough_enum():
    assert normalize_status(CanonicalStatus.FAILED) is CanonicalStatus.FAILED


def test_register_status_alias():
    register_status_alias("Vendor Weird State", CanonicalStatus.SUSPENDED)
    assert normalize_status("vendor-weird-state") is CanonicalStatus.SUSPENDED
    assert normalize_status("Vendor Weird State") is CanonicalStatus.SUSPENDED


@pytest.mark.parametrize(
    "raw",
    ["2026-01-02T03:04:05Z", "2026-01-02 03:04:05", "01/02/2026 03:04:05"],
)
def test_to_utc_iso_variants(raw):
    parsed = to_utc(raw)
    assert parsed == datetime(2026, 1, 2, 3, 4, 5)
    assert parsed.tzinfo is None


def test_to_utc_epoch_millis():
    ts = datetime(2026, 1, 2, tzinfo=timezone.utc).timestamp()
    assert to_utc(ts * 1000) == datetime(2026, 1, 2)


def test_to_utc_epoch_seconds():
    ts = datetime(2026, 1, 2, tzinfo=timezone.utc).timestamp()
    assert to_utc(int(ts)) == datetime(2026, 1, 2)


def test_to_utc_aware_datetime_converted():
    aware = datetime(2026, 1, 2, 5, 0, tzinfo=timezone.utc)
    assert to_utc(aware) == datetime(2026, 1, 2, 5, 0)


@pytest.mark.parametrize("raw", [None, "", "not-a-date"])
def test_to_utc_unparseable(raw):
    assert to_utc(raw) is None


def test_run_record_computed_duration():
    run = RunRecord(
        external_id="1",
        process_key="p",
        status=CanonicalStatus.COMPLETED,
        started_at=datetime(2026, 1, 1, 10, 0),
        finished_at=datetime(2026, 1, 1, 10, 30),
    )
    assert run.computed_duration() == 30.0
    explicit = RunRecord(external_id="2", process_key="p", status=CanonicalStatus.COMPLETED, duration_minutes=7.5)
    assert explicit.computed_duration() == 7.5
    bare = RunRecord(external_id="3", process_key="p", status=CanonicalStatus.RUNNING)
    assert bare.computed_duration() is None


def test_summarize_runs():
    runs = [
        RunRecord(external_id="1", process_key="p", status=CanonicalStatus.COMPLETED),
        RunRecord(external_id="2", process_key="p", status=CanonicalStatus.COMPLETED),
        RunRecord(external_id="3", process_key="p", status=CanonicalStatus.FAILED),
    ]
    assert summarize_runs(runs) == {"Completed": 2, "Failed": 1}
    assert summarize_runs([]) == {}


def test_job_start_request_defaults():
    request = JobStartRequest(process_key="Invoice_Processing")
    assert request.machine_keys == []
    assert request.arguments == {}
    assert request.priority == "Normal"
    assert request.idempotency_key is None
