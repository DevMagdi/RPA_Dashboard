# CTO Review — Control Room 3.0 production readiness

**Verdict:** Ready for a controlled production rollout (single bank / single
region) behind the deployment runbooks. The 3.0.0 test programme (257 tests,
80.55 % coverage, 62/62 smoke, live verification) closes the "zero tests, zero
CI" finding of the previous review. Residual risks below are accepted,
tracked items — none blocks launch, each has an owner-level mitigation.

## What changed since the last review

| Previous finding | Status in 3.0.0 |
|---|---|
| No tests / no CI / no Docker | ✅ 257 tests + 80 % gate, GitHub Actions (backend/frontend/security), Docker + compose |
| Cross-scope administration | ✅ `require_organization_admin` (installation SuperAdmin only) + regression tests |
| Vendor status `"In Progress"` uncounted | ✅ separator-insensitive normalisation + tests |
| Provider catalogue empty without credentials | ✅ class-level `CAPABILITIES` |
| SSE unusable from the browser | ✅ `?token=` fallback (ADR-003) |
| `.env` settings drift | ✅ all 80 keys documented + test-verified |

## Residual risks (R1–R12)

| ID | Risk | Impact | Mitigation / plan |
|---|---|---|---|
| R1 | Refresh-token replay detection revokes the whole family — an attacker with a stolen cookie can DoS a user's sessions | Low | Acceptable trade-off vs silent reuse; users re-login. Monitor `refresh_replay` audit events. |
| R2 | SSE access token in the URL can land in proxy/access logs | Medium | 15-min token TTL; header auth preferred where possible; scrub `token=` in log pipelines. Revisit with cookie-authenticated SSE. |
| R3 | In-process scheduler runs in the API process; >1 worker with `SCHEDULER_ENABLED=true` duplicates jobs | Medium | Documented: exactly one scheduler worker (compose default `WEB_CONCURRENCY=1`). Jobs are idempotent. Plan: leader election via Redis lock. |
| R4 | SQLite is supported for tests/demos but not for multi-user production | Low | Deployment docs mandate MSSQL/PostgreSQL in prod; startup warns on SQLite outside test/dev. |
| R5 | Vendor adapters depend on UiPath/AA payload shapes that change between vendor releases | Medium | Adapters are defensive (`_first` key lookup, UNKNOWN status fallback); samples in `docs/samples/` pin current shapes. Add contract tests per vendor upgrade. |
| R6 | Fernet vault: a single `FERNET_KEY` protects all bot credentials | High | Key held in Key Vault/Vault in prod; rotation endpoint exists (`/api/vault/rotate-key`). Plan: envelope encryption with per-secret data keys. |
| R7 | Rate limiting falls back to in-memory buckets when Redis is down — limits become per-worker | Low | Fail-open by design for availability; alert on Redis health in `/health/detail`. |
| R8 | Demo seed ships a well-known bootstrap password (`ChangeMe_Admin1!`) | High if misused | Only seeded with `DB_SEED_DEMO`/test or first bootstrap; `must_change_password` flow exists. Prod runbook: rotate immediately, prefer `BOOTSTRAP_ADMIN_PASSWORD` injection. |
| R9 | Notifications (SMTP/Slack/Teams) are synchronous best-effort with cooldown; no delivery queue | Low | Cooldown + NotificationLog audit; plan: outbox table + worker. |
| R10 | Frontend bundle has no E2E browser tests in CI yet (Playwright is a dev-dependency only) | Medium | API surface is contract-tested; add Playwright smoke (login → dashboard → capacity) as a follow-up. |
| R11 | `pyodbc`/MS ODBC driver adds image weight and a Microsoft apt dependency | Low | Only the API image carries it; PostgreSQL deployments may strip it in a slimmer variant. |
| R12 | Audit log grows unbounded within the retention window (730 d default) | Low | Retention job + `/api/organization/retention/run`; partition/archive strategy at scale. |

## Sign-off checklist

- [ ] Production secrets in Key Vault/Vault (no `.env` file) — `validate_security()` fails the boot otherwise
- [ ] `ALLOWED_HOSTS` / `ALLOWED_ORIGINS` set to real HTTPS origins
- [ ] `DB_TRUST_SERVER_CERT=no` with a valid SQL Server certificate
- [ ] Bootstrap admin password rotated; MFA enforced for operators
- [ ] Backups + restore drill for the chosen dialect
- [ ] `/metrics` restricted to the monitoring network
