"""A fresh install starts empty and needs setup (ADR-0006), through the real app lifespan."""

from fastapi.testclient import TestClient


def test_fresh_start_has_no_projects_and_needs_setup(client: TestClient) -> None:
    assert client.get("/api/setup").json()["needsSetup"] is True
    home = client.get("/api/home").json()
    assert (home["projectCount"], home["routineCount"], home["keyProject"]) == (0, 0, None)
    plan = client.get("/api/plan")
    assert plan.status_code == 409
    assert plan.json()["error"]["code"] == "SETUP_REQUIRED"
    assert client.get("/api/settings").json()["aiProvider"] == "none"
