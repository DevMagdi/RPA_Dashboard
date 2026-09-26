from __future__ import annotations

import os
import logging
import secrets
import math
import json
import hashlib
from datetime import datetime, timedelta, date
from typing import Optional, Any

import pandas as pd
import numpy as np

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
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from db_connection import run_query, execute_update, execute_transaction
from routers import auth

# ============================================================
# Logging
# ============================================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.FileHandler("api.log"), logging.StreamHandler()],
)
logger = logging.getLogger("RPA_API")

app = FastAPI(title="RPA CoE Control Room API", version="2.1.1")

# GZip (مهم مع Responses كبيرة)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# ============================================================
# CORS
# ============================================================
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)

ENROLLMENT_TTL_MINUTES = int(os.environ.get("ENROLLMENT_TTL_MINUTES", "15"))

# (Enterprise) Pepper اختياري لتخزين AgentToken بشكل HASH بدل plaintext
AGENT_TOKEN_PEPPER = os.environ.get("AGENT_TOKEN_PEPPER", "")


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
            return 0
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
            return 0.0
        return v

    if isinstance(data, (np.bool_,)):
        return bool(data)

    return data


def raise_safe_error(action: str, exc: Exception):
    logger.error(f"{action} failed: {exc}", exc_info=True)
    raise HTTPException(status_code=500, detail=f"حدث خطأ أثناء {action}، برجاء المحاولة لاحقاً")


def _token_hash(token: str) -> str:
    """
    لو AGENT_TOKEN_PEPPER متظبط => نخزن SHA256(token+pepper)
    لو مش متظبط => هنخزن plaintext (غير مفضل enterprise)
    """
    if not AGENT_TOKEN_PEPPER:
        return token
    return hashlib.sha256((token + AGENT_TOKEN_PEPPER).encode("utf-8")).hexdigest()


def _looks_like_sha256_hex(s: str) -> bool:
    if not isinstance(s, str) or len(s) != 64:
        return False
    try:
        int(s, 16)
        return True
    except Exception:
        return False


@app.get("/health")
def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


# ============================================================
# ROI Configuration
# ============================================================
class ROIConfigUpdate(BaseModel):
    ProcessName: str = Field(..., min_length=1, max_length=100)
    EmpMinutesPerRequest: float = Field(..., ge=0)
    EmpCostPerRequest: float = Field(..., ge=0)
    BotCostPerRequest: float = Field(..., ge=0)
    ExpectedRunsPerDay: int = Field(..., ge=0)


@app.post("/api/update-roi")
def update_roi(
    config: ROIConfigUpdate,
    request: Request,
    current_user: auth.User = Depends(auth.require_roles("SuperAdmin", "CoE_Manager")),
):
    old_values_df = run_query(
        """
        SELECT EmpMinutesPerRequest, EmpCostPerRequest, BotCostPerRequest, ExpectedRunsPerDay
        FROM ProcessConfig
        WHERE ProcessName = :name
        """,
        {"name": config.ProcessName},
    )
    if old_values_df.empty:
        raise HTTPException(status_code=404, detail="العملية غير موجودة")

    old_vals = old_values_df.iloc[0].to_dict()
    old_vals_json = json.dumps(old_vals, default=str)
    new_vals_json = json.dumps(config.dict(), default=str)

    update_query = """
        UPDATE ProcessConfig
        SET EmpMinutesPerRequest = :emp_minutes,
            EmpCostPerRequest = :emp_cost,
            BotCostPerRequest = :bot_cost,
            ExpectedRunsPerDay = :expected_runs
        WHERE ProcessName = :name
    """
    update_params = {
        "emp_minutes": config.EmpMinutesPerRequest,
        "emp_cost": config.EmpCostPerRequest,
        "bot_cost": config.BotCostPerRequest,
        "expected_runs": config.ExpectedRunsPerDay,
        "name": config.ProcessName,
    }

    audit_query = """
        INSERT INTO AuditLogs (UserID, ActionType, ProcessName, OldValues, NewValues, IPAddress, IsSuccess)
        VALUES (:user_id, 'Update_ROI', :name, :old_vals, :new_vals, :ip, 1)
    """
    audit_params = {
        "user_id": current_user.UserID,
        "name": config.ProcessName,
        "old_vals": old_vals_json,
        "new_vals": new_vals_json,
        "ip": (request.client.host if request.client else None),
    }

    try:
        execute_transaction([(update_query, update_params), (audit_query, audit_params)])
        return {"status": "success", "message": "ROI configuration updated successfully"}
    except Exception as e:
        raise_safe_error("تحديث بيانات الـ ROI", e)


# ============================================================
# ✅ Processes (Keyset Pagination + Prefix Search)
# ============================================================
@app.get("/api/processes")
def list_processes(
    search: Optional[str] = Query(None, description="Prefix search (مثال: Inv)"),
    department: Optional[str] = Query(None),
    after: Optional[str] = Query(None, description="Cursor: آخر ProcessName رجع لك"),
    page_size: int = Query(100, ge=1, le=1000),
    include_total: bool = Query(False, description="خليها False في الإنتاج لتقليل الضغط"),
    current_user: auth.User = Depends(auth.get_current_user),
):
    where = ["1=1"]
    params: dict[str, Any] = {"ps": page_size}

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
        count_params = {k: v for k, v in params.items() if k != "ps"}
        count_df = run_query(f"SELECT COUNT(1) AS total FROM ProcessConfig WHERE {where_sql}", count_params)
        total = int(count_df.iloc[0]["total"]) if not count_df.empty else 0

    data_df = run_query(
        f"""
        SELECT TOP (:ps)
            ProcessName, Department, BotName, ExpectedRunsPerDay, SLATargetMinutes, Criticality, IsActive
        FROM ProcessConfig
        WHERE {where_sql}
        ORDER BY ProcessName
        """,
        params,
    )

    items = clean_json_data(data_df.to_dict("records")) if not data_df.empty else []
    next_cursor = items[-1]["ProcessName"] if items else None

    return {"page_size": page_size, "total": total, "next_cursor": next_cursor, "items": items}


# ============================================================
# ✅ Dashboard Data (Enterprise/Scalable - SQL Aggregations)
# ============================================================
@app.get("/api/dashboard-data")
def get_dashboard_data(
    process: Optional[str] = Query(None, description="ProcessName أو None"),
    days: int = Query(90, ge=1, le=730),
    include_process_list: bool = Query(False),
    process_list_limit: int = Query(200, ge=1, le=2000),
    current_user: auth.User = Depends(auth.get_current_user),
):
    cfg_filters = []
    runs_filters = ["r.StartTime >= DATEADD(day, -:days, GETDATE())"]
    params: dict[str, Any] = {"days": days}

    if current_user.AllowedDepartment != "ALL":
        cfg_filters.append("Department = :dept")
        runs_filters.append("c.Department = :dept")
        params["dept"] = current_user.AllowedDepartment

    if process and process != "All":
        p_df = run_query(
            f"SELECT 1 AS X FROM ProcessConfig WHERE ProcessName = :p {'AND Department = :dept' if current_user.AllowedDepartment != 'ALL' else ''}",
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

    recent_df = run_query(
        f"""
        SELECT TOP 8 r.RunID, r.ProcessName, r.RequestID, r.Status, r.StartTime, r.EndTime,
               r.DurationMinutes, r.FailureReason, r.TransactionsCount
        FROM ProcessRuns r
        JOIN ProcessConfig c ON r.ProcessName = c.ProcessName
        WHERE {runs_where}
        ORDER BY r.StartTime DESC
        """,
        params,
    )
    table = recent_df.to_dict("records") if not recent_df.empty else []

    process_list: list[str] = []
    if include_process_list:
        pl_df = run_query(
            f"""
            SELECT TOP (:lim) ProcessName
            FROM ProcessConfig
            {cfg_where}
            ORDER BY ProcessName
            """,
            {**params, "lim": process_list_limit},
        )
        process_list = pl_df["ProcessName"].astype(str).tolist() if not pl_df.empty else []

    response_data = {
        "processList": process_list,
        "processListTruncated": bool(include_process_list and total_procedures > len(process_list)),
        "processListTotal": total_procedures,
        "configList": [],
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
            "failureDetails": failure_details,
        },
        "sidebarStats": {"bookedRuns": booked_runs, "successRate": success_rate, "errorRate": error_rate},
        "analytics": {"statusDistribution": status_distribution},
        "charts": {"volume": volume_data, "savings": savings_data},
        "table": table,
    }

    return clean_json_data(response_data)


# ============================================================
# Audit Logs
# ============================================================
@app.get("/api/audit-logs")
def get_audit_logs(
    limit: int = Query(500, ge=1, le=5000),
    current_user: auth.User = Depends(auth.require_roles("SuperAdmin", "CoE_Manager")),
):
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


# ============================================================
# SLA & Workload Management
# ============================================================
class SLAConfigUpdate(BaseModel):
    ProcessName: str = Field(..., min_length=1, max_length=100)
    SLATargetMinutes: int = Field(..., gt=0)
    AvgItemProcessingSeconds: int = Field(..., gt=0)


@app.post("/api/update-sla")
def update_sla(
    config: SLAConfigUpdate,
    request: Request,
    current_user: auth.User = Depends(auth.require_roles("SuperAdmin", "CoE_Manager")),
):
    old_config_df = run_query(
        "SELECT SLATargetMinutes FROM ProcessConfig WHERE ProcessName = :name",
        {"name": config.ProcessName},
    )
    old_queue_df = run_query(
        "SELECT AvgItemProcessingSeconds FROM ProcessQueues WHERE ProcessName = :name",
        {"name": config.ProcessName},
    )
    if old_config_df.empty:
        raise HTTPException(status_code=404, detail="العملية غير موجودة في الإعدادات")

    old_vals: dict[str, Any] = {}
    sla_val = old_config_df.iloc[0]["SLATargetMinutes"]
    old_vals["SLATargetMinutes"] = int(sla_val) if pd.notnull(sla_val) else 0

    if not old_queue_df.empty:
        avg_val = old_queue_df.iloc[0]["AvgItemProcessingSeconds"]
        old_vals["AvgItemProcessingSeconds"] = int(avg_val) if pd.notnull(avg_val) else 0
    else:
        old_vals["AvgItemProcessingSeconds"] = 0

    old_vals_json = json.dumps(old_vals, default=str)
    new_vals_json = json.dumps(config.dict(), default=str)

    update_config_query = "UPDATE ProcessConfig SET SLATargetMinutes = :sla WHERE ProcessName = :name"
    update_queue_query = "UPDATE ProcessQueues SET AvgItemProcessingSeconds = :avg_sec WHERE ProcessName = :name"
    audit_query = """
        INSERT INTO AuditLogs (UserID, ActionType, ProcessName, OldValues, NewValues, IPAddress, IsSuccess)
        VALUES (:user_id, 'Update_SLA', :name, :old_vals, :new_vals, :ip, 1)
    """

    try:
        execute_transaction(
            [
                (update_config_query, {"sla": config.SLATargetMinutes, "name": config.ProcessName}),
                (update_queue_query, {"avg_sec": config.AvgItemProcessingSeconds, "name": config.ProcessName}),
                (
                    audit_query,
                    {
                        "user_id": current_user.UserID,
                        "name": config.ProcessName,
                        "old_vals": old_vals_json,
                        "new_vals": new_vals_json,
                        "ip": (request.client.host if request.client else None),
                    },
                ),
            ]
        )
        return {"status": "success", "message": "SLA configuration updated successfully"}
    except Exception as e:
        raise_safe_error("تحديث إعدادات الـ SLA", e)


@app.get("/api/sla-workload")
def get_sla_workload(current_user: auth.User = Depends(auth.get_current_user)):
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


# ============================================================
# WebSocket Manager + Agent Authentication
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

    if AGENT_TOKEN_PEPPER and _looks_like_sha256_hex(stored):
        return secrets.compare_digest(stored, _token_hash(token))

    return secrets.compare_digest(stored, token)


# ============================================================
# Agent Enrollment Endpoint
# ============================================================
class AgentEnrollRequest(BaseModel):
    MachineName: str = Field(..., min_length=1, max_length=100)
    EnrollmentCode: str = Field(..., min_length=4, max_length=20)


@app.post("/api/agent/enroll")
def agent_enroll(payload: AgentEnrollRequest, request: Request):
    m_df = run_query("SELECT MachineName FROM BotInfrastructure WHERE MachineName = :m", {"m": payload.MachineName})
    if m_df.empty:
        raise HTTPException(status_code=404, detail="الجهاز غير مسجل في النظام")

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
        raise HTTPException(status_code=400, detail="كود الإقران غير صالح أو منتهي أو تم استخدامه")

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
async def websocket_endpoint(websocket: WebSocket, machine_name: str, token: str = Query(...)):
    is_valid = await verify_agent_token(machine_name, token)
    if not is_valid:
        logger.warning(f"Rejected WebSocket connection - invalid token for machine: {machine_name}")
        await websocket.close(code=1008)
        return

    await manager.connect(websocket, machine_name)
    logger.info(f"Agent connected: {machine_name}")
    try:
        while True:
            try:
                raw = await websocket.receive_text()
            except WebSocketDisconnect:
                raise
            except Exception as e:
                logger.warning(f"Receive error from {machine_name}: {e}")
                continue

            if not raw:
                logger.warning(f"Empty message received from {machine_name}")
                continue

            try:
                data = json.loads(raw)
                if not isinstance(data, dict):
                    logger.warning(f"Non-object JSON from {machine_name}: {type(data)} | raw={raw[:200]}")
                    continue
            except json.JSONDecodeError as e:
                logger.warning(f"Malformed JSON from {machine_name}: {e} | raw={raw[:200]}")
                continue

            cpu = int(data.get("CPU_Usage", 0)) if isinstance(data.get("CPU_Usage"), (int, float)) else 0
            ram = int(data.get("RAM_Usage", 0)) if isinstance(data.get("RAM_Usage"), (int, float)) else 0
            hdd = int(data.get("HDD_Usage", 0)) if isinstance(data.get("HDD_Usage"), (int, float)) else 0

            await run_in_threadpool(
                execute_update,
                """
                UPDATE BotInfrastructure
                SET CPU_Usage = :cpu,
                    RAM_Usage = :ram,
                    HDD_Usage = :hdd,
                    LastPing  = GETDATE(),
                    Status    = 'Online'
                WHERE MachineName = :name
                """,
                {"cpu": cpu, "ram": ram, "hdd": hdd, "name": machine_name},
            )
    except WebSocketDisconnect:
        await manager.disconnect(machine_name)
        logger.info(f"Agent disconnected: {machine_name}")


@app.post("/api/trigger-bot/{machine_name}")
async def trigger_bot(
    machine_name: str,
    bot_name: str,
    current_user: auth.User = Depends(auth.require_roles("SuperAdmin", "CoE_Manager")),
):
    machine_df = await run_in_threadpool(
        run_query, "SELECT MachineName FROM BotInfrastructure WHERE MachineName = :name", {"name": machine_name}
    )
    if machine_df.empty:
        raise HTTPException(status_code=404, detail="الجهاز غير مسجل في النظام")

    bot_df = await run_in_threadpool(
        run_query, "SELECT BotName FROM ProcessConfig WHERE BotName = :bot", {"bot": bot_name}
    )
    if bot_df.empty:
        raise HTTPException(status_code=400, detail="اسم البوت غير معروف أو غير مصرح به")

    command = f"RUN_BOT:{bot_name}"
    success = await manager.send_command(machine_name, command)

    if success:
        logger.info(f"Command sent by {current_user.Username} to {machine_name}: {command}")
        return {"status": "success", "message": f"Command '{command}' sent to {machine_name} instantly."}

    return {"status": "error", "message": f"Machine {machine_name} is currently offline."}


# ============================================================
# Infrastructure & Enrollment
# ============================================================
def generate_enrollment_code(length: int = 8) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    code = "".join(secrets.choice(alphabet) for _ in range(length))
    return f"{code[:4]}-{code[4:]}"


class MachineRegistration(BaseModel):
    MachineName: str = Field(..., min_length=1, max_length=100)
    AssignedBot: str = Field(..., min_length=1, max_length=100)
    RunnerType: str = Field(..., min_length=1, max_length=50)
    TotalRAM_GB: int = Field(..., gt=0)
    TotalHDD_GB: int = Field(..., gt=0)


@app.post("/api/register-machine")
def register_machine(
    machine: MachineRegistration,
    current_user: auth.User = Depends(auth.require_roles("SuperAdmin", "CoE_Manager")),
):
    existing = run_query("SELECT MachineName FROM BotInfrastructure WHERE MachineName = :name", {"name": machine.MachineName})
    if not existing.empty:
        raise HTTPException(status_code=400, detail="هذا الجهاز مسجل بالفعل")

    bot_exists = run_query("SELECT 1 AS X FROM ProcessConfig WHERE BotName = :b", {"b": machine.AssignedBot})
    if bot_exists.empty:
        raise HTTPException(status_code=400, detail="AssignedBot غير موجود في ProcessConfig")

    insert_query = """
        INSERT INTO BotInfrastructure
            (MachineName, AssignedBot, Status, CPU_Usage, RAM_Usage, HDD_Usage, LastPing,
             TotalRAM_GB, TotalHDD_GB, RunnerType, AgentToken)
        VALUES
            (:name, :bot, 'Pending', 0, 0, 0, GETDATE(), :ram, :hdd, :runner_type, NULL)
    """

    enrollment_code = generate_enrollment_code()

    # ✅ مهم: خلي SQL Server هو اللي يحسب ExpiresAt بـ GETDATE() لتفادي مشاكل الـ timezone
    enrollment_query = """
        INSERT INTO AgentEnrollmentCodes (MachineName, EnrollmentCode, ExpiresAt)
        VALUES (:name, :code, DATEADD(minute, :ttl, GETDATE()))
    """

    try:
        execute_transaction(
            [
                (
                    insert_query,
                    {
                        "name": machine.MachineName,
                        "bot": machine.AssignedBot,
                        "ram": machine.TotalRAM_GB,
                        "hdd": machine.TotalHDD_GB,
                        "runner_type": machine.RunnerType,
                    },
                ),
                ("DELETE FROM AgentEnrollmentCodes WHERE MachineName = :name", {"name": machine.MachineName}),
                (enrollment_query, {"name": machine.MachineName, "code": enrollment_code, "ttl": ENROLLMENT_TTL_MINUTES}),
            ]
        )

        expires_at_preview = datetime.now() + timedelta(minutes=ENROLLMENT_TTL_MINUTES)
        return {
            "status": "success",
            "message": "Runner Registered Successfully",
            "enrollment_code": enrollment_code,
            "expires_at": expires_at_preview.isoformat(),
            "expires_in_minutes": ENROLLMENT_TTL_MINUTES,
        }
    except Exception as e:
        raise_safe_error("تسجيل الجهاز", e)


@app.post("/api/regenerate-enrollment-code/{machine_name}")
def regenerate_enrollment_code(
    machine_name: str,
    current_user: auth.User = Depends(auth.require_roles("SuperAdmin", "CoE_Manager")),
):
    existing = run_query("SELECT MachineName FROM BotInfrastructure WHERE MachineName = :name", {"name": machine_name})
    if existing.empty:
        raise HTTPException(status_code=404, detail="الجهاز غير مسجل في النظام")

    enrollment_code = generate_enrollment_code()

    insert_code_query = """
        INSERT INTO AgentEnrollmentCodes (MachineName, EnrollmentCode, ExpiresAt)
        VALUES (:name, :code, DATEADD(minute, :ttl, GETDATE()))
    """

    try:
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
    except Exception as e:
        raise_safe_error("إعادة توليد كود الإقران", e)


# ============================================================
# Agent Heartbeat (HTTP) - Optional
# ============================================================
class AgentHeartbeat(BaseModel):
    MachineName: str = Field(..., min_length=1, max_length=100)
    CPU_Usage: int = Field(..., ge=0, le=100)
    RAM_Usage: int = Field(..., ge=0, le=100)
    HDD_Usage: int = Field(..., ge=0, le=100)


@app.post("/api/agent-heartbeat")
async def agent_heartbeat(
    heartbeat: AgentHeartbeat,
    x_agent_token: str = Header(..., alias="X-Agent-Token"),
):
    is_valid = await verify_agent_token(heartbeat.MachineName, x_agent_token)
    if not is_valid:
        raise HTTPException(status_code=401, detail="توكن الجهاز غير صحيح")

    query = """
        UPDATE BotInfrastructure
        SET CPU_Usage = :cpu, RAM_Usage = :ram, HDD_Usage = :hdd, Status = 'Online', LastPing = GETDATE()
        WHERE MachineName = :name
    """
    await run_in_threadpool(
        execute_update,
        query,
        {"cpu": heartbeat.CPU_Usage, "ram": heartbeat.RAM_Usage, "hdd": heartbeat.HDD_Usage, "name": heartbeat.MachineName},
    )
    return {"status": "success"}


@app.get("/api/infrastructure")
def get_infrastructure_health(current_user: auth.User = Depends(auth.get_current_user)):
    df_infra = run_query(
        """
        SELECT MachineName, AssignedBot, Status, CPU_Usage, RAM_Usage, HDD_Usage,
               LastPing, TotalRAM_GB, TotalHDD_GB, RunnerType
        FROM BotInfrastructure
        """
    )
    if df_infra.empty:
        return []

    df_infra["LastPing"] = pd.to_datetime(df_infra["LastPing"], errors="coerce")

    def determine_health(row):
        last_ping = row["LastPing"]
        if pd.isna(last_ping):
            return "Critical"
        time_diff = (pd.Timestamp.now() - last_ping).total_seconds()

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

    # Update offline in one shot
    execute_update("UPDATE BotInfrastructure SET Status = 'Offline' WHERE LastPing < DATEADD(second, -180, GETDATE())", {})

    df_infra["LastPing"] = df_infra["LastPing"].dt.strftime("%Y-%m-%d %H:%M:%S")
    return clean_json_data(df_infra.to_dict("records"))