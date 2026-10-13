"""Organization endpoints (single-organization On-Premises installation).

One installation = one bank / large enterprise. These routes manage *the*
organization that owns the installation: its branding, its vendor-neutral
RPA platform configuration (UiPath / Automation Anywhere / Blue Prism /
in-house), retention enforcement and the provider catalogue. There is no
provisioning of additional organizations.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_organization_admin, require_permission
from app.platforms.registry import invalidate_adapter_cache
from app.services import audit_service, organization_service
from app.services.auth_service import AuthenticatedUser
from app.services.organization_service import OrganizationError

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/organization", tags=["Organization"])


class BrandingUpdate(BaseModel):
    """Organization branding update."""

    Name: Optional[str] = Field(None, max_length=200)
    CompanyName: Optional[str] = Field(None, max_length=200)
    PrimaryColor: Optional[str] = Field(None, pattern=r"^#(?:[0-9a-fA-F]{3}){1,2}$")
    AccentColor: Optional[str] = Field(None, pattern=r"^#(?:[0-9a-fA-F]{3}){1,2}$")
    LogoUrl: Optional[str] = Field(None, max_length=500)
    Locale: Optional[str] = Field(None, pattern="^(en|ar)$")


class PlatformConfigUpdate(BaseModel):
    """Configure the organization's RPA platform."""

    Provider: str = Field(..., max_length=40)
    Config: Dict[str, Any] = Field(
        default_factory=dict,
        description="base_url, auth_mode, client_id, secret_ref, endpoints… (secrets stay in the vault)",
    )


@router.get("", summary="The single organization")
def get_organization(
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_organization_admin),
) -> Dict[str, Any]:
    """Organization row plus usage statistics."""
    org = organization_service.get_organization(db)
    if not org:
        raise HTTPException(status_code=404, detail="المنظمة غير مهيأة")
    return {**org, "stats": organization_service.organization_stats(db)}


@router.patch("/branding", summary="Update organization branding")
def update_branding(
    payload: BrandingUpdate,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_organization_admin),
) -> Dict[str, Any]:
    """Change logo/colours/company name — the UI picks them up on reload."""
    try:
        affected = organization_service.update_branding(
            db,
            name=payload.Name,
            company_name=payload.CompanyName,
            primary_color=payload.PrimaryColor,
            accent_color=payload.AccentColor,
            logo_url=payload.LogoUrl,
            locale=payload.Locale,
        )
    except OrganizationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    audit_service.record(
        db,
        action_type="Organization_Branding_Updated",
        user_id=principal.user_id,
        new_values=payload.model_dump(exclude_none=True),
    )
    return {"status": "success", "affected": affected}


@router.post("/platform", summary="Configure the RPA platform provider")
def configure_platform(
    payload: PlatformConfigUpdate,
    request: Request,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_organization_admin),
) -> Dict[str, Any]:
    """Point the installation at UiPath / Automation Anywhere / Blue Prism / in-house.

    Secrets are **never** stored here: pass ``vault:SECRET_NAME`` references and
    keep the values in the bank's own secret manager.
    """
    try:
        result = organization_service.set_platform_configuration(db, provider=payload.Provider, config=payload.Config)
    except OrganizationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    audit_service.record(
        db,
        action_type="Organization_Platform_Configured",
        user_id=principal.user_id,
        new_values={"provider": payload.Provider, "keys": sorted(payload.Config.keys())},
    )
    return {"status": "success", **result}


@router.get("/platform", summary="Read the platform configuration")
def get_platform_configuration(
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_organization_admin),
) -> Dict[str, Any]:
    """Current provider + non-secret configuration."""
    return organization_service.get_platform_configuration(db)


@router.post("/platform/test", summary="Test platform connectivity")
def test_platform(
    principal: AuthenticatedUser = Depends(require_organization_admin),
) -> Dict[str, Any]:
    """Instantiate the adapter and ping the vendor."""
    from app.platforms.registry import platform_health

    invalidate_adapter_cache()
    return platform_health()


@router.post("/retention/run", summary="Enforce the retention policy now")
def run_retention(
    retention_days: int = Query(730, ge=30, le=3650),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_organization_admin),
) -> Dict[str, Any]:
    """Delete telemetry older than the retention window."""
    result = organization_service.purge_organization_data(db, retention_days=retention_days)
    audit_service.record(
        db,
        action_type="Retention_Enforced",
        user_id=principal.user_id,
        new_values={"retention_days": retention_days, **{k: str(v) for k, v in result.items()}},
    )
    return {"status": "success", "purged": result, "deleted": result, "retention_days": retention_days}


@router.get("/meta/providers", summary="Supported platform providers")
def providers(
    principal: AuthenticatedUser = Depends(require_permission("infrastructure:read", "*")),
) -> List[Dict[str, Any]]:
    """Catalogue used by the setup wizard."""
    return organization_service.list_providers()
