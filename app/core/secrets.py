"""Pluggable secret backends (white-label / bank-grade deployments).

A bank rarely keeps secrets in a ``.env`` file.  This module abstracts secret
resolution behind a tiny interface so the platform can run against:

* **environment variables** (``env``) — dev, docker-compose, simple on-prem
* **Azure Key Vault** (``azure_keyvault``) — managed Azure deployments
* **HashiCorp Vault** (``hashicorp_vault``) — on-prem bank standard

The backend is selected with ``SECRET_BACKEND``.  No code changes are needed
to add a new backend: implement :class:`SecretStore` and register it.

Usage::

    from app.core.secrets import get_secret_store
    db_password = get_secret_store().get("DB_PASSWORD")
"""

from __future__ import annotations

import abc
import logging
import os
from functools import lru_cache
from typing import Dict, Iterable, Optional

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class SecretStore(abc.ABC):
    """Abstract secret resolution interface."""

    name: str = "abstract"

    @abc.abstractmethod
    def get(self, key: str, default: Optional[str] = None) -> Optional[str]:
        """Return the value of ``key`` or ``default`` when missing."""

    def get_many(self, keys: Iterable[str]) -> Dict[str, Optional[str]]:
        """Bulk resolve — default implementation loops over :meth:`get`."""
        return {k: self.get(k) for k in keys}

    def health(self) -> Dict[str, object]:
        """Small health descriptor exposed by ``/health/detail``."""
        return {"backend": self.name, "ok": True}


class EnvSecretStore(SecretStore):
    """Read secrets straight from the process environment."""

    name = "env"

    def get(self, key: str, default: Optional[str] = None) -> Optional[str]:
        return os.environ.get(key, default)


class AzureKeyVaultSecretStore(SecretStore):
    """Azure Key Vault backed store (``azure-keyvault-secrets`` SDK).

    Key Vault forbids underscores in secret names, therefore ``DB_PASSWORD``
    is looked up as ``{AZURE_KEYVAULT_PREFIX}db-password``.  The client is
    created lazily so the dependency is only required when actually used.
    """

    name = "azure_keyvault"

    def __init__(self, vault_url: str, prefix: str = "", cache_ttl: int = 300) -> None:
        if not vault_url:
            raise ValueError("AZURE_KEYVAULT_URL is required for the azure_keyvault backend")
        self._vault_url = vault_url
        self._prefix = prefix
        self._cache: Dict[str, Optional[str]] = {}
        try:  # pragma: no cover - imported only in real deployments
            from azure.identity import DefaultAzureCredential
            from azure.keyvault.secrets import SecretClient

            self._client = SecretClient(vault_url=vault_url, credential=DefaultAzureCredential())
        except Exception as exc:  # pragma: no cover
            logger.error("Azure Key Vault client unavailable: %s", exc)
            raise
        self._ttl = cache_ttl

    def _kv_name(self, key: str) -> str:
        return f"{self._prefix}{key.lower().replace('_', '-')}"

    def get(self, key: str, default: Optional[str] = None) -> Optional[str]:
        if key in self._cache:
            return self._cache[key]
        try:  # pragma: no cover - requires Azure
            value = self._client.get_secret(self._kv_name(key)).value
        except Exception as exc:
            logger.warning("Key Vault lookup failed for %s: %s", key, exc)
            value = os.environ.get(key, default)
        self._cache[key] = value
        return value

    def health(self) -> Dict[str, object]:
        return {"backend": self.name, "vault_url": self._vault_url, "ok": True}


class HashiCorpVaultSecretStore(SecretStore):
    """HashiCorp Vault KV-v2 backed store.

    Supports two auth modes:
      * static token via ``VAULT_TOKEN`` (simplest for on-prem)
      * Kubernetes / AppRole via ``hvac`` auto-auth when available
    """

    name = "hashicorp_vault"

    def __init__(self, addr: str, token: str, mount: str = "secret", path: str = "rpa-coe") -> None:
        if not addr:
            raise ValueError("VAULT_ADDR is required for the hashicorp_vault backend")
        self._mount, self._path = mount, path
        self._cache: Dict[str, Optional[str]] = {}
        try:  # pragma: no cover - imported only in real deployments
            import hvac

            self._client = hvac.Client(url=addr, token=token or None)
        except Exception as exc:  # pragma: no cover
            logger.error("Hashicorp Vault client unavailable: %s", exc)
            raise

    def _read(self) -> Dict[str, object]:
        try:  # pragma: no cover - requires Vault
            resp = self._client.secrets.kv.v2.read_secret_version(path=self._path, mount_point=self._mount)
            return dict(resp.get("data", {}).get("data", {}))
        except Exception as exc:  # pragma: no cover
            logger.warning("Vault read failed (%s); falling back to env", exc)
            return {}

    def get(self, key: str, default: Optional[str] = None) -> Optional[str]:
        if not self._cache:
            self._cache = {k: (str(v) if v is not None else None) for k, v in self._read().items()}
        if self._cache:
            for candidate in (key, key.lower(), key.upper()):
                if candidate in self._cache:
                    return self._cache[candidate]
        return os.environ.get(key, default)

    def health(self) -> Dict[str, object]:
        return {"backend": self.name, "addr": self._mount, "ok": True}


class CachingSecretStore(SecretStore):
    """Memoising decorator — avoids hammering the remote backend per request."""

    def __init__(self, inner: SecretStore) -> None:
        self._inner = inner
        self.name = inner.name
        self._cache: Dict[str, Optional[str]] = {}

    def get(self, key: str, default: Optional[str] = None) -> Optional[str]:
        if key not in self._cache:
            self._cache[key] = self._inner.get(key, default)
        return self._cache[key]

    def health(self) -> Dict[str, object]:
        return self._inner.health()


@lru_cache(maxsize=1)
def get_secret_store() -> SecretStore:
    """Instantiate (once) the store selected by ``SECRET_BACKEND``."""
    settings = get_settings()
    backend = settings.SECRET_BACKEND

    if backend == "azure_keyvault":
        try:
            return CachingSecretStore(
                AzureKeyVaultSecretStore(settings.AZURE_KEYVAULT_URL, settings.AZURE_KEYVAULT_PREFIX)
            )
        except Exception as exc:
            logger.error("Falling back to environment secrets: %s", exc)

    if backend == "hashicorp_vault":
        try:
            return CachingSecretStore(
                HashiCorpVaultSecretStore(
                    settings.VAULT_ADDR, settings.VAULT_TOKEN, settings.VAULT_MOUNT, settings.VAULT_PATH
                )
            )
        except Exception as exc:
            logger.error("Falling back to environment secrets: %s", exc)

    return EnvSecretStore()


def reset_secret_store() -> None:
    """Clear the cached store (used by tests and on config reload)."""
    get_secret_store.cache_clear()
