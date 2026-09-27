import os
import logging
from urllib.parse import quote_plus

import pandas as pd
from sqlalchemy import create_engine, text, bindparam
from sqlalchemy.pool import QueuePool

logger = logging.getLogger("db_connection")

# ============================================================
# Env loading (Dev only)
# - في الإنتاج الأفضل الاعتماد على Environment Variables مباشرة
# ============================================================
ENV = os.environ.get("ENV", "dev").lower()
if ENV != "prod":
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except Exception:
        # لو python-dotenv مش متثبت في prod مثلاً
        pass

# ============================================================
# Required env vars
# ============================================================
SERVER = os.environ["DB_SERVER"]
DATABASE = os.environ["DB_NAME"]
USERNAME = os.environ["DB_USER"]
PASSWORD = os.environ["DB_PASSWORD"]

DB_ENCRYPT = os.environ.get("DB_ENCRYPT", "yes")  # yes/no
DB_TRUST_SERVER_CERT = os.environ.get("DB_TRUST_SERVER_CERT", "yes")  # dev=yes, prod=no (مع شهادة صحيحة)
DB_DRIVER = os.environ.get("DB_DRIVER", "ODBC Driver 17 for SQL Server")

# Timeouts
DB_CONNECT_TIMEOUT = int(os.environ.get("DB_CONNECT_TIMEOUT", "30"))

# Pool sizing (عدليها حسب عدد workers والـ load)
DB_POOL_SIZE = int(os.environ.get("DB_POOL_SIZE", "20"))
DB_MAX_OVERFLOW = int(os.environ.get("DB_MAX_OVERFLOW", "40"))
DB_POOL_TIMEOUT = int(os.environ.get("DB_POOL_TIMEOUT", "30"))
DB_POOL_RECYCLE = int(os.environ.get("DB_POOL_RECYCLE", "1800"))

password_encoded = quote_plus(PASSWORD)

CONNECTION_STRING = (
    f"mssql+pyodbc://{USERNAME}:{password_encoded}@{SERVER}/{DATABASE}"
    f"?driver={quote_plus(DB_DRIVER)}"
    f"&Encrypt={DB_ENCRYPT}"
    f"&TrustServerCertificate={DB_TRUST_SERVER_CERT}"
)

engine = create_engine(
    CONNECTION_STRING,
    poolclass=QueuePool,
    pool_size=DB_POOL_SIZE,
    max_overflow=DB_MAX_OVERFLOW,
    pool_timeout=DB_POOL_TIMEOUT,
    pool_recycle=DB_POOL_RECYCLE,
    pool_pre_ping=True,
    fast_executemany=True,
    # pyodbc connect timeout (ثواني)
    connect_args={"timeout": DB_CONNECT_TIMEOUT},
)


def _prepare_statement(query: str, params: dict | None):
    """يفعّل دعم القوائم (IN clause) تلقائياً لو لقى list/tuple في الـ params"""
    stmt = text(query)
    if params:
        list_keys = [k for k, v in params.items() if isinstance(v, (list, tuple))]
        if list_keys:
            stmt = stmt.bindparams(*[bindparam(k, expanding=True) for k in list_keys])
    return stmt


def run_query(query: str, params: dict | None = None) -> pd.DataFrame:
    try:
        stmt = _prepare_statement(query, params)
        with engine.connect() as conn:
            return pd.read_sql(stmt, conn, params=params or {})
    except Exception as e:
        logger.error(f"Query failed: {query[:150]} | {e}", exc_info=True)
        raise


def execute_update(query: str, params: dict | None = None):
    try:
        stmt = _prepare_statement(query, params)
        with engine.begin() as conn:
            conn.execute(stmt, params or {})
    except Exception as e:
        logger.error(f"Update failed: {query[:150]} | {e}", exc_info=True)
        raise


def execute_transaction(queries: list[tuple[str, dict]]):
    """تنفيذ عدة استعلامات كوحدة واحدة (Atomic) - لازم تنجح كلها أو تترجع كلها"""
    try:
        with engine.begin() as conn:
            for q, p in queries:
                stmt = _prepare_statement(q, p)
                conn.execute(stmt, p or {})
    except Exception as e:
        logger.error(f"Transaction failed: {e}", exc_info=True)
        raise