from fastapi import FastAPI, Query, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
import numpy as np
from datetime import date
from typing import Optional
import math

from db_connection import run_query, execute_update
from routers import auth  # استدعاء راوتر المصادقة

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# تضمين مسارات المصادقة
app.include_router(auth.router)


# دالة تنظيف تمنع نهائياً أي خطأ NaN أو Infinity في الـ JSON
def clean_json_data(data):
    if isinstance(data, dict):
        return {k: clean_json_data(v) for k, v in data.items()}
    elif isinstance(data, list):
        return [clean_json_data(v) for v in data]
    elif isinstance(data, float):
        if math.isnan(data) or math.isinf(data):
            return 0.0
        return data
    return data


class ROIConfigUpdate(BaseModel):
    ProcessName: str
    EmpMinutesPerRequest: float
    EmpCostPerRequest: float
    BotCostPerRequest: float
    ExpectedRunsPerDay: int


@app.post("/api/update-roi")
def update_roi(config: ROIConfigUpdate, current_user: auth.User = Depends(auth.get_current_user)):
    # حماية: منع الموظف العادي من التعديل
    if current_user.Role not in ["SuperAdmin", "CoE_Manager"]:
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية لتعديل الـ ROI")

    # جلب القيم القديمة لغرض التدقيق
    old_values_df = run_query(
        f"SELECT EmpMinutesPerRequest, EmpCostPerRequest, BotCostPerRequest FROM ProcessConfig WHERE ProcessName = '{config.ProcessName}'")
    old_vals = old_values_df.iloc[0].to_dict() if not old_values_df.empty else "None"

    update_query = f"""
    UPDATE ProcessConfig 
    SET EmpMinutesPerRequest = {config.EmpMinutesPerRequest},
        EmpCostPerRequest = {config.EmpCostPerRequest},
        BotCostPerRequest = {config.BotCostPerRequest},
        ExpectedRunsPerDay = {config.ExpectedRunsPerDay}
    WHERE ProcessName = '{config.ProcessName}';
    """

    audit_query = f"""
    INSERT INTO AuditLogs (UserID, ActionType, ProcessName, OldValues, NewValues)
    VALUES ({current_user.UserID}, 'Update_ROI', '{config.ProcessName}', '{str(old_vals)}', '{str(config.dict())}');
    """

    try:
        execute_update(update_query)
        execute_update(audit_query)  # تسجيل التعديل واسم المستخدم
        return {"status": "success", "message": "ROI configuration updated successfully"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.get("/api/dashboard-data")
def get_dashboard_data(process: Optional[str] = Query(None), current_user: auth.User = Depends(auth.get_current_user)):
    # فلترة العمليات بناءً على القسم (Department) الموجود في الداتابيز مباشرة
    dept_filter = ""
    if current_user.AllowedDepartment != 'ALL':
        dept_filter = f" WHERE Department = '{current_user.AllowedDepartment}'"

    # جلب الإعدادات للقسم الخاص بالمستخدم فقط
    config_query = f"SELECT ProcessName, ExpectedRunsPerDay, Department, BotName, EmpMinutesPerRequest, EmpCostPerRequest, BotCostPerRequest FROM ProcessConfig {dept_filter}"
    df_config = run_query(config_query)

    if df_config.empty:
        return {"error": "لا توجد عمليات متاحة لهذا القسم"}

    allowed_processes = df_config['ProcessName'].tolist()

    # فلترة حركات التشغيل (Runs) لتشمل عمليات هذا القسم فقط
    if current_user.AllowedDepartment == 'ALL':
        runs_filter = ""
    else:
        if len(allowed_processes) == 1:
            runs_filter = f"WHERE ProcessName = '{allowed_processes[0]}'"
        else:
            runs_filter = f"WHERE ProcessName IN {tuple(allowed_processes)}"

    runs_query = f"SELECT * FROM ProcessRuns {runs_filter} ORDER BY StartTime DESC"
    df_runs = run_query(runs_query)

    if df_runs.empty:
        return {"error": "لا توجد بيانات تشغيل مسجلة لعملياتك"}

    # -- بقية الكود كما هو تماماً لعمل الحسابات --
    config_list = df_config.to_dict('records')

    if process and process != "All" and process in allowed_processes:
        df_runs = df_runs[df_runs['ProcessName'] == process]

    if 'TransactionsCount' in df_runs.columns:
        df_runs['TransactionsCount'] = pd.to_numeric(df_runs['TransactionsCount'], errors='coerce').fillna(0)

    df_runs = pd.merge(df_runs, df_config, on='ProcessName', how='left')
    df_runs['DynamicTimeSaved'] = (df_runs['TransactionsCount'] * df_runs['EmpMinutesPerRequest']) / 60.0
    df_runs['DynamicCostSaved'] = (df_runs['TransactionsCount'] * df_runs['EmpCostPerRequest']) - (
                df_runs['TransactionsCount'] * df_runs['BotCostPerRequest'])

    df_runs = df_runs.fillna(0).replace([np.inf, -np.inf], 0)
    df_runs['StartTime'] = pd.to_datetime(df_runs['StartTime'])
    df_runs['RunDate'] = df_runs['StartTime'].dt.date
    latest_date = df_runs['RunDate'].max()
    df_today = df_runs[df_runs['RunDate'] == latest_date]

    target_runs = int(df_config['ExpectedRunsPerDay'].sum())
    running_now = df_today[df_today['Status'] == 'Running']
    active_req = running_now.iloc[0]['RequestID'] if not running_now.empty else "-"
    active_proc = running_now.iloc[0]['ProcessName'] if not running_now.empty else "Idle"
    current_status = "Running" if not running_now.empty else "Standby"

    total_procedures = len(df_config)
    total_transactions = int(df_runs['TransactionsCount'].sum())
    success_rate = int((len(df_runs[df_runs['Status'] == 'Completed']) / len(df_runs)) * 100) if len(df_runs) > 0 else 0
    error_rate = 100 - success_rate

    dept_savings = []
    bot_utilization = []
    if 'Department' in df_runs.columns:
        dept_df = df_runs.groupby('Department')['DynamicTimeSaved'].sum().reset_index()
        dept_df.rename(columns={'DynamicTimeSaved': 'TimeSavedHours'}, inplace=True)
        dept_savings = dept_df.to_dict('records')

        bot_df = df_runs.groupby(['BotName', 'ExpectedRunsPerDay']).size().reset_index(name='ActualRuns')
        bot_df['ExpectedRunsPerDay'] = bot_df['ExpectedRunsPerDay'].replace(0, 1)
        bot_df['Utilization'] = ((bot_df['ActualRuns'] / bot_df['ExpectedRunsPerDay']) * 100).fillna(0).round(1)
        bot_df['Color'] = bot_df['Utilization'].apply(lambda x: '#EF4444' if x > 70 else '#10B981')
        bot_utilization = bot_df[['BotName', 'Utilization', 'Color']].to_dict('records')

    status_counts = df_runs['Status'].value_counts().reset_index()
    status_counts.columns = ['name', 'value']
    status_distribution = status_counts.to_dict('records')

    failed_today_df = df_today[df_today['Status'].isin(['Failed', 'Stopped'])]
    failure_details = failed_today_df[['ProcessName', 'RequestID', 'FailureReason', 'Status']].fillna(
        "Unknown Error").to_dict('records')

    vol_df = df_runs.groupby('RunDate').size().reset_index(name='volume')
    vol_df['date'] = pd.to_datetime(vol_df['RunDate']).dt.strftime('%d %b')
    volume_data = vol_df[['date', 'volume']].tail(14).to_dict('records')

    sav_df = df_runs.groupby('RunDate').agg({'DynamicCostSaved': 'sum'}).reset_index()
    sav_df['date'] = pd.to_datetime(sav_df['RunDate']).dt.strftime('%d %b')
    sav_df['bar'] = (sav_df['DynamicCostSaved']).round(2)
    sav_df['line'] = sav_df['bar'] + (sav_df['bar'] * 0.1)
    savings_data = sav_df[['date', 'bar', 'line']].tail(14).to_dict('records')

    df_runs['CostSavedForTable'] = df_runs['DynamicCostSaved'].round(2)
    recent_runs = df_runs.head(8).fillna("-").to_dict('records')
    for run in recent_runs:
        run['CostSaved'] = run['CostSavedForTable']

    response_data = {
        "processList": allowed_processes,  # يرسل العمليات المسموحة فقط للفرونت إند
        "configList": config_list,
        "kpis": {
            "totalProcedures": total_procedures,
            "totalTransactions": total_transactions,
            "runsToday": len(df_today),
            "targetRuns": target_runs,
            "stopsToday": len(failure_details),
            "timeSaved": float(np.nan_to_num(round(float(df_runs['DynamicTimeSaved'].sum()), 1))),
            "costSaved": int(np.nan_to_num(df_runs['DynamicCostSaved'].sum())),
            "activeRequest": active_req,
            "activeProcess": active_proc,
            "status": current_status,
            "failureDetails": failure_details
        },
        "sidebarStats": {
            "bookedRuns": len(df_runs),
            "successRate": success_rate,
            "errorRate": error_rate,
        },
        "analytics": {
            "departmentSavings": dept_savings,
            "botUtilization": bot_utilization,
            "statusDistribution": status_distribution
        },
        "charts": {
            "volume": volume_data,
            "savings": savings_data
        },
        "table": recent_runs
    }

    return clean_json_data(response_data)