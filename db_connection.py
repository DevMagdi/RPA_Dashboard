import os
from dotenv import load_dotenv
load_dotenv()

import logging
from sqlalchemy import create_engine, text, bindparam
from sqlalchemy.pool import QueuePool
import pandas as pd
from urllib.parse import quote_plus

logger = logging.getLogger("db_connection")

SERVER = os.environ["DB_SERVER"]
DATABASE = os.environ["DB_NAME"]
USERNAME = os.environ["DB_USER"]
PASSWORD = os.environ["DB_PASSWORD"]

password_encoded = quote_plus(PASSWORD)
CONNECTION_STRING = (
    f"mssql+pyodbc://{USERNAME}:{password_encoded}@{SERVER}/{DATABASE}"
    f"?driver=ODBC+Driver+17+for+SQL+Server&TrustServerCertificate=yes&Encrypt=yes"
)

engine = create_engine(
    CONNECTION_STRING, poolclass=QueuePool, pool_size=20, max_overflow=40,
    pool_timeout=30, pool_recycle=1800, pool_pre_ping=True, fast_executemany=True,
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
        logger.error(f"Query failed: {query[:150]} | {e}")
        raise


def execute_update(query: str, params: dict | None = None):
    try:
        stmt = _prepare_statement(query, params)
        with engine.begin() as conn:
            conn.execute(stmt, params or {})
    except Exception as e:
        logger.error(f"Update failed: {query[:150]} | {e}")
        raise


def execute_transaction(queries: list[tuple[str, dict]]):
    """تنفيذ عدة استعلامات كوحدة واحدة (Atomic) - لازم تنجح كلها أو تترجع كلها"""
    try:
        with engine.begin() as conn:
            for q, p in queries:
                stmt = _prepare_statement(q, p)
                conn.execute(stmt, p or {})
    except Exception as e:
        logger.error(f"Transaction failed: {e}")
        raise