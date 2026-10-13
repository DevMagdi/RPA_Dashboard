"""Capacity Advisor API."""

from __future__ import annotations


def test_capacity_insights(client, admin_headers):
    response = client.get("/api/capacity/insights", headers=admin_headers)
    assert response.status_code == 200
    assert "summary" in response.json()


def test_capacity_utilization(client, admin_headers):
    response = client.get("/api/capacity/utilization", headers=admin_headers)
    assert response.status_code == 200


def test_generate_recommendations(client, admin_headers):
    response = client.post("/api/capacity/generate", headers=admin_headers)
    assert response.status_code == 200
    assert response.json().get("generated", 0) >= 1


def test_recommendations_persisted(client, admin_headers):
    client.post("/api/capacity/generate", headers=admin_headers)
    response = client.get("/api/capacity/recommendations", headers=admin_headers)
    assert response.status_code == 200
    assert len(response.json()) >= 1


def test_recommendation_status_transition(client, admin_headers):
    client.post("/api/capacity/generate", headers=admin_headers)
    recommendations = client.get("/api/capacity/recommendations", headers=admin_headers).json()
    assert recommendations
    first = recommendations[0]
    rec_id = first.get("RecommendationID") or first.get("id")
    response = client.post(
        f"/api/capacity/recommendations/{rec_id}/status", json={"Status": "Requested"}, headers=admin_headers
    )
    assert response.status_code == 200


def test_capacity_history(client, admin_headers):
    response = client.get("/api/capacity/history?days=30", headers=admin_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_capacity_requires_auth(client):
    assert client.get("/api/capacity/insights").status_code == 401


def test_viewer_cannot_generate(client, user_headers):
    response = client.post("/api/capacity/generate", headers=user_headers("Viewer"))
    assert response.status_code == 403
