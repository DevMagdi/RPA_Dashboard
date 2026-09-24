from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
import numpy as np  # أضفنا numpy لمعالجة القيم غير الصالحة
from datetime import date
from typing import Optional
from db_connection import run_query, execute_update

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ROIConfigUpdate(BaseModel):
    ProcessName: str
    EmpMinutesPerRequest: float
    EmpCostPerRequest: float
    BotCostPerRequest: float
    ExpectedRunsPerDay: int


@app.post("/api/update-roi")
def update_roi(config: ROIConfigUpdate):
    query = f"""
    UPDATE ProcessConfig 
    SET EmpMinutesPerRequest = {config.EmpMinutesPerRequest},
        EmpCostPerRequest = {config.EmpCostPerRequest},
        BotCostPerRequest = {config.BotCostPerRequest},
        ExpectedRunsPerDay = {config.ExpectedRunsPerDay}
    WHERE ProcessName = '{config.ProcessName}';
    """
    try:
        execute_update(query)
        return {"status": "success", "message": "ROI configuration updated successfully"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.get("/api/dashboard-data")
def get_dashboard_data(process: Optional[str] = Query(None)):
    runs_query = "SELECT * FROM ProcessRuns ORDER BY StartTime DESC"
    df_runs = run_query(runs_query)

    config_query = "SELECT ProcessName, ExpectedRunsPerDay, HourlyRate, Department, BotName, EmpMinutesPerRequest, EmpCostPerRequest, BotCostPerRequest FROM ProcessConfig WHERE IsActive = 1"
    df_config = run_query(config_query)

    if df_runs.empty:
        return {"error": "لا توجد بيانات"}

    # تنظيف إعدادات الأدمن من أي قيم NULL أو NaN
    if not df_config.empty:
        df_config = df_config.fillna(0).replace([np.inf, -np.inf], 0)

    all_processes = df_config['ProcessName'].tolist() if not df_config.empty else df_runs[
        'ProcessName'].unique().tolist()

    config_list = df_config.to_dict('records') if not df_config.empty else []

    if process and process != "All":
        df_runs = df_runs[df_runs['ProcessName'] == process]

    # التأكد من أن عمود TransactionsCount رقمي ولا يحتوي على فراغات
    if 'TransactionsCount' in df_runs.columns:
        df_runs['TransactionsCount'] = pd.to_numeric(df_runs['TransactionsCount'], errors='coerce').fillna(0)

    if not df_config.empty:
        df_runs = pd.merge(df_runs, df_config, on='ProcessName', how='left')

        # العمليات الحسابية
        df_runs['DynamicTimeSaved'] = (df_runs['TransactionsCount'] * df_runs['EmpMinutesPerRequest']) / 60.0
        manual_cost = df_runs['TransactionsCount'] * df_runs['EmpCostPerRequest']
        bot_cost = df_runs['TransactionsCount'] * df_runs['BotCostPerRequest']
        df_runs['DynamicCostSaved'] = manual_cost - bot_cost
    else:
        df_runs['DynamicTimeSaved'] = df_runs['TimeSavedHours'] if 'TimeSavedHours' in df_runs.columns else 0
        df_runs['DynamicCostSaved'] = df_runs['CostSaved'] if 'CostSaved' in df_runs.columns else 0

    # تنظيف نهائي لجدول العمليات من أي NaN أو Infinity نتجت عن الحسابات
    df_runs = df_runs.fillna(0).replace([np.inf, -np.inf], 0)

    df_runs['StartTime'] = pd.to_datetime(df_runs['StartTime'])
    df_runs['RunDate'] = df_runs['StartTime'].dt.date
    latest_date = df_runs['RunDate'].max()
    df_today = df_runs[df_runs['RunDate'] == latest_date]

    target_runs = int(df_config['ExpectedRunsPerDay'].sum()) if not df_config.empty else 100

    running_now = df_today[df_today['Status'] == 'Running']
    active_req = running_now.iloc[0]['RequestID'] if not running_now.empty else "-"
    active_proc = running_now.iloc[0]['ProcessName'] if not running_now.empty else "Idle"
    current_status = "Running" if not running_now.empty else "Standby"

    total_procedures = len(df_config) if not df_config.empty else len(df_runs['ProcessName'].unique())
    total_transactions = int(df_runs['TransactionsCount'].sum())
    success_rate = int((len(df_runs[df_runs['Status'] == 'Completed']) / len(df_runs)) * 100) if len(df_runs) > 0 else 0
    error_rate = 100 - success_rate

    dept_savings = []
    bot_utilization = []
    if not df_config.empty and 'Department' in df_runs.columns:
        dept_df = df_runs.groupby('Department')['DynamicTimeSaved'].sum().reset_index()
        dept_df.rename(columns={'DynamicTimeSaved': 'TimeSavedHours'}, inplace=True)
        dept_savings = dept_df.to_dict('records')

        bot_df = df_runs.groupby(['BotName', 'ExpectedRunsPerDay']).size().reset_index(name='ActualRuns')
        # معالجة القسمة على صفر في حساب الاستغلال
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

    # التأكد من تحويل القيم النهائية للصيغ القياسية لمنع أي خطأ JSON متبقي
    return {
        "processList": all_processes,
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