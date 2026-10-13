# ADR-006: Test pyramid with an enforced 80 % coverage gate

- **Status:** Accepted (3.0.0)
- **Date:** 2026-10-13

## Context
The 2.x line shipped with no automated tests; defects (scope-isolation,
status-normalisation, provider-catalogue) were only found by manual review.

## Decision
Three layers, all runnable with one command (`python -m pytest`):
1. **Unit tests** — config, security primitives, status normalisation, adapter
   payload mapping (HTTP stubbed), cache/secrets/dialect.
2. **API tests** — the real FastAPI app against a demo-seeded SQLite database
   (auth/MFA, tenancy, processes, runs, capacity, infrastructure, lifecycle,
   exports, audit).
3. **Live checks** — `scripts/smoke_api.py` (62 checks, in-process) and
   `scripts/verify_dashboard.py` (58 checks against a running server; SSE is
   tested against real uvicorn because TestClient deadlocks on infinite
   streams).

`.coveragerc` sets `fail_under = 80`; CI runs the same gate plus pyflakes and
the frontend build.

## Consequences
- Regressions for every 3.0.0 fix are pinned by a named test.
- Coverage is a floor, not a target: new code must arrive with tests or the
  build goes red.
