"""Pytest fixtures for the Control Room test-suite.

The suite runs against a real FastAPI app + a throwaway SQLite database
(demo-seeded), exercising the same code paths as production.  Environment is
pinned *before* ``app`` is imported because settings/engine are cached
singletons.
"""

from __future__ import annotations

import os
import sys
import tempfile
import uuid
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

_TMPDIR = tempfile.mkdtemp(prefix="control-room-tests-")

os.environ.setdefault("ENV", "test")
os.environ.setdefault("DB_DIALECT", "sqlite")
os.environ.setdefault("DB_NAME", str(Path(_TMPDIR) / "tests.sqlite3"))
os.environ.setdefault("DB_SEED_DEMO", "true")
os.environ.setdefault("SCHEDULER_ENABLED", "false")

ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "ChangeMe_Admin1!"
STRONG_PASSWORD = "Str0ng_Passw0rd!"


@pytest.fixture(scope="session")
def client():
    """Session-scoped TestClient (lifespan bootstraps + seeds the DB once)."""
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


def do_login(client, username: str, password: str):
    return client.post("/api/auth/login", json={"username": username, "password": password})


@pytest.fixture(scope="session")
def admin_headers(client):
    response = do_login(client, ADMIN_USERNAME, ADMIN_PASSWORD)
    assert response.status_code == 200, response.text
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def admin_token(admin_headers):
    return admin_headers["Authorization"].split(" ", 1)[1]


@pytest.fixture()
def login(client):
    """Callable fixture: login(username, password) -> headers dict."""

    def _login(username: str, password: str) -> dict:
        payload = {"username": username, "password": password}
        response = client.post("/api/auth/login", json=payload)
        assert response.status_code == 200, response.text
        return {"Authorization": f"Bearer {response.json()['access_token']}"}

    return _login


@pytest.fixture()
def create_user(client, admin_headers):
    """Callable fixture creating a user via the admin API (unique username)."""

    def _create(role: str = "Viewer", department: str = "Finance", password: str = STRONG_PASSWORD) -> dict:
        username = f"pytest.{uuid.uuid4().hex[:10]}"
        response = client.post(
            "/api/users",
            json={"username": username, "role": role, "department": department, "password": password},
            headers=admin_headers,
        )
        assert response.status_code == 201, response.text
        return {"username": username, "password": password, "user_id": response.json().get("user_id")}

    return _create


@pytest.fixture()
def user_headers(client, create_user, login):
    """Headers for a fresh Viewer user."""

    def _headers(role: str = "Viewer", department: str = "Finance") -> dict:
        account = create_user(role=role, department=department)
        return login(account["username"], account["password"])

    return _headers
