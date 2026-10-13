# Install the RPA CoE Control Room API as a Windows Service (run as Administrator).
# Prerequisites: Python 3.12 in C:\RPA\venv, NSSM (https://nssm.cc) in PATH,
# and every production secret present in the machine environment / bank vault agent.
param(
    [string]$AppDir = "C:\RPA\ControlRoom",
    [string]$ServiceName = "RPACoEControlRoom",
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$python = Join-Path $AppDir ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) { throw "Python venv not found at $python" }

# Production configuration comes from the environment only (no .env in prod).
# Set these in the service account environment or inject them from the vault:
#   ENV=prod DB_DIALECT=mssql DB_SERVER=... DB_NAME=RPA_Dashboard DB_USER=...
#   DB_PASSWORD, JWT_SECRET_KEY, FERNET_KEY, AGENT_TOKEN_PEPPER,
#   ALLOWED_HOSTS=coe.bank.local ALLOWED_ORIGINS=https://coe.bank.local

nssm install $ServiceName $python
nssm set $ServiceName AppDirectory $AppDir
nssm set $ServiceName AppParameters "-m uvicorn app.main:app --host 127.0.0.1 --port $Port --workers 1"
nssm set $ServiceName AppEnvironmentExtra "ENV=prod" "PYTHONUNBUFFERED=1"
nssm set $ServiceName Start SERVICE_AUTO_START
nssm set $ServiceName AppStdout (Join-Path $AppDir "logs\service.log")
nssm set $ServiceName AppStderr (Join-Path $AppDir "logs\service-error.log")
nssm set $ServiceName Description "RPA CoE Control Room 4.0.0 (On-Premises, single organization)"
Start-Service $ServiceName
Write-Host "Service $ServiceName installed and started on 127.0.0.1:$Port (put IIS/ARR in front for TLS)."
