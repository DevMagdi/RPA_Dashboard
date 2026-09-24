import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime, date
from db_connection import run_query

# ====================== إعدادات الصفحة ======================
st.set_page_config(
    page_title="RPA Executive Dashboard",
    page_icon="⚡",
    layout="wide",
    initial_sidebar_state="collapsed"
)

# ====================== CSS (محاكاة Tailwind و Shadcn UI) ======================
st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

    /* الإعدادات الأساسية */
    html, body, [class*="css"] {
        font-family: 'Inter', sans-serif !important;
        background-color: #020817; /* Slate 950 */
        color: #f8fafc;
    }

    .stApp {
        background-color: #020817;
    }

    /* إخفاء هوامش Streamlit الافتراضية */
    .block-container {
        padding-top: 1rem !important;
        padding-bottom: 0rem !important;
        max-width: 98% !important;
    }
    header {visibility: hidden;}
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}

    /* الحاويات والبطاقات (Cards) */
    .premium-card {
        background-color: #0f172a; /* Slate 900 */
        border: 1px solid #1e293b; /* Slate 800 */
        border-radius: 12px;
        padding: 1.5rem;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
        margin-bottom: 1rem;
    }

    /* شريط الحالة المباشرة (Live Banner) */
    .live-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: linear-gradient(90deg, #1e293b 0%, #0f172a 100%);
        border: 1px solid #334155;
        border-radius: 12px;
        padding: 1rem 1.5rem;
        margin-bottom: 1.5rem;
    }
    .status-badge-running {
        background-color: rgba(16, 185, 129, 0.1);
        color: #10b981;
        border: 1px solid rgba(16, 185, 129, 0.2);
        padding: 4px 12px;
        border-radius: 9999px;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }
    .status-badge-idle {
        background-color: rgba(148, 163, 184, 0.1);
        color: #94a3b8;
        border: 1px solid rgba(148, 163, 184, 0.2);
        padding: 4px 12px;
        border-radius: 9999px;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
    }

    /* مؤشرات الأداء (KPI Strip) */
    .kpi-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
        margin-bottom: 1.5rem;
    }
    .kpi-item {
        background-color: #0f172a;
        border: 1px solid #1e293b;
        border-radius: 12px;
        padding: 1.25rem;
        transition: transform 0.2s, border-color 0.2s;
    }
    .kpi-item:hover {
        border-color: #3b82f6; /* Blue 500 */
        transform: translateY(-2px);
    }
    .kpi-title {
        color: #94a3b8;
        font-size: 0.875rem;
        font-weight: 500;
        margin-bottom: 0.5rem;
    }
    .kpi-value {
        color: #f8fafc;
        font-size: 1.875rem;
        font-weight: 700;
        line-height: 1.2;
    }
    .kpi-subtitle {
        color: #64748b;
        font-size: 0.75rem;
        margin-top: 0.25rem;
    }

    /* العناوين */
    h1, h2, h3 {
        color: #f8fafc !important;
        font-family: 'Inter', sans-serif !important;
    }
    .section-title {
        font-size: 1.125rem;
        font-weight: 600;
        margin-bottom: 1rem;
        color: #e2e8f0;
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    /* الجداول */
    .stDataFrame {
        border: 1px solid #1e293b;
        border-radius: 8px;
    }
</style>
""", unsafe_allow_html=True)


# ====================== جلب البيانات ======================
@st.cache_data(ttl=15)
def load_data():
    runs = run_query("""
                     SELECT RunID,
                            ProcessName,
                            RequestID,
                            Status,
                            StartTime,
                            EndTime,
                            DurationMinutes,
                            FailureReason,
                            TransactionsCount,
                            TimeSavedHours,
                            CostSaved,
                            CreatedAt
                     FROM ProcessRuns
                     ORDER BY StartTime DESC
                     """)
    config = run_query("""
                       SELECT ProcessName, ExpectedRunsPerDay, HourlyRate, Notes
                       FROM ProcessConfig
                       WHERE IsActive = 1
                       """)
    return runs, config


df_runs, df_config = load_data()

if df_runs.empty:
    st.error("لم يتم العثور على بيانات. تأكد من الاتصال بقاعدة البيانات وأن الجداول تحتوي على بيانات.")
    st.stop()

df_runs['StartTime'] = pd.to_datetime(df_runs['StartTime'])
df_runs['EndTime'] = pd.to_datetime(df_runs['EndTime'])
df_runs['RunDate'] = df_runs['StartTime'].dt.date

today = date.today()
df_today = df_runs[df_runs['RunDate'] == today].copy()

# ====================== الحسابات الأساسية ======================
total_runs_today = len(df_today)
failed_today = len(df_today[df_today['Status'].isin(['Failed', 'Stopped'])])
running_now = df_today[df_today['Status'] == 'Running']

time_saved_today = df_today['TimeSavedHours'].sum()
cost_saved_today = df_today['CostSaved'].sum()
expected_runs = int(df_config['ExpectedRunsPerDay'].sum()) if not df_config.empty else 0

current_status = "Running" if not running_now.empty else "Idle"
active_process = running_now.iloc[0]['ProcessName'] if current_status == "Running" else "لا توجد عمليات حالية"

# ====================== واجهة المستخدم (UI) ======================

# 1. Header & Live Banner (شريط الحالة المباشرة)
status_class = "status-badge-running" if current_status == "Running" else "status-badge-idle"
status_text = "🟢 عملية قيد التشغيل" if current_status == "Running" else "⚪ النظام في وضع الاستعداد"

st.markdown(f"""
<div class="live-banner">
    <div>
        <h2 style="margin:0; font-size:1.5rem; font-weight:700;">لوحة تحكم RPA المركزية</h2>
        <p style="margin:0; color:#94a3b8; font-size:0.875rem;">تحديث فوري لبيانات الروبوتات والعمليات</p>
    </div>
    <div style="text-align: right;">
        <div class="{status_class}">{status_text}</div>
        <p style="margin:0; margin-top:0.25rem; color:#94a3b8; font-size:0.75rem;">{active_process}</p>
    </div>
</div>
""", unsafe_allow_html=True)

# 2. KPI Strip (شريط مؤشرات الأداء باستخدام Grid)
st.markdown(f"""
<div class="kpi-grid">
    <div class="kpi-item">
        <div class="kpi-title">عمليات اليوم</div>
        <div class="kpi-value">{total_runs_today}</div>
        <div class="kpi-subtitle">المتوقع: {expected_runs}</div>
    </div>
    <div class="kpi-item">
        <div class="kpi-title">الوقت المُوفر</div>
        <div class="kpi-value" style="color: #38bdf8;">{time_saved_today:.1f} <span style="font-size:1rem">ساعة</span></div>
        <div class="kpi-subtitle">اليوم فقط</div>
    </div>
    <div class="kpi-item">
        <div class="kpi-title">التكلفة المُوفرة</div>
        <div class="kpi-value" style="color: #4ade80;">{cost_saved_today:,.0f} <span style="font-size:1rem">EGP</span></div>
        <div class="kpi-subtitle">اليوم فقط</div>
    </div>
    <div class="kpi-item" style="{'border-color: #ef4444;' if failed_today > 0 else ''}">
        <div class="kpi-title">أخطاء اليوم</div>
        <div class="kpi-value" style="color: {'#ef4444' if failed_today > 0 else '#f8fafc'};">{failed_today}</div>
        <div class="kpi-subtitle">فشل أو توقف</div>
    </div>
</div>
""", unsafe_allow_html=True)

# 3. Charts Panel (الرسوم البيانية)
c1, c2 = st.columns(2)

with c1:
    st.markdown('<div class="premium-card"><div class="section-title">📊 نشاط الروبوتات اليومي</div>',
                unsafe_allow_html=True)
    daily = df_runs.groupby('RunDate').size().reset_index(name='Runs').sort_values('RunDate')
    fig1 = px.area(daily, x='RunDate', y='Runs', color_discrete_sequence=['#3b82f6'])
    fig1.update_traces(mode='lines+markers', fill='tozeroy', fillcolor='rgba(59, 130, 246, 0.1)', line=dict(width=3))
    fig1.update_layout(
        height=280, margin=dict(t=10, b=0, l=0, r=0),
        paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)',
        font_color='#94a3b8', xaxis=dict(showgrid=False, title=''),
        yaxis=dict(showgrid=True, gridcolor='#1e293b', title='')
    )
    st.plotly_chart(fig1, use_container_width=True)
    st.markdown('</div>', unsafe_allow_html=True)

with c2:
    st.markdown('<div class="premium-card"><div class="section-title">💰 العائد على الاستثمار (ساعات)</div>',
                unsafe_allow_html=True)
    savings = df_runs.groupby('ProcessName').agg({'TimeSavedHours': 'sum'}).reset_index()
    fig2 = px.bar(savings, x='ProcessName', y='TimeSavedHours', color_discrete_sequence=['#10b981'])
    fig2.update_layout(
        height=280, margin=dict(t=10, b=0, l=0, r=0),
        paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)',
        font_color='#94a3b8', xaxis=dict(showgrid=False, title=''),
        yaxis=dict(showgrid=True, gridcolor='#1e293b', title='')
    )
    st.plotly_chart(fig2, use_container_width=True)
    st.markdown('</div>', unsafe_allow_html=True)

# 4. Runs Table & Failures Panel (جدول العمليات وتفاصيل الأخطاء)
c3, c4 = st.columns([2, 1])

with c3:
    st.markdown('<div class="premium-card"><div class="section-title">📋 السجل الحديث للعمليات (Process Rail)</div>',
                unsafe_allow_html=True)
    table_df = df_runs[['ProcessName', 'Status', 'StartTime', 'DurationMinutes', 'FailureReason']].head(10).copy()
    table_df.columns = ['العملية', 'الحالة', 'وقت البدء', 'المدة (دقيقة)', 'سبب الفشل']
    st.dataframe(table_df, use_container_width=True, hide_index=True, height=280)
    st.markdown('</div>', unsafe_allow_html=True)

with c4:
    st.markdown('<div class="premium-card"><div class="section-title">⚠️ تحليل الأخطاء</div>', unsafe_allow_html=True)
    fails = df_runs[df_runs['Status'].isin(['Failed', 'Stopped'])]
    if not fails.empty:
        summary = fails.groupby('FailureReason').size().reset_index(name='Count')
        fig3 = px.pie(summary, values='Count', names='FailureReason', hole=0.7,
                      color_discrete_sequence=['#ef4444', '#f59e0b', '#3b82f6'])
        fig3.update_layout(
            height=280, margin=dict(t=0, b=0, l=0, r=0),
            paper_bgcolor='rgba(0,0,0,0)', font_color='#e2e8f0',
            showlegend=False,
            annotations=[dict(text=str(len(fails)), x=0.5, y=0.5, font_size=32, font_color='#f8fafc', showarrow=False)]
        )
        st.plotly_chart(fig3, use_container_width=True)
    else:
        st.success("لا توجد أخطاء مسجلة مؤخراً.")
    st.markdown('</div>', unsafe_allow_html=True)