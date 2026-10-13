"""Tenant (white-label) service: branding, platform provider, data isolation.

Every query in the platform is scoped by ``TenantID``.  This service owns the
tenant lifecycle:

* provisioning a new bank/tenant (with its own branding and provider)
* reading the branding used by the frontend (logo, colours, locale)
* storing the multi-vendor platform configuration **without secrets**
* listing which providers are available and which capabilities they support
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.db.repository import execute, fetch_all, fetch_one, insert_row, update_rows
from app.db.tables import Tenants
from app.platforms.registry import available_providers, invalidate_adapter_cache

logger = logging.getLogger(__name__)

#: Keys accepted in ``PlatformConfigJson`` (secrets are resolved at runtime).
ALLOWED_PLATFORM_KEYS = {
    "base_url",
    "auth_mode",
    "token_url",
    "client_id",
    "username",
    "verify_ssl",
    "timeout",
    "max_retries",
    "tenant_name",
    "organization_unit_id",
    "folder_id",
    "extra_headers",
    "endpoints",
    "scope",
    "table_map",
    "column_map",
}

#: Config keys that must be stored as secret references, never raw values.
SECRET_KEYS = {"client_secret", "password", "api_key", "token"}

TENANT_KEY_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$")
HEX_COLOR_PATTERN = re.compile(r"^#(?:[0-9a-fA-F]{3}){1,2}$")


class TenantError(RuntimeError):
    """Invalid tenant operation."""


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def create_tenant(
    session: Session,
    *,
    tenant_key: str,
    name: str,
    company_name: Optional[str] = None,
    primary_color: str = "#4B367C",
    accent_color: str = "#F37920",
    locale: str = "en",
    provider: str = "generic_sql",
    logo_url: Optional[str] = None,
) -> int:
    """Provision a new tenant (bank/white-label customer)."""
    key = (tenant_key or "").strip().lower()
    if not TENANT_KEY_PATTERN.match(key):
        raise TenantError("مفتاح المستأجر يجب أن يكون أحرف إنجليزية صغيرة/أرقام/شرطات (3-50 حرف)")
    if primary_color and not HEX_COLOR_PATTERN.match(primary_color):
        raise TenantError("كود اللون الأساسي غير صالح (مثال: #4B367C)")
    if accent_color and not HEX_COLOR_PATTERN.match(accent_color):
        raise TenantError("كود اللون الثانوي غير صالح")

    if fetch_one(session, "SELECT TenantID FROM Tenants WHERE TenantKey = :k", {"k": key}):
        raise TenantError("مفتاح المستأجر مستخدم بالفعل")

    provider = (provider or "generic_sql").strip().lower()
    valid_providers = {item["provider"] for item in available_providers()}
    if provider not in valid_providers:
        raise TenantError(f"مزوّد غير معروف: {provider}")

    tenant_id = insert_row(
        session,
        Tenants,
        {
            "TenantKey": key,
            "Name": name.strip()[:200],
            "CompanyName": (company_name or name).strip()[:200],
            "BrandPrimaryColor": primary_color,
            "BrandAccentColor": accent_color,
            "LogoUrl": logo_url,
            "Locale": locale,
            "PlatformProvider": provider,
            "IsActive": True,
        },
    )
    from app.db.bootstrap import ROLE_PERMISSIONS
    from app.db.repository import insert_row as _insert
    from app.db.tables import RolePermissions

    for role, permissions in ROLE_PERMISSIONS.items():
        for permission in permissions:
            _insert(session, RolePermissions, {"TenantID": tenant_id, "Role": role, "Permission": permission})

    logger.info("Tenant provisioned: %s (id=%s, provider=%s)", key, tenant_id, provider)
    return int(tenant_id)


def get_tenant(session: Session, tenant_id: int) -> Optional[Dict[str, Any]]:
    """Return the tenant row without platform secrets."""
    row = fetch_one(session, "SELECT * FROM Tenants WHERE TenantID = :t", {"t": tenant_id}, operation="tenant.get")
    if not row:
        return None
    row.pop("PlatformConfigJson", None)
    return row


def get_branding(session: Session, tenant_id: int) -> Dict[str, Any]:
    """Branding payload consumed by the frontend at boot (``/api/branding``)."""
    row = fetch_one(
        session,
        """
        SELECT TenantKey, Name, CompanyName, BrandPrimaryColor, BrandAccentColor, LogoUrl, Locale, TimeZone, PlatformProvider
        FROM Tenants WHERE TenantID = :t
        """,
        {"t": tenant_id},
        operation="tenant.branding",
    )
    if not row:
        return {
            "tenant_key": "default",
            "name": "RPA CoE Control Room",
            "company_name": "RPA CoE",
            "primary_color": "#4B367C",
            "accent_color": "#F37920",
            "logo_url": None,
            "locale": "en",
            "time_zone": "UTC",
            "provider": "generic_sql",
        }
    return {
        "tenant_key": row.get("TenantKey"),
        "name": row.get("Name"),
        "company_name": row.get("CompanyName") or row.get("Name"),
        "primary_color": row.get("BrandPrimaryColor") or "#4B367C",
        "accent_color": row.get("BrandAccentColor") or "#F37920",
        "logo_url": row.get("LogoUrl"),
        "locale": row.get("Locale") or "en",
        "time_zone": row.get("TimeZone") or "UTC",
        "provider": row.get("PlatformProvider") or "generic_sql",
    }


def list_tenants(session: Session, *, include_inactive: bool = False) -> List[Dict[str, Any]]:
    """List tenants (platform-operator view)."""
    where = "" if include_inactive else "WHERE IsActive = 1"
    return fetch_all(
        session,
        f"""
        SELECT TenantID, TenantKey, Name, CompanyName, BrandPrimaryColor, BrandAccentColor,
               Locale, TimeZone, PlatformProvider, IsActive, CreatedAt
        FROM Tenants {where}
        ORDER BY Name
        """,
        operation="tenant.list",
    )


def update_branding(
    session: Session,
    *,
    tenant_id: int,
    name: Optional[str] = None,
    company_name: Optional[str] = None,
    primary_color: Optional[str] = None,
    accent_color: Optional[str] = None,
    logo_url: Optional[str] = None,
    locale: Optional[str] = None,
) -> int:
    """Update white-label branding (used by the admin settings screen)."""
    values: Dict[str, Any] = {"UpdatedAt": _now()}
    if name is not None:
        values["Name"] = name.strip()[:200]
    if company_name is not None:
        values["CompanyName"] = company_name.strip()[:200]
    if primary_color:
        if not HEX_COLOR_PATTERN.match(primary_color):
            raise TenantError("كود اللون الأساسي غير صالح")
        values["BrandPrimaryColor"] = primary_color
    if accent_color:
        if not HEX_COLOR_PATTERN.match(accent_color):
            raise TenantError("كود اللون الثانوي غير صالح")
        values["BrandAccentColor"] = accent_color
    if logo_url is not None:
        values["LogoUrl"] = logo_url[:500]
    if locale in ("en", "ar"):
        values["Locale"] = locale

    return update_rows(session, Tenants, values, [Tenants.c.TenantID == tenant_id])


def set_platform_configuration(
    session: Session,
    *,
    tenant_id: int,
    provider: str,
    config: Dict[str, Any],
) -> Dict[str, Any]:
    """Persist the multi-vendor platform configuration for a tenant.

    Secrets (``client_secret``/``password``/``api_key``/``token``) are **never
    stored**: the caller passes either a ``vault:<KEY>`` reference or entries in
    ``secret_ref`` mapping to the secret backend, keeping credentials in
    Key Vault / Vault.
    """
    provider = (provider or "").strip().lower()
    valid = {item["provider"] for item in available_providers()}
    if provider not in valid:
        raise TenantError(f"مزوّد غير معروف: {provider}")

    payload: Dict[str, Any] = {}
    secret_ref: Dict[str, str] = {}

    for key, value in (config or {}).items():
        if key in SECRET_KEYS:
            if isinstance(value, str) and value.startswith("vault:"):
                secret_ref[key] = value.split(":", 1)[1]
            elif isinstance(value, str) and value:
                # The caller sent a raw secret: keep it out of the DB entirely.
                raise TenantError(
                    f"لا يتم تخزين '{key}' داخل قاعدة البيانات — استخدم مرجع 'vault:SECRET_KEY' أو احفظه في خزانة الأسرار"
                )
            continue
        if key in ALLOWED_PLATFORM_KEYS:
            payload[key] = value

    if secret_ref:
        payload["secret_ref"] = secret_ref

    update_rows(
        session,
        Tenants,
        {"PlatformProvider": provider, "PlatformConfigJson": json.dumps(payload, default=str)},
        [Tenants.c.TenantID == tenant_id],
    )
    invalidate_adapter_cache()
    logger.info("Platform configuration updated for tenant %s → %s", tenant_id, provider)
    return {"provider": provider, "config": {k: v for k, v in payload.items() if k != "secret_ref"}, "secret_keys": list(secret_ref)}


def get_platform_configuration(session: Session, tenant_id: int) -> Dict[str, Any]:
    """Read the stored configuration (secrets replaced by references)."""
    row = fetch_one(
        session,
        "SELECT PlatformProvider, PlatformConfigJson FROM Tenants WHERE TenantID = :t",
        {"t": tenant_id},
        operation="tenant.platform",
    )
    if not row:
        return {"provider": "generic_sql", "config": {}}
    try:
        config = json.loads(row.get("PlatformConfigJson") or "{}")
    except (TypeError, ValueError):
        config = {}
    return {"provider": row.get("PlatformProvider") or "generic_sql", "config": config}


def list_providers() -> List[Dict[str, Any]]:
    """Catalogue of supported RPA platforms + their capabilities."""
    return available_providers()


def set_tenant_active(session: Session, *, tenant_id: int, is_active: bool) -> int:
    """Activate/suspend a tenant (suspension blocks logins immediately)."""
    return update_rows(session, Tenants, {"IsActive": is_active, "UpdatedAt": _now()}, [Tenants.c.TenantID == tenant_id])


def tenant_stats(session: Session, tenant_id: int) -> Dict[str, Any]:
    """Cheap counts used by the platform-operator overview."""
    row = fetch_one(
        session,
        """
        SELECT
            (SELECT COUNT(1) FROM SystemUsers WHERE TenantID = :t AND (IsDeleted = 0 OR IsDeleted IS NULL)) AS users,
            (SELECT COUNT(1) FROM ProcessConfig WHERE TenantID = :t AND (IsDeleted = 0 OR IsDeleted IS NULL)) AS processes,
            (SELECT COUNT(1) FROM BotInfrastructure WHERE TenantID = :t AND (IsDeleted = 0 OR IsDeleted IS NULL)) AS machines,
            (SELECT COUNT(1) FROM ProcessRuns WHERE TenantID = :t) AS runs
        """,
        {"t": tenant_id},
        operation="tenant.stats",
    ) or {}
    return {k: int(v or 0) for k, v in row.items()}


def purge_tenant_data(session: Session, *, tenant_id: int, retention_days: int) -> Dict[str, int]:
    """Retention enforcement: drop telemetry older than the tenant's window."""
    from app.db.dialect import get_flavor

    flavor = get_flavor()
    results = {}
    results["runs"] = execute(
        session,
        f"DELETE FROM ProcessRuns WHERE TenantID = :t AND StartTime < {flavor.days_ago(retention_days)}",
        {"t": tenant_id},
        operation="retention.runs",
    )
    results["snapshots"] = execute(
        session,
        f"DELETE FROM QueueSnapshots WHERE TenantID = :t AND CapturedAt < {flavor.days_ago(retention_days)}",
        {"t": tenant_id},
        operation="retention.snapshots",
    )
    results["notifications"] = execute(
        session,
        f"DELETE FROM NotificationLog WHERE TenantID = :t AND CreatedAt < {flavor.days_ago(retention_days)}",
        {"t": tenant_id},
        operation="retention.notifications",
    )
    return results
