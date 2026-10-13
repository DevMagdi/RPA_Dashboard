# Architecture — RPA CoE Control Room 3.0

## 1. System overview

```
                        ┌──────────────────────────────────────────────┐
  Browser (SPA) ───────▶│ nginx (web image)                            │
  React 19, AR/EN       │  /          -> SPA (immutable /assets)       │
                        │  /api/      -> API                           │
                        │  /api/realtime/events -> API (SSE, no buffer)│
                        │  /ws/       -> API (WebSocket upgrade)       │
                        └──────────────┬───────────────────────────────┘
                                       │
                        ┌──────────────▼───────────────────────────────┐
                        │ FastAPI API (gunicorn + uvicorn workers)     │
                        │  middleware: correlation-id → TrustedHost →  │
                        │  CORS → IP allowlist → security headers →    │
                        │  CSRF → metrics                              │
                        │  routers: auth · tenants · dashboard ·       │
                        │  processes · runs · machines/agents ·        │
                        │  capacity · lifecycle/vault · audit/exports  │
                        │  services: dashboard · capacity · lifecycle ·│
                        │  sync · scheduler · realtime hub · notify    │
                        └──────┬──────────────┬──────────────┬─────────┘
                               │              │              │
                    ┌──────────▼───┐  ┌───────▼──────┐  ┌────▼─────────────┐
                    │ Database     │  │ Redis        │  │ Vendor platforms │
                    │ MSSQL / PG / │  │ cache, rate  │  │ UiPath OData ·   │
                    │ SQLite       │  │ limit, pubsub│  │ AA A360 REST ·   │
                    └──────────────┘  └──────────────┘  │ native SQL bots  │
                                                        └──────────────────┘
  Runner agents ── WebSocket /ws/agent/{machine} (enrolment code → token,
                   heartbeats, commands, run events) ──▶ API
```

## 2. Backend layout

| Module | Responsibility |
|---|---|
| `app/main.py` | Composition root: lifespan (bootstrap, scheduler, Redis bridge), middleware order, SPA mounting |
| `app/api/deps.py` | AuthN/Z dependencies: bearer, `require_permission`, `require_platform_admin`, SSE token fallback, rate limiting |
| `app/api/routes/*` | HTTP surface (thin; validation + audit + service calls) |
| `app/services/*` | Business logic: dashboard aggregation, capacity advisor, lifecycle/vault, sync, scheduler, realtime hub, notifications |
| `app/platforms/*` | Vendor adapters (`base` canonical model, `uipath`, `automation_anywhere`, `generic_sql`, `registry`) |
| `app/db/*` | Engine/session (dialect-aware), repository helpers, bootstrap/seed, tables |
| `app/core/*` | Settings (80 env keys), security (JWT/MFA/vault cipher), cache, secrets backends, metrics, tracing |
| `app/security/permissions.py` | DB-backed role/permission matrix with built-in fallback |

## 3. Tenancy model

- Every business row carries `TenantID`; repositories always scope by it.
- Users belong to exactly one tenant; JWTs embed `tenant_id` + `user_id` and
  the principal is re-loaded from the DB per request (disabled users fail
  immediately).
- The **platform tenant** (`TenantKey="default"`) hosts the operator's
  SuperAdmin — the only principal allowed to administer other tenants
  (ADR-002). Tenant-local SuperAdmins are powerful *inside* their tenant only.

## 4. Vendor adapter model

Adapters translate vendor payloads into canonical records; statuses are
normalised separator-insensitively (`In Progress` ≡ `InProgress`), timestamps
to naive-UTC. Capabilities are class-level (`CAPABILITIES`) so catalogues and
UI affordances work with zero credentials. Per-tenant provider + config lives
in `Tenants.PlatformProvider/PlatformConfigJson`, with secret values replaced
by `vault:` references resolved at build time (ADR-001, ADR-005).

Control actions (`start_job`/`stop_job`) flow through the same adapter
interface; the native provider dispatches to connected agents and always
returns an `external_id` (caller idempotency key or a generated `job-<uuid>`).

## 5. Realtime

- **SSE** (`/api/realtime/events`) for dashboard clients; 25 s heartbeats;
  auth via header or `?token=` (ADR-003).
- **WebSocket** (`/ws/agent/{machine}`) for runner agents: enrolment-code →
  hashed agent token, heartbeats, command dispatch + ack, run events.
- The in-process hub fans out locally; with Redis configured, a bridge
  carries events across API workers.

## 6. Background work

One scheduler (run exactly one API worker with `SCHEDULER_ENABLED=true`, or
accept idempotent jobs): platform sync (10 min), capacity advisor refresh
(15 min), stale-run reaper + command sweep (30 min), retention enforcement,
realtime KPI tick (15 s). All intervals are settings.

## 7. Security controls

JWT (15 min access) + rotating refresh families with replay revocation ·
TOTP MFA + backup codes · lockout after 5 failures · password policy ·
CSRF double-submit for cookie flows · security headers + TrustedHost +
optional IP allowlist · Fernet credential vault with rotation · audit log of
every sensitive action · Prometheus metrics with normalised path labels.

## 8. Testing

257 pytest tests (unit/API/live-SSE) with an 80 % coverage gate, a 62-check
in-process smoke and a 58-check live verification — see
[TEST_REPORT.md](TEST_REPORT.md) and ADR-006.
