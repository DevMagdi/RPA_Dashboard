from fastapi import FastAPI, Query, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
import numpy as np
from datetime import date
from typing import Optional
import math
import json
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

    old_vals = old_values_df.iloc[0].to_dict() if not old_values_df.empty else {}

    # تحويل البيانات إلى JSON آمن للـ SQL
    old_vals_json = json.dumps(old_vals)
    new_vals_json = json.dumps(config.dict())

    update_query = f"""
    UPDATE ProcessConfig 
    SET EmpMinutesPerRequest = {config.EmpMinutesPerRequest},
        EmpCostPerRequest = {config.EmpCostPerRequest},
        BotCostPerRequest = {config.BotCostPerRequest},
        ExpectedRunsPerDay = {config.ExpectedRunsPerDay}
    WHERE ProcessName = '{config.ProcessName}';
    """

    # استخدام القيم الآمنة (JSON)
    audit_query = f"""
    INSERT INTO AuditLogs (UserID, ActionType, ProcessName, OldValues, NewValues)
    VALUES ({current_user.UserID}, 'Update_ROI', '{config.ProcessName}', '{old_vals_json}', '{new_vals_json}');
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


@app.get("/api/audit-logs")
def get_audit_logs(current_user: auth.User = Depends(auth.get_current_user)):
    # السماح للسوبر أدمن أو مديري الأقسام (CoE_Manager) برؤية السجلات
    if current_user.Role not in ["SuperAdmin", "CoE_Manager"]:
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية لعرض سجلات التدقيق")

    # بناء شرط الفلترة بناءً على قسم المستخدم
    dept_filter = ""
    if current_user.AllowedDepartment != 'ALL':
        dept_filter = f" WHERE p.Department = '{current_user.AllowedDepartment}'"

    # دمج جدول السجلات مع جدول الإعدادات لمعرفة قسم كل عملية وفلترتها
    query = f"""
        SELECT a.LogID, ISNULL(u.Username, 'System') AS Username, a.ActionType, 
               a.ProcessName, a.OldValues, a.NewValues, a.ActionDate 
        FROM AuditLogs a
        LEFT JOIN SystemUsers u ON a.UserID = u.UserID
        INNER JOIN ProcessConfig p ON a.ProcessName = p.ProcessName
        {dept_filter}
        ORDER BY a.ActionDate DESC
    """
    df_audit = run_query(query)

    if df_audit.empty:
        return []

    df_audit['ActionDate'] = pd.to_datetime(df_audit['ActionDate']).dt.strftime('%Y-%m-%d %H:%M:%S')

    logs = df_audit.to_dict('records')
    return clean_json_data(logs)


# ---------------------------------------------------------
# الجزء الخاص بـ SLA & Workload Management
# ---------------------------------------------------------

class SLAConfigUpdate(BaseModel):
    ProcessName: str
    SLATargetMinutes: int
    AvgItemProcessingSeconds: int


@app.post("/api/update-sla")
def update_sla(config: SLAConfigUpdate, current_user: auth.User = Depends(auth.get_current_user)):
    # 1. الحماية: للسوبر أدمن ومديري الأقسام فقط
    if current_user.Role not in ["SuperAdmin", "CoE_Manager"]:
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية لتعديل الـ SLA")

    # 2. جلب القيم القديمة من الجدولين لتسجيلها في الـ Audit
    old_config_df = run_query(f"SELECT SLATargetMinutes FROM ProcessConfig WHERE ProcessName = '{config.ProcessName}'")
    old_queue_df = run_query(
        f"SELECT AvgItemProcessingSeconds FROM ProcessQueues WHERE ProcessName = '{config.ProcessName}'")

    old_vals = {}

    # معالجة آمنة للـ NULL (None) لتجنب أخطاء التحويل
    if not old_config_df.empty:
        sla_val = old_config_df.iloc[0]['SLATargetMinutes']
        old_vals['SLATargetMinutes'] = int(sla_val) if pd.notnull(sla_val) else 0

    if not old_queue_df.empty:
        avg_val = old_queue_df.iloc[0]['AvgItemProcessingSeconds']
        old_vals['AvgItemProcessingSeconds'] = int(avg_val) if pd.notnull(avg_val) else 0

    old_vals_json = json.dumps(old_vals)
    new_vals_json = json.dumps(config.dict())

    # 3. تحديث القيم (SLA في جدول الإعدادات، وسرعة البوت في جدول الطوابير)
    update_config_query = f"""
    UPDATE ProcessConfig 
    SET SLATargetMinutes = {config.SLATargetMinutes} 
    WHERE ProcessName = '{config.ProcessName}';
    """

    update_queue_query = f"""
    UPDATE ProcessQueues 
    SET AvgItemProcessingSeconds = {config.AvgItemProcessingSeconds} 
    WHERE ProcessName = '{config.ProcessName}';
    """

    # 4. تسجيل العملية في جدول التدقيق والمراقبة
    audit_query = f"""
    INSERT INTO AuditLogs (UserID, ActionType, ProcessName, OldValues, NewValues)
    VALUES ({current_user.UserID}, 'Update_SLA', '{config.ProcessName}', '{old_vals_json}', '{new_vals_json}');
    """

    try:
        execute_update(update_config_query)
        execute_update(update_queue_query)
        execute_update(audit_query)
        return {"status": "success", "message": "SLA configuration updated successfully"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.get("/api/sla-workload")
def get_sla_workload(current_user: auth.User = Depends(auth.get_current_user)):
    # 1. فلترة الطوابير حسب صلاحية قسم المستخدم
    dept_filter = ""
    if current_user.AllowedDepartment != 'ALL':
        dept_filter = f" AND c.Department = '{current_user.AllowedDepartment}'"

    # 2. جلب بيانات الطابور ودمجها مع إعدادات الـ SLA
    query = f"""
        SELECT 
            q.ProcessName, 
            q.PendingItems, 
            q.ActiveItems, 
            q.AvgItemProcessingSeconds,
            c.SLATargetMinutes,
            c.Department
        FROM ProcessQueues q
        JOIN ProcessConfig c ON q.ProcessName = c.ProcessName
        WHERE 1=1 {dept_filter}
    """
    df_queue = run_query(query)

    if df_queue.empty:
        return []

    # 3. الذكاء التنبؤي: حساب الوقت التقديري لإنهاء الطابور (بالدقائق)
    df_queue['EstimatedCompletionMinutes'] = (df_queue['PendingItems'] * df_queue['AvgItemProcessingSeconds']) / 60.0

    # 4. دالة تحديد مستوى الخطر
    def determine_status(row):
        est = row['EstimatedCompletionMinutes']
        sla = row['SLATargetMinutes']
        if sla == 0 or pd.isna(sla):
            return 'Unknown'

        ratio = est / sla
        if ratio >= 1.0:
            return 'Breach_Risk'  # سيتجاوز أو تجاوز الوقت المحدد بالفعل
        elif ratio >= 0.75:
            return 'Warning'  # استهلك 75% من الوقت المتاح
        return 'Healthy'  # آمن وفي النطاق الزمني

    df_queue['SLAStatus'] = df_queue.apply(determine_status, axis=1)
    df_queue['EstimatedCompletionMinutes'] = df_queue['EstimatedCompletionMinutes'].round(1)

    return clean_json_data(df_queue.to_dict('records'))


from fastapi import WebSocket, WebSocketDisconnect
import asyncio


# --- مدير اتصالات WebSockets المؤسسي ---
class ConnectionManager:
    def __init__(self):
        # قاموس لتخزين الاتصالات الحية: { "MachineName": websocket_object }
        self.active_connections: dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, machine_name: str):
        await websocket.accept()
        self.active_connections[machine_name] = websocket
        # تحديث حالة السيرفر إلى Online فور اتصاله
        execute_update(
            f"UPDATE BotInfrastructure SET Status = 'Online', LastPing = GETDATE() WHERE MachineName = '{machine_name}'")

    def disconnect(self, machine_name: str):
        if machine_name in self.active_connections:
            del self.active_connections[machine_name]
        # تحديث حالة السيرفر إلى Offline فور انقطاع الاتصال
        execute_update(f"UPDATE BotInfrastructure SET Status = 'Offline' WHERE MachineName = '{machine_name}'")

    async def send_command(self, machine_name: str, command: str):
        if machine_name in self.active_connections:
            await self.active_connections[machine_name].send_text(command)
            return True
        return False


manager = ConnectionManager()


# --- مسار الـ WebSocket الذي يتصل به الـ Bot Agent ---
@app.websocket("/ws/agent/{machine_name}")
async def websocket_endpoint(websocket: WebSocket, machine_name: str):
    await manager.connect(websocket, machine_name)
    try:
        while True:
            # استقبال النبضات (CPU, RAM, HDD) من السيرفر
            data = await websocket.receive_json()
            query = f"""
            UPDATE BotInfrastructure 
            SET CPU_Usage = {data.get('CPU_Usage', 0)}, 
                RAM_Usage = {data.get('RAM_Usage', 0)},
                HDD_Usage = {data.get('HDD_Usage', 0)},
                LastPing = GETDATE()
            WHERE MachineName = '{machine_name}'
            """
            execute_update(query)
    except WebSocketDisconnect:
        manager.disconnect(machine_name)


# --- مسار API جديد لإرسال أمر تشغيل بوت من الداشبورد إلى السيرفر ---
@app.post("/api/trigger-bot/{machine_name}")
async def trigger_bot(machine_name: str, bot_name: str, current_user: auth.User = Depends(auth.get_current_user)):
    if current_user.Role not in ["SuperAdmin", "CoE_Manager"]:
        raise HTTPException(status_code=403, detail="ليس لديك صلاحية لتشغيل العمليات")

    command = f"RUN_BOT:{bot_name}"
    success = await manager.send_command(machine_name, command)

    if success:
        return {"status": "success", "message": f"Command '{command}' sent to {machine_name} instantly."}
    else:
        return {"status": "error", "message": f"Machine {machine_name} is currently offline."}
# ---------------------------------------------------------
# الجزء الخاص بـ Infrastructure & Device Health
# ---------------------------------------------------------

class MachineRegistration(BaseModel):
    MachineName: str
    AssignedBot: str
    RunnerType: str
    TotalRAM_GB: int
    TotalHDD_GB: int


class AgentHeartbeat(BaseModel):
    MachineName: str
    CPU_Usage: int
    RAM_Usage: int
    HDD_Usage: int


@app.post("/api/register-machine")
def register_machine(machine: MachineRegistration, current_user: auth.User = Depends(auth.get_current_user)):
    if current_user.Role not in ["SuperAdmin", "CoE_Manager"]:
        raise HTTPException(status_code=403, detail="Only Admins can register machines.")

    query = f"""
    INSERT INTO BotInfrastructure (MachineName, AssignedBot, Status, CPU_Usage, RAM_Usage, HDD_Usage, LastPing, TotalRAM_GB, TotalHDD_GB, RunnerType)
    VALUES ('{machine.MachineName}', '{machine.AssignedBot}', 'Idle', 0, 0, 0, GETDATE(), {machine.TotalRAM_GB}, {machine.TotalHDD_GB}, '{machine.RunnerType}')
    """
    try:
        execute_update(query)
        return {"status": "success", "message": "Runner Registered Successfully"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


class MachineUpdate(BaseModel):
    MachineName: str
    AssignedBot: str
    RunnerType: str
    TotalRAM_GB: int
    TotalHDD_GB: int


@app.post("/api/update-machine")
def update_machine(machine: MachineUpdate, current_user: auth.User = Depends(auth.get_current_user)):
    # التحقق من الصلاحيات
    if current_user.Role not in ["SuperAdmin", "CoE_Manager"]:
        raise HTTPException(status_code=403, detail="Only Admins can update machines.")

    query = f"""
    UPDATE BotInfrastructure 
    SET AssignedBot = '{machine.AssignedBot}',
        RunnerType = '{machine.RunnerType}',
        TotalRAM_GB = {machine.TotalRAM_GB},
        TotalHDD_GB = {machine.TotalHDD_GB}
    WHERE MachineName = '{machine.MachineName}'
    """
    try:
        execute_update(query)
        return {"status": "success", "message": "Runner Updated Successfully"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/agent-heartbeat")
def agent_heartbeat(heartbeat: AgentHeartbeat):
    query = f"""
    UPDATE BotInfrastructure 
    SET CPU_Usage = {heartbeat.CPU_Usage}, 
        RAM_Usage = {heartbeat.RAM_Usage},
        HDD_Usage = {heartbeat.HDD_Usage},
        Status = 'Online',
        LastPing = GETDATE()
    WHERE MachineName = '{heartbeat.MachineName}'
    """
    execute_update(query)
    return {"status": "success"}


@app.get("/api/infrastructure")
def get_infrastructure_health(current_user: auth.User = Depends(auth.get_current_user)):
    query = "SELECT * FROM BotInfrastructure"
    df_infra = run_query(query)

    if df_infra.empty:
        return []

    def determine_health(row):
        last_ping = pd.to_datetime(row['LastPing'])
        time_diff = (pd.Timestamp.now() - last_ping).total_seconds()

        if time_diff > 180:
            return 'Critical'
        if row['CPU_Usage'] >= 90 or row['RAM_Usage'] >= 90 or row['HDD_Usage'] >= 90:
            return 'Warning'
        if row['Status'] == 'Idle':
            return 'Idle'
        return 'Healthy'

    df_infra['HealthStatus'] = df_infra.apply(determine_health, axis=1)

    offline_machines = df_infra[df_infra['HealthStatus'] == 'Critical']['MachineName'].tolist()
    for machine in offline_machines:
        execute_update(f"UPDATE BotInfrastructure SET Status = 'Offline' WHERE MachineName = '{machine}'")

    df_infra['LastPing'] = pd.to_datetime(df_infra['LastPing']).dt.strftime('%Y-%m-%d %H:%M:%S')
    return clean_json_data(df_infra.to_dict('records'))