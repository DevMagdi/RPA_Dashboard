# ADR-002: Single-organization, On-Premises only

- **Status:** Accepted (4.0.0) — supersedes the removed multi-tenancy ADR
- **Date:** 2026-10-13

## Context

The Control Room is sold/deployed as an internal platform for one bank or
large enterprise. A shared multi-organization service would create regulatory
(data residency, segregation, audit) obligations that no customer asked for,
and would complicate every query, token and permission check.

## Decision

One installation = one organization. The database holds a single seeded
`Organization` row; business tables carry no organization discriminator.
JWTs carry `sub`, `role`, `user_id` and `department` only. Organization
administration (branding, platform configuration, retention) is guarded by
`require_organization_admin` (SuperAdmin of the installation).

## Consequences

- Simpler, auditable data model; department scoping remains the only
  row-level visibility rule.
- Each bank/enterprise runs its own isolated installation inside its own
  data center or private cloud — isolation is physical, not logical.
- Vendor neutrality unchanged: UiPath, Automation Anywhere, Blue Prism and
  in-house platforms are configured once for the organization.
