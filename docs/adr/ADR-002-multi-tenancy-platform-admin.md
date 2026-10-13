# ADR-002: Multi-tenancy with a distinct platform-operator role

- **Status:** Accepted (3.0.0)
- **Date:** 2026-10-13

## Context
Every tenant seeds its own roles, including a tenant-local `SuperAdmin` with
the `*` permission *inside that tenant*. Guarding tenant administration with
`require_permission("*")` therefore let any tenant's admin manage all other
tenants (found by the 3.0 test suite).

## Decision
Tenant isolation is by `TenantID` scoping on every query. Cross-tenant
administration additionally requires `require_platform_admin`
(`app/api/deps.py`): role `SuperAdmin` **and** membership of the platform
tenant (`TenantKey = "default"`). Tenant-local admins keep full control of
their own tenant only. `X-Tenant-Key` impersonation is likewise restricted
and audited.

## Consequences
- White-label operators run one console; tenant admins can never cross the
  boundary (regression tests in `tests/test_tenants_isolation.py`).
- Provisioning a tenant is an operator-only, audited action.
