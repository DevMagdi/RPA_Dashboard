"""Dialect-portable SQL fragments.

The platform must run unchanged on **Microsoft SQL Server** (banks, on-prem),
**PostgreSQL** (cloud / containerised) and **SQLite** (automated test-suite).

Rather than a fragile string translator, this module exposes *named fragments*
that repositories compose into their queries.  Every user-supplied value is
still passed as a bound parameter — only syntax, never data, is interpolated.
"""

from __future__ import annotations

from typing import Optional

from app.core.config import get_settings


class SqlFlavor:
    """SQL syntax helpers for the currently configured dialect."""

    def __init__(self, dialect: Optional[str] = None) -> None:
        self.dialect = (dialect or get_settings().DB_DIALECT).lower()

    # ------------------------------------------------------------------ #
    # Limiting rows
    # ------------------------------------------------------------------ #
    @property
    def supports_top(self) -> bool:
        return self.dialect == "mssql"

    def top(self, n: int) -> str:
        """``TOP n`` prefix for SQL Server, empty elsewhere."""
        return f"TOP {int(n)} " if self.supports_top else ""

    def limit(self, n: int) -> str:
        """``LIMIT n`` suffix for PG/SQLite, empty for SQL Server."""
        return "" if self.supports_top else f" LIMIT {int(n)}"

    def leading_select(self, n: int) -> str:
        """Build ``SELECT {TOP n}`` / ``SELECT`` + trailing ``LIMIT n`` helper."""
        return self.top(n)

    def quote_ident(self, name: str) -> str:
        """Quote a single identifier for this dialect.

        Reserved words differ per engine — e.g. ``Trigger`` is a reserved
        keyword in T-SQL (``Incorrect syntax near the keyword 'Trigger'``)
        while it is accepted bare on SQLite/PostgreSQL.  Quoting only the
        identifier (never a value) makes the same query text valid on every
        supported dialect without renaming any database column.

        The returned text is the quoted form only; the logical column name
        is unchanged, so result mappings keep their original keys when the
        quoted identifier is also used as the ``AS`` alias.
        """
        ident = str(name).strip()
        if not ident or any(ch in ident for ch in (".", ";", "\n", "\r", "\0")):
            raise ValueError(f"invalid identifier: {name!r}")
        if self.dialect == "mssql":
            return "[" + ident.replace("]", "]]") + "]"
        return '"' + ident.replace('"', '""') + '"'

    def paginate(self, limit: int, offset: int = 0) -> str:
        """Row-limiting clause **suffix** (the query must already have ORDER BY).

        ``LIMIT/OFFSET`` on PostgreSQL & SQLite, ``OFFSET … FETCH NEXT`` on
        SQL Server (2012+), which keeps a single query text for every dialect.
        """
        limit, offset = int(limit), int(offset)
        if self.dialect == "mssql":
            return f" OFFSET {offset} ROWS FETCH NEXT {limit} ROWS ONLY"
        return f" LIMIT {limit} OFFSET {offset}"

    # ------------------------------------------------------------------ #
    # Functions
    # ------------------------------------------------------------------ #
    def now(self) -> str:
        """Current timestamp expression."""
        return "GETDATE()" if self.dialect == "mssql" else "CURRENT_TIMESTAMP"

    def today(self) -> str:
        """Truncate the current timestamp to a date."""
        return self.cast_date(self.now())

    def cast_date(self, expr: str) -> str:
        """Render ``expr`` as a ``'YYYY-MM-DD'`` **string** on every dialect.

        Returning text (instead of a native DATE) keeps the JSON payloads
        identical across SQL Server, PostgreSQL and SQLite — and avoids SQLite's
        surprising ``CAST('2026-10-13 …' AS DATE) -> 2026`` integer coercion.
        """
        if self.dialect == "mssql":
            return f"CONVERT(varchar(10), {expr}, 23)"
        if self.dialect == "postgresql":
            return f"to_char({expr}, 'YYYY-MM-DD')"
        return f"strftime('%Y-%m-%d', {expr})"

    def cast_float(self, expr: str) -> str:
        """Cast an expression to a floating point type."""
        if self.dialect == "mssql":
            return f"CAST({expr} AS float)"
        if self.dialect == "sqlite":
            return f"CAST({expr} AS REAL)"
        return f"CAST({expr} AS DOUBLE PRECISION)"

    def cast_int(self, expr: str) -> str:
        """Cast an expression to a 64-bit integer."""
        return f"CAST({expr} AS BIGINT)" if self.dialect != "sqlite" else f"CAST({expr} AS INTEGER)"

    def days_ago(self, days: int, reference: Optional[str] = None) -> str:
        """Timestamp ``days`` in the past (dialect specific)."""
        ref = reference or self.now()
        if self.dialect == "mssql":
            return f"DATEADD(day, -{int(days)}, {ref})"
        if self.dialect == "postgresql":
            return f"({ref} - INTERVAL '{int(days)} days')"
        return f"datetime({ref}, '-{int(days)} days')" if reference else f"datetime('now', '-{int(days)} days')"

    def minutes_from_now(self, minutes: int) -> str:
        """Timestamp ``minutes`` in the future (used for TTL columns)."""
        if self.dialect == "mssql":
            return f"DATEADD(minute, {int(minutes)}, GETDATE())"
        if self.dialect == "postgresql":
            return f"(CURRENT_TIMESTAMP + INTERVAL '{int(minutes)} minutes')"
        return f"datetime('now', '+{int(minutes)} minutes')"

    def add_days(self, expr: str, days: int) -> str:
        """``expr`` shifted by ``days`` days."""
        if self.dialect == "mssql":
            return f"DATEADD(day, {int(days)}, {expr})"
        if self.dialect == "postgresql":
            return f"({expr} + INTERVAL '{int(days)} days')"
        return f"datetime({expr}, '{int(days)} days')"

    def date_part(self, part: str, expr: str) -> str:
        """Extract a date part (``year``/``month``/``day``/``hour``)."""
        if self.dialect == "mssql":
            return f"DATEPART({part}, {expr})"
        if self.dialect == "postgresql":
            return f"EXTRACT({part} FROM {expr})"
        return f"CAST(strftime('%{'Y' if part == 'year' else 'm' if part == 'month' else 'd' if part == 'day' else 'H'}', {expr}) AS INTEGER)"

    def nullif(self, expr: str, value: str) -> str:
        """``NULLIF`` is ANSI — provided for readability."""
        return f"NULLIF({expr}, {value})"

    # ------------------------------------------------------------------ #
    # Booleans & misc
    # ------------------------------------------------------------------ #
    @property
    def true_literal(self) -> str:
        return "1" if self.dialect in ("mssql", "sqlite") else "TRUE"

    @property
    def false_literal(self) -> str:
        return "0" if self.dialect in ("mssql", "sqlite") else "FALSE"

    def concat(self, *parts: str) -> str:
        """String concatenation across dialects."""
        if self.dialect == "mssql":
            return " + ".join(parts)
        if self.dialect == "sqlite":
            return " || ".join(parts)
        return " || ".join(parts)

    def like_escape_ansi(self, placeholder: str) -> str:
        """Standard ``LIKE`` with an explicit ESCAPE clause (all dialects)."""
        return f"{placeholder} ESCAPE '\\'"

    @property
    def supports_returning(self) -> bool:
        """``INSERT ... RETURNING`` support."""
        return self.dialect in ("postgresql", "sqlite")


_flavor: Optional[SqlFlavor] = None


def get_flavor() -> SqlFlavor:
    """Return the cached SQL flavor for the configured dialect."""
    global _flavor
    if _flavor is None:
        _flavor = SqlFlavor()
    return _flavor


def reset_flavor() -> None:
    """Reset the cached flavor (tests switch ``DB_DIALECT`` on the fly)."""
    global _flavor
    _flavor = None
