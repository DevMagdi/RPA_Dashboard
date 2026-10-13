# ADR-004: One codebase, three database dialects (config-only switch)

- **Status:** Accepted (3.0.0)
- **Date:** 2026-10-13

## Context
Bank standard is SQL Server on-prem; cloud deployments prefer PostgreSQL;
developers and the test-suite need something zero-install (SQLite).

## Decision
SQLAlchemy 2 + a `SqlFlavor` fragment layer (`app/db/dialect.py`) compose
dialect-correct SQL (TOP/LIMIT, date casts, boolean literals) while all values
stay bound parameters. `DB_DIALECT` selects the engine; switching is a pure
configuration change (`Settings.database_url`). Schema is managed by Alembic
(`db/migrations`) or idempotent bootstrap for demos/tests.

## Consequences
- The full pytest suite runs on SQLite in ~40 s with zero infrastructure.
- Dialect behaviour is unit-tested (`tests/test_config.py::test_dialect_flavours`).
- A small set of raw-SQL repositories must stay within the flavour fragments'
  common denominator.
