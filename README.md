# RPA CoE Control Room — v4.0.0 "Bank Production Ready"

Enterprise-grade, single-tenant, On-Premises RPA CoE Control Room. Designed to be deployed inside a bank's or large enterprise's own data center or private cloud. Fully isolated, fully auditable, and fully compliant with local regulatory requirements. Vendor-neutral control plane over UiPath, Automation Anywhere, Blue Prism and in-house RPA platforms.

> **Deployment model:** On-Premises / bank private cloud only. One installation serves exactly **one organization** (one bank / large enterprise). There is no SaaS mode and no shared multi-organization hosting.

## Supported RPA platforms

| Platform | Integration |
|---|---|
| UiPath Orchestrator | REST API adapter (processes, runs, machines, queues, jobs) |
| Automation Anywhere A360 | Control Room API adapter |
| Blue Prism | Adapter (status/queue surface; extend per bank DBA/API access) |
| In-house / SQL-based RPA | Generic SQL adapter + agent-based telemetry & run ingestion |

## What it does

- **Operations dashboard** — realtime KPIs, ROI & cost savings computed server-side, SLA tracking, capacity advice. Arabic + English UI with full RTL.
- **Run & queue ingestion** — agents/bots report run start/heartbeat/complete and queue telemetry (`POST /api/runs/start`, `/api/runs/{id}/heartbeat`, `/api/runs/{id}/complete`, `POST /api/queues/telemetry`) with idempotency keys.
- **Real command & control** — issue `RUN_BOT`/`STOP_BOT` to runner agents over an authenticated WebSocket, with a server-side allowed-process whitelist, HMAC-signed commands, ack/timeout tracking and basic scheduling.
- **Alerting engine** — agent-offline, SLA-breach-risk, high-failure-rate and repeated-failure rules with dedupe + cooldown, delivered over SMTP / Teams / Slack (on-prem endpoints), with an in-app bell + alerts page (Open → Acknowledged → Resolved).
- **Lifecycle governance** — strict Dev → UAT → Prod promotions, four-eyes approval for Production, target-environment secret checks, rollback, and an encrypted credential vault (Fernet/MultiFernet) where every decryption is audited with a mandatory reason.
- **Bank-grade security** — JWT + rotating refresh families, MFA (TOTP), 12-character password policy with history, account lockout, RBAC + department scoping, full audit trail, agent enrollment codes with revocation + force-disconnect.

## Architecture

| Layer | Technology |
|---|---|
| Backend | FastAPI · SQLAlchemy 2 · Alembic · Redis (cache/realtime) · WebSocket/SSE |
| Frontend | React 19 · Vite · Tailwind · Recharts (lazy-loaded routes/charts) |
| Database | SQL Server (bank standard) · PostgreSQL · SQLite (dev/tests) |
| Agent | Python robot agent (enrollment, heartbeat, signed command execution) |

## Run locally (development only)

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env                     # dev defaults work out of the box
DB_DIALECT=sqlite DB_SEED_DEMO=true .venv/bin/python -m app.main
# API on http://127.0.0.1:8000 — demo login admin / ChangeMe_Admin1!
```

```bash
cd rpa-dashboard && npm ci && npm run dev   # http://127.0.0.1:5173 (proxies /api)
```

## Deploy On-Premises (production)

Follow **[docs/DEPLOYMENT_ON_PREM_BANK.md](docs/DEPLOYMENT_ON_PREM_BANK.md)** — network topology, SQL Server setup, secret management (Azure Key Vault / HashiCorp Vault over private endpoints), Nginx/IIS reverse proxy + certificates, Windows Service installation, backup/restore and health monitoring.

Production starts **from environment variables only** (no committed `.env`), and refuses to start in `ENV=prod` without the required secrets (`FERNET_KEY`, `JWT_SECRET_KEY`, …).

Docker (single-host evaluation or bank private cloud):

```bash
docker compose up -d   # SQL Server profile available; set every secret via env
```

## Tests & CI

```bash
pip install -r requirements-dev.txt
python -m pytest        # full suite, 80% coverage gate
cd rpa-dashboard && npm run lint && npm run build
```

CI runs ruff + pyflakes, the pytest suite, frontend lint/build, dependency vulnerability scans (pip-audit / npm audit) and a gitleaks secret scan.

## Documentation

| Document | Contents |
|---|---|
| [docs/DEPLOYMENT_ON_PREM_BANK.md](docs/DEPLOYMENT_ON_PREM_BANK.md) | Production On-Premises deployment runbook |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, layering, data flow |
| [docs/adr/](docs/adr/) | Architecture decision records |
| [CHANGELOG.md](CHANGELOG.md) | Release history (4.0.0) |

> Proprietary — bank-internal use. Never commit secrets, agent credentials or database backups to this repository.
