"""Engine & session management (dialect aware).

Creates one SQLAlchemy engine per process with a tuned connection pool and
exposes small helpers used by the repository layer:

* :func:`get_engine` — cached engine (``pool_pre_ping``, ``fast_executemany``)
* :func:`session_scope` — transactional context manager
* :func:`read_connection` — read-only connection context manager
* :func:`check_database_health` — used by ``/health/detail``

Switching between Microsoft SQL Server, PostgreSQL and SQLite is a pure
configuration change (``DB_DIALECT``).
"""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from typing import Any, Dict, Iterator, Optional

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool, StaticPool

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_engine: Optional[Engine] = None
_session_factory: Optional[sessionmaker] = None


def _build_engine() -> Engine:
    """Construct the engine for the configured dialect."""
    settings = get_settings()
    url = settings.database_url()
    kwargs: Dict[str, Any] = {"future": True, "echo": False}

    if settings.DB_DIALECT == "sqlite":
        # SQLite is used for the automated test-suite and single-VM demos.
        kwargs.update(
            connect_args={"check_same_thread": False},
            poolclass=StaticPool if ":memory:" in url else QueuePool,
        )
        if ":memory:" not in url:
            kwargs.update(pool_size=5, max_overflow=5)
    else:
        kwargs.update(
            poolclass=QueuePool,
            pool_size=settings.DB_POOL_SIZE,
            max_overflow=settings.DB_MAX_OVERFLOW,
            pool_timeout=settings.DB_POOL_TIMEOUT,
            pool_recycle=settings.DB_POOL_RECYCLE,
            pool_pre_ping=True,
        )
        if settings.DB_DIALECT == "mssql":
            kwargs["connect_args"] = {"timeout": settings.DB_CONNECT_TIMEOUT}
            kwargs["fast_executemany"] = True
        elif settings.DB_DIALECT == "postgresql":
            kwargs["connect_args"] = {
                "connect_timeout": settings.DB_CONNECT_TIMEOUT,
                "options": f"-c statement_timeout={settings.DB_STATEMENT_TIMEOUT_MS}",
            }
            kwargs["pool_pre_ping"] = True

    engine = create_engine(url, **kwargs)

    if settings.DB_DIALECT == "sqlite":

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_conn, _record):  # pragma: no cover - driver hook
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA journal_mode=WAL")
            cur.close()

    logger.info("Database engine created (dialect=%s)", settings.DB_DIALECT)
    return engine


def get_engine() -> Engine:
    """Return the process-wide engine (lazily created)."""
    global _engine
    if _engine is None:
        _engine = _build_engine()
    return _engine


def get_session_factory() -> sessionmaker:
    """Return the process-wide session factory."""
    global _session_factory
    if _session_factory is None:
        _session_factory = sessionmaker(bind=get_engine(), expire_on_commit=False, future=True)
    return _session_factory


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional scope — commits on success, rolls back on error."""
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@contextmanager
def read_connection() -> Iterator[Any]:
    """Short-lived read-only connection (autocommit semantics)."""
    with get_engine().connect() as conn:
        yield conn


def dispose_engine() -> None:
    """Dispose the pool — used on shutdown and between tests."""
    global _engine, _session_factory
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _session_factory = None


def check_database_health(timeout_seconds: float = 3.0) -> Dict[str, Any]:
    """Ping the database and report latency (used by ``/health/detail``)."""
    started = time.perf_counter()
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return {
            "ok": True,
            "dialect": get_settings().DB_DIALECT,
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
        }
    except Exception as exc:  # pragma: no cover - depends on infra
        return {"ok": False, "dialect": get_settings().DB_DIALECT, "error": str(exc)[:200]}
