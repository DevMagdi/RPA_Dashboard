"""Adapter registry — resolves the provider configured for the organization.

Configuring the vendor platform is a **configuration** operation:

1. ``POST /api/organization/platform`` with ``{"provider": "uipath", ...}``
2. credentials are stored through the secret backend
   (Key Vault / Vault / env), never in the repository
3. :func:`get_adapter` returns a ready adapter on the next request

Adding a brand-new vendor only requires implementing
:class:`~app.platforms.base.PlatformAdapter` and registering it here (or via
the ``RPA_PLATFORM_PLUGINS`` setting for out-of-tree plugins).
"""

from __future__ import annotations

import importlib
import json
import logging
import os
from functools import lru_cache
from typing import Any, Dict, List, Optional, Type

from app.core.secrets import get_secret_store
from app.db.repository import fetch_one
from app.db.session import session_scope
from app.platforms.automation_anywhere import AutomationAnywhereAdapter
from app.platforms.base import PlatformAdapter
from app.platforms.generic_sql import GenericSQLAdapter
from app.platforms.blue_prism import BluePrismAdapter
from app.platforms.uipath import UiPathOrchestratorAdapter

logger = logging.getLogger(__name__)

#: Built-in providers.  Keys are the values stored in ``Organization.PlatformProvider``.
BUILTIN_ADAPTERS: Dict[str, Type[PlatformAdapter]] = {
    "generic_sql": GenericSQLAdapter,
    "uipath": UiPathOrchestratorAdapter,
    "automation_anywhere": AutomationAnywhereAdapter,
    "blue_prism": BluePrismAdapter,
}

#: Credential keys that must be resolved through the secret backend rather than
#: being persisted in the organization JSON blob in clear text.
_SECRET_KEYS = ("client_secret", "password", "api_key", "token")


def register_adapter(name: str, adapter: Type[PlatformAdapter]) -> None:
    """Register (or override) an adapter implementation at runtime."""
    BUILTIN_ADAPTERS[name.strip().lower()] = adapter
    logger.info("Platform adapter registered: %s", name)


def load_plugin_adapters() -> None:
    """Load out-of-tree adapters from ``RPA_PLATFORM_PLUGINS``.

    Format: ``provider=module.path:ClassName,other=module:Class`` — lets a bank
    ship Blue Prism/SS&C support as a private package without touching core.
    """
    spec = os.environ.get("RPA_PLATFORM_PLUGINS", "").strip()
    if not spec:
        return
    for entry in spec.split(","):
        try:
            provider, target = entry.split("=", 1)
            module_path, class_name = target.split(":", 1)
            module = importlib.import_module(module_path)
            register_adapter(provider, getattr(module, class_name))
        except Exception as exc:  # pragma: no cover - deployment specific
            logger.error("Failed to load platform plugin %r: %s", entry, exc)


def available_providers() -> List[Dict[str, Any]]:
    """Catalogue of providers for the setup wizard / organization configuration UI."""
    catalogue: List[Dict[str, Any]] = []
    for key, adapter_cls in BUILTIN_ADAPTERS.items():
        # Class-level CAPABILITIES: no instantiation, so the catalogue works
        # with zero credentials configured (HTTP adapters used to raise here
        # because base_url was required, emptying their capability matrix).
        capabilities = dict(getattr(adapter_cls, "CAPABILITIES", {}) or {})
        if not capabilities:  # out-of-tree plugin without the class attribute
            try:
                capabilities = adapter_cls({}).capabilities()
            except Exception:  # pragma: no cover - defensive
                capabilities = {}
        catalogue.append(
            {
                "provider": key,
                "display_name": getattr(adapter_cls, "display_name", key),
                "capabilities": capabilities,
            }
        )
    return catalogue


def _resolve_secrets(config: Dict[str, Any]) -> Dict[str, Any]:
    """Replace secret references with real values from the secret backend.

    Two supported shapes::

        {"client_secret": "vault:UIPATH_CLIENT_SECRET"}   # explicit reference
        {"client_secret": "", "secret_ref": {"client_secret": "UIPATH_SECRET"}}

    Anything resolved through the secret store is never written back to the
    database.
    """
    resolved = dict(config or {})
    secret_refs: Dict[str, str] = resolved.pop("secret_ref", {}) or {}
    store = get_secret_store()

    for key in _SECRET_KEYS:
        value = resolved.get(key)
        if isinstance(value, str) and value.startswith("vault:"):
            resolved[key] = store.get(value.split(":", 1)[1], "") or ""
        elif key in secret_refs:
            resolved[key] = store.get(secret_refs[key], "") or ""
    return resolved


def build_adapter(provider: str, config: Optional[Dict[str, Any]] = None) -> PlatformAdapter:
    """Instantiate an adapter for ``provider`` with the given configuration."""
    key = (provider or "generic_sql").strip().lower()
    adapter_cls = BUILTIN_ADAPTERS.get(key)
    if adapter_cls is None:
        logger.warning("Unknown platform provider %r — falling back to generic_sql", provider)
        adapter_cls = GenericSQLAdapter
        key = "generic_sql"

    payload = _resolve_secrets(config or {})
    return adapter_cls(payload)


def get_platform_config() -> Dict[str, Any]:
    """Load the stored provider + configuration for the organization."""
    with session_scope() as session:
        row = fetch_one(
            session,
            "SELECT PlatformProvider, PlatformConfigJson FROM Organization ORDER BY OrganizationID",
            {},
            operation="registry.platform_config",
        )
    if not row:
        return {"provider": "generic_sql", "config": {}}

    raw = row.get("PlatformConfigJson")
    try:
        config = json.loads(raw) if raw else {}
    except (TypeError, ValueError):
        config = {}
    return {"provider": row.get("PlatformProvider") or "generic_sql", "config": config}


@lru_cache(maxsize=64)
def _cached_adapter(provider: str, config_json: str) -> PlatformAdapter:
    """Adapters are stateless enough to be cached per config."""
    try:
        config = json.loads(config_json) if config_json else {}
    except ValueError:
        config = {}
    return build_adapter(provider, config)


def get_adapter(*, use_cache: bool = True) -> PlatformAdapter:
    """Return a ready-to-use adapter for the configured provider."""
    stored = get_platform_config()
    provider = stored["provider"]
    config = stored["config"]

    if not use_cache:
        return build_adapter(provider, config)
    try:
        return _cached_adapter(provider, json.dumps(config, sort_keys=True, default=str))
    except TypeError:  # unhashable config → bypass the cache
        return build_adapter(provider, config)


def invalidate_adapter_cache() -> None:
    """Drop cached adapters (called when platform config changes)."""
    _cached_adapter.cache_clear()


def platform_health() -> Dict[str, Any]:
    """Health probe of the configured provider (used by ``/health/detail``)."""
    adapter = get_adapter()
    health = adapter.health()
    return {
        "provider": health.provider,
        "display_name": adapter.display_name,
        "ok": health.ok,
        "message": health.message,
        "latency_ms": health.latency_ms,
        "capabilities": adapter.capabilities(),
    }
