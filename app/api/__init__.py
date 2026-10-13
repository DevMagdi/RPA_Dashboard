"""HTTP layer: routers, dependencies, middleware and error handling.

``register_routers(app)`` is the single place where every router is mounted, so
:mod:`app.main` stays a thin composition root.  Two API generations are served
by the same process:

* **v1-compatible routes** — the exact paths the original Streamlit/React
  dashboard already calls (``/api/dashboard-data``, ``/api/infrastructure`` …),
  enriched with the new payload fields.  Existing installations keep working
  after the upgrade; nothing has to be redeployed in lockstep.
* **v3 routes** — the enterprise surface (capacity advisor, lifecycle &
  approvals, vault, exports, tenants, health).
"""

from __future__ import annotations

from typing import List, Tuple

from fastapi import FastAPI

from app.api.routes import (
    agents,
    audit,
    auth,
    capacity,
    dashboard,
    health,
    lifecycle,
    machines,
    processes,
    runs,
    tenants,
)

#: Routers without an internal prefix (paths are declared in full).
FLAT_ROUTERS: List[Tuple[object, List[str]]] = [
    (auth.router, ["Authentication", "Users & Roles"]),
    (auth.users_router, ["Users & Roles"]),
    (health.router, ["Health"]),
    (agents.router, ["Agents"]),
    (dashboard.router, ["Dashboard", "Realtime"]),
    (processes.router, ["Processes", "ROI"]),
    (runs.router, ["Runs"]),
    (machines.router, ["Infrastructure", "Commands", "Platforms"]),
    (capacity.router, ["Capacity Advisor"]),
    (lifecycle.router, ["Lifecycle & Vault"]),
    (audit.router, ["Audit & Reporting"]),
    (tenants.router, ["Tenants"]),
]


def register_routers(app: FastAPI) -> None:
    """Mount every router on the application (idempotent)."""
    for router, tags in FLAT_ROUTERS:
        app.include_router(router, tags=tags)  # type: ignore[arg-type]


__all__ = ["register_routers", "FLAT_ROUTERS"]
