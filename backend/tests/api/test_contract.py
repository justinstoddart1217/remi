"""The OpenAPI document matches the frozen route table exactly."""

from typing import Any

import pytest
from fastapi import FastAPI

from app.core.clock import FixedClock
from app.core.config import RemiConfig
from tests.api.conftest import build_app
from tests.api.routes_table import DEV_ROUTES, ROUTES, Route

HTTP_METHODS = {"get", "post", "put", "patch", "delete"}


def _spec(app: FastAPI) -> dict[str, Any]:
    return app.openapi()


def _schema_name(schema: dict[str, Any] | None) -> str | None:
    if not schema:
        return None
    if "$ref" in schema:
        return str(schema["$ref"]).rsplit("/", 1)[-1]
    if schema.get("type") == "array":
        return f"list[{_schema_name(schema['items'])}]"
    return str(schema.get("type"))


def _operations(spec: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    ops: dict[tuple[str, str], dict[str, Any]] = {}
    for path, item in spec["paths"].items():
        for method, op in item.items():
            if method in HTTP_METHODS:
                ops[(method.upper(), path)] = op
    return ops


def _request_schema(op: dict[str, Any]) -> str | None:
    body = op.get("requestBody")
    if body is None:
        return None
    content = body["content"]
    media = "application/json" if "application/json" in content else "multipart/form-data"
    return _schema_name(content[media]["schema"])


def _success(op: dict[str, Any]) -> tuple[int, str | None]:
    statuses = [s for s in op["responses"] if s.startswith("2")]
    assert len(statuses) == 1, statuses
    status = statuses[0]
    content = op["responses"][status].get("content", {})
    if "application/json" in content:
        return int(status), _schema_name(content["application/json"]["schema"])
    if "text/html" in content:
        return int(status), "html"
    return int(status), None


def test_every_route_is_in_the_contract_and_nothing_else(app: FastAPI) -> None:
    expected = {(r.method, "/api" + r.path) for r in (*ROUTES, *DEV_ROUTES)}
    actual = set(_operations(_spec(app)))
    assert actual - expected == set(), "routes missing from tests/api/routes_table.py"
    assert expected - actual == set(), "routes in the table but not served"


@pytest.mark.parametrize("route", ROUTES + DEV_ROUTES, ids=lambda r: f"{r.method} {r.path}")
def test_route_shape(app: FastAPI, route: Route) -> None:
    op = _operations(_spec(app))[(route.method, "/api" + route.path)]
    assert _request_schema(op) == route.request
    assert _success(op) == (route.status, route.response)
    assert op["tags"] == [route.tag]
    assert op.get("summary"), "every route has a summary"


def test_operation_ids_are_unique_snake_case(app: FastAPI) -> None:
    ids = [op["operationId"] for op in _operations(_spec(app)).values()]
    assert len(ids) == len(set(ids))
    for op_id in ids:
        assert op_id.isidentifier() and op_id == op_id.lower(), op_id


def test_path_and_query_parameters_are_camel_case(app: FastAPI) -> None:
    for (method, path), op in _operations(_spec(app)).items():
        for param in op.get("parameters", []):
            if param["in"] == "header":
                continue
            assert "_" not in param["name"], f"{method} {path}: {param['name']}"


def test_dev_fixtures_route_is_not_mounted_in_prod(
    prod_config: RemiConfig, clock: FixedClock
) -> None:
    app = build_app(prod_config, clock)
    ops = _operations(app.openapi())
    assert ("POST", "/api/dev/fixtures") not in ops
    assert len(ops) == len(ROUTES)


def test_install_api_is_idempotent(app: FastAPI, config: RemiConfig) -> None:
    from app.api.router import install_api

    before = len(_operations(app.openapi()))
    middleware = len(app.user_middleware)
    install_api(app, config)
    app.openapi_schema = None
    assert len(_operations(app.openapi())) == before
    assert len(app.user_middleware) == middleware
