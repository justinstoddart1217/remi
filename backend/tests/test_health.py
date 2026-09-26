from fastapi.testclient import TestClient

from remi import __version__


def test_health_identifies_remi(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"app": "remi", "version": __version__}


def test_openapi_contract_is_served_as_json(client: TestClient) -> None:
    response = client.get("/api/openapi.json")

    assert response.status_code == 200
    assert "/api/health" in response.json()["paths"]


def test_cdn_backed_doc_pages_are_disabled(client: TestClient) -> None:
    # Swagger UI and ReDoc load assets from a CDN; Remi never serves them.
    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404
    assert client.get("/api/docs").status_code == 404
