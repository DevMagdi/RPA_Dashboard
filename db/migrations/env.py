"""Alembic environment — dialect agnostic.

The connection string comes from the application settings, so migrations run
identically against SQL Server (bank on-prem), PostgreSQL (private cloud) and SQLite
(unit tests / air-gapped demos).
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import get_settings
from app.db.tables import metadata

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = metadata
settings = get_settings()


def _database_url() -> str:
    """Prefer an explicit override (CI / release pipeline), else app settings."""
    override = config.get_main_option("sqlalchemy.url", None)
    if override:
        return override
    url = settings.database_url()
    # Alembic runs synchronously; async drivers are mapped to their sync twin.
    return url.replace("+aiosqlite", "").replace("+asyncpg", "+psycopg")


def run_migrations_offline() -> None:
    """Generate SQL without connecting (used to hand DDL to a DBA)."""
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Apply migrations against a live database."""
    section = config.get_section(config.config_ini_section) or {}
    section["sqlalchemy.url"] = _database_url()
    connectable = engine_from_config(section, prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            include_schemas=False,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
