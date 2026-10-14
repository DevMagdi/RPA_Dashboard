"""Authentication & user management API."""

from __future__ import annotations

from tests.conftest import ADMIN_PASSWORD, ADMIN_USERNAME, STRONG_PASSWORD, do_login


def test_login_success_issues_access_token(client):
    response = do_login(client, ADMIN_USERNAME, ADMIN_PASSWORD)
    assert response.status_code == 200
    body = response.json()
    assert body["access_token"]
    assert body.get("mfa_required") is not True


def test_login_sets_csrf_and_refresh_cookies(client):
    response = do_login(client, ADMIN_USERNAME, ADMIN_PASSWORD)
    assert response.status_code == 200
    assert client.cookies.get("csrf_token")
    cookie_names = {c.name for c in client.cookies.jar}
    assert "refresh_token" in cookie_names


def test_login_wrong_password_rejected(client, create_user):
    from sqlalchemy import select

    from app.db.session import get_session_factory
    from app.db.tables import AuditLogs, SystemUsers

    account = create_user(role="Viewer")
    response = do_login(client, account["username"], "definitely-wrong")
    assert response.status_code in (401, 403)

    with get_session_factory()() as session:
        attempts = session.execute(
            select(SystemUsers.c.FailedLoginAttempts).where(SystemUsers.c.UserID == account["user_id"])
        ).scalar_one()
        audit_event = session.execute(
            select(AuditLogs.c.LogID).where(
                AuditLogs.c.ActionType == "Login_Failed",
                AuditLogs.c.NewValues.like(f'%{account["username"]}%'),
            )
        ).scalar_one_or_none()
    assert attempts == 1
    assert audit_event is not None


def test_login_unknown_user_rejected(client):
    response = do_login(client, "no.such.user", STRONG_PASSWORD)
    assert response.status_code in (401, 403)


def test_me_returns_profile_and_permissions(client, admin_headers):
    response = client.get("/api/auth/me", headers=admin_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["username"] == ADMIN_USERNAME
    assert body["role"] == "SuperAdmin"
    assert body["permissions"]


def test_me_requires_authentication(client):
    assert client.get("/api/auth/me").status_code == 401


def test_garbage_token_rejected(client):
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-token"}).status_code == 401


def test_create_and_login_user(client, create_user, login):
    account = create_user(role="Operator", department="Finance")
    headers = login(account["username"], account["password"])
    me = client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["role"] == "Operator"
    assert me.json()["department"] == "Finance"


def test_users_list_requires_privilege(client, user_headers):
    assert client.get("/api/users", headers=user_headers("Viewer")).status_code == 403


def test_users_list_for_admin(client, admin_headers):
    response = client.get("/api/users", headers=admin_headers)
    assert response.status_code == 200
    assert any(u["Username"] == ADMIN_USERNAME for u in response.json())


def test_disabled_user_cannot_login(client, admin_headers, create_user, login):
    account = create_user(role="Auditor")
    response = client.patch(
        f"/api/users/{account['user_id']}/active", json={"is_active": False}, headers=admin_headers
    )
    assert response.status_code == 200
    assert do_login(client, account["username"], account["password"]).status_code in (401, 403)


def test_delete_user(client, admin_headers, create_user):
    account = create_user(role="Viewer")
    response = client.delete(f"/api/users/{account['user_id']}", headers=admin_headers)
    assert response.status_code == 200
    assert do_login(client, account["username"], account["password"]).status_code in (401, 403)


def test_sessions_listed(client, admin_headers):
    response = client.get("/api/auth/sessions", headers=admin_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_refresh_rotates_and_replay_rejected(client):
    do_login(client, ADMIN_USERNAME, ADMIN_PASSWORD)
    csrf = client.cookies.get("csrf_token") or ""
    first = client.post("/api/auth/refresh", json={}, headers={"X-CSRF-Token": csrf})
    assert first.status_code == 200
    assert first.json().get("access_token")
    replay = client.post("/api/auth/refresh", json={}, headers={"X-CSRF-Token": csrf})
    assert replay.status_code in (401, 403)


def test_refresh_forged_csrf_rejected(client):
    do_login(client, ADMIN_USERNAME, ADMIN_PASSWORD)
    response = client.post("/api/auth/refresh", json={}, headers={"X-CSRF-Token": "forged"})
    assert response.status_code == 403


def test_logout_then_refresh_fails(client):
    do_login(client, ADMIN_USERNAME, ADMIN_PASSWORD)
    csrf = client.cookies.get("csrf_token") or ""
    access = client.post("/api/auth/refresh", json={}, headers={"X-CSRF-Token": csrf})
    headers = {"Authorization": f"Bearer {access.json()['access_token']}", "X-CSRF-Token": csrf}
    assert client.post("/api/auth/logout", headers=headers).status_code == 200
    assert client.post("/api/auth/refresh", json={}, headers={"X-CSRF-Token": csrf}).status_code in (401, 403)


def _csrf(client) -> str:
    return client.cookies.get("csrf_token") or ""


def test_refresh_with_garbage_token_returns_401_not_500(client):
    do_login(client, ADMIN_USERNAME, ADMIN_PASSWORD)
    response = client.post(
        "/api/auth/refresh",
        json={"refresh_token": "garbage.not-a-jwt"},
        headers={"X-CSRF-Token": _csrf(client)},
    )
    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "refresh_invalid"


def test_refresh_with_unknown_token_row_returns_401_not_500(client):
    """Well-formed JWT whose hash has no RefreshTokens row -> 401."""
    from app.core.security import create_refresh_token

    login_response = do_login(client, ADMIN_USERNAME, ADMIN_PASSWORD)
    assert login_response.status_code == 200
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {login_response.json()['access_token']}"})
    assert me.status_code == 200
    forged = create_refresh_token(ADMIN_USERNAME, user_id=int(me.json()["user_id"]), token_id="999999999")
    response = client.post(
        "/api/auth/refresh",
        json={"refresh_token": forged},
        headers={"X-CSRF-Token": _csrf(client)},
    )
    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "refresh_invalid"


def test_refresh_after_logout_returns_401_not_500(client):
    do_login(client, ADMIN_USERNAME, ADMIN_PASSWORD)
    csrf = _csrf(client)
    captured_refresh = client.cookies.get("refresh_token")
    assert captured_refresh
    access = client.post("/api/auth/refresh", json={}, headers={"X-CSRF-Token": csrf})
    assert access.status_code == 200
    captured_refresh = client.cookies.get("refresh_token") or captured_refresh
    headers = {"Authorization": f"Bearer {access.json()['access_token']}", "X-CSRF-Token": csrf}
    assert client.post("/api/auth/logout", headers=headers).status_code == 200
    # Authorization header exempts the cookie-CSRF check (bearer requests are
    # not forgeable), so this exercises the auth layer itself: the revoked
    # token must surface as 401, never 500.
    response = client.post(
        "/api/auth/refresh",
        json={"refresh_token": captured_refresh},
        headers={"Authorization": f"Bearer {access.json()['access_token']}"},
    )
    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "refresh_invalid"


def test_valid_refresh_still_rotates(client):
    do_login(client, ADMIN_USERNAME, ADMIN_PASSWORD)
    response = client.post("/api/auth/refresh", json={}, headers={"X-CSRF-Token": _csrf(client)})
    assert response.status_code == 200, response.text
    assert response.json().get("access_token")


def test_token_error_handler_returns_401_envelope():
    """Defense-in-depth: a bare TokenError escaping any path is a 401."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.api.errors import register_exception_handlers
    from app.services.token_service import TokenError

    mini = FastAPI()
    register_exception_handlers(mini)

    @mini.get("/boom")
    def _boom():
        raise TokenError("refresh token not recognised")

    with TestClient(mini, raise_server_exceptions=False) as mini_client:
        response = mini_client.get("/boom")
    assert response.status_code == 401, response.text
    body = response.json()
    assert body["error"]["code"] == "refresh_invalid"
    assert "request_id" in body["error"]


def test_change_password_flow(client, create_user, login):
    account = create_user(role="Viewer")
    headers = login(account["username"], account["password"])
    response = client.post(
        "/api/auth/change-password",
        json={"current_password": account["password"], "new_password": "New_Str0ng_Pass!"},
        headers=headers,
    )
    assert response.status_code == 200
    assert do_login(client, account["username"], "New_Str0ng_Pass!").status_code == 200
    assert do_login(client, account["username"], account["password"]).status_code in (401, 403)


def test_change_password_wrong_current_rejected(client, create_user, login):
    account = create_user(role="Viewer")
    headers = login(account["username"], account["password"])
    response = client.post(
        "/api/auth/change-password",
        json={"current_password": "not-the-password", "new_password": "New_Str0ng_Pass!"},
        headers=headers,
    )
    assert response.status_code in (400, 401, 403)


def test_mfa_setup_issues_secret(client, create_user, login):
    account = create_user(role="Viewer")
    headers = login(account["username"], account["password"])
    response = client.post("/api/auth/mfa/setup", headers=headers)
    assert response.status_code == 200
    assert response.json()["secret"]
    assert response.json()["otpauth_url"].startswith("otpauth://")


def test_mfa_full_lifecycle(client, create_user, login, monkeypatch):
    import pyotp
    from sqlalchemy import select

    from app.db.session import get_session_factory
    from app.db.tables import AuditLogs
    from app.services import audit_service

    account = create_user(role="Viewer")
    headers = login(account["username"], account["password"])
    secret = client.post("/api/auth/mfa/setup", headers=headers).json()["secret"]

    confirm = client.post("/api/auth/mfa/confirm", json={"code": pyotp.TOTP(secret).now()}, headers=headers)
    assert confirm.status_code == 200
    assert len(confirm.json().get("backup_codes", [])) >= 5

    def forbid_standalone_audit(**_kwargs):
        raise AssertionError("MFA login challenge must share the authentication transaction")

    original_record_standalone = audit_service.record_standalone
    monkeypatch.setattr(audit_service, "record_standalone", forbid_standalone_audit)
    login_response = do_login(client, account["username"], account["password"])
    assert login_response.json().get("mfa_required") is True
    with get_session_factory()() as session:
        challenge_audit = session.execute(
            select(AuditLogs.c.LogID).where(
                AuditLogs.c.UserID == account["user_id"], AuditLogs.c.ActionType == "Login_MFA_Challenge"
            )
        ).scalar_one_or_none()
    assert challenge_audit is not None
    monkeypatch.setattr(audit_service, "record_standalone", original_record_standalone)

    mfa_token = login_response.json()["mfa_token"]

    wrong = client.post("/api/auth/mfa/verify", json={"mfa_token": mfa_token, "code": "000000"})
    assert wrong.status_code in (401, 403)

    verified = client.post(
        "/api/auth/mfa/verify", json={"mfa_token": mfa_token, "code": pyotp.TOTP(secret).now()}
    )
    assert verified.status_code == 200
    assert verified.json()["access_token"]

    mfa_headers = {"Authorization": f"Bearer {verified.json()['access_token']}"}
    disabled = client.post(
        "/api/auth/mfa/disable", json={"password": account["password"]}, headers=mfa_headers
    )
    assert disabled.status_code == 200
    assert do_login(client, account["username"], account["password"]).json().get("mfa_required") is not True


# --------------------------------------------------------------------------- #
# Permission caching — every request resolves a role, so the lookup must not
# hit the database each time (see the ``permissions.load`` slow queries).
# --------------------------------------------------------------------------- #
def _count_permission_lookups(monkeypatch) -> dict:
    from app.security import permissions as permission_module

    calls = {"n": 0}
    real_fetch_all = permission_module.fetch_all

    def counting_fetch_all(*args, **kwargs):
        calls["n"] += 1
        return real_fetch_all(*args, **kwargs)

    monkeypatch.setattr(permission_module, "fetch_all", counting_fetch_all)
    return calls


def test_permission_lookup_is_cached_between_requests(client, admin_headers, monkeypatch):
    from app.security.permissions import invalidate_permission_cache

    calls = _count_permission_lookups(monkeypatch)
    invalidate_permission_cache()  # cold cache, whatever ran before this test

    for _ in range(3):
        assert client.get("/api/processes?limit=1", headers=admin_headers).status_code == 200

    # One lookup for the first request, then cache hits for the rest — even
    # though each request resolves the principal *and* the guard.
    assert calls["n"] == 1


def test_permission_sets_can_be_invalidated_per_role():
    from app.core.cache import get_cache
    from app.security.permissions import invalidate_permission_cache
    from app.security.permissions import load_permissions

    load_permissions("SuperAdmin")
    load_permissions("Auditor")
    assert get_cache().get_json("perms:role:SuperAdmin") is not None

    invalidate_permission_cache("SuperAdmin")
    assert get_cache().get_json("perms:role:SuperAdmin") is None
    assert get_cache().get_json("perms:role:Auditor") is not None

    invalidate_permission_cache()
    assert get_cache().get_json("perms:role:Auditor") is None


def test_failed_permission_lookup_is_not_cached(monkeypatch):
    from app.security import permissions as permission_module
    from app.security.permissions import invalidate_permission_cache, load_permissions

    invalidate_permission_cache("GhostRole")

    def boom(*args, **kwargs):
        raise RuntimeError("database down")

    monkeypatch.setattr(permission_module, "fetch_all", boom)
    assert load_permissions("GhostRole").as_list() == []

    # The failure was not cached, so the next call retries and picks the row up.
    monkeypatch.setattr(
        permission_module, "fetch_all", lambda *args, **kwargs: [{"Permission": "audit:read"}]
    )
    assert load_permissions("GhostRole").as_list() == ["audit:read"]


def test_unknown_role_falls_back_to_the_builtin_matrix(monkeypatch):
    from app.security import permissions as permission_module
    from app.security.permissions import invalidate_permission_cache, load_permissions

    invalidate_permission_cache("GhostRole")
    monkeypatch.setattr(permission_module, "fetch_all", lambda *args, **kwargs: [])
    # No custom rows for the role -> the built-in matrix (empty here) applies,
    # and that answer *is* cacheable.
    assert load_permissions("GhostRole").as_list() == []
    assert load_permissions("Viewer").has("dashboard:read")
