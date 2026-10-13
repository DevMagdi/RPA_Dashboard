# Deployment — Cloud

Target profile: containers on Azure/AWS, **PostgreSQL** managed database,
Redis managed cache, secrets in **Azure Key Vault** (or HashiCorp Vault),
TLS at the ingress.

## 1. Reference stack (Docker Compose equivalent)

`docker-compose.yml` in the repo root is the single-host reference: API +
nginx web + PostgreSQL 16 + Redis 7. In managed cloud, replace `db`/`redis`
with the managed services and run `api`/`web` on Container Apps / ECS /
Kubernetes with the same environment variables.

## 2. Configuration highlights

```ini
ENV=prod
DB_DIALECT=postgresql
DB_SERVER=<managed-pg-host>
DB_USER=coe
DB_PASSWORD=<Key Vault>
SECRET_BACKEND=azure_keyvault
AZURE_KEYVAULT_URL=https://<vault>.vault.azure.net/
REDIS_URL=rediss://<managed-redis>:6380/0
ALLOWED_HOSTS=coe.example.com
ALLOWED_ORIGINS=https://coe.example.com
COOKIE_SECURE=true
SERVE_FRONTEND=false        # nginx web image serves the SPA
REALTIME_ENABLED=true
```

## 3. Scaling model

- **API**: scale horizontally; keep `SCHEDULER_ENABLED=true` on exactly one
  replica (dedicated single-replica deployment) — all other replicas run with
  `SCHEDULER_ENABLED=false`. Redis bridges realtime events across replicas.
- **Database**: managed PostgreSQL (PITR backups), connection pooling via the
  built-in settings (`DB_POOL_SIZE` etc.). For very high run-ingestion
  volume, put PgBouncer in transaction mode in front.
- **Web**: any CDN/static host can serve `rpa-dashboard/dist` instead of the
  nginx image, as long as `/api`, `/ws` and `/health` route to the API and
  SSE is not buffered.

## 4. CI/CD

GitHub Actions (`.github/workflows/ci.yml`) gates merges: pyflakes, pytest
with the 80 % coverage gate, the 62-check API smoke, frontend lint + build,
pip-audit / npm audit / gitleaks. CD (environment-specific) should:

1. Build both images (`Dockerfile`, `-f rpa-dashboard/Dockerfile`).
2. Run `alembic upgrade head` as a one-off job.
3. Roll out the API, then the web image.
4. Verify: `python scripts/verify_dashboard.py https://<host>` (58 checks).

## 5. Observability

- `/health` (liveness), `/health/ready`, `/health/detail` (DB/Redis/platform).
- `/metrics` — Prometheus (`rpa_http_requests_total`, auth events, agent
  gauges). Scrape from the monitoring network only.
- Structured JSON logs (`LOG_JSON=true`) with correlation IDs end-to-end;
  optional OpenTelemetry export (`OTEL_ENABLED=true`).
