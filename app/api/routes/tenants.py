"""Multi-tenancy endpoints (provisioning, branding, platform configuration).

Tenant isolation is enforced everywhere by ``TenantID`` scoping.  These routes
are reserved for platform operators (``SuperAdmin``) and cover the white-label
setup: create a bank, brand it, and point it at its RPA platform **without a
code change**.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission, require_platform_admin
from app.platforms.registry import invalidate_adapter_cache
from app.services import audit_service, tenant_service
from app.services.auth_service import AuthenticatedUser
from app.services.tenant_service import TenantError

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/tenants", tags=["Tenants"])


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class TenantCreate(BaseModel):
    """Provision a new tenant (bank / white-label customer)."""

    TenantKey: str = Field(..., min_length=3, max_length=50, description="url-safe key, e.g. 'acme-bank'")
    Name: str = Field(..., min_length=2, max_length=200)
    CompanyName: Optional[str] = Field(None, max_length=200)
    PrimaryColor: str = Field("#4B367C", pattern=r"^#(?:[0-9a-fA-F]{3}){1,2}$")
    AccentColor: str = Field("#F37920", pattern=r"^#(?:[0-9a-fA-F]{3}){1,2}$")
    Locale: str = Field("en", pattern="^(en|ar)$")
    Provider: str = Field("generic_sql", max_length=40)
    LogoUrl: Optional[str] = Field(None, max_length=500)
    AdminUsername: Optional[str] = Field(None, min_length=3, max_length=50)
    AdminPassword: Optional[str] = Field(None, min_length=8, max_length=256)
    AdminEmail: Optional[str] = Field(None, max_length=200)


class BrandingUpdate(BaseModel):
    """White-label branding update."""

    Name: Optional[str] = Field(None, max_length=200)
    CompanyName: Optional[str] = Field(None, max_length=200)
    PrimaryColor: Optional[str] = Field(None, pattern=r"^#(?:[0-9a-fA-F]{3}){1,2}$")
    AccentColor: Optional[str] = Field(None, pattern=r"^#(?:[0-9a-fA-F]{3}){1,2}$")
    LogoUrl: Optional[str] = Field(None, max_length=500)
    Locale: Optional[str] = Field(None, pattern="^(en|ar)$")


class PlatformConfigUpdate(BaseModel):
    """Configure the tenant's RPA platform (UiPath / Automation Anywhere / …)."""

    Provider: str = Field(..., max_length=40)
    Config: Dict[str, Any] = Field(
        default_factory=dict,
        description="base_url, auth_mode, client_id, secret_ref, endpoints… (secrets stay in the vault)",
    )


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
@router.get("", summary="List tenants (platform operator)")
def list_tenants(
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_platform_admin),
) -> List[Dict[str, Any]]:
    """Every tenant with its branding and provider (no secrets)."""
    return tenant_service.list_tenants(db, include_inactive=include_inactive)


@router.post("", status_code=201, summary="Provision a tenant")
def create_tenant(
    payload: TenantCreate,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_platform_admin),
) -> Dict[str, Any]:
    """Create a tenant, seed its roles and optionally its first administrator."""
    try:
        tenant_id = tenant_service.create_tenant(
            db,
            tenant_key=payload.TenantKey,
            name=payload.Name,
            company_name=payload.CompanyName,
            primary_color=payload.PrimaryColor,
            accent_color=payload.AccentColor,
            locale=payload.Locale,
            provider=payload.Provider,
            logo_url=payload.LogoUrl,
        )
    except TenantError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    admin_created = None
    if payload.AdminUsername and payload.AdminPassword:
        from app.services import auth_service

        try:
            admin_created = auth_service.create_user(
                db,
                tenant_id=tenant_id,
                username=payload.AdminUsername,
                password=payload.AdminPassword,
                role="SuperAdmin",
                email=payload.AdminEmail,
                must_change_password=True,
            )
        except Exception as exc:  # pragma: no cover - validation surfaced to caller
            logger.error("Tenant admin creation failed: %s", exc)
            raise HTTPException(status_code=400, detail=f"تم إنشاء المستأجر لكن فشل إنشاء المدير: {exc}") from exc

    audit_service.record(
        db,
        tenant_id=tenant_id,
        action_type="Tenant_Created",
        user_id=principal.user_id,
        entity_type="Tenant",
        entity_id=str(tenant_id),
        new_values={"key": payload.TenantKey, "provider": payload.Provider, "admin": payload.AdminUsername},
    )
    return {
        "status": "success",
        "tenant_id": tenant_id,
        "tenant_key": payload.TenantKey,
        "admin_user_id": admin_created,
        "message": "تم إنشاء المستأجر وتهيئة الأدوار والصلاحيات",
    }


@router.get("/{tenant_id}", summary="Tenant details")
def get_tenant(
    tenant_id: int,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_platform_admin),
) -> Dict[str, Any]:
    """Tenant row plus usage statistics."""
    tenant = tenant_service.get_tenant(db, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="المستأجر غير موجود")
    return {**tenant, "stats": tenant_service.tenant_stats(db, tenant_id)}


@router.patch("/{tenant_id}/branding", summary="Update white-label branding")
def update_branding(
    tenant_id: int,
    payload: BrandingUpdate,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_platform_admin),
) -> Dict[str, Any]:
    """Change logo/colours/company name — the UI picks them up on reload."""
    try:
        affected = tenant_service.update_branding(
            db,
            tenant_id=tenant_id,
            name=payload.Name,
            company_name=payload.CompanyName,
            primary_color=payload.PrimaryColor,
            accent_color=payload.AccentColor,
            logo_url=payload.LogoUrl,
            locale=payload.Locale,
        )
    except TenantError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    audit_service.record(
        db,
        tenant_id=tenant_id,
        action_type="Tenant_Branding_Updated",
        user_id=principal.user_id,
        new_values=payload.model_dump(exclude_none=True),
    )
    return {"status": "success", "affected": affected}


@router.post("/{tenant_id}/platform", summary="Configure the RPA platform provider")
def configure_platform(
    tenant_id: int,
    payload: PlatformConfigUpdate,
    request: Request,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_platform_admin),
) -> Dict[str, Any]:
    """Point the tenant at UiPath / Automation Anywhere / a bespoke platform.

    Secrets are **never** stored here: pass ``vault:SECRET_NAME`` references and
    keep the values in Key Vault / HashiCorp Vault.
    """
    try:
        result = tenant_service.set_platform_configuration(
            db, tenant_id=tenant_id, provider=payload.Provider, config=payload.Config
        )
    except TenantError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    audit_service.record(
        db,
        tenant_id=tenant_id,
        action_type="Tenant_Platform_Configured",
        user_id=principal.user_id,
        new_values={"provider": payload.Provider, "keys": sorted(payload.Config.keys())},
    )
    return {"status": "success", **result}


@router.get("/{tenant_id}/platform", summary="Read the platform configuration")
def get_platform_configuration(
    tenant_id: int,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_platform_admin),
) -> Dict[str, Any]:
    """Current provider + non-secret configuration."""
    return tenant_service.get_platform_configuration(db, tenant_id)


@router.post("/{tenant_id}/platform/test", summary="Test platform connectivity")
def test_platform(
    tenant_id: int,
    principal: AuthenticatedUser = Depends(require_platform_admin),
) -> Dict[str, Any]:
    """Instantiate the adapter and ping the vendor (setup wizard step 3)."""
    from app.platforms.registry import platform_health

    invalidate_adapter_cache()
    return platform_health(tenant_id)


@router.patch("/{tenant_id}/active", summary="Suspend or resume a tenant")
def set_tenant_active(
    tenant_id: int,
    is_active: bool = Query(...),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_platform_admin),
) -> Dict[str, Any]:
    """Suspension blocks logins immediately (contract end / security incident)."""
    affected = tenant_service.set_tenant_active(db, tenant_id=tenant_id, is_active=is_active)
    audit_service.record(
        db,
        tenant_id=tenant_id,
        action_type="Tenant_Activation_Changed",
        user_id=principal.user_id,
        new_values={"is_active": is_active},
        is_success=bool(affected),
    )
    return {"status": "success", "affected": affected}


@router.post("/{tenant_id}/retention/run", summary="Enforce the retention policy now")
def run_retention(
    tenant_id: int,
    retention_days: int = Query(730, ge=30, le=3650),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_platform_admin),
) -> Dict[str, Any]:
    """Delete telemetry older than the retention window (GDPR / data-minimisation)."""
    result = tenant_service.purge_tenant_data(db, tenant_id=tenant_id, retention_days=retention_days)
    audit_service.record(
        db,
        tenant_id=tenant_id,
        action_type="Retention_Enforced",
        user_id=principal.user_id,
        new_values={"retention_days": retention_days, **{k: str(v) for k, v in result.items()}},
    )
    return {"status": "success", "deleted": result, "retention_days": retention_days}


@router.get("/meta/providers", summary="Supported platform providers")
def providers(
    principal: AuthenticatedUser = Depends(require_permission("infrastructure:read", "*")),
) -> List[Dict[str, Any]]:
    """Catalogue used by the tenant setup wizard."""
    return tenant_service.list_providers()
