"""Role & permission evaluation (role-based and department-scoped).

Permissions live in the database (``RolePermissions``) so a bank can create
custom roles — e.g. *"Audit Reader"* — without a code change or a release.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import FrozenSet, Iterable, Optional, Set

from app.core.cache import get_cache
from app.db.repository import fetch_all
from app.db.session import session_scope

logger = logging.getLogger(__name__)

WILDCARD = "*"

#: Permission sets change with a release/role edit, never per request — a short
#: TTL keeps the authorisation path off the database without risking staleness.
_CACHE_TTL_SECONDS = 60
_CACHE_PREFIX = "perms:role:"

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


def load_permissions(role: str) -> PermissionSet:
    """Load the permission set for ``role``.

    Every authenticated request resolves a role, so the lookup is cached for a
    short TTL — without it each request pays a round trip to the database (the
    ``permissions.load`` slow queries in production logs).  Call
    :func:`invalidate_permission_cache` after changing ``RolePermissions``.

    Falls back to the built-in matrix when no custom role rows exist
    (or the table is empty during a fresh bootstrap).
    """
    cache_key = f"{_CACHE_PREFIX}{role}"
    cached = get_cache().get_json(cache_key)
    if isinstance(cached, list):
        return PermissionSet(role=role, permissions=frozenset(str(item) for item in cached))

    try:
        with session_scope() as session:
            rows = fetch_all(
                session,
                "SELECT Permission FROM RolePermissions WHERE Role = :r",
                {"r": role},
                operation="permissions.load",
            )
    except Exception as exc:  # pragma: no cover - defensive: never block auth
        logger.warning("Permission lookup failed for role %s: %s", role, exc)
        # A failed lookup is *not* cached: the next request retries the query.
        return PermissionSet(role=role, permissions=frozenset(DEFAULT_ROLE_PERMISSIONS.get(role, set())))

    permissions = {row["Permission"] for row in rows if row.get("Permission")}
    if not permissions:
        permissions = set(DEFAULT_ROLE_PERMISSIONS.get(role, set()))
    permission_set = PermissionSet(role=role, permissions=frozenset(permissions))
    get_cache().set_json(cache_key, permission_set.as_list(), ttl=_CACHE_TTL_SECONDS)
    return permission_set


def invalidate_permission_cache(role: Optional[str] = None) -> None:
    """Drop cached permission sets for ``role`` (or every role when omitted)."""
    cache = get_cache()
    if role:
        cache.delete(f"{_CACHE_PREFIX}{role}")
    else:
        cache.delete_prefix(_CACHE_PREFIX)


def is_known_role(role: str) -> bool:
    """True when the role is one of the built-in roles."""
    return role in KNOWN_ROLES


def validate_role_or_permissions(role: str, extra_permissions: Optional[Iterable[str]] = None) -> bool:
    """Used by the user admin API to reject typo'd roles."""
    return is_known_role(role) or bool(list(extra_permissions or []))


def default_permissions_for(role: str) -> list[str]:
    """Return the seed permission list for a role (setup wizard / tests)."""
    return sorted(DEFAULT_ROLE_PERMISSIONS.get(role, set()))
