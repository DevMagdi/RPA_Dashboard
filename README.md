# RPA CoE Control Room 3.0

A **multi-tenant, multi-vendor Intelligent Automation Control Room** for banks
and large enterprises. One vendor-neutral console over **UiPath Orchestrator**,
**Automation Anywhere A360**, and in-house SQL-based RPA estates — telemetry,
ROI/SLA analytics, a Capacity Advisor, lifecycle governance with a credential
vault, and realtime dashboards.

| | |
|---|---|
| Backend | FastAPI · SQLAlchemy 2 · JWT + MFA (TOTP) · SSE/WebSocket realtime |
| Frontend | React 19 · Vite · Tailwind · Recharts (AR/EN, white-label per tenant) |
| Database | SQL Server (bank standard) · PostgreSQL · SQLite — config-only switch |
| Tests | **257 pytest cases, ≥80 % coverage gate** · 62-check API smoke · 58-check live verification |

## Quick start (local demo)

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env                     # dev defaults work out of the box
DB_DIALECT=sqlite DB_SEED_DEMO=true .venv/bin/python -m app.main
# API + (optional) SPA on http://127.0.0.1:8000 — login admin / ChangeMe_Admin1!
```

Frontend development:

```bash
cd rpa-dashboard && npm ci && npm run dev   # http://127.0.0.1:5173 (proxies /api)
```

## Docker (single host)

```bash
cp .env.example .env   # set DB_PASSWORD / JWT_SECRET_KEY / FERNET_KEY / AGENT_TOKEN_PEPPER
docker compose up -d   # PostgreSQL + Redis + API + nginx web on :8080
docker compose --profile mssql up -d   # optional SQL Server instead
```

## Testing & quality gates

```bash
pip install -r requirements-dev.txt
python -m pytest                 # 257 tests, coverage gate 80% (.coveragerc)
python scripts/smoke_api.py      # 62 end-to-end API checks (needs env below)
DB_DIALECT=sqlite DB_NAME=/tmp/smoke.sqlite3 ENV=test DB_SEED_DEMO=true \
  SCHEDULER_ENABLED=false python scripts/smoke_api.py
python scripts/verify_dashboard.py http://127.0.0.1:8000   # 58 live checks
```

## Documentation

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, data flow, tenancy & adapter model |
| [docs/TEST_REPORT.md](docs/TEST_REPORT.md) | Measured test/coverage/smoke results |
| [docs/CTO_REVIEW.md](docs/CTO_REVIEW.md) | Production readiness + residual risks R1–R12 |
| [docs/DEPLOYMENT_ON_PREM_BANK.md](docs/DEPLOYMENT_ON_PREM_BANK.md) | Bank on-prem (SQL Server, no egress) |
| [docs/DEPLOYMENT_CLOUD.md](docs/DEPLOYMENT_CLOUD.md) | Cloud (PostgreSQL, Key Vault/Vault) |
| [docs/adr/](docs/adr/) | Architecture decision records |
| [docs/samples/](docs/samples/) | Sample UiPath / Automation Anywhere payloads |
| [HANDOFF.md](HANDOFF.md) | What changed in 3.0.0 and how to review it |

## Security model (summary)

- Short-lived JWT access tokens (15 min) + rotating refresh-token families
  (replay revokes the family), CSRF double-submit on cookie-authenticated calls.
- MFA (TOTP + backup codes), account lockout, password policy (3-of-4 classes).
- Tenant isolation on every query; cross-tenant administration is reserved
  for the platform operator (`require_platform_admin`).
- Credentials encrypted at rest (Fernet vault); secrets resolved through
  env / Azure Key Vault / HashiCorp Vault — never committed (`.env.example`
  documents all 80 settings, values stay out of git).

> Internal platform — proprietary, bank-internal use.
