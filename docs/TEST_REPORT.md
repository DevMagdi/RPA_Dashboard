# Test Report — Control Room 3.0.0

Measured on 2026-10-13 in the delivery sandbox (Python 3.11 venv, SQLite
test database, demo seed). Every number below is reproducible with the
commands in §5.

## 1. Results summary

| Suite | Result | Gate |
|---|---|---|
| `pytest` (12 files in `tests/`) | **257 passed** | — |
| Coverage (`app`, `.coveragerc`) | **80.55 %** | ≥ 80 % (`fail_under = 80`) |
| `scripts/smoke_api.py` (in-process, 62 checks) | **62/62 passed** | 62/62 |
| `scripts/verify_dashboard.py` (live uvicorn) | **59/59 passed** | all |
| Live API latency (verify run, n=34) | median **5 ms** · p95 **9 ms** | p95 < 200 ms ✅ |
| Frontend `npm run lint` (oxlint) | **0 warnings, 0 errors** | 0 |
| Frontend `npm run build` | ✅ built (code-split: react/charts/motion/grid/i18n) | success |
| `pyflakes app tests` | ✅ clean | 0 findings |

## 2. What the pytest suite covers

| File | Focus |
|---|---|
| `test_config.py` | Settings validators, per-dialect `database_url`, prod security validation, **`.env.example` == all 80 Settings keys**, cache/secrets/dialect units |
| `test_security.py` | bcrypt round-trip, password policy (3-of-4 classes), JWT claims/type/expiry/tamper, TOTP, backup codes, Fernet vault, CSRF tokens |
| `test_platforms_base.py` | Status normalisation (26 parametrised vendor spellings incl. `"In Progress"`), `to_utc` formats, run summaries |
| `test_platforms_adapters.py` | UiPath/AA payload mapping (HTTP stubbed), queue-stat buckets, provider catalogue **without credentials**, class-level `CAPABILITIES`, HTTP retry/error mapping, native adapter reads |
| `test_auth_api.py` | Login/cookies, refresh rotation + replay revocation, logout, users CRUD, disable/delete, change-password, full MFA lifecycle |
| `test_tenants_isolation.py` | Platform-admin guard: tenant-local SuperAdmin gets **403** on list/provision/read of tenants; provisioning, branding, platform config, suspend/resume, retention |
| `test_processes_api.py` | ROI upsert, **SLA partial updates**, soft-delete then **404 on repeat**, queue telemetry, department scope |
| `test_runs_api.py` | Idempotent run start (replay returns same `run_id`), completion savings + replay flag, statistics |
| `test_dashboard_api.py` | Dashboard payload/cache, SLA summary, backlog, **SSE via `?token=` and header against a real uvicorn server**, 401s |
| `test_capacity_api.py` | Insights, generate → persisted recommendations, status transitions, RBAC |
| `test_infrastructure_api.py` | Machine registration, agent enrol/heartbeat/command-ack, **`/api/jobs/start` always returns `external_id` + echoes idempotency key**, platform sync |
| `test_misc_api.py` | Health/version/metrics/headers, lifecycle + vault round-trip, four-eyes approvals, rollback gate, exports (XLSX/PDF magic bytes), audit, notifications, sync/scheduler/realtime-hub units, agent WebSocket flow |

## 3. Regressions pinned by tests (the 3.0.0 fixes)

1. Cross-tenant administration → `test_tenants_isolation.py` (3 tests).
2. `"In Progress"` status → `test_platforms_base.py`, `test_platforms_adapters.py::test_aa_run_mapping_in_progress`, UiPath queue buckets.
3. Provider catalogue without credentials → `test_provider_catalogue_without_credentials`, `test_http_adapters_instantiable_without_credentials`.
4. SSE `?token=` → `test_dashboard_api.py` SSE tests (live server).
5. Job-start idempotency → `test_start_job_always_returns_external_id`, `test_start_job_echoes_idempotency_key`.
6. Soft-delete repeat → `test_soft_delete_then_second_delete_404`.
7. Optional SLA fields → `test_update_sla_partial_target_only`, `test_update_sla_partial_processing_only`.
8. `.env.example` completeness → `test_env_example_covers_every_setting`.

## 4. Notes

- SSE is tested against a real uvicorn server (module-scoped fixture):
  Starlette's TestClient deadlocks on infinite streams.
- The suite uses one session-scoped SQLite database seeded with the demo
  dataset; tests create uniquely-named users/processes/machines/tenants so
  they are order-independent within the session.
- `scripts/smoke_api.py` must run on a **fresh** database file (it asserts
  first-login behaviour).

## 5. Reproduce

```bash
pip install -r requirements-dev.txt
python -m pytest                                    # 257 passed, coverage ≥80%
rm -f /tmp/smoke.sqlite3*
DB_DIALECT=sqlite DB_NAME=/tmp/smoke.sqlite3 ENV=test DB_SEED_DEMO=true \
  SCHEDULER_ENABLED=false python scripts/smoke_api.py   # 62/62
uvicorn app.main:app --port 8000 &                  # with the same env
python scripts/verify_dashboard.py http://127.0.0.1:8000  # 59/59
cd rpa-dashboard && npm ci && npm run lint && npm run build
```
