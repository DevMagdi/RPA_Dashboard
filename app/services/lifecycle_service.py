"""Bot lifecycle, credential vault and release governance.

Adds the enterprise controls a bank needs on top of the original
"create version → promote" flow:

* **environment state machine** — ``Development → UAT → Production`` only
  (no accidental straight-to-prod), with ``Retired`` as a terminal state
* **four-eyes approval** — production promotions require an approval request
  decided by a *different* user with the ``lifecycle:approve`` permission
* **credential vault** — encrypted values with access accounting, mandatory
  audit on read (``record_strict``) and key-rotation support
* **rollback** — instantly point a process back to a previous production build
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.core.security import get_vault_cipher
from app.db.dialect import get_flavor
from app.db.repository import fetch_all, fetch_one, insert_row, update_rows
from app.db.tables import ApprovalRequests, BotVault, BotVersions, PromotionAuditLog

logger = logging.getLogger(__name__)

ENVIRONMENTS = ("Development", "UAT", "Production", "Retired")

#: Allowed forward transitions (the state machine).
TRANSITIONS: Dict[str, tuple[str, ...]] = {
    # Strict forward-only pipeline. Rollback is a separate audited operation
    # (``rollback_process``), never a free-form backward promotion.
    "Development": ("UAT", "Retired"),
    "UAT": ("Production", "Retired"),
    "Production": ("Retired",),
    "Retired": (),
}

PRODUCTION_LIKE = ("Production",)


class LifecycleError(RuntimeError):
    """Invalid lifecycle operation (bad transition, missing approval…)."""


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _normalize_env(value: Optional[str]) -> str:
    """Normalise legacy status strings such as ``"UAT (comment)"``."""
    if not value:
        return "Development"
    text = str(value).strip()
    for environment in ENVIRONMENTS:
        if text.startswith(environment):
            return environment
    return text.split("(")[0].strip() or "Development"


# --------------------------------------------------------------------------- #
# Versions
# --------------------------------------------------------------------------- #
def create_version(
    session: Session,
    *,
    
    process_name: str,
    version_tag: str,
    target_machine: Optional[str] = None,
    notes: Optional[str] = None,
    artifact_url: Optional[str] = None,
    created_by: Optional[int] = None,
) -> Dict[str, Any]:
    """Register a new bot version in Development."""
    if not version_tag or len(version_tag) > 40:
        raise LifecycleError("رقم النسخة غير صالح")

    duplicate = fetch_one(
        session,
        "SELECT VersionID FROM BotVersions WHERE ProcessName = :p AND VersionTag = :v",
        {"p": process_name, "v": version_tag},
        operation="lifecycle.duplicate_version",
    )
    if duplicate:
        raise LifecycleError("رقم هذه النسخة مسجل بالفعل لهذه العملية")

    version_id = insert_row(
        session,
        BotVersions,
        {
            "ProcessName": process_name[:100],
            "VersionTag": version_tag[:40],
            "CurrentStatus": "Development",
            "TargetMachineName": (target_machine or "")[:100] or None,
            "CreatedBy": created_by,
            "Notes": notes,
            "ArtifactUrl": artifact_url,
        },
    )
    return {"version_id": int(version_id), "version_tag": version_tag, "status": "Development"}


def get_version(session: Session, *, version_id: int) -> Optional[Dict[str, Any]]:
    """Fetch a single version row."""
    row = fetch_one(
        session,
        "SELECT * FROM BotVersions WHERE VersionID = :v",
        {"v": version_id},
        operation="lifecycle.get_version",
    )
    return row


def list_versions(
    session: Session, *, process_name: Optional[str] = None, limit: int = 200
) -> List[Dict[str, Any]]:
    """Version history with credential counts and approval state."""
    flavor = get_flavor()
    where = [f"v.IsDeleted = {flavor.false_literal}"]
    params: Dict[str, Any] = {"limit": int(min(limit, 500))}
    if process_name:
        where.append("v.ProcessName = :p")
        params["p"] = process_name

    rows = fetch_all(
        session,
        f"""
        SELECT {flavor.top(params['limit'])}
               v.VersionID, v.ProcessName, v.VersionTag, v.CurrentStatus, v.TargetMachineName,
               v.CreatedBy, v.CreatedAt, v.LastPromotedAt, v.Notes, v.ArtifactUrl,
               u.Username AS CreatorName,
               (SELECT COUNT(1) FROM BotVault b WHERE b.VersionID = v.VersionID) AS CredentialsCount
        FROM BotVersions v
        LEFT JOIN SystemUsers u ON u.UserID = v.CreatedBy
        WHERE {' AND '.join(where)}
        ORDER BY v.CreatedAt DESC, v.VersionID DESC{flavor.limit(params['limit'])}
        """,
        params,
        operation="lifecycle.list_versions",
    )
    for row in rows:
        row["CurrentStatus"] = _normalize_env(row.get("CurrentStatus"))
        row["CredentialsCount"] = int(row.get("CredentialsCount") or 0)
    return rows


def lifecycle_overview(session: Session) -> Dict[str, Any]:
    """Environment counters + recent promotions (Lifecycle hub header)."""
    flavor = get_flavor()
    counts = fetch_one(
        session,
        """
        SELECT
            COALESCE(SUM(CASE WHEN CurrentStatus = 'Production' THEN 1 ELSE 0 END), 0) AS production,
            COALESCE(SUM(CASE WHEN CurrentStatus = 'UAT' THEN 1 ELSE 0 END), 0) AS uat,
            COALESCE(SUM(CASE WHEN CurrentStatus = 'Development' THEN 1 ELSE 0 END), 0) AS development,
            COALESCE(SUM(CASE WHEN CurrentStatus = 'Retired' THEN 1 ELSE 0 END), 0) AS retired,
            COUNT(1) AS total
        FROM BotVersions WHERE 1 = 1
        """,
        {},
        operation="lifecycle.counts",
    ) or {}

    pending = fetch_one(
        session,
        "SELECT COUNT(1) AS pending FROM ApprovalRequests WHERE Status = 'Pending'",
        {},
        operation="lifecycle.pending_approvals",
    ) or {}

    promotions = fetch_all(
        session,
        f"""
        SELECT {flavor.top(20)} v.ProcessName, v.VersionTag, p.PreviousStatus, p.NewStatus,
               p.PromotedAt, p.Comment, u.Username
        FROM PromotionAuditLog p
        JOIN BotVersions v ON v.VersionID = p.VersionID
        LEFT JOIN SystemUsers u ON u.UserID = p.PromotedBy
        WHERE 1 = 1
        ORDER BY p.PromotedAt DESC{flavor.limit(20)}
        """,
        {},
        operation="lifecycle.recent_promotions",
    )

    # "Live" picture: which version runs in which environment per process
    live = fetch_all(
        session,
        f"""
        SELECT {flavor.top(200)} ProcessName, VersionTag, CurrentStatus, LastPromotedAt
        FROM BotVersions
        WHERE CurrentStatus IN ('Production','UAT')
        ORDER BY ProcessName, LastPromotedAt DESC{flavor.limit(200)}
        """,
        {},
        operation="lifecycle.live",
    )

    for item in promotions + live:
        if "PreviousStatus" in item:
            item["PreviousStatus"] = _normalize_env(item.get("PreviousStatus"))
        if "NewStatus" in item:
            item["NewStatus"] = _normalize_env(item.get("NewStatus"))
        if "CurrentStatus" in item:
            item["CurrentStatus"] = _normalize_env(item.get("CurrentStatus"))

    return {
        "counts": {
            "ProductionCount": int(counts.get("production") or 0),
            "UATCount": int(counts.get("uat") or 0),
            "DevCount": int(counts.get("development") or 0),
            "RetiredCount": int(counts.get("retired") or 0),
            "TotalCount": int(counts.get("total") or 0),
            "PendingApprovals": int(pending.get("pending") or 0),
        },
        "recent_promotions": promotions,
        "live_deployments": live,
    }


def validate_transition(current: str, target: str) -> None:
    """Enforce the environment state machine."""
    current = _normalize_env(current)
    if target not in ENVIRONMENTS:
        raise LifecycleError(f"بيئة غير معروفة: {target}")
    if current == target:
        raise LifecycleError(f"النسخة موجودة بالفعل في بيئة {target}")
    if target not in TRANSITIONS.get(current, ()):
        raise LifecycleError(f"لا يمكن الانتقال من {current} إلى {target} — المسار المسموح: Development → UAT → Production")


def requires_approval(target_environment: str) -> bool:
    """Production changes need a second pair of eyes."""
    return target_environment in PRODUCTION_LIKE


def promote_version(
    session: Session,
    *,
    
    version_id: int,
    target_environment: str,
    promoted_by: Optional[int],
    ip_address: Optional[str] = None,
    comment: Optional[str] = None,
    approval_id: Optional[int] = None,
    force: bool = False,
) -> Dict[str, Any]:
    """Move a version between environments, enforcing the state machine.

    Production promotions require an approved :class:`ApprovalRequests` row
    unless ``force`` is used by a break-glass administrator (still audited).
    """
    version = get_version(session, version_id=version_id)
    if not version:
        raise LifecycleError("النسخة غير موجودة")

    current = _normalize_env(version.get("CurrentStatus"))
    validate_transition(current, target_environment)

    approval = None
    if requires_approval(target_environment) and not force:
        if not approval_id:
            raise LifecycleError("الترقية إلى الإنتاج تتطلب طلب موافقة معتمد (Four-eyes)")
        approval = fetch_one(
            session,
            "SELECT * FROM ApprovalRequests WHERE ApprovalID = :a",
            {"a": approval_id},
            operation="lifecycle.approval_lookup",
        )
        if not approval or str(approval.get("Status")) != "Approved":
            raise LifecycleError("طلب الموافقة غير معتمد")
        if int(approval.get("VersionID")) != int(version_id):
            raise LifecycleError("طلب الموافقة لا يخص هذه النسخة")
        # Four-eyes: the approver must be a different person from the requester.
        if approval.get("RequestedBy") and approval.get("ApprovedBy") and int(approval["RequestedBy"]) == int(approval["ApprovedBy"]):
            raise LifecycleError("لا يمكن لمقدّم الطلب اعتماد طلبه بنفسه (فصل المهام — Four-eyes)")

    if target_environment in ("UAT", "Production") and not _has_credentials_for(
        session, version_id=version_id, environment=target_environment
    ):
        raise LifecycleError(f"لا يمكن النشر إلى {target_environment} بدون أسرار تلك البيئة (أضف بيانات الاعتماد أولاً)")

    update_rows(
        session,
        BotVersions,
        {"CurrentStatus": target_environment, "LastPromotedAt": _now()},
        [BotVersions.c.VersionID == version_id],
    )
    insert_row(
        session,
        PromotionAuditLog,
        {
            "VersionID": version_id,
            "PreviousStatus": current[:40],
            "NewStatus": target_environment[:40],
            "PromotedBy": promoted_by,
            "IPAddress": (ip_address or "")[:64] or None,
            "Comment": (comment or "")[:500] or None,
        },
    )

    # Retiring a process: also demote the previously promoted production build
    logger.info(
        "Version promoted: process=%s version=%s %s → %s",
        version.get("ProcessName"),
        version.get("VersionTag"),
        current,
        target_environment,
    )
    return {
        "version_id": version_id,
        "process_name": version.get("ProcessName"),
        "version_tag": version.get("VersionTag"),
        "previous_status": current,
        "new_status": target_environment,
    }


def _has_credentials_for(session: Session, *, version_id: int, environment: str = "Production") -> bool:
    """Guard: production releases must ship with production credentials."""
    row = fetch_one(
        session,
        """
        SELECT COUNT(1) AS c FROM BotVault
        WHERE VersionID = :v AND Environment = :e AND (IsDeleted = 0 OR IsDeleted IS NULL)
        """,
        {"v": version_id, "e": environment},
        operation="lifecycle.credentials_present",
    )
    return bool(row and int(row.get("c") or 0) > 0)


def rollback_process(
    session: Session, *, process_name: str, to_version_id: int, performed_by: Optional[int], reason: str = ""
) -> Dict[str, Any]:
    """Roll a process back to a previous production build (audited)."""
    target = get_version(session, version_id=to_version_id)
    if not target or str(target.get("ProcessName")) != process_name:
        raise LifecycleError("النسخة المطلوب الرجوع إليها غير صحيحة")

    current_prod = fetch_one(
        session,
        "SELECT VersionID, VersionTag FROM BotVersions WHERE ProcessName = :p AND CurrentStatus = 'Production'",
        {"p": process_name},
        operation="lifecycle.current_production",
    )

    if current_prod:
        update_rows(
            session,
            BotVersions,
            {"CurrentStatus": "UAT", "LastPromotedAt": _now()},
            [BotVersions.c.VersionID == int(current_prod["VersionID"])],
        )

    update_rows(
        session,
        BotVersions,
        {"CurrentStatus": "Production", "LastPromotedAt": _now()},
        [BotVersions.c.VersionID == to_version_id],
    )
    insert_row(
        session,
        PromotionAuditLog,
        {
            "VersionID": to_version_id,
            "PreviousStatus": str(current_prod.get("VersionTag")) if current_prod else "None",
            "NewStatus": "Production (Rollback)",
            "PromotedBy": performed_by,
            "Comment": f"Rollback: {reason}"[:500],
        },
    )
    return {
        "process_name": process_name,
        "rolled_back_to": target.get("VersionTag"),
        "previous_version": (current_prod or {}).get("VersionTag"),
    }


# --------------------------------------------------------------------------- #
# Approval workflow
# --------------------------------------------------------------------------- #
def request_approval(
    session: Session,
    *,
    
    version_id: int,
    target_environment: str,
    requested_by: int,
    comment: Optional[str] = None,
    risk_notes: Optional[str] = None,
) -> Dict[str, Any]:
    """Create a pending approval request (four-eyes principle)."""
    version = get_version(session, version_id=version_id)
    if not version:
        raise LifecycleError("النسخة غير موجودة")
    validate_transition(str(version.get("CurrentStatus")), target_environment)

    existing = fetch_one(
        session,
        "SELECT ApprovalID FROM ApprovalRequests WHERE VersionID = :v AND Status = 'Pending'",
        {"v": version_id},
        operation="lifecycle.pending_request",
    )
    if existing:
        raise LifecycleError("يوجد طلب موافقة معلّق لهذه النسخة بالفعل")

    approval_id = insert_row(
        session,
        ApprovalRequests,
        {
            "VersionID": version_id,
            "ProcessName": str(version.get("ProcessName"))[:100],
            "TargetEnvironment": target_environment[:40],
            "RequestedBy": requested_by,
            "Status": "Pending",
            "Comment": (comment or "")[:500] or None,
            "RiskNotes": risk_notes,
        },
    )
    return {"approval_id": int(approval_id), "status": "Pending", "target_environment": target_environment}


def decide_approval(
    session: Session,
    *,
    
    approval_id: int,
    approved: bool,
    decided_by: int,
    comment: Optional[str] = None,
) -> Dict[str, Any]:
    """Approve or reject a pending request (self-approval is rejected)."""
    row = fetch_one(
        session,
        "SELECT * FROM ApprovalRequests WHERE ApprovalID = :a",
        {"a": approval_id},
        operation="lifecycle.approval",
    )
    if not row:
        raise LifecycleError("طلب الموافقة غير موجود")
    if str(row.get("Status")) != "Pending":
        raise LifecycleError("تم البت في هذا الطلب بالفعل")
    if int(row.get("RequestedBy")) == int(decided_by):
        raise LifecycleError("لا يمكن اعتماد طلبك بنفسك — مطلوب شخص آخر (فصل المهام)")

    update_rows(
        session,
        ApprovalRequests,
        {
            "Status": "Approved" if approved else "Rejected",
            "ApprovedBy": decided_by,
            "DecidedAt": _now(),
            "Comment": (comment or row.get("Comment"))[:500] if comment or row.get("Comment") else None,
        },
        [ApprovalRequests.c.ApprovalID == approval_id],
    )
    return {
        "approval_id": approval_id,
        "status": "Approved" if approved else "Rejected",
        "version_id": int(row["VersionID"]),
        "target_environment": row.get("TargetEnvironment"),
    }


def list_approvals(session: Session, *, status: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
    """Approval queue for the governance screen."""
    flavor = get_flavor()
    where = ["1 = 1"]
    params: Dict[str, Any] = {"limit": int(min(limit, 300))}
    if status:
        where.append("a.Status = :s")
        params["s"] = status

    return fetch_all(
        session,
        f"""
        SELECT {flavor.top(params['limit'])} a.ApprovalID, a.VersionID, a.ProcessName, a.TargetEnvironment,
               a.RequestedBy, a.RequestedAt, a.Status, a.ApprovedBy, a.DecidedAt, a.Comment, a.RiskNotes,
               v.VersionTag, ru.Username AS RequestedByName, au.Username AS ApprovedByName
        FROM ApprovalRequests a
        LEFT JOIN BotVersions v ON v.VersionID = a.VersionID
        LEFT JOIN SystemUsers ru ON ru.UserID = a.RequestedBy
        LEFT JOIN SystemUsers au ON au.UserID = a.ApprovedBy
        WHERE {' AND '.join(where)}
        ORDER BY a.RequestedAt DESC{flavor.limit(params['limit'])}
        """,
        params,
        operation="lifecycle.list_approvals",
    )


# --------------------------------------------------------------------------- #
# Credential vault
# --------------------------------------------------------------------------- #
def add_credential(
    session: Session,
    *,
    
    version_id: int,
    credential_name: str,
    environment: str,
    value: str,
    created_by: Optional[int] = None,
) -> Dict[str, Any]:
    """Store an encrypted credential for a version/environment pair."""
    if environment not in ("Development", "UAT", "Production"):
        raise LifecycleError("بيئة غير صالحة للسر")
    if not value:
        raise LifecycleError("قيمة السر مطلوبة")

    vault_id = insert_row(
        session,
        BotVault,
        {
            "VersionID": version_id,
            "CredentialName": credential_name[:100],
            "Environment": environment,
            "EncryptedValue": get_vault_cipher().encrypt(value),
            "CreatedBy": created_by,
            "KeyVersion": "1",
        },
    )
    return {"vault_id": int(vault_id), "credential_name": credential_name, "environment": environment}


def list_credentials(session: Session, *, version_id: int) -> List[Dict[str, Any]]:
    """List credential *metadata* — values are never returned here."""
    return fetch_all(
        session,
        """
        SELECT VaultID, CredentialName, Environment, KeyVersion, CreatedAt, LastAccessedAt, AccessCount
        FROM BotVault
        WHERE VersionID = :v AND (IsDeleted = 0 OR IsDeleted IS NULL)
        ORDER BY Environment, CredentialName
        """,
        {"v": version_id},
        operation="lifecycle.list_credentials",
    )


def read_credential(
    session: Session,
    *,
    
    vault_id: int,
    version_id: int,
    user_id: Optional[int],
    ip_address: Optional[str],
    user_agent: Optional[str] = None,
    reason: Optional[str] = None,
) -> Dict[str, Any]:
    """Decrypt a credential and record a **mandatory** audit entry.

    If the audit trail cannot be written the read is refused — a bank must
    always be able to prove who accessed a secret.
    """
    from app.services import audit_service

    row = fetch_one(
        session,
        "SELECT * FROM BotVault WHERE VaultID = :v AND VersionID = :vid",
        {"v": vault_id, "vid": version_id},
        operation="lifecycle.read_credential",
    )
    if not row:
        raise LifecycleError("السر غير موجود")

    audit_service.record_strict(
        session,
        
        action_type="Vault_Decrypt",
        user_id=user_id,
        process_name=None,
        entity_type="BotVault",
        entity_id=str(vault_id),
        old_values=None,
        new_values={"credential_name": row.get("CredentialName"), "environment": row.get("Environment"), "reason": reason},
        ip_address=ip_address,
        user_agent=user_agent,
    )

    update_rows(
        session,
        BotVault,
        {"LastAccessedAt": _now(), "AccessCount": int(row.get("AccessCount") or 0) + 1},
        [BotVault.c.VaultID == vault_id],
    )

    try:
        plaintext = get_vault_cipher().decrypt(str(row["EncryptedValue"]))
    except ValueError as exc:
        raise LifecycleError(
            "فشل فك التشفير — المفتاح الحالي لا يطابق المفتاح المستخدم عند التخزين (راجع FERNET_KEY / تدوير المفاتيح)"
        ) from exc

    return {
        "vault_id": vault_id,
        "credential_name": row.get("CredentialName"),
        "environment": row.get("Environment"),
        "value": plaintext,
        "access_count": int(row.get("AccessCount") or 0) + 1,
    }


def rotate_vault_key(session: Session, *, dry_run: bool = True) -> Dict[str, Any]:
    """Re-encrypt every credential with the newest FERNET key (key rotation)."""
    cipher = get_vault_cipher()
    rows = fetch_all(
        session,
        "SELECT VaultID, EncryptedValue FROM BotVault WHERE 1 = 1",
        {},
        operation="lifecycle.rotate_scan",
    )
    rotated, failed = 0, 0
    for row in rows:
        try:
            new_value = cipher.rotate(str(row["EncryptedValue"]))
            if not dry_run:
                update_rows(session, BotVault, {"EncryptedValue": new_value}, [BotVault.c.VaultID == int(row["VaultID"])])
            rotated += 1
        except Exception:  # pragma: no cover - unreadable legacy value
            failed += 1
    return {"scanned": len(rows), "rotated": rotated, "failed": failed, "dry_run": dry_run}


def soft_delete_credential(session: Session, *, vault_id: int) -> int:
    """Logically delete a credential (secret history preserved for audit)."""
    return update_rows(
        session,
        BotVault,
        {"IsDeleted": True, "DeletedAt": _now()},
        [BotVault.c.VaultID == vault_id],
    )


def vault_statistics(session: Session) -> Dict[str, Any]:
    """Vault hygiene metrics shown on the security screen."""
    row = fetch_one(
        session,
        """
        SELECT COUNT(1) AS total,
               COALESCE(SUM(AccessCount), 0) AS reads,
               COALESCE(SUM(CASE WHEN Environment = 'Production' THEN 1 ELSE 0 END), 0) AS production_secrets,
               COALESCE(SUM(CASE WHEN LastAccessedAt IS NULL THEN 1 ELSE 0 END), 0) AS never_read
        FROM BotVault WHERE (IsDeleted = 0 OR IsDeleted IS NULL)
        """,
        {},
        operation="lifecycle.vault_stats",
    ) or {}
    flavor = get_flavor()
    recent_reads = fetch_all(
        session,
        f"""
        SELECT {flavor.top(20)}
               a.ActionDate, COALESCE(u.Username, 'System') AS Username, a.EntityID, a.IPAddress, a.NewValues
        FROM AuditLogs a
        LEFT JOIN SystemUsers u ON u.UserID = a.UserID
        WHERE a.ActionType = 'Vault_Decrypt'
        ORDER BY a.ActionDate DESC{flavor.limit(20)}
        """,
        {},
        operation="lifecycle.vault_reads",
    )
    return {
        "total_credentials": int(row.get("total") or 0),
        "total_reads": int(row.get("reads") or 0),
        "production_credentials": int(row.get("production_secrets") or 0),
        "never_accessed": int(row.get("never_read") or 0),
        "recent_reads": recent_reads,
    }
