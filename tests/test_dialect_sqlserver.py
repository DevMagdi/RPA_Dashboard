"""SQL Server reserved-keyword regression tests.

``Trigger`` is a reserved keyword in T-SQL, so raw SQL selecting
``r.Trigger`` unquoted raises ``Incorrect syntax near the keyword
'Trigger'`` on SQL Server while passing on SQLite/PostgreSQL.  These tests
compile the dashboard "recent runs" and runs-list queries through each
supported flavor and pin the quoting, plus they guard the audit that no
other raw SQL in ``app/`` references the reserved column unquoted.
"""

from __future__ import annotations

import pathlib
import re

import pytest

from app.db.dialect import SqlFlavor

RESERVED_AUDIT_WORDS = ("Trigger", "Order", "User", "Key", "Session", "Index", "Percent")


def test_quote_ident_mssql_uses_brackets():
    assert SqlFlavor("mssql").quote_ident("Trigger") == "[Trigger]"


@pytest.mark.parametrize("dialect", ["postgresql", "sqlite"])
def test_quote_ident_pg_and_sqlite_use_double_quotes(dialect):
    assert SqlFlavor(dialect).quote_ident("Trigger") == '"Trigger"'


def test_quote_ident_escapes_closing_delimiter():
    assert SqlFlavor("mssql").quote_ident("Tri]gger") == "[Tri]]gger]"
    assert SqlFlavor("sqlite").quote_ident('Tri"gger') == '"Tri""gger"'


def test_quote_ident_rejects_dotted_or_empty_names():
    with pytest.raises(ValueError):
        SqlFlavor("mssql").quote_ident("r.Trigger")
    with pytest.raises(ValueError):
        SqlFlavor("mssql").quote_ident("")


def _capture_dashboard_sql(monkeypatch, dialect: str) -> list[str]:
    from app.services import dashboard_service

    captured: list[str] = []
    flavor = SqlFlavor(dialect)
    monkeypatch.setattr(dashboard_service, "get_flavor", lambda: flavor)

    def fake_fetch_all(session, sql, params=None, *, operation="select"):
        captured.append(sql)
        return []

    def fake_fetch_one(session, sql, params=None, *, operation="select_one"):
        captured.append(sql)
        return {}

    monkeypatch.setattr(dashboard_service, "fetch_all", fake_fetch_all)
    monkeypatch.setattr(dashboard_service, "fetch_one", fake_fetch_one)
    dashboard_service.build_dashboard_payload(None, department_scope="ALL", include_capacity=False)
    return captured


def _capture_runs_sql(monkeypatch, dialect: str) -> list[str]:
    from app.services import run_service

    captured: list[str] = []
    flavor = SqlFlavor(dialect)
    monkeypatch.setattr(run_service, "get_flavor", lambda: flavor)

    def fake_fetch_all(session, sql, params=None, *, operation="select"):
        captured.append(sql)
        return []

    def fake_fetch_one(session, sql, params=None, *, operation="select_one"):
        captured.append(sql)
        return {"total": 0}

    monkeypatch.setattr(run_service, "fetch_all", fake_fetch_all)
    monkeypatch.setattr(run_service, "fetch_one", fake_fetch_one)
    run_service.list_runs(None, department_scope="ALL")
    return captured


def _joined_for_operation(sqls: list[str], needle: str) -> str:
    matches = [sql for sql in sqls if needle in sql]
    assert matches, f"no captured SQL containing {needle!r}: {sqls!r}"
    return "\n".join(matches)


def test_dashboard_recent_query_quotes_trigger_for_mssql(monkeypatch):
    sqls = _capture_dashboard_sql(monkeypatch, "mssql")
    recent = _joined_for_operation(sqls, "MachineName")
    assert "[Trigger]" in recent
    assert not re.search(r"\.Trigger\b", recent)
    # Alias is quoted too, so the result key stays exactly "Trigger".
    assert "AS [Trigger]" in recent


@pytest.mark.parametrize(
    ("dialect", "quoted"),
    [("postgresql", '"Trigger"'), ("sqlite", '"Trigger"')],
)
def test_dashboard_recent_query_quotes_trigger_for_pg_and_sqlite(monkeypatch, dialect, quoted):
    sqls = _capture_dashboard_sql(monkeypatch, dialect)
    recent = _joined_for_operation(sqls, "MachineName")
    assert quoted in recent
    assert not re.search(r"\.Trigger\b", recent)


def test_runs_list_query_quotes_trigger_for_mssql(monkeypatch):
    sqls = _capture_runs_sql(monkeypatch, "mssql")
    listing = _joined_for_operation(sqls, "RobotName")
    assert "[Trigger]" in listing
    assert "AS [Trigger]" in listing
    assert not re.search(r"\.Trigger\b", listing)


@pytest.mark.parametrize("dialect", ["postgresql", "sqlite"])
def test_runs_list_query_quotes_trigger_for_pg_and_sqlite(monkeypatch, dialect):
    sqls = _capture_runs_sql(monkeypatch, dialect)
    listing = _joined_for_operation(sqls, "RobotName")
    assert '"Trigger"' in listing
    assert not re.search(r"\.Trigger\b", listing)


def test_process_runs_column_not_renamed():
    """Existing bank databases keep the ``Trigger`` column name."""
    from app.db.tables import ProcessRuns

    assert "Trigger" in ProcessRuns.c
    assert ProcessRuns.c.Trigger.name == "Trigger"


def test_no_unquoted_reserved_trigger_in_raw_sql():
    """Audit: no hand-written SQL in app/ references ``.Trigger`` bare.

    ``SELECT *`` and SQLAlchemy Core inserts are unaffected (the engine
    expands/quotes them); only dotted raw-SQL references can hit the
    T-SQL parser as the ``TRIGGER`` keyword.
    """
    root = pathlib.Path(__file__).resolve().parents[1] / "app"
    offenders = []
    for path in root.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        # The quoted builders use ``.{flavor.quote_ident('Trigger')}`` — a
        # bare ``.Trigger`` dotted reference must never appear in raw SQL.
        if re.search(r"\b[rc]\.Trigger\b", text):
            offenders.append(str(path.relative_to(root)))
    assert offenders == []
