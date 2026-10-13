"""Process-catalogue query regressions (SQL Server `error 169`).

The catalogue query used to emit ``ORDER BY c.ProcessName ASC, c.ProcessName
ASC`` whenever the default sort was requested: SQL Server rejects that with
*A column has been specified more than once in the order by list* (169) and
``/api/processes`` answered **500** on the bank's MSSQL deployment, while
SQLite/PostgreSQL silently accepted it (which is why the test-suite was green).

Each test compiles the query for a given dialect and asserts:

* every ``ORDER BY`` term is unique (the reported bug);
* the row limiter matches the dialect (``OFFSET … FETCH`` for MSSQL, since
  ``TOP`` cannot be combined with an offset, ``LIMIT … OFFSET`` elsewhere);
* a keyset cursor is always walked on ``ProcessName``.
"""

from __future__ import annotations

from typing import Any, List

import pytest

from app.db.dialect import SqlFlavor

ROW_LIMITERS = (" LIMIT ", " OFFSET ")


def _capture_catalogue_sql(monkeypatch, dialect: str, **kwargs: Any) -> str:
    """Return the SQL ``list_processes`` sends for ``dialect``."""
    from app.services import process_service

    captured: List[str] = []
    flavor = SqlFlavor(dialect)
    monkeypatch.setattr(process_service, "get_flavor", lambda: flavor)

    def fake_fetch_all(session, sql, params=None, *, operation="select"):
        captured.append(sql)
        return []

    def fake_fetch_one(session, sql, params=None, *, operation="select_one"):
        return {"total": 0}

    monkeypatch.setattr(process_service, "fetch_all", fake_fetch_all)
    monkeypatch.setattr(process_service, "fetch_one", fake_fetch_one)
    process_service.list_processes(None, **kwargs)
    assert len(captured) == 1, captured
    return captured[0]


def _order_by_terms(sql: str) -> List[str]:
    """Split the ORDER BY clause into its terms (row limiter stripped)."""
    clause = sql.split("ORDER BY", 1)[1]
    for limiter in ROW_LIMITERS:
        clause = clause.split(limiter, 1)[0]
    return [term.strip() for term in clause.split(",") if term.strip()]


@pytest.mark.parametrize("sort_by", ["ProcessName", "Department", "CreatedAt", "NotAColumn"])
@pytest.mark.parametrize("dialect", ["mssql", "postgresql", "sqlite"])
def test_order_by_terms_are_unique(monkeypatch, dialect, sort_by):
    """The exact shape that made SQL Server answer 169 (and 500 to the UI)."""
    sql = _capture_catalogue_sql(monkeypatch, dialect, sort_by=sort_by)
    terms = _order_by_terms(sql)
    assert terms, sql
    assert len(terms) == len(set(terms)), f"duplicate ORDER BY term in: {sql}"


@pytest.mark.parametrize("sort_dir", ["asc", "desc"])
def test_default_sort_orders_by_process_name_once(monkeypatch, sort_dir):
    sql = _capture_catalogue_sql(monkeypatch, "mssql", sort_by="ProcessName", sort_dir=sort_dir)
    expected = "ORDER BY c.ProcessName DESC" if sort_dir == "desc" else "ORDER BY c.ProcessName ASC"
    assert expected in sql
    assert sql.count("c.ProcessName ASC") + sql.count("c.ProcessName DESC") == 1


def test_secondary_sort_key_is_added_only_when_needed(monkeypatch):
    """A non-unique sort column needs a deterministic tiebreaker."""
    sql = _capture_catalogue_sql(monkeypatch, "mssql", sort_by="CreatedAt", sort_dir="desc")
    assert "ORDER BY c.CreatedAt DESC, c.ProcessName DESC" in sql


def test_mssql_uses_offset_fetch_and_never_top(monkeypatch):
    """``TOP`` cannot be combined with ``OFFSET`` — pick one, per dialect."""
    mssql = _capture_catalogue_sql(monkeypatch, "mssql", page_size=25)
    assert "OFFSET 0 ROWS FETCH NEXT 26 ROWS ONLY" in mssql
    assert "SELECT TOP" not in mssql


@pytest.mark.parametrize("dialect", ["postgresql", "sqlite"])
def test_pg_and_sqlite_use_limit_offset(monkeypatch, dialect):
    sql = _capture_catalogue_sql(monkeypatch, dialect, page_size=25, offset=50)
    assert "LIMIT 26 OFFSET 50" in sql
    assert "TOP" not in sql


def test_offset_is_rendered_per_dialect(monkeypatch):
    sql = _capture_catalogue_sql(monkeypatch, "mssql", page_size=25, offset=50)
    assert "OFFSET 50 ROWS FETCH NEXT 26 ROWS ONLY" in sql


def test_keyset_cursor_pins_the_order_to_process_name(monkeypatch):
    """`after` walks ProcessName, so the ordering must follow the cursor."""
    sql = _capture_catalogue_sql(
        monkeypatch, "mssql", after="Invoice_Processing", sort_by="CreatedAt", sort_dir="asc"
    )
    assert "c.ProcessName > :after" in sql
    assert "ORDER BY c.ProcessName ASC" in sql
    assert "CreatedAt" not in sql.split("ORDER BY", 1)[1]


def test_keyset_cursor_descending(monkeypatch):
    sql = _capture_catalogue_sql(monkeypatch, "mssql", after="Invoice_Processing", sort_dir="desc")
    assert "c.ProcessName < :after" in sql
    assert "ORDER BY c.ProcessName DESC" in sql


def test_count_query_has_no_order_by(monkeypatch):
    """The COUNT companion query must not carry the ordering at all."""
    from app.services import process_service

    captured: List[str] = []
    monkeypatch.setattr(process_service, "get_flavor", lambda: SqlFlavor("mssql"))
    monkeypatch.setattr(
        process_service, "fetch_one", lambda *a, **k: captured.append(a[1]) or {"total": 0}
    )
    monkeypatch.setattr(process_service, "fetch_all", lambda *a, **k: [])
    process_service.list_processes(None, include_total=True)
    assert captured and "ORDER BY" not in captured[0]
