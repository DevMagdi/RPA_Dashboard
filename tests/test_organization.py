"""Single-organization installation: branding, platform, guard rails."""

from __future__ import annotations


def test_organization_singleton_read(client, admin_headers):
    response = client.get("/api/organization", headers=admin_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["OrganizationID"] == 1
    assert body["Name"]
    assert "stats" in body


def test_organization_requires_auth(client):
    assert client.get("/api/organization").status_code == 401


def test_organization_admin_only(client, user_headers):
    assert client.get("/api/organization", headers=user_headers()).status_code == 403


def test_no_multi_org_provisioning_endpoint(client, admin_headers):
    """There is exactly one organization per installation — no creation API."""
    assert client.post("/api/organization", json={"Name": "Second"}, headers=admin_headers).status_code in (404, 405)


def test_update_branding(client, admin_headers):
    response = client.patch(
        "/api/organization/branding",
        json={"PrimaryColor": "#123456", "CompanyName": "Bank RPA CoE"},
        headers=admin_headers,
    )
    assert response.status_code == 200, response.text
    org = client.get("/api/organization", headers=admin_headers).json()
    assert org["BrandPrimaryColor"] == "#123456"


def test_branding_is_public_for_login_screen(client):
    response = client.get("/api/branding")
    assert response.status_code == 200
    assert response.json()["api_version"] == "4.0.0"


def test_configure_platform_and_read_back(client, admin_headers):
    configured = client.post(
        "/api/organization/platform",
        json={"Provider": "uipath", "Config": {"base_url": "https://uipath.bank.local", "auth_mode": "pat"}},
        headers=admin_headers,
    )
    assert configured.status_code == 200, configured.text
    read = client.get("/api/organization/platform", headers=admin_headers)
    assert read.status_code == 200
    assert read.json()["provider"] == "uipath"


def test_platform_secret_values_rejected(client, admin_headers):
    """Raw secrets must never be stored in the platform config (vault refs only)."""
    response = client.post(
        "/api/organization/platform",
        json={"Provider": "uipath", "Config": {"client_secret": "plain-text-secret"}},
        headers=admin_headers,
    )
    assert response.status_code == 400


def test_unknown_provider_rejected(client, admin_headers):
    response = client.post(
        "/api/organization/platform",
        json={"Provider": "not-a-vendor", "Config": {}},
        headers=admin_headers,
    )
    assert response.status_code == 400


def test_platform_test_responds(client, admin_headers):
    response = client.post("/api/organization/platform/test", headers=admin_headers)
    assert response.status_code == 200


def test_retention_run(client, admin_headers):
    response = client.post("/api/organization/retention/run?retention_days=730", headers=admin_headers)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "success"


def test_providers_catalogue(client, admin_headers):
    response = client.get("/api/organization/meta/providers", headers=admin_headers)
    assert response.status_code == 200
    providers = {row["provider"] for row in response.json()}
    assert {"generic_sql", "uipath", "automation_anywhere", "blue_prism"} <= providers


def test_alerts_endpoints(client, admin_headers):
    assert client.get("/api/alerts", headers=admin_headers).status_code == 200
    assert client.get("/api/alerts/count", headers=admin_headers).status_code == 200
    evaluated = client.post("/api/alerts/evaluate", headers=admin_headers)
    assert evaluated.status_code == 200
    assert "touched" in evaluated.json()
