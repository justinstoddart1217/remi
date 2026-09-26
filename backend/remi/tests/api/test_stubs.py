"""Every contract route answers a valid request with 501 ``NOT_IMPLEMENTED`` in the envelope.

The sample requests double as a check that each request model accepts the documented shape.
As services land, their routes stop returning 501 and drop out of ``STUBS`` automatically.
"""

import importlib
import inspect
import pkgutil

import pytest
from fastapi import APIRouter
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from remi.api import endpoints
from remi.tests.api.routes_table import (
    BODIES,
    CHART_FILE,
    DEV_ROUTES,
    QUERIES,
    ROUTES,
    Route,
    concrete_path,
)


def _endpoint_routes() -> dict[tuple[str, str], APIRoute]:
    """Every route declared by an ``remi.api.endpoints`` module, keyed by (method, path)."""
    found: dict[tuple[str, str], APIRoute] = {}
    for info in pkgutil.iter_modules(endpoints.__path__):
        module = importlib.import_module(f"{endpoints.__name__}.{info.name}")
        router = getattr(module, "router", None)
        if not isinstance(router, APIRouter):
            continue
        for route in router.routes:
            if isinstance(route, APIRoute):
                for method in route.methods or ():
                    found[(method, route.path)] = route
    return found


_ENDPOINTS = _endpoint_routes()


def _is_stub(method: str, path: str) -> bool:
    """A route is still a stub while its handler body calls ``not_implemented()``.

    Detected from the handler source, so service owners never edit this file.
    """
    route = _ENDPOINTS.get((method, path))
    assert route is not None, f"route {method} {path} is not declared by any endpoint module"
    return "not_implemented(" in inspect.getsource(route.endpoint)


STUBS = tuple(
    r for r in (*ROUTES, *DEV_ROUTES) if r.path != "/health" and _is_stub(r.method, r.path)
)


@pytest.mark.parametrize("route", STUBS, ids=lambda r: f"{r.method} {r.path}")
def test_stub_returns_501_envelope(client: TestClient, route: Route) -> None:
    key = (route.method, route.path)
    if key == ("POST", "/textbook/charts"):
        response = client.post(concrete_path(route.path), files={"file": CHART_FILE})
    else:
        body = BODIES.get(key)
        if route.request is not None:
            assert body is not None, f"add a sample body for {key}"
        response = client.request(
            route.method,
            concrete_path(route.path),
            params=QUERIES.get(key),
            json=body,
        )

    assert response.status_code == 501, response.text
    assert response.headers["content-type"] == "application/json"
    error = response.json()["error"]
    assert error["code"] == "NOT_IMPLEMENTED"
    assert error["message"]
    assert error["field"] is None


def test_health_still_answers(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["app"] == "remi"
