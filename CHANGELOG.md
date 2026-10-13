# Changelog

## 3.0.0 — Control Room 3.0 (2026-10-13)

### Added
- **Test suite**: `tests/` — 12 files, **257 tests** (unit + API + live-server
  SSE), `conftest.py` fixtures, `pytest.ini`, `.coveragerc` with an **80 %
  coverage gate** (measured 80.55 %).
- **Docker**: `Dockerfile` (API, non-root, gunicorn + uvicorn workers, MS ODBC
  Driver 18), `rpa-dashboard/Dockerfile` (Vite build → nginx),
  `deploy/nginx.conf` (SSE with buffering disabled, WebSocket upgrade,
  security headers, immutable asset caching), `docker-compose.yml`
  (PostgreSQL default, SQL Server under the `mssql` profile, Redis),
  `.dockerignore`.
- **CI**: `.github/workflows/ci.yml` — backend (pyflakes + pytest + smoke),
  frontend (oxlint + production build), security (pip-audit, npm audit,
  gitleaks).
- **Docs**: rewritten `README.md`, `docs/ARCHITECTURE.md`,
  `docs/TEST_REPORT.md`, `docs/CTO_REVIEW.md` (12 residual risks R1–R12),
  `docs/DEPLOYMENT_ON_PREM_BANK.md`, `docs/DEPLOYMENT_CLOUD.md`,
  6 ADRs (`docs/adr/`), vendor payload samples (`docs/samples/`), `HANDOFF.md`.

### Fixed (found by the new tests)
- **Tenant isolation**: tenant administration now requires
  `require_platform_admin` (SuperAdmin *of the platform tenant*). Previously
  `require_permission("*")` let any tenant's own SuperAdmin list, rebrand,
  reconfigure or suspend every other tenant.
- **Status normalisation**: `normalize_status` is separator-insensitive
  (`"In Progress"`, `"InProgress"`, `IN_PROGRESS` …) and UiPath queue stats go
  through it — `"In Progress"` work was silently not counted as active.
- **Provider catalogue**: `CAPABILITIES` is declared per adapter class and the
  registry no longer instantiates adapters to describe them (HTTP adapters
  raised without credentials, emptying their capability matrix).
  `HttpAdapterConfig.base_url` now defaults to empty.
- **SSE auth**: `/api/realtime/events` accepts `?token=` as a fallback —
  browsers' `EventSource` cannot send an `Authorization` header.
- **Job starts**: `POST /api/jobs/start` accepts `IdempotencyKey`, passes it
  to the adapter, and always returns `external_id` (the native adapter
  generates `job-<uuid>` when no key is supplied).
- **Soft delete**: deleting an already-deleted process now returns `404`
  instead of a fake success (the update only touches live rows).
- **SLA updates**: `SLATargetMinutes` / `AvgItemProcessingSeconds` are
  optional; omitted fields keep their current values (partial updates).
- **Dependencies**: added `gunicorn` and `email-validator`; `pyodbc` is no
  longer excluded on Linux (the Docker image ships unixODBC + MS Driver 18).
- **`.env.example`**: documents all **80** `Settings` fields (verified by
  `tests/test_config.py::test_env_example_covers_every_setting`).

### Changed
- The previous revision of `requirements.txt` was UTF-16 encoded and pinned
  an abandoned bcrypt/streamlit stack; it is now a clean, pinned manifest.

## 2.x

Streamlit/React dashboard generations (see git history and
`docs/CODE_REVIEW_AR.md`).
