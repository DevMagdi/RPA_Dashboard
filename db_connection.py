from sqlalchemy import create_engine, text
import pandas as pd
from urllib.parse import quote_plus

# ========== بيانات الاتصال ==========
SERVER = r'DESKTOP-A0QINRF\MSSQLSERVERTEST'
DATABASE = 'RPA_Dashboard'
USERNAME = 'rpa_user'
PASSWORD = 'Rpa@123456'
# ==================================

def get_engine():
    # بنعمل Encode للباسورد عشان الرموز الخاصة
    password_encoded = quote_plus(PASSWORD)

    connection_string = (
        f"mssql+pyodbc://{USERNAME}:{password_encoded}@{SERVER}/{DATABASE}"
        f"?driver=ODBC+Driver+17+for+SQL+Server"
        f"&TrustServerCertificate=yes"
        f"&Encrypt=yes"
    )
    return create_engine(connection_string, fast_executemany=True)


def run_query(query: str) -> pd.DataFrame:
    try:
        engine = get_engine()
        df = pd.read_sql(query, engine)
        return df
    except Exception as e:
        print(f"Query Error: {e}")
        return pd.DataFrame()


def execute_update(query: str):
    try:
        engine = get_engine() # استدعاء الاتصال أولاً
        # استخدام begin() بيعمل Commit تلقائي بعد التنفيذ
        with engine.begin() as conn:
            conn.execute(text(query))
    except Exception as e:
        print(f"Update Error: {e}")
        raise e # نمرر الخطأ للـ API عشان يظهر في الواجهة لو حصلت مشكلة