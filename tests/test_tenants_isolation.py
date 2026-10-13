"""Tenant management + cross-tenant isolation (platform-admin guard)."""

from __future__ import annotations

import uuid

from tests.conftest import STRONG_PASSWORD


def _provision_tenant(client, admin_headers):
    key = f"pytest-{uuid.uuid4().hex[:8]}"
    response = client.post(
        "/api/tenants",
        json={
            "TenantKey": key,
            "Name": "Pytest Bank",
            "CompanyName": "Pytest Bank",
            "Provider": "generic_sql",
            "AdminUsername": f"{key}-admin",
            "AdminPassword": STRONG_PASSWORD,
        },
        headers=admin_headers,
    )
    assert response.status_code == 201, response.text
    return key, response.json()["tenant_id"]


def test_platform_admin_lists_tenants(client, admin_headers):
    response = client.get("/api/tenants", headers=admin_headers)
    assert response.status_code == 200
    keys = {t.get("TenantKey") or t.get("tenant_key") for t in response.json()}
    assert "default" in keys


def test_create_tenant_and_read_back(client, admin_headers):
    key, tenant_id = _provision_tenant(client, admin_headers)
    response = client.get(f"/api/tenants/{tenant_id}", headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["stats"] is not None


def test_tenant_admin_cannot_list_tenants(client, admin_headers, login):
    """A tenant-local SuperAdmin must never see other tenants.

    Regression: tenant endpoints were guarded by ``require_permission("*")``
    and every tenant seeds its own SuperAdmin with ``*`` — so any tenant's
    admin could enumerate/manage all banks.  Now requires platform admin.
    """
    key, _tenant_id = _provision_tenant(client, admin_headers)
    tenant_admin = login(f"{key}-admin", STRONG_PASSWORD, tenant_key=key)
    assert client.get("/api/tenants", headers=tenant_admin).status_code == 403


def test_tenant_admin_cannot_provision_tenants(client, admin_headers, login):
    key, _tenant_id = _provision_tenant(client, admin_headers)
    tenant_admin = login(f"{key}-admin", STRONG_PASSWORD, tenant_key=key)
    response = client.post(
        "/api/tenants",
        json={"TenantKey": f"evil-{uuid.uuid4().hex[:6]}", "Name": "Evil Bank"},
        headers=tenant_admin,
    )
    assert response.status_code == 403


def test_tenant_admin_cannot_read_other_tenant(client, admin_headers, login):
    key, tenant_id = _provision_tenant(client, admin_headers)
    tenant_admin = login(f"{key}-admin", STRONG_PASSWORD, tenant_key=key)
    assert client.get("/api/tenants/1", headers=tenant_admin).status_code == 403
    assert client.get(f"/api/tenants/{tenant_id}", headers=tenant_admin).status_code == 403


def test_viewer_cannot_list_tenants(client, user_headers):
    assert client.get("/api/tenants", headers=user_headers("Viewer")).status_code == 403


def test_branding_is_public(client):
    response = client.get("/api/branding")
    assert response.status_code == 200
    assert response.json()["api_version"] == "3.0.0"


def test_update_branding(client, admin_headers):
    _key, tenant_id = _provision_tenant(client, admin_headers)
    response = client.patch(
        f"/api/tenants/{tenant_id}/branding", json={"PrimaryColor": "#123456"}, headers=admin_headers
    )
    assert response.status_code == 200


def test_configure_platform_and_read_back(client, admin_headers):
    _key, tenant_id = _provision_tenant(client, admin_headers)
    response = client.post(
        f"/api/tenants/{tenant_id}/platform",
        json={
            "Provider": "uipath",
            "Config": {"base_url": "https://orchestrator.example.com", "auth_mode": "oauth_client_credentials"},
        },
        headers=admin_headers,
    )
    assert response.status_code == 200
    read_back = client.get(f"/api/tenants/{tenant_id}/platform", headers=admin_headers)
    assert read_back.status_code == 200


def test_platform_test_responds(client, admin_headers):
    _key, tenant_id = _provision_tenant(client, admin_headers)
    response = client.post(f"/api/tenants/{tenant_id}/platform/test", headers=admin_headers)
    assert response.status_code == 200
    assert "ok" in response.json()


def test_suspend_and_resume_tenant(client, admin_headers, login):
    key, tenant_id = _provision_tenant(client, admin_headers)
    suspended = client.patch(
        f"/api/tenants/{tenant_id}/active", params={"is_active": False}, headers=admin_headers
    )
    assert suspended.status_code == 200
    # Suspended tenant's admin can no longer log in.
    suspended_login = client.post(
        "/api/auth/login",
        json={"username": f"{key}-admin", "password": STRONG_PASSWORD, "tenant_key": key},
    )
    assert suspended_login.status_code in (401, 403)
    resumed = client.patch(f"/api/tenants/{tenant_id}/active", params={"is_active": True}, headers=admin_headers)
    assert resumed.status_code == 200


def test_retention_run(client, admin_headers):
    _key, tenant_id = _provision_tenant(client, admin_headers)
    response = client.post(
        f"/api/tenants/{tenant_id}/retention/run", params={"retention_days": 730}, headers=admin_headers
    )
    assert response.status_code == 200
    assert response.json()["status"] == "success"


def test_providers_catalogue_endpoint(client, admin_headers):
    response = client.get("/api/tenants/meta/providers", headers=admin_headers)
    assert response.status_code == 200
    providers = {row["provider"] for row in response.json()}
    assert {"generic_sql", "uipath", "automation_anywhere"} <= providers


def test_platform_providers_alias(client, admin_headers):
    response = client.get("/api/platform/providers", headers=admin_headers)
    assert response.status_code in (200, 404)  # alias exists in some profiles


def test_unknown_tenant_404(client, admin_headers):
    assert client.get("/api/tenants/999999", headers=admin_headers).status_code == 404
