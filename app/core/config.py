"""Application configuration (12-factor, typed, validated).

All settings come from environment variables (and a local ``.env`` file in
non-production only).  Secrets themselves are resolved through the pluggable
:mod:`app.core.secrets` backends so that banks can run this platform against
Azure Key Vault, HashiCorp Vault or plain environment variables with **zero
code change**.

The module exposes a single cached :func:`get_settings` accessor used across
the code base.
"""

from __future__ import annotations

import secrets
import sys
from functools import lru_cache
from pathlib import Path
from typing import List, Literal, Optional

from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = REPO_ROOT / ".env"


class Settings(BaseSettings):
    """Strongly-typed runtime configuration."""

    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE) if ENV_FILE.exists() else None,
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        populate_by_name=True,
    )

    # ------------------------------------------------------------------ #
    # Runtime / platform
    # ------------------------------------------------------------------ #
    ENV: Literal["dev", "test", "prod"] = "dev"
    APP_NAME: str = "RPA CoE Control Room"
    APP_VERSION: str = "4.1.0"
    LOG_LEVEL: str = "INFO"
    LOG_JSON: bool = False
    #: Optional log file.  Always written as UTF-8: on a Windows Service the
    #: console code page is often cp1256/cp437, which is exactly how Arabic log
    #: lines used to arrive as ``????``.
    LOG_FILE: str = ""

    # ------------------------------------------------------------------ #
    # Network / hosting
    # ------------------------------------------------------------------ #
    ALLOWED_HOSTS: str = "localhost,127.0.0.1,testserver"
    ALLOWED_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"
    TRUSTED_PROXIES: str = "127.0.0.1"
    IP_ALLOWLIST: str = ""

    # ------------------------------------------------------------------ #
    # Database — multi-dialect (zero-code switch between SQL Server / PG)
    # ------------------------------------------------------------------ #
    DB_DIALECT: Literal["mssql", "postgresql", "sqlite"] = "mssql"
    DB_SERVER: str = "localhost"
    DB_PORT: Optional[int] = None
    DB_NAME: str = "RPA_Dashboard"
    DB_USER: str = ""
    DB_PASSWORD: str = ""
    DB_DRIVER: str = "ODBC Driver 18 for SQL Server"
    DB_ENCRYPT: str = "yes"
    DB_TRUST_SERVER_CERT: str = "yes"
    DB_CONNECT_TIMEOUT: int = 30
    DB_POOL_SIZE: int = 20
    DB_MAX_OVERFLOW: int = 40
    DB_POOL_TIMEOUT: int = 30
    DB_POOL_RECYCLE: int = 1800
    DB_STATEMENT_TIMEOUT_MS: int = 30_000

    # ------------------------------------------------------------------ #
    # Security / crypto
    # ------------------------------------------------------------------ #
    JWT_SECRET_KEY: str = ""
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    FERNET_KEY: str = ""
    AGENT_TOKEN_PEPPER: str = ""
    ENROLLMENT_TTL_MINUTES: int = 15
    MAX_FAILED_LOGIN_ATTEMPTS: int = 5
    LOCKOUT_MINUTES: int = 15
    PASSWORD_MIN_LENGTH: int = 12
    PASSWORD_HISTORY_SIZE: int = 5
    COOKIE_SECURE: bool = False
    COOKIE_DOMAIN: Optional[str] = None
    CSRF_ENABLED: bool = True
    CSRF_PROTECTED_PATHS: str = Field(
        default="/api/auth/refresh,/api/auth/logout,/api/auth/sessions,/api/auth/change-password",
        description=(
            "Comma-separated path prefixes that authenticate with the refresh cookie and therefore require "
            "the double-submit CSRF header. Bearer-token APIs are immune to CSRF and stay exempt."
        ),
    )
    HSTS_MAX_AGE: int = 31536000

    # ------------------------------------------------------------------ #
    # MFA
    # ------------------------------------------------------------------ #
    MFA_ENABLED: bool = True
    MFA_ISSUER: str = "RPA CoE Control Room"
    MFA_WINDOW: int = 1
    MFA_BACKUP_CODES: int = 10

    # ------------------------------------------------------------------ #
    # Secret backends (bank secret-manager integration)
    # ------------------------------------------------------------------ #
    SECRET_BACKEND: Literal["env", "azure_keyvault", "hashicorp_vault"] = "env"
    AZURE_KEYVAULT_URL: str = ""
    AZURE_KEYVAULT_PREFIX: str = "rpa-coe-"
    VAULT_ADDR: str = ""
    VAULT_TOKEN: str = ""
    VAULT_MOUNT: str = "secret"
    VAULT_PATH: str = "rpa-coe"

    # ------------------------------------------------------------------ #
    # Redis
    # ------------------------------------------------------------------ #
    REDIS_URL: str = "redis://localhost:6379/0"

    # ------------------------------------------------------------------ #
    # Recommendation engine (Capacity Advisor)
    # ------------------------------------------------------------------ #
    CAPACITY_UTILIZATION_WARNING: float = 75.0
    CAPACITY_UTILIZATION_CRITICAL: float = 90.0
    CAPACITY_LOOKAHEAD_DAYS: int = 14
    CAPACITY_MIN_SAMPLES: int = 20

    # ------------------------------------------------------------------ #
    # Notifications
    # ------------------------------------------------------------------ #
    NOTIFY_ENABLED: bool = False
    NOTIFY_SMTP_HOST: str = ""
    NOTIFY_SMTP_PORT: int = 587
    NOTIFY_SMTP_USER: str = ""
    NOTIFY_SMTP_PASSWORD: str = ""
    NOTIFY_SMTP_FROM: str = "coe-alerts@bank.local"
    NOTIFY_SMTP_TLS: bool = True
    NOTIFY_SLACK_WEBHOOK: str = ""
    NOTIFY_TEAMS_WEBHOOK: str = ""
    NOTIFY_COOLDOWN_MINUTES: int = 30
    ALERT_FAILURE_RATE_THRESHOLD: float = 0.25
    ALERT_FAILURE_MIN_RUNS: int = 10
    ALERT_REPEATED_FAILURE_THRESHOLD: int = 3
    COMMAND_ALLOWED_PROCESSES: str = ""  # comma-separated whitelist; empty = ProcessConfig-assigned only
    AGENT_COMMAND_HMAC_SECRET: str = ""

    # ------------------------------------------------------------------ #
    # Observability
    # ------------------------------------------------------------------ #
    OTEL_ENABLED: bool = False
    OTEL_EXPORTER_OTLP_ENDPOINT: str = "http://localhost:4318"
    OTEL_SERVICE_NAME: str = "rpa-coe-control-room"
    METRICS_ENABLED: bool = True

    # ------------------------------------------------------------------ #
    # Runtime / serving behaviour
    # ------------------------------------------------------------------ #
    DB_AUTO_BOOTSTRAP: bool = Field(
        default=True,
        description="Create missing tables + seed the single organization on startup (off for strict DBA-managed deployments)",
    )
    DB_SEED_DEMO: bool = Field(
        default=False, description="Seed the demo dataset when the database is empty (dev/demo only)"
    )
    SCHEDULER_ENABLED: bool = Field(
        default=True, description="Run the in-process scheduler (sync, capacity advisor, stale-run reaper, SLA snapshots)"
    )
    SCHEDULER_SYNC_MINUTES: int = Field(default=10, ge=1, le=720)
    SCHEDULER_CAPACITY_MINUTES: int = Field(default=15, ge=1, le=720)
    SCHEDULER_REAPER_MINUTES: int = Field(default=30, ge=1, le=1440)
    REALTIME_ENABLED: bool = Field(default=True, description="Publish periodic KPI snapshots to SSE/WebSocket clients")
    REALTIME_TICK_SECONDS: int = Field(default=15, ge=5, le=600)
    SERVE_FRONTEND: bool = Field(
        default=True, description="Serve the built React SPA from this process (single-container deployments)"
    )
    FRONTEND_DIST: str = Field(default="rpa-dashboard/dist", description="Path to the Vite build output")
    EXPOSE_DOCS: bool = Field(default=False, description="Expose /docs + /openapi.json even in production")

    # ------------------------------------------------------------------ #
    # Agent telemetry
    # ------------------------------------------------------------------ #
    AGENT_STALE_SECONDS: int = Field(
        default=180, validation_alias=AliasChoices("AGENT_STALE_SECONDS", "AGENT_STALE_THRESHOLD")
    )

    # ================================================================== #
    # Validators
    # ================================================================== #
    @field_validator("ENV", mode="before")
    @classmethod
    def _normalize_env(cls, v: object) -> object:
        if isinstance(v, str):
            return v.strip().lower()
        return v

    @field_validator("LOG_LEVEL", mode="before")
    @classmethod
    def _normalize_log_level(cls, v: object) -> object:
        return str(v).strip().upper() if v else "INFO"

    @model_validator(mode="after")
    def _generate_dev_defaults(self) -> "Settings":
        """Dev/test convenience only — production must supply real secrets."""
        if self.ENV in ("dev", "test"):
            if not self.JWT_SECRET_KEY:
                self.JWT_SECRET_KEY = secrets.token_urlsafe(64)
            if not self.AGENT_TOKEN_PEPPER:
                self.AGENT_TOKEN_PEPPER = secrets.token_urlsafe(32)
            if not self.FERNET_KEY:
                from cryptography.fernet import Fernet

                self.FERNET_KEY = Fernet.generate_key().decode()
        return self

    # ================================================================== #
    # Derived helpers
    # ================================================================== #
    @property
    def is_prod(self) -> bool:
        """True when running in production (enforces strict security)."""
        return self.ENV == "prod"

    @property
    def is_test(self) -> bool:
        return self.ENV == "test"

    @staticmethod
    def _split(value: str) -> List[str]:
        return [part.strip() for part in str(value).split(",") if part.strip()]

    @property
    def allowed_hosts_list(self) -> List[str]:
        return self._split(self.ALLOWED_HOSTS) or ["localhost", "127.0.0.1"]

    @property
    def cors_origins(self) -> List[str]:
        return self._split(self.ALLOWED_ORIGINS)

    @property
    def trusted_proxies_list(self) -> List[str]:
        return self._split(self.TRUSTED_PROXIES)

    @property
    def ip_allowlist_list(self) -> List[str]:
        return self._split(self.IP_ALLOWLIST)

    @property
    def csrf_protected_paths(self) -> List[str]:
        """Path prefixes protected by the double-submit CSRF check."""
        return self._split(self.CSRF_PROTECTED_PATHS)

    @property
    def cookie_secure(self) -> bool:
        """Secure cookies are mandatory in production."""
        return bool(self.COOKIE_SECURE) or self.is_prod

    def database_url(self) -> str:
        """Build the SQLAlchemy URL for the configured dialect.

        Supports Microsoft SQL Server (pyodbc), PostgreSQL (psycopg) and
        SQLite (used by the automated test-suite / demo mode).  Switching
        dialect is a pure configuration change.
        """
        from urllib.parse import quote_plus

        if self.DB_DIALECT == "sqlite":
            name = self.DB_NAME or "dev.sqlite3"
            if name.startswith("/") or name == ":memory:":
                return f"sqlite+pysqlite:///{name}"
            return f"sqlite+pysqlite:///./{name}"

        if self.DB_DIALECT == "postgresql":
            port = self.DB_PORT or 5432
            user = quote_plus(self.DB_USER)
            pwd = quote_plus(self.DB_PASSWORD)
            return f"postgresql+psycopg://{user}:{pwd}@{self.DB_SERVER}:{port}/{self.DB_NAME}"

        # Microsoft SQL Server (default / current production setup)
        port_part = f":{self.DB_PORT}" if self.DB_PORT else ""
        pwd = quote_plus(self.DB_PASSWORD)
        return (
            f"mssql+pyodbc://{quote_plus(self.DB_USER)}:{pwd}@{self.DB_SERVER}{port_part}/{self.DB_NAME}"
            f"?driver={quote_plus(self.DB_DRIVER)}"
            f"&Encrypt={self.DB_ENCRYPT}"
            f"&TrustServerCertificate={self.DB_TRUST_SERVER_CERT}"
        )

    def validate_security(self) -> List[str]:
        """Return a list of *fatal* security misconfigurations.

        Raises:
            RuntimeError: in production when a hard requirement is missing.
        """
        problems: List[str] = []

        if not self.JWT_SECRET_KEY:
            problems.append("JWT_SECRET_KEY must be set")
        elif len(self.JWT_SECRET_KEY) < 32:
            problems.append("JWT_SECRET_KEY must be at least 32 characters")

        if not self.FERNET_KEY:
            problems.append("FERNET_KEY must be set (credential vault encryption key)")
        if not self.AGENT_TOKEN_PEPPER:
            problems.append("AGENT_TOKEN_PEPPER must be set")

        if self.is_prod:
            if not self.COOKIE_SECURE:
                problems.append("COOKIE_SECURE must be true in production")
            if self.DB_TRUST_SERVER_CERT.lower() in ("yes", "true", "1") and self.DB_DIALECT == "mssql":
                problems.append("DB_TRUST_SERVER_CERT must be 'no' in production (use a valid certificate)")
            if "localhost" in self.allowed_hosts_list:
                problems.append("ALLOWED_HOSTS must not contain 'localhost' in production")
            if any(o.startswith("http://") for o in self.cors_origins):
                problems.append("ALLOWED_ORIGINS must use https:// in production")

        if problems and self.is_prod:
            raise RuntimeError("Refusing to start — insecure production configuration: " + "; ".join(problems))
        return problems


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the cached settings singleton."""
    return Settings()


def get_secret(key: str, default: Optional[str] = None) -> Optional[str]:
    """Resolve a secret from the configured backend (env by default).

    Thin wrapper kept for callers that only need one value without
    instantiating the full secret store.
    """
    from app.core.secrets import get_secret_store

    return get_secret_store().get(key, default)


def bootstrap_logging_and_validate() -> None:
    """Validate configuration early and fail fast on insecure production setups."""
    settings = get_settings()
    problems = settings.validate_security()
    if problems and not settings.is_prod:
        print(f"[config] WARNING (non-production): {'; '.join(problems)}", file=sys.stderr)
