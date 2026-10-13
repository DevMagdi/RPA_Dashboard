# ADR-001: Vendor-neutral platform adapter abstraction

- **Status:** Accepted (3.0.0)
- **Date:** 2026-10-13

## Context
Banks run heterogeneous RPA estates (UiPath, Automation Anywhere, Blue Prism,
home-grown SQL runners). Vendor branching across the codebase would make every
feature N× work and block white-label onboarding.

## Decision
Every integration implements `PlatformAdapter` (`app/platforms/base.py`) and
translates vendor payloads into canonical records (`RunRecord`, `QueueStats`,
`MachineRecord`…) with normalised statuses/timestamps. Adapters are pure
translators: no business rules, no persistence. The registry
(`app/platforms/registry.py`) resolves an adapter per tenant from stored
configuration — onboarding a client is a **configuration** operation, and new
vendors can be supplied out-of-tree via `RPA_PLATFORM_PLUGINS`.

## Consequences
- One service layer, one KPI/ROI/SLA model, regardless of vendor.
- Vendor quirks (e.g. `"In Progress"` vs `InProgress`) are fixed once, in
  `normalize_status`, and covered by parametrised tests.
- Adapter capability matrices (`CAPABILITIES`) drive UI affordances.
