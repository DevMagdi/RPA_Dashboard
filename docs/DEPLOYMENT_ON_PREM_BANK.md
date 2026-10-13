# Deployment — Bank on-prem (no internet egress)

Target profile: Windows/Linux VMs inside the bank network, **SQL Server**
standard, IIS or nginx as TLS reverse proxy, secrets in the bank's vault
(HashiCorp Vault or CyberArk via env injection), no outbound internet.

## 1. Topology

```
RPA-RUNNER-xx (agents) ──▶ IIS/nginx (TLS, :443) ──▶ API (gunicorn, :8000)
Browsers (intranet) ─────▶ IIS/nginx               ├─▶ SQL Server (RPA_Dashboard)
                                                   └─▶ Redis (optional, single VM ok)
```

## 2. Prerequisites

- SQL Server 2019+ with a dedicated login for the platform (db_owner on
  `RPA_Dashboard` only during migration; `db_datareader/writer` afterwards).
- Python 3.12 + unixODBC + **Microsoft ODBC Driver 18**, or the Docker image
  (which bundles them).
- Redis 7 (optional but recommended: cache, cross-worker realtime, rate limits).

## 3. Configuration (environment, never a committed file)

```ini
ENV=prod
DB_DIALECT=mssql
DB_SERVER=SQLPROD01.bank.local
DB_NAME=RPA_Dashboard
DB_USER=rpa_control_room
DB_PASSWORD=<from vault>
DB_TRUST_SERVER_CERT=no            # valid CA-signed cert on SQL Server
JWT_SECRET_KEY=<64+ chars, from vault>
FERNET_KEY=<generated once, from vault>
AGENT_TOKEN_PEPPER=<from vault>
SECRET_BACKEND=hashicorp_vault     # or env when the vault agent injects env vars
VAULT_ADDR=https://vault.bank.local:8200
ALLOWED_HOSTS=coe.bank.local
ALLOWED_ORIGINS=https://coe.bank.local
COOKIE_SECURE=true
SCHEDULER_ENABLED=true             # exactly one API worker runs the scheduler
```

`validate_security()` refuses to boot a production process that violates the
hard rules (short JWT secret, localhost hosts, plain-HTTP origins, trusted
self-signed DB certs).

## 4. Install & migrate

```bash
python -m venv /opt/control-room/.venv
/opt/control-room/.venv/bin/pip install -r requirements.txt   # from the internal PyPI mirror
/opt/control-room/.venv/bin/alembic upgrade head              # schema (DBA-approved change window)
BOOTSTRAP_ADMIN_PASSWORD='<strong>' /opt/control-room/.venv/bin/python -m app.db.bootstrap
```

Serve with gunicorn (systemd unit) **or** the Docker image on the bank's
container host:

```bash
gunicorn app.main:app --workers 1 --worker-class uvicorn.workers.UvicornWorker \
  --bind 127.0.0.1:8000 --timeout 120
```

Keep `--workers 1` while `SCHEDULER_ENABLED=true` (R3 in the CTO review);
scale read capacity later by adding scheduler-less workers behind the proxy.

## 5. Reverse proxy (IIS/ARR or nginx)

- Terminate TLS with the bank CA certificate; redirect 80 → 443; enable HSTS.
- Proxy `/api/` and `/ws/` (WebSocket upgrade) to the API; for
  `/api/realtime/events` disable response buffering (SSE) — see
  `deploy/nginx.conf` for the reference configuration.
- Restrict `/metrics` to the monitoring VLAN.

## 6. Go-live checklist

1. Rotate the bootstrap admin password; enable MFA for all operators.
2. Create tenants per business unit; point each at its UiPath/AA platform
   with `vault:` secret references.
3. Enrol runner agents (one-time enrolment code → permanent hashed token).
4. Run `python scripts/verify_dashboard.py https://coe.bank.local` (58 checks).
5. Schedule DB backups; test a restore; set the retention window per policy.
