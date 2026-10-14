"""Organization service: the single organization that owns this installation.

An On-Premises installation serves exactly one bank / large enterprise.
There is no provisioning of additional organizations, no cross-organization
administration and no organization discriminator on business data. This
service owns the singleton ``Organization`` row:

* branding used by the frontend (logo, colours, locale)
* the vendor-neutral RPA platform configuration **without secrets**
  (UiPath / Automation Anywhere / Blue Prism / in-house estates)
* retention enforcement for the whole installation
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.db.repository import execute, fetch_one, update_rows
from app.db.tables import Organization
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
    "workspace_name",
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

HEX_COLOR_PATTERN = re.compile(r"^#(?:[0-9a-fA-F]{3}){1,2}$")


class OrganizationError(RuntimeError):
    """Invalid organization operation."""


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def get_organization(session: Session) -> Optional[Dict[str, Any]]:
    """Return the singleton organization row without platform secrets."""
    row = fetch_one(session, "SELECT * FROM Organization ORDER BY OrganizationID", operation="organization.get")
    if not row:
        return None
    row.pop("PlatformConfigJson", None)
    return row


def get_branding(session: Session) -> Dict[str, Any]:
    """Branding payload consumed by the frontend at boot (``/api/branding``)."""
    row = fetch_one(
        session,
        """
        SELECT Name, CompanyName, BrandPrimaryColor, BrandAccentColor, LogoUrl, Locale, TimeZone, PlatformProvider
        FROM Organization ORDER BY OrganizationID
        """,
        operation="organization.branding",
    )
    if not row:
        return {
            "name": "RPA CoE Control Room",
            "company_name": "RPA CoE",
            "primary_color": "#6D5DFC",
            "accent_color": "#0F9F91",
            "logo_url": None,
            "locale": "en",
            "time_zone": "UTC",
            "provider": "generic_sql",
        }
    return {
        "name": row.get("Name"),
        "company_name": row.get("CompanyName") or row.get("Name"),
        "primary_color": row.get("BrandPrimaryColor") or "#6D5DFC",
        "accent_color": row.get("BrandAccentColor") or "#0F9F91",
        "logo_url": row.get("LogoUrl"),
        "locale": row.get("Locale") or "en",
        "time_zone": row.get("TimeZone") or "UTC",
        "provider": row.get("PlatformProvider") or "generic_sql",
    }


def update_branding(
    session: Session,
    *,
    name: Optional[str] = None,
    company_name: Optional[str] = None,
    primary_color: Optional[str] = None,
    accent_color: Optional[str] = None,
    logo_url: Optional[str] = None,
    locale: Optional[str] = None,
) -> int:
    """Update organization branding (used by the admin settings screen)."""
    values: Dict[str, Any] = {"UpdatedAt": _now()}
    if name is not None:
        values["Name"] = name.strip()[:200]
    if company_name is not None:
        values["CompanyName"] = company_name.strip()[:200]
    if primary_color:
        if not HEX_COLOR_PATTERN.match(primary_color):
            raise OrganizationError("كود اللون الأساسي غير صالح")
        values["BrandPrimaryColor"] = primary_color
    if accent_color:
        if not HEX_COLOR_PATTERN.match(accent_color):
            raise OrganizationError("كود اللون الثانوي غير صالح")
        values["BrandAccentColor"] = accent_color
    if logo_url is not None:
        values["LogoUrl"] = logo_url[:500]
    if locale in ("en", "ar"):
        values["Locale"] = locale

    org = get_organization(session)
    if not org:
        raise OrganizationError("لم يتم تهيئة المنظمة بعد")
    return update_rows(session, Organization, values, [Organization.c.OrganizationID == int(org["OrganizationID"])])


def set_platform_configuration(
    session: Session,
    *,
    provider: str,
    config: Dict[str, Any],
) -> Dict[str, Any]:
    """Persist the vendor-neutral platform configuration for the organization.

    Secrets (``client_secret``/``password``/``api_key``/``token``) are **never
    stored**: the caller passes either a ``vault:<KEY>`` reference or entries in
    ``secret_ref`` mapping to the secret backend, keeping credentials in the
    bank's own secret manager.
    """
    provider = (provider or "").strip().lower()
    valid = {item["provider"] for item in available_providers()}
    if provider not in valid:
        raise OrganizationError(f"مزوّد غير معروف: {provider}")

    payload: Dict[str, Any] = {}
    secret_ref: Dict[str, str] = {}

    for key, value in (config or {}).items():
        if key in SECRET_KEYS:
            if isinstance(value, str) and value.startswith("vault:"):
                secret_ref[key] = value.split(":", 1)[1]
            elif isinstance(value, str) and value:
                raise OrganizationError(
                    f"لا يتم تخزين '{key}' داخل قاعدة البيانات — استخدم مرجع 'vault:SECRET_KEY' أو احفظه في خزانة الأسرار"
                )
            continue
        if key in ALLOWED_PLATFORM_KEYS:
            payload[key] = value

    if secret_ref:
        payload["secret_ref"] = secret_ref

    org = get_organization(session)
    if not org:
        raise OrganizationError("لم يتم تهيئة المنظمة بعد")
    update_rows(
        session,
        Organization,
        {"PlatformProvider": provider, "PlatformConfigJson": json.dumps(payload, default=str)},
        [Organization.c.OrganizationID == int(org["OrganizationID"])],
    )
    invalidate_adapter_cache()
    logger.info("Platform configuration updated → %s", provider)
    return {"provider": provider, "config": {k: v for k, v in payload.items() if k != "secret_ref"}, "secret_keys": list(secret_ref)}


def get_platform_configuration(session: Session) -> Dict[str, Any]:
    """Read the stored configuration (secrets replaced by references)."""
    row = fetch_one(
        session,
        "SELECT PlatformProvider, PlatformConfigJson FROM Organization ORDER BY OrganizationID",
        operation="organization.platform",
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


def organization_stats(session: Session) -> Dict[str, Any]:
    """Cheap counts used by the organization overview."""
    row = fetch_one(
        session,
        """
        SELECT
            (SELECT COUNT(1) FROM SystemUsers WHERE (IsDeleted = 0 OR IsDeleted IS NULL)) AS users,
            (SELECT COUNT(1) FROM ProcessConfig WHERE (IsDeleted = 0 OR IsDeleted IS NULL)) AS processes,
            (SELECT COUNT(1) FROM BotInfrastructure WHERE (IsDeleted = 0 OR IsDeleted IS NULL)) AS machines,
            (SELECT COUNT(1) FROM ProcessRuns) AS runs
        """,
        operation="organization.stats",
    ) or {}
    return {k: int(v or 0) for k, v in row.items()}


def purge_organization_data(session: Session, *, retention_days: int) -> Dict[str, int]:
    """Retention enforcement: drop telemetry older than the configured window."""
    from app.db.dialect import get_flavor

    flavor = get_flavor()
    results = {}
    results["runs"] = execute(
        session,
        f"DELETE FROM ProcessRuns WHERE StartTime < {flavor.days_ago(retention_days)}",
        operation="retention.runs",
    )
    results["snapshots"] = execute(
        session,
        f"DELETE FROM QueueSnapshots WHERE CapturedAt < {flavor.days_ago(retention_days)}",
        operation="retention.snapshots",
    )
    results["notifications"] = execute(
        session,
        f"DELETE FROM NotificationLog WHERE CreatedAt < {flavor.days_ago(retention_days)}",
        operation="retention.notifications",
    )
    return results
