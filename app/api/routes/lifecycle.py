"""Bot lifecycle, credential vault and release-governance endpoints."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, request_meta, require_permission
from app.services import audit_service, lifecycle_service, process_service
from app.services.auth_service import AuthenticatedUser
from app.services.lifecycle_service import LifecycleError

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["Lifecycle & Vault"])


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class BotVersionCreate(BaseModel):
    """Register a new bot version."""

    ProcessName: str = Field(..., min_length=1, max_length=100)
    VersionTag: str = Field(..., min_length=1, max_length=40)
    TargetMachineName: Optional[str] = Field(None, max_length=100)
    Description: Optional[str] = Field(None, max_length=2000)
    ArtifactUrl: Optional[str] = Field(None, max_length=500)
    Department: Optional[str] = Field(None, max_length=50)


class PromotionRequest(BaseModel):
    """Promote a version to another environment."""

    TargetEnvironment: str = Field(..., pattern="^(Development|UAT|Production|Retired)$")
    Comment: Optional[str] = Field(None, max_length=500)
    ApprovalID: Optional[int] = None
    Force: bool = Field(False, description="Break-glass: skip the approval requirement (SuperAdmin only)")


class CredentialInput(BaseModel):
    """Store a credential inside the encrypted vault."""

    CredentialName: str = Field(..., min_length=1, max_length=100)
    Environment: str = Field(..., pattern="^(Development|UAT|Production)$")
    Value: str = Field(..., min_length=1, max_length=8000)


class ApprovalRequestCreate(BaseModel):
    """Request a four-eyes approval for a promotion."""

    VersionID: int
    TargetEnvironment: str = Field(..., pattern="^(Development|UAT|Production|Retired)$")
    Comment: Optional[str] = Field(None, max_length=500)
    RiskNotes: Optional[str] = Field(None, max_length=2000)


class ApprovalDecision(BaseModel):
    """Approve or reject a pending request."""

    Approved: bool
    Comment: Optional[str] = Field(None, max_length=500)


class RollbackRequest(BaseModel):
    """Roll a process back to a previous production build."""

    ProcessName: str = Field(..., min_length=1, max_length=100)
    ToVersionID: int
    Reason: str = Field(..., min_length=3, max_length=300)


class VaultReadRequest(BaseModel):
    """Justification for reading a secret (recorded in the audit trail)."""

    Reason: str = Field(..., min_length=3, max_length=300)


# --------------------------------------------------------------------------- #
# Versions
# --------------------------------------------------------------------------- #
@router.get("/bot-versions", summary="Version history")
def list_versions(
    process: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("lifecycle:read", "*")),
) -> List[Dict[str, Any]]:
    """List versions with credential counts and environment status."""
    return lifecycle_service.list_versions(db, process_name=process)


@router.post("/bot-versions", status_code=201, summary="Register a bot version")
def create_version(
    payload: BotVersionCreate,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("lifecycle:write", "*")),
) -> Dict[str, Any]:
    """Create a version in ``Development`` (upserts the process if needed)."""
    if not process_service.process_exists(db, process_name=payload.ProcessName):
        process_service.ensure_process(
            db,
            
            process_name=payload.ProcessName,
            department=payload.Department or "Operations",
        )

    try:
        result = lifecycle_service.create_version(
            db,
            
            process_name=payload.ProcessName,
            version_tag=payload.VersionTag,
            target_machine=payload.TargetMachineName,
            notes=payload.Description,
            artifact_url=payload.ArtifactUrl,
            created_by=principal.user_id,
        )
    except LifecycleError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    audit_service.record(
        db,
        
        action_type="Version_Created",
        user_id=principal.user_id,
        process_name=payload.ProcessName,
        entity_type="BotVersion",
        entity_id=str(result["version_id"]),
        new_values=result,
    )
    return {"status": "success", "message": "تم تسجيل النسخة في بيئة التطوير", **result}


@router.get("/bot-versions/{process_name}/history", summary="Version history for one process")
def version_history(
    process_name: str,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("lifecycle:read", "*")),
) -> List[Dict[str, Any]]:
    """All versions of a process, newest first."""
    return lifecycle_service.list_versions(db, process_name=process_name)


@router.get("/bot-versions/live-status", summary="Lifecycle dashboard counters")
def live_status(
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("lifecycle:read", "*")),
) -> Dict[str, Any]:
    """Environment counters, recent promotions and live deployments."""
    return lifecycle_service.lifecycle_overview(db)


# --------------------------------------------------------------------------- #
# Promotion & approvals
# --------------------------------------------------------------------------- #
@router.post("/bot-versions/{version_id}/promote", summary="Promote a version (state machine)")
def promote_version(
    version_id: int,
    payload: PromotionRequest,
    request: Request,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("lifecycle:promote", "*")),
    meta=Depends(request_meta),
) -> Dict[str, Any]:
    """Move a version between environments.

    ``Development → UAT → Production`` only; production requires an approved
    four-eyes request unless an administrator uses the break-glass flag.
    """
    if payload.Force and principal.role != "SuperAdmin":
        raise HTTPException(status_code=403, detail="التجاوز الطارئ متاح للمسؤول الأعلى فقط")

    try:
        result = lifecycle_service.promote_version(
            db,
            
            version_id=version_id,
            target_environment=payload.TargetEnvironment,
            promoted_by=principal.user_id,
            ip_address=meta.ip_address,
            comment=payload.Comment,
            approval_id=payload.ApprovalID,
            force=payload.Force,
        )
    except LifecycleError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    audit_service.record(
        db,
        
        action_type="Version_Promote_Forced" if payload.Force else "Version_Promote",
        user_id=principal.user_id,
        process_name=result.get("process_name"),
        entity_type="BotVersion",
        entity_id=str(version_id),
        old_values={"status": result["previous_status"]},
        new_values={
            "status": result["new_status"],
            "comment": payload.Comment,
            "approval_id": payload.ApprovalID,
            "break_glass": payload.Force,
        },
        ip_address=meta.ip_address,
        user_agent=meta.user_agent,
    )
    return {"status": "success", "message": f"تم نقل النسخة إلى {result['new_status']}", **result}


@router.get("/approvals", summary="Approval queue")
def list_approvals(
    status_filter: Optional[str] = Query(None, alias="status", pattern="^(Pending|Approved|Rejected)$"),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("lifecycle:read", "*")),
) -> List[Dict[str, Any]]:
    """Pending and historical approval requests."""
    return lifecycle_service.list_approvals(db, status=status_filter)


@router.post("/approvals", status_code=201, summary="Request a promotion approval")
def request_approval(
    payload: ApprovalRequestCreate,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("lifecycle:promote", "*")),
) -> Dict[str, Any]:
    """Create a four-eyes request for a production change."""
    try:
        result = lifecycle_service.request_approval(
            db,
            
            version_id=payload.VersionID,
            target_environment=payload.TargetEnvironment,
            requested_by=principal.user_id,
            comment=payload.Comment,
            risk_notes=payload.RiskNotes,
        )
    except LifecycleError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    audit_service.record(
        db,
        
        action_type="Approval_Requested",
        user_id=principal.user_id,
        entity_type="BotVersion",
        entity_id=str(payload.VersionID),
        new_values=result,
    )
    return {"status": "success", **result}


@router.post("/approvals/{approval_id}/decide", summary="Approve or reject a request")
def decide_approval(
    approval_id: int,
    payload: ApprovalDecision,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("lifecycle:approve", "*")),
) -> Dict[str, Any]:
    """Decide a pending request (self-approval is refused — separation of duties)."""
    try:
        result = lifecycle_service.decide_approval(
            db,
            
            approval_id=approval_id,
            approved=payload.Approved,
            decided_by=principal.user_id,
            comment=payload.Comment,
        )
    except LifecycleError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    audit_service.record(
        db,
        
        action_type="Approval_Granted" if payload.Approved else "Approval_Rejected",
        user_id=principal.user_id,
        entity_type="ApprovalRequest",
        entity_id=str(approval_id),
        new_values={"comment": payload.Comment, **result},
        is_success=payload.Approved,
    )
    return {"status": "success", **result}


@router.post("/bot-versions/rollback", summary="Roll back a process to a previous build")
def rollback(
    payload: RollbackRequest,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("lifecycle:approve", "*")),
) -> Dict[str, Any]:
    """Restore a previous production version (audited, requires approval rights)."""
    try:
        result = lifecycle_service.rollback_process(
            db,
            
            process_name=payload.ProcessName,
            to_version_id=payload.ToVersionID,
            performed_by=principal.user_id,
            reason=payload.Reason,
        )
    except LifecycleError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    audit_service.record(
        db,
        
        action_type="Version_Rollback",
        user_id=principal.user_id,
        process_name=payload.ProcessName,
        entity_type="BotVersion",
        entity_id=str(payload.ToVersionID),
        new_values={"reason": payload.Reason},
    )
    return {"status": "success", "message": "تم الرجوع للنسخة السابقة", **result}


# --------------------------------------------------------------------------- #
# Credential vault
# --------------------------------------------------------------------------- #
@router.get("/bot-versions/{version_id}/credentials", summary="List credential metadata")
def list_credentials(
    version_id: int,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("lifecycle:read", "*")),
) -> List[Dict[str, Any]]:
    """Names/environments only — values are never returned by the list call."""
    return lifecycle_service.list_credentials(db, version_id=version_id)


@router.post("/bot-versions/{version_id}/credentials", status_code=201, summary="Store a credential")
def add_credential(
    version_id: int,
    payload: CredentialInput,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("lifecycle:write", "*")),
) -> Dict[str, Any]:
    """Encrypt and store a secret in the vault (Fernet, Key Vault-backed key)."""
    version = lifecycle_service.get_version(db, version_id=version_id)
    if not version:
        raise HTTPException(status_code=404, detail="النسخة غير موجودة")

    try:
        result = lifecycle_service.add_credential(
            db,
            
            version_id=version_id,
            credential_name=payload.CredentialName,
            environment=payload.Environment,
            value=payload.Value,
            created_by=principal.user_id,
        )
    except LifecycleError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    audit_service.record(
        db,
        
        action_type="Vault_Add_Cred",
        user_id=principal.user_id,
        process_name=version.get("ProcessName"),
        entity_type="BotVault",
        entity_id=str(result["vault_id"]),
        new_values={"CredentialName": payload.CredentialName, "Environment": payload.Environment},
    )
    return {"status": "success", "message": "تم تشفير السر وتخزينه بنجاح", **result}


@router.post("/bot-versions/{version_id}/decrypt/{vault_id}", summary="Read a credential (audited)")
def read_credential(
    version_id: int,
    vault_id: int,
    payload: VaultReadRequest,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("lifecycle:write", "*")),
    meta=Depends(request_meta),
) -> Dict[str, Any]:
    """Decrypt a secret — the read is **always** written to the audit trail."""
    try:
        result = lifecycle_service.read_credential(
            db,
            
            vault_id=vault_id,
            version_id=version_id,
            user_id=principal.user_id,
            ip_address=meta.ip_address,
            user_agent=meta.user_agent,
            reason=payload.Reason,
        )
    except LifecycleError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "success", **result}


@router.delete("/vault/{vault_id}", summary="Delete a credential")
def delete_credential(
    vault_id: int,
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("lifecycle:write", "*")),
) -> Dict[str, Any]:
    """Logically delete a secret (history preserved for audits)."""
    affected = lifecycle_service.soft_delete_credential(db, vault_id=vault_id)
    if not affected:
        raise HTTPException(status_code=404, detail="السر غير موجود")
    audit_service.record(
        db,
        
        action_type="Vault_Delete_Cred",
        user_id=principal.user_id,
        entity_type="BotVault",
        entity_id=str(vault_id),
    )
    return {"status": "success", "affected": affected}


@router.get("/vault/statistics", summary="Vault hygiene metrics")
def vault_statistics(
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("audit:read", "*")),
) -> Dict[str, Any]:
    """Credential counts, reads and the most recent access events."""
    return lifecycle_service.vault_statistics(db)


@router.post("/vault/rotate-key", summary="Re-encrypt secrets with the newest key")
def rotate_key(
    dry_run: bool = Query(True),
    db: Session = Depends(get_db),
    principal: AuthenticatedUser = Depends(require_permission("*")),
) -> Dict[str, Any]:
    """Rotate ``FERNET_KEY`` (run ``dry_run=true`` first in production)."""
    result = lifecycle_service.rotate_vault_key(db, dry_run=dry_run)
    audit_service.record(
        db,
        
        action_type="Vault_Key_Rotation",
        user_id=principal.user_id,
        new_values=result,
    )
    return {"status": "success", **result}
