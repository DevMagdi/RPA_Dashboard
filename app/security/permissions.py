"""Role & permission evaluation (role-based, department- and tenant-scoped).

Permissions live in the database (``RolePermissions``) so a bank can create
custom roles — e.g. *"Audit Reader"* — without a code change or a release.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import FrozenSet, Iterable, Optional, Set

from app.db.repository import fetch_all
from app.db.session import session_scope

logger = logging.getLogger(__name__)

WILDCARD = "*"

#: Fallback matrix used when the database has no rows yet (fresh install).
DEFAULT_ROLE_PERMISSIONS: dict[str, Set[str]] = {
    "SuperAdmin": {WILDCARD},
    "CoE_Manager": {
        "dashboard:read",
        "processes:read",
        "processes:write",
        "roi:write",
        "sla:write",
        "lifecycle:read",
        "lifecycle:write",
        "lifecycle:promote",
        "lifecycle:approve",
        "infrastructure:read",
        "infrastructure:write",
        "capacity:read",
        "capacity:act",
        "audit:read",
        "export:read",
        "commands:write",
        "users:read",
    },
    "Operator": {
        "dashboard:read",
        "processes:read",
        "lifecycle:read",
        "infrastructure:read",
        "capacity:read",
        "commands:write",
        "export:read",
    },
    "Auditor": {"dashboard:read", "processes:read", "lifecycle:read", "infrastructure:read", "audit:read", "export:read"},
    "Viewer": {"dashboard:read", "processes:read", "lifecycle:read", "infrastructure:read"},
}

KNOWN_ROLES = tuple(DEFAULT_ROLE_PERMISSIONS.keys())


@dataclass(frozen=True)
class PermissionSet:
    """Resolved permissions for a user, plus their tenancy scope."""

    role: str
    permissions: FrozenSet[str] = field(default_factory=frozenset)

    def has(self, permission: str) -> bool:
        """Wildcard-aware permission check."""
        if WILDCARD in self.permissions:
            return True
        return permission in self.permissions

    def has_any(self, permissions: Iterable[str]) -> bool:
        return any(self.has(p) for p in permissions)

    def as_list(self) -> list[str]:
        return sorted(self.permissions)


def load_permissions(tenant_id: int, role: str) -> PermissionSet:
    """Load the permission set for ``role`` inside ``tenant_id``.

    Falls back to the built-in matrix when the tenant has not customised roles
    (or the table is empty during a fresh bootstrap).
    """
    try:
        with session_scope() as session:
            rows = fetch_all(
                session,
                "SELECT Permission FROM RolePermissions WHERE TenantID = :t AND Role = :r",
                {"t": tenant_id, "r": role},
                operation="permissions.load",
            )
    except Exception as exc:  # pragma: no cover - defensive: never block auth
        logger.warning("Permission lookup failed for role %s: %s", role, exc)
        rows = []

    permissions = {row["Permission"] for row in rows if row.get("Permission")}
    if not permissions:
        permissions = set(DEFAULT_ROLE_PERMISSIONS.get(role, set()))
    return PermissionSet(role=role, permissions=frozenset(permissions))


def is_known_role(role: str) -> bool:
    """True when the role is one of the built-in roles."""
    return role in KNOWN_ROLES


def validate_role_or_permissions(role: str, extra_permissions: Optional[Iterable[str]] = None) -> bool:
    """Used by the tenant admin API to reject typo'd roles."""
    return is_known_role(role) or bool(list(extra_permissions or []))


def default_permissions_for(role: str) -> list[str]:
    """Return the seed permission list for a role (setup wizard / tests)."""
    return sorted(DEFAULT_ROLE_PERMISSIONS.get(role, set()))
