# ============================================================================
# RPA CoE Control Room — API image
# Multi-dialect (SQL Server / PostgreSQL / SQLite) FastAPI backend.
# Runs as a non-root user behind gunicorn + uvicorn workers.
# ============================================================================
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# System dependencies:
#  - unixodbc + Microsoft ODBC Driver 18  -> SQL Server (DB_DIALECT=mssql)
#  - curl                                -> container HEALTHCHECK
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl gnupg2 unixodbc unixodbc-dev \
    && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/debian/12/prod bookworm main" > /etc/apt/sources.list.d/mssql-release.list \
    && apt-get update \
    && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY app ./app
COPY alembic.ini ./
COPY db ./db
COPY scripts ./scripts

# Non-root runtime user
RUN useradd --create-home --uid 10001 controlroom \
    && chown -R controlroom:controlroom /app
USER controlroom

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/health || exit 1

# gunicorn manages uvicorn workers (tune WEB_CONCURRENCY per host; keep 1 when
# SCHEDULER_ENABLED=true so background jobs run exactly once).
CMD ["sh", "-c", "gunicorn app.main:app --workers ${WEB_CONCURRENCY:-1} --worker-class uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000 --timeout 120 --access-logfile - --error-logfile -"]
