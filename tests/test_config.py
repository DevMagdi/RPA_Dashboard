"""Configuration: settings shape, dialect URLs, security validation, env template."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.core.config import Settings, get_settings

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_settings_defaults_are_test_environment():
    settings = get_settings()
    assert settings.is_test
    assert not settings.is_prod
    assert settings.APP_VERSION == "4.0.0"


def test_database_url_sqlite_memory():
    settings = Settings(ENV="test", DB_DIALECT="sqlite", DB_NAME=":memory:")
    assert settings.database_url() == "sqlite+pysqlite:///:memory:"


def test_database_url_sqlite_file():
    settings = Settings(ENV="test", DB_DIALECT="sqlite", DB_NAME="dev.sqlite3")
    assert settings.database_url() == "sqlite+pysqlite:///./dev.sqlite3"


def test_database_url_postgres_quotes_credentials():
    settings = Settings(
        ENV="test", DB_DIALECT="postgresql", DB_SERVER="db.internal", DB_USER="coe user", DB_PASSWORD="p@ss/word"
    )
    url = settings.database_url()
    assert url.startswith("postgresql+psycopg://coe+user:p%40ss%2Fword@db.internal:5432/")


def test_database_url_mssql_default_driver():
    settings = Settings(ENV="test", DB_DIALECT="mssql", DB_SERVER="sql01", DB_USER="sa", DB_PASSWORD="secret")
    url = settings.database_url()
    assert url.startswith("mssql+pyodbc://sa:secret@sql01/")
    assert "ODBC+Driver+18+for+SQL+Server" in url


def test_env_normalised_to_lowercase():
    assert Settings(ENV=" TEST ").ENV == "test"


def test_log_level_normalised_to_uppercase():
    assert Settings(ENV="test", LOG_LEVEL="debug").LOG_LEVEL == "DEBUG"


def test_dev_defaults_generate_secrets():
    settings = Settings(ENV="test", JWT_SECRET_KEY="", FERNET_KEY="", AGENT_TOKEN_PEPPER="")
    assert len(settings.JWT_SECRET_KEY) >= 32
    assert settings.FERNET_KEY
    assert settings.AGENT_TOKEN_PEPPER


def test_prod_cookie_secure_forced():
    settings = Settings(ENV="prod", COOKIE_SECURE=False, JWT_SECRET_KEY="x" * 40)
    assert settings.cookie_secure is True


def test_validate_security_flags_short_jwt_secret():
    settings = Settings(ENV="test", JWT_SECRET_KEY="short")
    problems = settings.validate_security()
    assert any("32 characters" in p for p in problems)


def test_validate_security_prod_rejects_localhost(monkeypatch):
    settings = Settings(
        ENV="prod",
        JWT_SECRET_KEY="x" * 40,
        FERNET_KEY="k" * 44,
        AGENT_TOKEN_PEPPER="p" * 20,
        COOKIE_SECURE=True,
        DB_TRUST_SERVER_CERT="no",
        ALLOWED_HOSTS="coe.bank.local",
        ALLOWED_ORIGINS="https://coe.bank.local",
    )
    assert settings.validate_security() == []


def test_validate_security_prod_raises_on_insecure():
    settings = Settings(ENV="prod", JWT_SECRET_KEY="", FERNET_KEY="", AGENT_TOKEN_PEPPER="")
    with pytest.raises(RuntimeError):
        settings.validate_security()


def test_list_splitting_helpers():
    settings = Settings(ENV="test", ALLOWED_HOSTS="a, b ,,c", IP_ALLOWLIST="")
    assert settings.allowed_hosts_list == ["a", "b", "c"]
    assert settings.ip_allowlist_list == []
    assert settings.csrf_protected_paths  # non-empty default


def test_env_example_covers_every_setting():
    """The shipped .env.example must document every Settings field (86 keys)."""
    source = (REPO_ROOT / "app" / "core" / "config.py").read_text()
    fields = set(re.findall(r"^\s{4}([A-Z][A-Z0-9_]+):", source, re.M))
    env_keys = set(re.findall(r"^([A-Z][A-Z0-9_]+)=", (REPO_ROOT / ".env.example").read_text(), re.M))
    assert fields == env_keys, f"missing={sorted(fields - env_keys)} extra={sorted(env_keys - fields)}"
    assert len(env_keys) == 86


# --------------------------------------------------------------------------- #
# Core infrastructure units: cache, secret store, dialect SQL, logging/tracing
# --------------------------------------------------------------------------- #
def test_memory_cache_behaviour():
    from app.core.cache import get_cache

    cache = get_cache()
    cache.set_json("pytest:key", {"a": 1}, ttl=60)
    assert cache.get_json("pytest:key") == {"a": 1}
    assert cache.incr_with_ttl("pytest:counter", 60) == 1
    assert cache.incr_with_ttl("pytest:counter", 60) == 2
    cache.delete("pytest:key")
    assert cache.get_json("pytest:key") is None
    cache.set_json("pytest:p1", 1, ttl=60)
    cache.set_json("pytest:p2", 2, ttl=60)
    cache.delete_prefix("pytest:p")
    assert cache.get_json("pytest:p1") is None
    assert cache.backend in ("memory", "redis")
    assert "ok" in cache.health()


def test_env_secret_store(monkeypatch):
    from app.core.secrets import EnvSecretStore

    monkeypatch.setenv("PYTEST_SECRET_X", "value-1")
    store = EnvSecretStore()
    assert store.get("PYTEST_SECRET_X") == "value-1"
    assert store.get("PYTEST_MISSING", "fallback") == "fallback"
    assert store.get_many(["PYTEST_SECRET_X", "PYTEST_MISSING"]) == {
        "PYTEST_SECRET_X": "value-1",
        "PYTEST_MISSING": None,
    }
    assert store.health()["backend"] == "env"


def test_caching_secret_store(monkeypatch):
    from app.core.secrets import CachingSecretStore, EnvSecretStore

    monkeypatch.setenv("PYTEST_SECRET_Y", "value-2")
    store = CachingSecretStore(EnvSecretStore())
    assert store.get("PYTEST_SECRET_Y") == "value-2"
    assert store.get("PYTEST_SECRET_Y") == "value-2"  # cached path
    assert store.health()


@pytest.mark.parametrize("dialect", ["sqlite", "postgresql", "mssql"])
def test_dialect_flavours(dialect):
    from app.db.dialect import SqlFlavor

    flavour = SqlFlavor(dialect)
    assert flavour.top(5) or flavour.limit(5)
    assert "5" in flavour.paginate(5, 10)
    assert flavour.now()
    assert flavour.today()
    assert flavour.cast_date("CreatedAt")
    assert flavour.cast_float("Amount")
    assert flavour.cast_int("Amount")
    assert flavour.days_ago(3)
    assert flavour.minutes_from_now(15)
    assert flavour.add_days("CreatedAt", 2)
    assert flavour.date_part("month", "CreatedAt")
    assert flavour.nullif("X", "0")
    assert flavour.true_literal in ("1", "TRUE", "true")
    assert flavour.false_literal in ("0", "FALSE", "false")
    assert flavour.concat("a", "b")
    assert flavour.supports_returning in (True, False)
    assert flavour.supports_top is (dialect == "mssql")


def test_get_flavor_defaults_to_settings():
    from app.db.dialect import get_flavor

    assert get_flavor().dialect == "sqlite"  # test environment


def test_configure_tracing_disabled_is_noop(client):
    from app.core.tracing import configure_tracing

    configure_tracing(client.app)  # OTEL_ENABLED=false in tests: must not raise


def test_logging_correlation_context():
    from app.core.logging import get_correlation_id, set_request_actor

    set_request_actor(username="pytest")
    assert get_correlation_id()  # never empty inside a request-ish context
