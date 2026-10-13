"""Thin, safe data-access helpers shared by every repository.

Design goals
------------
* **Always parameterised** — user input never reaches the SQL string.
* **Dialect agnostic** — composed with :mod:`app.db.dialect` fragments.
* **Explicit** — no hidden ORM magic, results are plain mappings.
* **Observable** — query latency and failures are logged and metered.
"""

from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from sqlalchemy import Table, delete, insert, select, update
from sqlalchemy.engine import RowMapping
from sqlalchemy.exc import CompileError, IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.metrics import DB_QUERY_LATENCY

logger = logging.getLogger(__name__)

Params = Mapping[str, Any]
Row = Dict[str, Any]


class RepositoryError(RuntimeError):
    """Raised when a database operation fails (never leaks SQL to the caller)."""


def _log_slow(operation: str, sql: str, started: float) -> None:
    elapsed = (time.perf_counter() - started) * 1000
    DB_QUERY_LATENCY.labels(operation=operation).observe(elapsed / 1000)
    if elapsed > 500:  # pragma: no cover - timing dependent
        logger.warning("Slow query (%.0f ms) [%s]: %s", elapsed, operation, " ".join(sql.split())[:300])


#: Bare ISO-8601 timestamps, e.g. ``2026-10-13 08:31:04.123456``.
#: SQLite (used for tests, demos and single-node installs) hands ``DATETIME``
#: columns back as text; MSSQL/PostgreSQL return real ``datetime`` objects.
#: Coercing here keeps service code dialect-agnostic instead of sprinkling
#: ``strptime`` calls (and date-arithmetic bugs) across the code base.
_ISO_TIMESTAMP = re.compile(
    r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?$"
)


def _coerce_value(value: Any) -> Any:
    """Normalise driver-specific representations (currently: timestamps)."""
    if isinstance(value, str) and _ISO_TIMESTAMP.match(value):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:  # pragma: no cover - regex already validated the shape
            return value
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed
    return value


def _coerce_row(row: Mapping[str, Any]) -> Row:
    """Apply :func:`_coerce_value` to every column of a result row."""
    return {key: _coerce_value(value) for key, value in row.items()}


def fetch_all(session: Session, sql: str, params: Optional[Params] = None, *, operation: str = "select") -> List[Row]:
    """Run a SELECT and return a list of dictionaries."""
    started = time.perf_counter()
    try:
        result = session.execute(__import__("sqlalchemy").text(sql), dict(params or {}))
        rows = [_coerce_row(row) for row in result.mappings().all()]
        return rows
    except SQLAlchemyError as exc:
        logger.error("Query failed [%s]: %s", operation, exc)
        raise RepositoryError(f"database query failed: {operation}") from exc
    finally:
        _log_slow(operation, sql, started)


def fetch_one(session: Session, sql: str, params: Optional[Params] = None, *, operation: str = "select_one") -> Optional[Row]:
    """Run a SELECT expected to return at most one row."""
    rows = fetch_all(session, sql, params, operation=operation)
    return rows[0] if rows else None


def fetch_scalar(
    session: Session, sql: str, params: Optional[Params] = None, *, operation: str = "select_scalar", default: Any = None
) -> Any:
    """Return the first column of the first row (or ``default``)."""
    row = fetch_one(session, sql, params, operation=operation)
    if not row:
        return default
    value = next(iter(row.values()), default)
    return default if value is None else value


def execute(session: Session, sql: str, params: Optional[Params] = None, *, operation: str = "statement") -> int:
    """Execute a DML statement and return the affected row count."""
    started = time.perf_counter()
    try:
        result = session.execute(__import__("sqlalchemy").text(sql), dict(params or {}))
        return int(result.rowcount or 0)
    except SQLAlchemyError as exc:
        logger.error("Statement failed [%s]: %s", operation, exc)
        raise RepositoryError(f"database statement failed: {operation}") from exc
    finally:
        _log_slow(operation, sql, started)


def execute_many(session: Session, statements: Sequence[Tuple[str, Params]], *, operation: str = "batch") -> None:
    """Execute several statements inside the caller's transaction (atomic)."""
    for sql, params in statements:
        execute(session, sql, params, operation=operation)


# --------------------------------------------------------------------------- #
# Table-level helpers (structural ORM usage for writes)
# --------------------------------------------------------------------------- #
def insert_row(session: Session, table: Table, values: Mapping[str, Any]) -> Any:
    """Insert one row and return its primary key value.

    Uses ``INSERT ... RETURNING`` on PostgreSQL/SQLite and ``OUTPUT INSERTED``
    (emitted by SQLAlchemy) on SQL Server for a single round trip.  Falls back
    to the driver's ``lastrowid``/``inserted_primary_key`` for exotic drivers.
    Only *compilation* failures trigger the fallback — real integrity errors
    must propagate so callers can react (e.g. idempotent ingestion).
    """
    pk_column = list(table.primary_key.columns)[0]
    values = dict(values)
    try:
        result = session.execute(insert(table).values(**values).returning(pk_column))
        new_id = result.scalar_one()
    except (CompileError, NotImplementedError):  # pragma: no cover - dialect specific
        result = session.execute(insert(table).values(**values))
        pk = result.inserted_primary_key
        new_id = pk[0] if pk else None
    return int(new_id) if isinstance(new_id, int) else new_id


def update_rows(session: Session, table: Table, values: Mapping[str, Any], where: Sequence[Any]) -> int:
    """Update rows matching ``where`` clauses and return the affected count."""
    if not where:
        raise ValueError("refusing to UPDATE without a WHERE clause")
    result = session.execute(update(table).where(*where).values(**dict(values)))
    return int(result.rowcount or 0)


def delete_rows(session: Session, table: Table, where: Sequence[Any]) -> int:
    """Hard delete rows matching ``where``."""
    if not where:
        raise ValueError("refusing to DELETE without a WHERE clause")
    result = session.execute(delete(table).where(*where))
    return int(result.rowcount or 0)


def soft_delete(session: Session, table: Table, pk_value: Any, *, now: Any) -> int:
    """Logically delete a row by primary key."""
    pk_column = list(table.primary_key.columns)[0]
    return update_rows(
        session,
        table,
        {"IsDeleted": True, "DeletedAt": now, "UpdatedAt": now},
        [pk_column == pk_value],
    )


def select_columns(table: Table, columns: Iterable[str]) -> str:
    """Render a comma-separated column list for ``table`` (identifier safety)."""
    valid = {c.name for c in table.columns}
    rendered = []
    for name in columns:
        if name not in valid:
            raise ValueError(f"unknown column {name!r} for table {table.name}")
        rendered.append(f"{table.name}.{name}")
    return ", ".join(rendered)


def mapping_to_dict(row: RowMapping | Row) -> Row:
    """Normalise a SQLAlchemy row to a plain dict."""
    return dict(row)


def chunked(items: Sequence[Any], size: int = 500) -> Iterable[Sequence[Any]]:
    """Yield ``items`` in chunks (used for bulk insert of telemetry)."""
    for index in range(0, len(items), size):
        yield items[index : index + size]


__all__ = [
    "RepositoryError",
    "IntegrityError",
    "fetch_all",
    "fetch_one",
    "fetch_scalar",
    "execute",
    "execute_many",
    "insert_row",
    "update_rows",
    "delete_rows",
    "soft_delete",
    "select_columns",
    "chunked",
    "select",
]
