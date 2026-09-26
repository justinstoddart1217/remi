"""The OpenAPI document is valid, self-contained and stays local."""

import json
import re
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

HTTP_METHODS = {"get", "post", "put", "patch", "delete"}
CAMEL = re.compile(r"^[a-z][A-Za-z0-9]*$")


@pytest.fixture
def spec(app: FastAPI) -> dict[str, Any]:
    return app.openapi()


def _walk(node: Any) -> Iterator[tuple[str, Any]]:
    if isinstance(node, dict):
        for key, value in node.items():  # pyright: ignore[reportUnknownVariableType]
            yield str(key), value  # pyright: ignore[reportUnknownArgumentType]
            yield from _walk(value)
    elif isinstance(node, list):
        for item in node:  # pyright: ignore[reportUnknownVariableType]
            yield from _walk(item)


def test_openapi_version_and_info(spec: dict[str, Any]) -> None:
    assert spec["openapi"].startswith("3.1")
    assert spec["info"]["title"] == "Remi"


def test_every_ref_resolves(spec: dict[str, Any]) -> None:
    schemas = spec["components"]["schemas"]
    refs = [value for key, value in _walk(spec) if key == "$ref"]
    assert refs
    for ref in refs:
        assert ref.startswith("#/components/schemas/"), ref
        assert ref.rsplit("/", 1)[-1] in schemas, ref


def test_every_path_parameter_is_declared(spec: dict[str, Any]) -> None:
    for path, item in spec["paths"].items():
        placeholders = set(re.findall(r"{([^}]+)}", path))
        for method, op in item.items():
            if method not in HTTP_METHODS:
                continue
            declared = {p["name"] for p in op.get("parameters", []) if p["in"] == "path"}
            assert declared == placeholders, f"{method} {path}"


def test_errors_use_the_envelope_everywhere(spec: dict[str, Any]) -> None:
    schemas = spec["components"]["schemas"]
    assert "HTTPValidationError" not in schemas
    assert "ValidationError" not in schemas
    for path, item in spec["paths"].items():
        for method, op in item.items():
            if method not in HTTP_METHODS:
                continue
            for status, response in op["responses"].items():
                if status.startswith(("4", "5")):
                    schema = response["content"]["application/json"]["schema"]
                    assert schema == {"$ref": "#/components/schemas/ErrorOut"}, (
                        f"{method} {path} {status}"
                    )


def test_routes_with_inputs_document_422(spec: dict[str, Any]) -> None:
    for path, item in spec["paths"].items():
        for method, op in item.items():
            if method in HTTP_METHODS and (op.get("parameters") or op.get("requestBody")):
                assert "422" in op["responses"], f"{method} {path}"


def test_one_schema_per_model(spec: dict[str, Any]) -> None:
    # Shared request/response models (changes, blocks) must not split into -Input/-Output.
    names = spec["components"]["schemas"]
    assert not [n for n in names if n.endswith(("-Input", "-Output"))]


def test_property_names_are_camel_case(spec: dict[str, Any]) -> None:
    for name, schema in spec["components"]["schemas"].items():
        for prop in schema.get("properties", {}):
            assert CAMEL.match(prop), f"{name}.{prop}"


def test_response_models_declare_every_key(spec: dict[str, Any]) -> None:
    # Out models always send every key (null when empty), so TS response types have no `?`.
    for name, schema in spec["components"]["schemas"].items():
        if name.endswith("Out") and "properties" in schema:
            assert set(schema.get("required", [])) == set(schema["properties"]), name


def test_discriminated_unions(spec: dict[str, Any]) -> None:
    schemas = spec["components"]["schemas"]
    change = schemas["PreviewRequest"]["properties"]["changes"]["items"]
    assert change["discriminator"]["propertyName"] == "type"
    assert set(change["discriminator"]["mapping"]) == {
        "task_done",
        "task_add",
        "scope_add",
        "blocker",
        "confidence",
        "target_move",
        "hours_per_day",
        "note",
        "bau_done",
    }
    block = schemas["BlocksPut"]["properties"]["blocks"]["items"]
    assert set(block["discriminator"]["mapping"]) == {
        "p",
        "h1",
        "h2",
        "h3",
        "bullet",
        "callout",
        "formula",
        "page",
        "chart",
        "divider",
    }


def test_mutation_out_shape(spec: dict[str, Any]) -> None:
    schemas = spec["components"]["schemas"]
    assert set(schemas["MutationOut"]["properties"]) == {"plan", "movements"}
    assert set(schemas["ProjectMutationOut"]["properties"]) == {"plan", "movements", "entity"}
    assert set(schemas["Movement"]["properties"]) >= {
        "projectId",
        "fromForecast",
        "toForecast",
        "deltaBd",
        "cause",
        "label",
    }


def test_plan_out_has_every_section(spec: dict[str, Any]) -> None:
    plan = spec["components"]["schemas"]["PlanOut"]
    assert set(plan["properties"]) == {
        "revision",
        "today",
        "settings",
        "calendar",
        "loads",
        "projects",
        "routines",
        "rotation",
        "move",
        "verdict",
        "flags",
        "aliases",
        "counts",
    }


def test_the_api_key_is_write_only(spec: dict[str, Any]) -> None:
    schemas = spec["components"]["schemas"]
    key = schemas["AiKeyPut"]["properties"]["apiKey"]
    assert key.get("writeOnly") is True
    for name, schema in schemas.items():
        if name != "AiKeyPut":
            assert "apiKey" not in schema.get("properties", {}), name


def test_no_external_urls_or_cdn(spec: dict[str, Any]) -> None:
    text = json.dumps(spec)
    assert not re.search(r"https?://", text), "the contract must not point off the machine"
    for marker in ("swagger", "redoc", "cdn.jsdelivr", "unpkg", "googleapis"):
        assert marker not in text.lower()


@pytest.mark.parametrize(
    "path", ["/docs", "/redoc", "/api/docs", "/api/redoc", "/docs/oauth2-redirect"]
)
def test_cdn_backed_doc_pages_are_not_served(client: TestClient, path: str) -> None:
    response = client.get(path)
    assert response.status_code == 404
    assert "swagger" not in response.text.lower()


def test_openapi_json_is_served_locally(client: TestClient) -> None:
    response = client.get("/api/openapi.json")
    assert response.status_code == 200
    assert "/api/plan" in response.json()["paths"]
