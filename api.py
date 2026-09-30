from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import secrets
import hashlib
import hmac
from datetime import datetime, timedelta, date
from typing import Optional, Any, Literal

import pandas as pd
import numpy as np
import redis.asyncio as aioredis
from cryptography.fernet import Fernet
from dotenv import load_dotenv

from fastapi import (
    FastAPI,
    Query,
    Depends,
    HTTPException,
    Header,
    WebSocket,
    WebSocketDisconnect,
    Request,
)
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.concurrency import run_in_threadpool
from starlette.middleware.trustedhost import TrustedHostMiddleware

from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from pydantic import BaseModel, Field

from db_connection import run_query, execute_update, execute_transaction
from routers import auth

load_dotenv()

# ============================================================
# Logging
# ============================================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.FileHandler("api.log"), logging.StreamHandler()],
)
logger = logging.getLogger("RPA_API")

# ============================================================
# Security (Fernet)
# ============================================================
_FERNET_KEY = os.environ.get("FERNET_KEY")
_fernet: Optional[Fernet] = None


def _get_fernet() -> Fernet:
    global _fernet, _FERNET_KEY
    if _fernet is not None:
        return _fernet

    if not _FERNET_KEY:
        logger.warning("FERNET_KEY not found. Generating TEMP key for DEV.")
        _FERNET_KEY = Fernet.generate_key().decode()

    try:
        _fernet = Fernet(_FERNET_KEY.encode() if isinstance(_FERNET_KEY, str) else _FERNET_KEY)
        return _fernet
    except Exception:
        logger.error("Invalid FERNET_KEY format")
        raise HTTPException(status_code=500, detail="Configuration Error: Invalid Encryption Key")


def encrypt_text(text: str) -> str:
    return _get_fernet().encrypt(text.encode("utf-8")).decode("utf-8")


def decrypt_text(token: str) -> str:
    return _get_fernet().decrypt(token.encode("utf-8")).decode("utf-8")


# ============================================================
# Hardening Headers Middleware
# ============================================================
class SecurityHeadersMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message):
            if message.get("type") == "http.response.start":
                headers = dict(message.get("headers", []))
                headers[b"x-frame-options"] = b"DENY"
                headers[b"x-content-type-options"] = b"nosniff"
                headers[b"referrer-policy"] = b"strict-origin-when-cross-origin"
                # CSP isn't critical for JSON APIs, but keep it safe:
                headers[b"content-security-policy"] = (
                    b"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
                )
                message["headers"] = list(headers.items())
            await send(message)

        await self.app(scope, receive, send_with_headers)


# ============================================================
# App Init
# ============================================================
app = FastAPI(title="RPA CoE Control Room API", version="2.3.0")

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "::1"])

# Rate limiting
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)


@app.exception_handler(RateLimitExceeded)
async def rate_limit_exception_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"detail": "Rate limit exceeded. Try again later."},
    )


# GZip
app.add_middleware(GZipMiddleware, minimum_size=1000)

# CORS (important: frontend maybe 5173 or 3000)
default_origins = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000"
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", default_origins).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)

ENROLLMENT_TTL_MINUTES = int(os.environ.get("ENROLLMENT_TTL_MINUTES", "15"))
AGENT_TOKEN_PEPPER = os.environ.get("AGENT_TOKEN_PEPPER", "")
if not AGENT_TOKEN_PEPPER:
    logger.warning("AGENT_TOKEN_PEPPER not set (DEV).")

# Redis
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
redis_client = None


# ============================================================
# Helpers
# ============================================================
def clean_json_data(data: Any):
    if isinstance(data, dict):
        return {k: clean_json_data(v) for k, v in data.items()}
    if isinstance(data, list):
        return [clean_json_data(v) for v in data]

    try:
        if pd.isna(data):
            return None
    except Exception:
        pass

    if isinstance(data, (datetime, date, pd.Timestamp)):
        try:
            return data.isoformat()
        except Exception:
            return str(data)

    if isinstance(data, (np.integer,)):
        return int(data)
    if isinstance(data, (np.floating, float)):
        v = float(data)
        if math.isnan(v) or math.isinf(v):
            return None
        return v
    if isinstance(data, (np.bool_,)):
        return bool(data)

    return data


def raise_safe_error(action: str, exc: Exception):
    logger.error(f"{action} failed: {exc}", exc_info=True)
    raise HTTPException(status_code=500, detail=f"حدث خطأ أثناء {action}، برجاء المحاولة لاحقاً")


def _token_hash(token: str) -> str:
    token_b = token.encode("utf-8")
    if AGENT_TOKEN_PEPPER:
        return hmac.new(AGENT_TOKEN_PEPPER.encode("utf-8"), token_b, hashlib.sha256).hexdigest()
    return hashlib.sha256(token_b).hexdigest()


def _looks_like_sha256_hex(s: str) -> bool:
    if not isinstance(s, str) or len(s) != 64:
        return False
    try:
        int(s, 16)
        return True
    except Exception:
        return False


def _normalize_env(s: Optional[str]) -> Optional[str]:
    """Normalize old bad stored values like: 'UAT (comment)' -> 'UAT' """
    if not s:
        return s
    s = str(s).strip()
    for env in ("Development", "UAT", "Production"):
        if s.startswith(env):
            return env
    # if something weird:
    return s.split("(")[0].strip()


@app.get("/health")
def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


# ============================================================
# Models
# ============================================================
class ROIConfigUpdate(BaseModel):
    ProcessName: str = Field(..., min_length=1, max_length=100)
    EmpMinutesPerRequest: float = Field(..., ge=0)
    EmpCostPerRequest: float = Field(..., ge=0)
    BotCostPerRequest: float = Field(..., ge=0)
    ExpectedRunsPerDay: int = Field(..., ge=0)
    # Optional (frontend currently doesn't send them, but allow for future)
    Department: Optional[str] = Field(None, max_length=50)
    BotName: Optional[str] = Field(None, max_length=50)


class SLAConfigUpdate(BaseModel):
    ProcessName: str = Field(..., min_length=1, max_length=100)
    SLATargetMinutes: int = Field(..., gt=0)
    AvgItemProcessingSeconds: int = Field(..., gt=0)


class AgentEnrollRequest(BaseModel):
    MachineName: str = Field(..., min_length=1, max_length=100)
    EnrollmentCode: str = Field(..., min_length=4, max_length=20)


class MachineRegistration(BaseModel):
    MachineName: str = Field(..., min_length=1, max_length=100)
    AssignedBot: str = Field(..., min_length=1, max_length=100)
    RunnerType: Literal["Unattended", "Attended", "TestBot"]
    TotalRAM_GB: int = Field(..., gt=0)
    TotalHDD_GB: int = Field(..., gt=0)


class MachineUpdate(BaseModel):
    MachineName: str = Field(..., min_length=1, max_length=100)
    AssignedBot: str = Field(..., min_length=1, max_length=100)
    RunnerType: Literal["Unattended", "Attended", "TestBot"]
    TotalRAM_GB: int = Field(..., gt=0)
    TotalHDD_GB: int = Field(..., gt=0)


class AgentHeartbeat(BaseModel):
    MachineName: str = Field(..., min_length=1, max_length=100)
    CPU_Usage: int = Field(..., ge=0, le=100)
    RAM_Usage: int = Field(..., ge=0, le=100)
    HDD_Usage: int = Field(..., ge=0, le=100)


class BotVersionCreate(BaseModel):
    ProcessName: str = Field(..., min_length=1, max_length=100)
    VersionTag: str = Field(..., min_length=1, max_length=20)
    TargetMachineName: Optional[str] = Field(None, max_length=100)
    Description: Optional[str] = None


class CredentialInput(BaseModel):
    CredentialName: str = Field(..., min_length=1, max_length=100)
    Environment: str = Field(..., pattern="^(Development|UAT|Production)$")
    Value: str = Field(..., min_length=1)


class PromotionRequest(BaseModel):
    TargetEnvironment: str = Field(..., pattern="^(Development|UAT|Production)$")
    Comment: Optional[str] = Field(None, max_length=500)


# ============================================================
# ROI (FIXED: Upsert to support "new process" from frontend)
# ============================================================
@app.post("/api/update-roi")
def update_roi(
    config: ROIConfigUpdate,
    request: Request,
    current_user: auth.User = Depends(auth.require_roles("SuperAdmin", "CoE_Manager")),
):
    try:
        existing_df = run_query(
            """
            SELECT EmpMinutesPerRequest, EmpCostPerRequest, BotCostPerRequest, ExpectedRunsPerDay, Department, BotName
            FROM ProcessConfig
            WHERE ProcessName = :name
            """,
            {"name": config.ProcessName},
        )

        ip = (request.client.host if request.client else None)
        dept = (config.Department or "Operations")
        botname = (config.BotName or "Bot-01")

        if existing_df.empty:
            # INSERT (create new process automatically)
            insert_q = """
                INSERT INTO ProcessConfig
                    (ProcessName, Department, BotName, IsActive,
                     EmpMinutesPerRequest, EmpCostPerRequest, BotCostPerRequest, ExpectedRunsPerDay)
                VALUES
                    (:name, :dept, :bot, 1,
                     :m, :ec, :bc, :runs)
            """
            insert_p = {
                "name": config.ProcessName,
                "dept": dept,
                "bot": botname,
                "m": config.EmpMinutesPerRequest,
                "ec": config.EmpCostPerRequest,
                "bc": config.BotCostPerRequest,
                "runs": config.ExpectedRunsPerDay,
            }

            audit_q = """
                INSERT INTO AuditLogs (UserID, ActionType, ProcessName, OldValues, NewValues, IPAddress, IsSuccess)
                VALUES (:u, 'Create_Process_ROI', :p, NULL, :nv, :ip, 1)
            """
            audit_p = {
                "u": current_user.UserID,
                "p": config.ProcessName,
                "nv": json.dumps(config.model_dump(), default=str),
                "ip": ip,
            }

            execute_transaction([(insert_q, insert_p), (audit_q, audit_p)])
            return {"status": "success", "message": "Process created & ROI saved"}

        # UPDATE (existing)
        old_vals = existing_df.iloc[0].to_dict()
        update_q = """
            UPDATE ProcessConfig
            SET EmpMinutesPerRequest = :m,
                EmpCostPerRequest    = :ec,
                BotCostPerRequest    = :bc,
                ExpectedRunsPerDay   = :runs
            WHERE ProcessName = :name
        """
        update_p = {
            "m": config.EmpMinutesPerRequest,
            "ec": config.EmpCostPerRequest,
            "bc": config.BotCostPerRequest,
            "runs": config.ExpectedRunsPerDay,
            "name": config.ProcessName,
        }

        audit_q = """
            INSERT INTO AuditLogs (UserID, ActionType, ProcessName, OldValues, NewValues, IPAddress, IsSuccess)
            VALUES (:u, 'Update_ROI', :p, :ov, :nv, :ip, 1)
        """
        audit_p = {
            "u": current_user.UserID,
            "p": config.ProcessName,
            "ov": json.dumps(old_vals, default=str),
            "nv": json.dumps(config.model_dump(), default=str),
            "ip": ip,
        }

        execute_transaction([(update_q, update_p), (audit_q, audit_p)])
        return {"status": "success", "message": "ROI configuration updated successfully"}

    except Exception as e:
        raise_safe_error("تحديث/إنشاء بيانات الـ ROI", e)


# ============================================================
# Processes (Keyset Pagination) - Compatible with frontend contract
# ============================================================
@app.get("/api/processes")
def list_processes(
    search: Optional[str] = Query(None),
    department: Optional[str] = Query(None),
    after: Optional[str] = Query(None),
    page_size: int = Query(200, ge=1, le=1000),
    include_total: bool = Query(False),
    current_user: auth.User = Depends(auth.get_current_user),
):
    try:
        where = ["1=1"]
        params: dict[str, Any] = {}

        if current_user.AllowedDepartment != "ALL":
            where.append("Department = :dept_scope")
            params["dept_scope"] = current_user.AllowedDepartment

        if department and current_user.AllowedDepartment == "ALL":
            where.append("Department = :dept")
            params["dept"] = department

        if search:
            where.append("ProcessName LIKE :search")
            params["search"] = f"{search}%"

        if after:
            where.append("ProcessName > :after")
            params["after"] = after

        where_sql = " AND ".join(where)

        total = None
        if include_total:
            count_df = run_query(f"SELECT COUNT(1) AS total FROM ProcessConfig WHERE {where_sql}", params)
            total = int(count_df.iloc[0]["total"]) if not count_df.empty else 0

        # Fetch page_size + 1 to know if next_cursor exists
        top_n = int(page_size) + 1
        data_df = run_query(
            f"""
            SELECT TOP {top_n}
                ProcessName, Department, BotName, ExpectedRunsPerDay, SLATargetMinutes, Criticality, IsActive,
                EmpMinutesPerRequest, EmpCostPerRequest, BotCostPerRequest
            FROM ProcessConfig
            WHERE {where_sql}
            ORDER BY ProcessName
            """,
            params,
        )

        items = clean_json_data(data_df.to_dict("records")) if not data_df.empty else []
        has_more = len(items) > page_size
        items = items[:page_size]

        next_cursor = items[-1]["ProcessName"] if (has_more and items) else None

        return {
            "page_size": page_size,
            "total": total,
            "next_cursor": next_cursor,
            "items": items,
        }
    except Exception as e:
        raise_safe_error("تحميل قائمة العمليات", e)


# ============================================================
# Dashboard Data
# ============================================================


@app.get("/api/dashboard-data")
def get_dashboard_data(
    process: Optional[str] = Query(None),
    days: int = Query(90, ge=1, le=730),
    current_user: auth.User = Depends(auth.get_current_user),
):
    try:
        cfg_filters = []
        runs_filters = ["r.StartTime >= DATEADD(day, -:days, GETDATE())"]
        params: dict[str, Any] = {"days": days}

        if current_user.AllowedDepartment != "ALL":
            cfg_filters.append("Department = :dept")
            runs_filters.append("c.Department = :dept")
            params["dept"] = current_user.AllowedDepartment

        if process and process != "All":
            p_df = run_query(
                f"""
                SELECT 1 AS X FROM ProcessConfig
                WHERE ProcessName = :p
                {"AND Department = :dept" if current_user.AllowedDepartment != "ALL" else ""}
                """,
                {"p": process, **({"dept": current_user.AllowedDepartment} if current_user.AllowedDepartment != "ALL" else {})},
            )
            if p_df.empty:
                raise HTTPException(status_code=403, detail="غير مصرح لك برؤية هذه العملية")

            cfg_filters.append("ProcessName = :p")
            runs_filters.append("r.ProcessName = :p")
            params["p"] = process

        cfg_where = ("WHERE " + " AND ".join(cfg_filters)) if cfg_filters else ""
        runs_where = " AND ".join(runs_filters)

        cfg_kpis_df = run_query(
            f"""
            SELECT
                COUNT(1) AS totalProcedures,
                ISNULL(SUM(ISNULL(ExpectedRunsPerDay,0)),0) AS targetRuns
            FROM ProcessConfig
            {cfg_where}
            """,
            params,
        )
        total_procedures = int(cfg_kpis_df.iloc[0]["totalProcedures"]) if not cfg_kpis_df.empty else 0
        target_runs = int(cfg_kpis_df.iloc[0]["targetRuns"]) if not cfg_kpis_df.empty else 0

        runs_kpis_df = run_query(
            f"""
            SELECT
                COUNT(1) AS bookedRuns,
                SUM(CASE WHEN r.Status = 'Completed' THEN 1 ELSE 0 END) AS successRuns,
                ISNULL(SUM(ISNULL(r.TransactionsCount,0)),0) AS totalTransactions,
                ISNULL(SUM(
                    CAST(ISNULL(r.TransactionsCount,0) AS float) * CAST(ISNULL(c.EmpMinutesPerRequest,0) AS float) / 60.0
                ),0) AS timeSavedHours,
                ISNULL(SUM(
                    CAST(ISNULL(r.TransactionsCount,0) AS float) *
                    (CAST(ISNULL(c.EmpCostPerRequest,0) AS float) - CAST(ISNULL(c.BotCostPerRequest,0) AS float))
                ),0) AS costSaved
            FROM ProcessRuns r
            JOIN ProcessConfig c ON r.ProcessName = c.ProcessName
            WHERE {runs_where}
            """,
            params,
        )

        booked_runs = int(runs_kpis_df.iloc[0]["bookedRuns"]) if not runs_kpis_df.empty else 0
        success_runs = int(runs_kpis_df.iloc[0]["successRuns"] or 0) if not runs_kpis_df.empty else 0
        total_transactions = int(runs_kpis_df.iloc[0]["totalTransactions"] or 0) if not runs_kpis_df.empty else 0
        time_saved = float(runs_kpis_df.iloc[0]["timeSavedHours"] or 0) if not runs_kpis_df.empty else 0.0
        cost_saved = float(runs_kpis_df.iloc[0]["costSaved"] or 0) if not runs_kpis_df.empty else 0.0

        success_rate = int((success_runs / booked_runs) * 100) if booked_runs > 0 else 0
        error_rate = 100 - success_rate

        today_df = run_query(
            f"""
            SELECT
                COUNT(1) AS runsToday,
                SUM(CASE WHEN r.Status IN ('Failed','Stopped') THEN 1 ELSE 0 END) AS stopsToday
            FROM ProcessRuns r
            JOIN ProcessConfig c ON r.ProcessName = c.ProcessName
            WHERE r.StartTime >= CONVERT(date, GETDATE())
              AND r.StartTime < DATEADD(day, 1, CONVERT(date, GETDATE()))
              AND ({'1=1' if current_user.AllowedDepartment == 'ALL' else 'c.Department = :dept'})
              {'' if not (process and process != 'All') else 'AND r.ProcessName = :p'}
            """,
            params,
        )
        runs_today = int(today_df.iloc[0]["runsToday"]) if not today_df.empty else 0
        stops_today = int(today_df.iloc[0]["stopsToday"] or 0) if not today_df.empty else 0

        running_df = run_query(
            f"""
            SELECT TOP 1 r.ProcessName, r.RequestID
            FROM ProcessRuns r
            JOIN ProcessConfig c ON r.ProcessName = c.ProcessName
            WHERE r.Status = 'Running'
              AND ({'1=1' if current_user.AllowedDepartment == 'ALL' else 'c.Department = :dept'})
              {'' if not (process and process != 'All') else 'AND r.ProcessName = :p'}
            ORDER BY r.StartTime DESC
            """,
            params,
        )
        active_req = str(running_df.iloc[0]["RequestID"]) if not running_df.empty else "-"
        active_proc = str(running_df.iloc[0]["ProcessName"]) if not running_df.empty else "Idle"
        current_status = "Running" if not running_df.empty else "Standby"

        fail_df = run_query(
            f"""
            SELECT TOP 50 r.ProcessName, r.RequestID,
                   ISNULL(NULLIF(r.FailureReason,''), 'Unknown Error') AS FailureReason,
                   r.Status
            FROM ProcessRuns r
            JOIN ProcessConfig c ON r.ProcessName = c.ProcessName
            WHERE r.StartTime >= CONVERT(date, GETDATE())
              AND r.StartTime < DATEADD(day, 1, CONVERT(date, GETDATE()))
              AND r.Status IN ('Failed','Stopped')
              AND ({'1=1' if current_user.AllowedDepartment == 'ALL' else 'c.Department = :dept'})
              {'' if not (process and process != 'All') else 'AND r.ProcessName = :p'}
            ORDER BY r.StartTime DESC
            """,
            params,
        )
        failure_details = fail_df.to_dict("records") if not fail_df.empty else []

        status_df = run_query(
            f"""
            SELECT r.Status AS name, COUNT(1) AS value
            FROM ProcessRuns r
            JOIN ProcessConfig c ON r.ProcessName = c.ProcessName
            WHERE {runs_where}
            GROUP BY r.Status
            """,
            params,
        )
        status_distribution = status_df.to_dict("records") if not status_df.empty else []

        sav_df = run_query(
            f"""
            SELECT TOP 14 CONVERT(date, r.StartTime) AS RunDate,
                   ISNULL(SUM(
                    CAST(ISNULL(r.TransactionsCount,0) AS float) *
                    (CAST(ISNULL(c.EmpCostPerRequest,0) AS float) - CAST(ISNULL(c.BotCostPerRequest,0) AS float))
                   ),0) AS costSaved
            FROM ProcessRuns r
            JOIN ProcessConfig c ON r.ProcessName = c.ProcessName
            WHERE r.StartTime >= DATEADD(day, -14, GETDATE())
              AND ({'1=1' if current_user.AllowedDepartment == 'ALL' else 'c.Department = :dept'})
              {'' if not (process and process != 'All') else 'AND r.ProcessName = :p'}
            GROUP BY CONVERT(date, r.StartTime)
            ORDER BY RunDate
            """,
            params,
        )
        savings_data = []
        if not sav_df.empty:
            sav_df["date"] = pd.to_datetime(sav_df["RunDate"], errors="coerce").dt.strftime("%d %b")
            sav_df["bar"] = pd.to_numeric(sav_df["costSaved"], errors="coerce").fillna(0).round(2)
            sav_df["line"] = sav_df["bar"] + (sav_df["bar"] * 0.1)
            savings_data = sav_df[["date", "bar", "line"]].to_dict("records")

        vol_df = run_query(
            f"""
            SELECT TOP 14 CONVERT(date, r.StartTime) AS RunDate, COUNT(1) AS volume
            FROM ProcessRuns r
            JOIN ProcessConfig c ON r.ProcessName = c.ProcessName
            WHERE r.StartTime >= DATEADD(day, -14, GETDATE())
              AND ({'1=1' if current_user.AllowedDepartment == 'ALL' else 'c.Department = :dept'})
              {'' if not (process and process != 'All') else 'AND r.ProcessName = :p'}
            GROUP BY CONVERT(date, r.StartTime)
            ORDER BY RunDate
            """,
            params,
        )
        volume_data = []
        if not vol_df.empty:
            vol_df["date"] = pd.to_datetime(vol_df["RunDate"], errors="coerce").dt.strftime("%d %b")
            volume_data = vol_df[["date", "volume"]].to_dict("records")

        recent_df = run_query(
            f"""
            SELECT TOP 8 r.RunID, r.ProcessName, r.RequestID, r.Status, r.StartTime, r.EndTime,
                   r.DurationMinutes, r.FailureReason, r.TransactionsCount, r.CostSaved
            FROM ProcessRuns r
            JOIN ProcessConfig c ON r.ProcessName = c.ProcessName
            WHERE {runs_where}
            ORDER BY r.StartTime DESC
            """,
            params,
        )
        table = recent_df.to_dict("records") if not recent_df.empty else []

        # ============================================================
        # TODAY EXCEPTIONS (GLOBAL across processes) - department scoped
        # ============================================================
        dept_cond = "1=1" if current_user.AllowedDepartment == "ALL" else "c.Department = :dept"

        today_ex_df = run_query(
            f"""
            SELECT
                COUNT(1) AS stopsTodayAll
            FROM ProcessRuns r
            JOIN ProcessConfig c ON r.ProcessName = c.ProcessName
            WHERE r.StartTime >= CONVERT(date, GETDATE())
              AND r.StartTime < DATEADD(day, 1, CONVERT(date, GETDATE()))
              AND r.Status IN ('Failed','Stopped')
              AND ({dept_cond})
            """,
            params,
        )
        stops_today_all = int(today_ex_df.iloc[0]["stopsTodayAll"] or 0) if not today_ex_df.empty else 0

        today_fail_all_df = run_query(
            f"""
            SELECT TOP 200
                r.ProcessName,
                r.RequestID,
                r.Status,
                ISNULL(NULLIF(r.FailureReason,''), 'Unknown Error') AS FailureReason
            FROM ProcessRuns r
            JOIN ProcessConfig c ON r.ProcessName = c.ProcessName
            WHERE r.StartTime >= CONVERT(date, GETDATE())
              AND r.StartTime < DATEADD(day, 1, CONVERT(date, GETDATE()))
              AND r.Status IN ('Failed','Stopped')
              AND ({dept_cond})
            ORDER BY r.StartTime DESC
            """,
            params,
        )
        failure_details_all = today_fail_all_df.to_dict("records") if not today_fail_all_df.empty else []
        response_data = {
            "kpis": {
                "totalProcedures": total_procedures,
                "totalTransactions": total_transactions,
                "runsToday": runs_today,
                "targetRuns": target_runs,
                "stopsToday": stops_today,
                "timeSaved": round(time_saved, 1),
                "costSaved": int(round(cost_saved, 0)),
                "activeRequest": active_req,
                "activeProcess": active_proc,
                "status": current_status,
                "stopsTodayAll": stops_today_all,
                "failureDetailsAll": failure_details_all,
            },
            "sidebarStats": {"bookedRuns": booked_runs, "successRate": success_rate, "errorRate": error_rate},
            "analytics": {"statusDistribution": status_distribution},
            "charts": {"volume": volume_data, "savings": savings_data},
            "table": table,
        }
        return clean_json_data(response_data)

    except HTTPException:
        raise
    except Exception as e:
        raise_safe_error("تحميل بيانات الداشبورد", e)


# ============================================================
# Audit Logs
# ============================================================
@app.get("/api/audit-logs")
def get_audit_logs(
    limit: int = Query(500, ge=1, le=5000),
    current_user: auth.User = Depends(auth.require_roles("SuperAdmin", "CoE_Manager")),
):
    try:
        top_n = int(limit)
        dept_filter = ""
        params: dict[str, Any] = {}

        if current_user.AllowedDepartment != "ALL":
            dept_filter = " WHERE p.Department = :dept"
            params["dept"] = current_user.AllowedDepartment

        query = f"""
            SELECT TOP {top_n}
                   a.LogID, ISNULL(u.Username, 'System') AS Username, a.ActionType,
                   a.ProcessName, a.OldValues, a.NewValues, a.ActionDate, a.IPAddress, a.IsSuccess
            FROM AuditLogs a
            LEFT JOIN SystemUsers u ON a.UserID = u.UserID
            LEFT JOIN ProcessConfig p ON a.ProcessName = p.ProcessName
            {dept_filter}
            ORDER BY a.ActionDate DESC
        """
        df_audit = run_query(query, params)
        if df_audit.empty:
            return []
        df_audit["ActionDate"] = pd.to_datetime(df_audit["ActionDate"], errors="coerce").dt.strftime("%Y-%m-%d %H:%M:%S")
        return clean_json_data(df_audit.to_dict("records"))
    except Exception as e:
        raise_safe_error("تحميل سجلات التدقيق", e)


# ============================================================
# SLA & Workload
# ============================================================
@app.post("/api/update-sla")
def update_sla(
    config: SLAConfigUpdate,
    request: Request,
    current_user: auth.User = Depends(auth.require_roles("SuperAdmin", "CoE_Manager")),
):
    try:
        old_config_df = run_query(
            "SELECT SLATargetMinutes FROM ProcessConfig WHERE ProcessName = :name",
            {"name": config.ProcessName},
        )
        if old_config_df.empty:
            raise HTTPException(status_code=404, detail="العملية غير موجودة في الإعدادات")

        old_queue_df = run_query(
            "SELECT AvgItemProcessingSeconds FROM ProcessQueues WHERE ProcessName = :name",
            {"name": config.ProcessName},
        )

        old_vals: dict[str, Any] = {}
        sla_val = old_config_df.iloc[0]["SLATargetMinutes"]
        old_vals["SLATargetMinutes"] = int(sla_val) if pd.notnull(sla_val) else 0

        if not old_queue_df.empty:
            avg_val = old_queue_df.iloc[0]["AvgItemProcessingSeconds"]
            old_vals["AvgItemProcessingSeconds"] = int(avg_val) if pd.notnull(avg_val) else 0
        else:
            old_vals["AvgItemProcessingSeconds"] = 0

        update_config_query = "UPDATE ProcessConfig SET SLATargetMinutes = :sla WHERE ProcessName = :name"
        update_queue_query = """
            IF EXISTS (SELECT 1 FROM ProcessQueues WHERE ProcessName = :name)
                UPDATE ProcessQueues SET AvgItemProcessingSeconds = :avg_sec WHERE ProcessName = :name
            ELSE
                INSERT INTO ProcessQueues (ProcessName, PendingItems, ActiveItems, AvgItemProcessingSeconds)
                VALUES (:name, 0, 0, :avg_sec)
        """
        audit_query = """
            INSERT INTO AuditLogs (UserID, ActionType, ProcessName, OldValues, NewValues, IPAddress, IsSuccess)
            VALUES (:user_id, 'Update_SLA', :name, :old_vals, :new_vals, :ip, 1)
        """

        execute_transaction(
            [
                (update_config_query, {"sla": config.SLATargetMinutes, "name": config.ProcessName}),
                (update_queue_query, {"avg_sec": config.AvgItemProcessingSeconds, "name": config.ProcessName}),
                (
                    audit_query,
                    {
                        "user_id": current_user.UserID,
                        "name": config.ProcessName,
                        "old_vals": json.dumps(old_vals, default=str),
                        "new_vals": json.dumps(config.model_dump(), default=str),
                        "ip": (request.client.host if request.client else None),
                    },
                ),
            ]
        )
        return {"status": "success", "message": "SLA configuration updated successfully"}

    except HTTPException:
        raise
    except Exception as e:
        raise_safe_error("تحديث إعدادات الـ SLA", e)


@app.get("/api/sla-workload")
def get_sla_workload(current_user: auth.User = Depends(auth.get_current_user)):
    try:
        dept_filter = ""
        params: dict[str, Any] = {}

        if current_user.AllowedDepartment != "ALL":
            dept_filter = " AND c.Department = :dept"
            params["dept"] = current_user.AllowedDepartment

        query = f"""
            SELECT q.ProcessName, q.PendingItems, q.ActiveItems, q.AvgItemProcessingSeconds,
                   c.SLATargetMinutes, c.Department
            FROM ProcessQueues q
            JOIN ProcessConfig c ON q.ProcessName = c.ProcessName
            WHERE 1=1 {dept_filter}
        """
        df_queue = run_query(query, params)
        if df_queue.empty:
            return []

        df_queue["EstimatedCompletionMinutes"] = (
            pd.to_numeric(df_queue["PendingItems"], errors="coerce").fillna(0)
            * pd.to_numeric(df_queue["AvgItemProcessingSeconds"], errors="coerce").fillna(0)
        ) / 60.0

        def determine_status(row):
            est = row.get("EstimatedCompletionMinutes", 0)
            sla = row.get("SLATargetMinutes", 0)
            if sla == 0 or pd.isna(sla):
                return "Unknown"
            ratio = est / sla
            if ratio >= 1.0:
                return "Breach_Risk"
            if ratio >= 0.75:
                return "Warning"
            return "Healthy"

        df_queue["SLAStatus"] = df_queue.apply(determine_status, axis=1)
        df_queue["EstimatedCompletionMinutes"] = (
            pd.to_numeric(df_queue["EstimatedCompletionMinutes"], errors="coerce").fillna(0).round(1)
        )
        return clean_json_data(df_queue.to_dict("records"))

    except Exception as e:
        raise_safe_error("تحميل بيانات SLA", e)


# ============================================================
# Bot Lifecycle (FIXED promote logging + history aggregation)
# ============================================================
@app.post("/api/bot-versions", tags=["Lifecycle"])
@limiter.limit("20/minute")
async def create_bot_version(
    version_data: BotVersionCreate,
    request: Request,
    current_user: auth.User = Depends(auth.require_roles("SuperAdmin", "CoE_Manager")),
):
    try:
        # Ensure process exists (frontend "new_process" relies on upsert in update-roi,
        # but keep safeguard here too)
        proc_exists = run_query(
            "SELECT 1 AS X FROM ProcessConfig WHERE ProcessName = :name",
            {"name": version_data.ProcessName},
        )
        if proc_exists.empty:
            # create minimal process config with defaults
            execute_update(
                """
                INSERT INTO ProcessConfig
                    (ProcessName, Department, BotName, IsActive,
                     EmpMinutesPerRequest, EmpCostPerRequest, BotCostPerRequest, ExpectedRunsPerDay)
                VALUES
                    (:name, 'Operations', 'Bot-01', 1, 15, 10, 0.5, 0)
                """,
                {"name": version_data.ProcessName},
            )

        tag_exists = run_query(
            "SELECT 1 AS X FROM BotVersions WHERE ProcessName = :name AND VersionTag = :tag",
            {"name": version_data.ProcessName, "tag": version_data.VersionTag},
        )
        if not tag_exists.empty:
            raise HTTPException(status_code=400, detail="رقم هذه النسخة مسجل بالفعل لهذه العملية")

        insert_ver_query = """
            INSERT INTO BotVersions (ProcessName, VersionTag, CurrentStatus, TargetMachineName, CreatedBy, Notes)
            VALUES (:name, :tag, 'Development', :machine, :user, :notes)
        """

        await run_in_threadpool(
            execute_update,
            insert_ver_query,
            {
                "name": version_data.ProcessName,
                "tag": version_data.VersionTag,
                "machine": version_data.TargetMachineName,
                "user": current_user.UserID,
                "notes": version_data.Description,
            },
        )

        ver_info = run_query(
            """
            SELECT TOP 1 v.*, u.Username AS CreatorName
            FROM BotVersions v
            LEFT JOIN SystemUsers u ON v.CreatedBy = u.UserID
            WHERE v.ProcessName = :pname
            ORDER BY v.VersionID DESC
            """,
            {"pname": version_data.ProcessName},
        )
        new_version_id = int(ver_info.iloc[0]["VersionID"]) if not ver_info.empty else None

        await run_in_threadpool(
            execute_update,
            """
            INSERT INTO AuditLogs (UserID, ActionType, ProcessName, OldValues, NewValues, IPAddress, IsSuccess)
            VALUES (:u, 'Version_Created', :p, NULL, :newv, :ip, 1)
            """,
            {
                "u": current_user.UserID,
                "p": version_data.ProcessName,
                "newv": json.dumps(
                    {"VersionID": new_version_id, "VersionTag": version_data.VersionTag},
                    default=str
                ),
                "ip": request.client.host if request.client else None,
            },
        )

        return {
            "status": "success",
            "message": "Bot Version Created",
            "data": clean_json_data(ver_info.to_dict("records")[0]) if not ver_info.empty else {},
        }

    except HTTPException:
        raise
    except Exception as e:
        raise_safe_error("إنشاء النسخة", e)


@app.get("/api/bot-versions/{process_name}/history", tags=["Lifecycle"])
def get_version_history(process_name: str, current_user: auth.User = Depends(auth.get_current_user)):
    try:
        df = run_query(
            """
            SELECT
                v.VersionID, v.ProcessName, v.VersionTag, v.CurrentStatus, v.TargetMachineName,
                v.CreatedBy, v.CreatedAt, v.LastPromotedAt, v.Notes,
                u.Username AS CreatorName,
                (SELECT COUNT(1) FROM BotVault b WHERE b.VersionID = v.VersionID) AS CredentialsCount
            FROM BotVersions v
            LEFT JOIN SystemUsers u ON v.CreatedBy = u.UserID
            WHERE v.ProcessName = :pname
            ORDER BY v.VersionID DESC
            """,
            {"pname": process_name},
        )
        if df.empty:
            return []
        df["CurrentStatus"] = df["CurrentStatus"].apply(_normalize_env)
        return clean_json_data(df.to_dict("records"))
    except Exception as e:
        raise_safe_error("تحميل تاريخ النسخ", e)


@app.post("/api/bot-versions/{version_id}/credentials", tags=["Lifecycle"])
async def add_credential_to_version(
    version_id: int,
    cred: CredentialInput,
    request: Request,
    current_user: auth.User = Depends(auth.require_roles("SuperAdmin", "CoE_Manager")),
):
    try:
        ver_check = run_query(
            "SELECT ProcessName FROM BotVersions WHERE VersionID = :id",
            {"id": version_id},
        )
        if ver_check.empty:
            raise HTTPException(status_code=404, detail="النسخة غير موجودة")

        encrypted_value = encrypt_text(cred.Value)

        await run_in_threadpool(
            execute_update,
            """
            INSERT INTO BotVault (VersionID, CredentialName, Environment, EncryptedValue)
            VALUES (:id, :name, :env, :enc)
            """,
            {"id": version_id, "name": cred.CredentialName, "env": cred.Environment, "enc": encrypted_value},
        )

        await run_in_threadpool(
            execute_update,
            """
            INSERT INTO AuditLogs (UserID, ActionType, ProcessName, OldValues, NewValues, IPAddress, IsSuccess)
            VALUES (:u, 'Vault_Add_Cred', :p, NULL, :nv, :ip, 1)
            """,
            {
                "u": current_user.UserID,
                "p": ver_check.iloc[0]["ProcessName"],
                "nv": json.dumps({"CredentialName": cred.CredentialName, "Environment": cred.Environment, "VersionID": version_id}),
                "ip": request.client.host if request.client else None,
            },
        )

        return {"status": "success", "message": "Credential added securely"}

    except HTTPException:
        raise
    except Exception as e:
        raise_safe_error("إضافة السر", e)


@app.post("/api/bot-versions/{version_id}/promote", tags=["Lifecycle"])
async def promote_bot_version(
    version_id: int,
    promo: PromotionRequest,
    request: Request,
    current_user: auth.User = Depends(auth.require_roles("SuperAdmin", "CoE_Manager")),
):
    """
    FIXED: PromotionAuditLog.NewStatus must be only env (varchar(20)).
    Comment stored in AuditLogs NewValues instead.
    """
    try:
        ver_row = run_query("SELECT VersionID, ProcessName, CurrentStatus FROM BotVersions WHERE VersionID = :id", {"id": version_id})
        if ver_row.empty:
            raise HTTPException(status_code=404, detail="النسخة غير موجودة")

        current_status = _normalize_env(ver_row.iloc[0]["CurrentStatus"])
        target_env = promo.TargetEnvironment

        if current_status == target_env:
            raise HTTPException(status_code=400, detail=f"النسخة موجودة بالفعل في بيئة {target_env}")

        ip = request.client.host if request.client else "System"

        # Update version
        await run_in_threadpool(
            execute_update,
            "UPDATE BotVersions SET CurrentStatus = :s, LastPromotedAt = GETDATE() WHERE VersionID = :id",
            {"s": target_env, "id": version_id},
        )

        # Insert promotion audit (ONLY env names)
        await run_in_threadpool(
            execute_update,
            """
            INSERT INTO PromotionAuditLog (VersionID, PreviousStatus, NewStatus, PromotedBy, IPAddress)
            VALUES (:id, :old, :new, :u, :ip)
            """,
            {"id": version_id, "old": current_status, "new": target_env, "u": current_user.UserID, "ip": ip},
        )

        # Store comment in AuditLogs
        await run_in_threadpool(
            execute_update,
            """
            INSERT INTO AuditLogs (UserID, ActionType, ProcessName, OldValues, NewValues, IPAddress, IsSuccess)
            VALUES (:u, 'Version_Promote', :p, :ov, :nv, :ip, 1)
            """,
            {
                "u": current_user.UserID,
                "p": ver_row.iloc[0]["ProcessName"],
                "ov": json.dumps({"from": current_status}, default=str),
                "nv": json.dumps({"to": target_env, "comment": promo.Comment}, default=str),
                "ip": ip,
            },
        )

        return {"status": "success", "message": f"Moved to {target_env}"}

    except HTTPException:
        raise
    except Exception as e:
        raise_safe_error("تحديث حالة النسخة", e)


@app.get("/api/bot-versions/live-status", tags=["Lifecycle"])
def get_live_lifecycle_dashboard(current_user: auth.User = Depends(auth.get_current_user)):
    try:
        stats = run_query(
            """
            SELECT
                SUM(CASE WHEN CurrentStatus = 'Production' THEN 1 ELSE 0 END)  AS ProductionCount,
                SUM(CASE WHEN CurrentStatus = 'UAT' THEN 1 ELSE 0 END)         AS UATCount,
                SUM(CASE WHEN CurrentStatus = 'Development' THEN 1 ELSE 0 END) AS DevCount
            FROM BotVersions
            """
        )

        recent_promos = run_query(
            """
            SELECT TOP 10
                v.ProcessName,
                v.VersionTag,
                pl.PreviousStatus,
                pl.NewStatus,
                pl.PromotedAt,
                u.Username
            FROM PromotionAuditLog pl
            JOIN BotVersions v ON pl.VersionID = v.VersionID
            LEFT JOIN SystemUsers u ON pl.PromotedBy = u.UserID
            ORDER BY pl.PromotedAt DESC
            """
        )

        promos = clean_json_data(recent_promos.to_dict("records")) if not recent_promos.empty else []
        # normalize status strings for safety (in case old bad data exists)
        for p in promos:
            p["PreviousStatus"] = _normalize_env(p.get("PreviousStatus"))
            p["NewStatus"] = _normalize_env(p.get("NewStatus"))

        return {
            "counts": stats.to_dict("records")[0] if not stats.empty else {"ProductionCount": 0, "UATCount": 0, "DevCount": 0},
            "recent_promotions": promos,
        }

    except Exception as e:
        raise_safe_error("تحميل حالة الـ Lifecycle", e)


@app.post("/api/bot-versions/{version_id}/decrypt/{vault_id}", tags=["Lifecycle"])
def get_credential_value(
    version_id: int,
    vault_id: int,
    current_user: auth.User = Depends(auth.require_roles("SuperAdmin")),
):
    vault_rec = run_query(
        "SELECT EncryptedValue FROM BotVault WHERE VaultID = :id AND VersionID = :vid",
        {"id": vault_id, "vid": version_id},
    )
    if vault_rec.empty:
        raise HTTPException(status_code=404, detail="السر غير موجود")

    try:
        return {"plaintext": decrypt_text(str(vault_rec.iloc[0]["EncryptedValue"]))}
    except Exception:
        raise HTTPException(status_code=500, detail="فشل فك التشفير")


# ============================================================
# Infrastructure (used by InfrastructureHealth component)
# ============================================================
def generate_enrollment_code(length: int = 8) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    code = "".join(secrets.choice(alphabet) for _ in range(length))
    return f"{code[:4]}-{code[4:]}"


@app.post("/api/register-machine")
def register_machine(
    machine: MachineRegistration,
    current_user: auth.User = Depends(auth.require_roles("SuperAdmin", "CoE_Manager")),
):
    try:
        existing = run_query(
            "SELECT MachineName FROM BotInfrastructure WHERE MachineName = :name",
            {"name": machine.MachineName},
        )
        if not existing.empty:
            raise HTTPException(status_code=400, detail="هذا الجهاز مسجل بالفعل")

        proc_exists = run_query(
            "SELECT 1 AS X FROM ProcessConfig WHERE ProcessName = :p",
            {"p": machine.AssignedBot},
        )
        if proc_exists.empty:
            raise HTTPException(status_code=400, detail="العملية المحددة غير موجودة في قاعدة البيانات")

        insert_query = """
            INSERT INTO BotInfrastructure
            (MachineName, AssignedProcess, Status, CPU_Usage, RAM_Usage, HDD_Usage, LastPing,
             TotalRAM_GB, TotalHDD_GB, RunnerType, AgentToken)
            VALUES (:name, :bot, 'Offline', 0, 0, 0, GETDATE(), :ram, :hdd, :runner_type, NULL)
        """

        enrollment_code = generate_enrollment_code()
        enrollment_query = """
            INSERT INTO AgentEnrollmentCodes (MachineName, EnrollmentCode, ExpiresAt)
            VALUES (:name, :code, DATEADD(minute, :ttl, GETDATE()))
        """

        execute_transaction(
            [
                (insert_query, {
                    "name": machine.MachineName,
                    "bot": machine.AssignedBot,
                    "ram": machine.TotalRAM_GB,
                    "hdd": machine.TotalHDD_GB,
                    "runner_type": machine.RunnerType,
                }),
                ("DELETE FROM AgentEnrollmentCodes WHERE MachineName = :name", {"name": machine.MachineName}),
                (enrollment_query, {"name": machine.MachineName, "code": enrollment_code, "ttl": ENROLLMENT_TTL_MINUTES}),
            ]
        )

        return {"status": "success", "enrollment_code": enrollment_code}

    except HTTPException:
        raise
    except Exception as e:
        raise_safe_error("تسجيل الجهاز", e)


@app.post("/api/regenerate-enrollment-code/{machine_name}")
def regenerate_enrollment_code(
    machine_name: str,
    current_user: auth.User = Depends(auth.require_roles("SuperAdmin", "CoE_Manager")),
):
    try:
        existing = run_query("SELECT MachineName FROM BotInfrastructure WHERE MachineName = :name", {"name": machine_name})
        if existing.empty:
            raise HTTPException(status_code=404, detail="الجهاز غير مسجل في النظام")

        enrollment_code = generate_enrollment_code()
        insert_code_query = """
            INSERT INTO AgentEnrollmentCodes (MachineName, EnrollmentCode, ExpiresAt)
            VALUES (:name, :code, DATEADD(minute, :ttl, GETDATE()))
        """

        execute_transaction(
            [
                ("DELETE FROM AgentEnrollmentCodes WHERE MachineName = :name", {"name": machine_name}),
                (insert_code_query, {"name": machine_name, "code": enrollment_code, "ttl": ENROLLMENT_TTL_MINUTES}),
            ]
        )

        expires_at_preview = datetime.now() + timedelta(minutes=ENROLLMENT_TTL_MINUTES)
        return {
            "status": "success",
            "enrollment_code": enrollment_code,
            "expires_at": expires_at_preview.isoformat(),
            "expires_in_minutes": ENROLLMENT_TTL_MINUTES,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise_safe_error("إعادة توليد كود الإقران", e)


@app.post("/api/update-machine")
def update_machine(
    machine: MachineUpdate,
    current_user: auth.User = Depends(auth.require_roles("SuperAdmin", "CoE_Manager")),
):
    try:
        execute_update(
            """
            UPDATE BotInfrastructure
            SET AssignedProcess = :bot,
                RunnerType  = :runner_type,
                TotalRAM_GB = :ram,
                TotalHDD_GB = :hdd
            WHERE MachineName = :name
            """,
            {
                "bot": machine.AssignedBot,
                "runner_type": machine.RunnerType,
                "ram": machine.TotalRAM_GB,
                "hdd": machine.TotalHDD_GB,
                "name": machine.MachineName,
            },
        )
        return {"status": "success", "message": "Runner Updated Successfully"}
    except Exception as e:
        raise_safe_error("تحديث بيانات الجهاز", e)


@app.get("/api/infrastructure")
def get_infrastructure_health(current_user: auth.User = Depends(auth.get_current_user)):
    try:
        df_infra = run_query(
            """
            SELECT MachineName,
                   AssignedProcess AS AssignedBot,
                   Status,
                   CPU_Usage,
                   RAM_Usage,
                   HDD_Usage,
                   LastPing,
                   TotalRAM_GB,
                   TotalHDD_GB,
                   RunnerType,
                   LastIP,
                   OSName,
                   AgentVersion
            FROM BotInfrastructure
            """
        )
        if df_infra.empty:
            return []

        df_infra["LastPing"] = pd.to_datetime(df_infra["LastPing"], errors="coerce")
        now = pd.Timestamp.now()

        stale_mask = df_infra["LastPing"].isna() | ((now - df_infra["LastPing"]).dt.total_seconds() > 180)
        df_infra.loc[stale_mask, "Status"] = "Offline"

        def determine_health(row):
            last_ping = row["LastPing"]
            if pd.isna(last_ping):
                return "Critical"
            time_diff = (now - last_ping).total_seconds()

            cpu = int(row.get("CPU_Usage", 0) or 0)
            ram = int(row.get("RAM_Usage", 0) or 0)
            hdd = int(row.get("HDD_Usage", 0) or 0)

            if time_diff > 180:
                return "Critical"
            if cpu >= 90 or ram >= 90 or hdd >= 90:
                return "Warning"
            if str(row.get("Status", "")) == "Idle":
                return "Idle"
            return "Healthy"

        df_infra["HealthStatus"] = df_infra.apply(determine_health, axis=1)
        df_infra["LastPing"] = df_infra["LastPing"].dt.strftime("%Y-%m-%d %H:%M:%S")
        return clean_json_data(df_infra.to_dict("records"))

    except Exception as e:
        raise_safe_error("تحميل حالة البنية التحتية", e)


# ============================================================
# Redis startup/shutdown (optional)
# ============================================================
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, machine_name: str):
        await websocket.accept()
        self.active_connections[machine_name] = websocket
        await run_in_threadpool(
            execute_update,
            "UPDATE BotInfrastructure SET Status = 'Online', LastPing = GETDATE() WHERE MachineName = :name",
            {"name": machine_name},
        )

    async def disconnect(self, machine_name: str):
        self.active_connections.pop(machine_name, None)
        await run_in_threadpool(
            execute_update,
            "UPDATE BotInfrastructure SET Status = 'Offline', LastPing = GETDATE() WHERE MachineName = :name",
            {"name": machine_name},
        )

    async def send_command(self, machine_name: str, command: str) -> bool:
        ws = self.active_connections.get(machine_name)
        if ws:
            await ws.send_text(command)
            return True
        return False


manager = ConnectionManager()


async def redis_command_listener(manager_ref: ConnectionManager):
    global redis_client
    while True:
        try:
            pubsub = redis_client.pubsub()
            await pubsub.subscribe("bot_commands_channel")
            logger.info("Redis subscriber listening...")

            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                try:
                    data = json.loads(message["data"])
                    target_machine = data.get("machine_name")
                    command = data.get("command")
                    if not target_machine or not command:
                        continue
                    await manager_ref.send_command(target_machine, command)
                except Exception as e:
                    logger.error(f"Redis msg error: {e}")

        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f"Redis listener error: {e}. Reconnecting in 5s...")
            await asyncio.sleep(5)


@app.on_event("startup")
async def startup_event():
    global redis_client
    try:
        redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)
        await redis_client.ping()
        asyncio.create_task(redis_command_listener(manager))
        logger.info("Redis connected.")
    except Exception:
        redis_client = None
        logger.info("Redis unavailable, standalone mode.")


@app.on_event("shutdown")
async def shutdown_event():
    global redis_client
    if redis_client:
        try:
            await redis_client.aclose()
        except Exception:
            pass


async def verify_agent_token(machine_name: str, token: str) -> bool:
    if not token:
        return False
    df = await run_in_threadpool(
        run_query,
        "SELECT AgentToken FROM BotInfrastructure WHERE MachineName = :name",
        {"name": machine_name},
    )
    if df.empty or pd.isna(df.iloc[0]["AgentToken"]):
        return False

    stored = str(df.iloc[0]["AgentToken"])
    if _looks_like_sha256_hex(stored):
        return secrets.compare_digest(stored, _token_hash(token))
    return secrets.compare_digest(stored, token)


@app.post("/api/agent/enroll")
@limiter.limit("5/hour")
def agent_enroll(payload: AgentEnrollRequest, request: Request):
    m_df = run_query("SELECT MachineName FROM BotInfrastructure WHERE MachineName = :m", {"m": payload.MachineName})
    if m_df.empty:
        raise HTTPException(status_code=404, detail="الجهاز غير مسجل")

    code_df = run_query(
        """
        SELECT TOP 1 CodeID
        FROM AgentEnrollmentCodes
        WHERE MachineName = :m
          AND EnrollmentCode = :c
          AND IsUsed = 0
          AND ExpiresAt >= GETDATE()
        ORDER BY CreatedAt DESC
        """,
        {"m": payload.MachineName, "c": payload.EnrollmentCode},
    )
    if code_df.empty:
        raise HTTPException(status_code=400, detail="كود غير صالح أو منتهي")

    code_id = int(code_df.iloc[0]["CodeID"])
    raw_token = secrets.token_urlsafe(48)
    stored_token = _token_hash(raw_token)

    try:
        execute_transaction(
            [
                ("UPDATE BotInfrastructure SET AgentToken = :t WHERE MachineName = :m", {"t": stored_token, "m": payload.MachineName}),
                ("UPDATE AgentEnrollmentCodes SET IsUsed = 1 WHERE CodeID = :id", {"id": code_id}),
                (
                    """
                    INSERT INTO AuditLogs (UserID, ActionType, ProcessName, OldValues, NewValues, IPAddress, IsSuccess)
                    VALUES (NULL, 'Agent_Enroll', :m, NULL, :newv, :ip, 1)
                    """,
                    {
                        "m": payload.MachineName,
                        "newv": json.dumps({"CodeID": code_id}, default=str),
                        "ip": (request.client.host if request.client else None),
                    },
                ),
            ]
        )
        return {"status": "success", "agent_token": raw_token}
    except Exception as e:
        raise_safe_error("تفعيل الجهاز", e)


@app.websocket("/ws/agent/{machine_name}")
async def websocket_endpoint(websocket: WebSocket, machine_name: str, token: Optional[str] = Query(None)):
    header_token = websocket.headers.get("x-agent-token")
    final_token = header_token or token

    is_valid = await verify_agent_token(machine_name, final_token or "")
    if not is_valid:
        await websocket.close(code=1008)
        return

    await manager.connect(websocket, machine_name)

    try:
        while True:
            raw = await websocket.receive_text()
            if not raw:
                continue
            try:
                data = json.loads(raw)
            except Exception:
                continue

            cpu = int(data.get("CPU_Usage", 0)) if isinstance(data.get("CPU_Usage"), (int, float)) else 0
            ram = int(data.get("RAM_Usage", 0)) if isinstance(data.get("RAM_Usage"), (int, float)) else 0
            hdd = int(data.get("HDD_Usage", 0)) if isinstance(data.get("HDD_Usage"), (int, float)) else 0

            machine_ip = data.get("MachineIP")
            os_name = data.get("OSName")
            agent_version = data.get("AgentVersion")

            machine_ip = machine_ip[:50] if isinstance(machine_ip, str) else None
            os_name = os_name[:50] if isinstance(os_name, str) else None
            agent_version = agent_version[:30] if isinstance(agent_version, str) else None

            await run_in_threadpool(
                execute_update,
                """
                UPDATE BotInfrastructure
                SET CPU_Usage    = :cpu,
                    RAM_Usage    = :ram,
                    HDD_Usage    = :hdd,
                    LastPing     = GETDATE(),
                    Status       = 'Online',
                    LastIP       = COALESCE(:ip, LastIP),
                    OSName       = COALESCE(:os, OSName),
                    AgentVersion = COALESCE(:ver, AgentVersion)
                WHERE MachineName = :name
                """,
                {"cpu": cpu, "ram": ram, "hdd": hdd, "name": machine_name, "ip": machine_ip, "os": os_name, "ver": agent_version},
            )

    except WebSocketDisconnect:
        await manager.disconnect(machine_name)


@app.post("/api/agent-heartbeat")
async def agent_heartbeat(
    heartbeat: AgentHeartbeat,
    x_agent_token: str = Header(..., alias="X-Agent-Token"),
):
    is_valid = await verify_agent_token(heartbeat.MachineName, x_agent_token)
    if not is_valid:
        raise HTTPException(status_code=401, detail="توكن الجهاز غير صحيح")

    await run_in_threadpool(
        execute_update,
        """
        UPDATE BotInfrastructure
        SET CPU_Usage = :cpu,
            RAM_Usage = :ram,
            HDD_Usage = :hdd,
            Status    = 'Online',
            LastPing  = GETDATE()
        WHERE MachineName = :name
        """,
        {"cpu": heartbeat.CPU_Usage, "ram": heartbeat.RAM_Usage, "hdd": heartbeat.HDD_Usage, "name": heartbeat.MachineName},
    )
    return {"status": "success"}