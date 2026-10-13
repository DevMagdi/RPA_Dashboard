# HANDOFF — Control Room 3.0: tests, CI/CD, Docker, docs & review fixes

This file is the review guide for the 3.0.0 hardening PR. It describes every
change, why it was made, and the measured proof. (Arabic summary at the end.)

## 1. Current state

| | |
|---|---|
| Base | `master` = `8c9d0f8` (after PR #1 merged `13b7ee7`) |
| This branch | all 3.0.0 work described below, as one reviewable PR |
| Backend tests | **257 passed**, coverage **80.55 %** (gate 80 %) |
| Smoke / live | `smoke_api.py` **62/62** · `verify_dashboard.py` **59/59** (median 5 ms, p95 9 ms) |
| Frontend | oxlint 0/0 · `vite build` ✅ |

> Note: this work re-implements, from the agreed specification, a change set
> originally produced in a separate workspace whose uncommitted patch could
> not be transferred. Everything here is verified by the suites above.

## 2. Backend fixes (each pinned by a regression test)

1. **`require_platform_admin`** (`app/api/deps.py`, used by all 9 tenant-admin
   endpoints): previously `require_permission("*")` let *any tenant's*
   SuperAdmin (seeded with `*` inside its own tenant) list/rebrand/suspend
   other tenants. Now the caller must be SuperAdmin **of the platform tenant**
   (`TenantKey="default"`).
2. **Status normalisation** (`app/platforms/base.py`): separator-insensitive
   keys — `"In Progress"` (AA) now matches like `InProgress`/`IN_PROGRESS`;
   UiPath queue stats route through `normalize_status` (the spaced spelling
   was silently not counted as active). Extra aliases: Abandoned→Failed,
   Retried→Pending, Deleted→Stopped…
3. **Class-level `CAPABILITIES`** (base + UiPath/AA/generic adapters): the
   registry catalogue no longer instantiates adapters (`available_providers`);
   `HttpAdapterConfig.base_url` defaults to `""` so adapters are
   instantiable without credentials instead of raising `TypeError`.
4. **SSE token fallback** (`current_principal_sse`): `/api/realtime/events`
   accepts `?token=` because `EventSource` cannot send headers; header wins
   when present, same validation path.
5. **`/api/jobs/start` idempotency**: `IdempotencyKey` accepted, passed to
   the adapter, echoed in the response/audit; `external_id` is **always**
   present (native adapter generates `job-<uuid>` when no key is given).
6. **Soft-delete**: only live rows are updated, so a repeated
   `DELETE /api/processes/{name}` returns **404** instead of fake success.
7. **SLA partial updates**: `SLATargetMinutes`/`AvgItemProcessingSeconds`
   optional in payload and service; omitted fields keep current values.
8. **`requirements.txt`**: `gunicorn` and `email-validator` added; `pyodbc`
   no longer excluded on Linux (Docker image ships unixODBC + MS Driver 18).
9. **`.env.example`**: all **80** `Settings` fields documented; equality with
   the config model is enforced by a test.

## 3. Tests — `tests/` (12 files, 257 tests)

`conftest.py` (session client, login/user factories) + `pytest.ini` +
`.coveragerc` (80 % gate). Breakdown and coverage map:
[docs/TEST_REPORT.md](docs/TEST_REPORT.md). SSE tests run against a real
uvicorn server (TestClient deadlocks on infinite streams).

## 4. Docker & CI

- `Dockerfile` — API: python:3.12-slim, MS ODBC Driver 18, non-root
  (`controlroom`), gunicorn + uvicorn workers, `/health` healthcheck.
- `rpa-dashboard/Dockerfile` — node:22 build → nginx:1.27 (build context =
  repo root).
- `deploy/nginx.conf` — SPA fallback, `/api` proxy, **SSE buffering off**,
  WebSocket upgrade, security headers, immutable `/assets` caching.
- `docker-compose.yml` — PostgreSQL default, SQL Server under `--profile
  mssql`, Redis, api (unpublished) behind web on `${WEB_PORT:-8080}`.
- `.dockerignore`, `.github/workflows/ci.yml` — backend (pyflakes, pytest +
  coverage gate, smoke), frontend (lint + build), security (pip-audit,
  npm audit, gitleaks).

## 5. Documentation

`README.md` (rewritten) · `CHANGELOG.md` (3.0.0) · `docs/ARCHITECTURE.md` ·
`docs/TEST_REPORT.md` (measured results) · `docs/CTO_REVIEW.md` (residual
risks **R1–R12**) · `docs/DEPLOYMENT_ON_PREM_BANK.md` ·
`docs/DEPLOYMENT_CLOUD.md` · `docs/adr/ADR-001…006` ·
`docs/samples/uipath-job.json`, `docs/samples/automation-anywhere-activity.json`.

## 6. Reviewer checklist

```bash
pip install -r requirements-dev.txt && python -m pytest     # 257 passed, ≥80%
python scripts/smoke_api.py                                  # fresh DB: 62/62
python scripts/verify_dashboard.py http://127.0.0.1:8000     # live: 59/59
cd rpa-dashboard && npm ci && npm run lint && npm run build
docker compose up -d --build                                 # optional
```

Suggested commit message:

```
feat(v3.0): tests, CI/CD, Docker, docs polish and review fixes
```

---

## ملخص بالعربي

- **إصلاحات أمنية/وظيفية (9):** منع أي مستأجر من إدارة غيره
  (`require_platform_admin`) · إصلاح تطبيع الحالات (`In Progress`) ·
  `CAPABILITIES` على مستوى الكلاس (الكتالوج يعمل بدون بيانات اعتماد) ·
  توكن SSE عبر `?token=` · `IdempotencyKey` لبدء الوظائف مع `external_id`
  دائمًا · حذف منطقي يرجّع 404 عند التكرار · حقول SLA اختيارية ·
  `gunicorn`+`pyodbc` في المتطلبات · `.env.example` بكل الـ 80 مفتاح.
- **اختبارات:** 257 اختبار ناجح، تغطية 80.55 % (بوابة 80 %)، smoke ‏62/62،
  تحقق حي 59/59.
- **بنية:** Docker (API + nginx SPA) + compose (Postgres افتراضي / MSSQL
  profile + Redis) + GitHub Actions (باك إند/فرونت/فحص أمني).
- **توثيق:** README + هندسة + تقرير اختبارات + مراجعة CTO (مخاطر R1–R12) +
  أدلة نشر (بنك on-prem / سحابة) + 6 ADRs + عينات UiPath/AA.
