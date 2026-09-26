"""The error envelope: ``{"error": {"code", "message", "field"}}`` for every ``/api`` failure."""

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.errors import ApiError, error_responses, install_error_handlers, not_implemented
from app.core.errors import DomainError, NotFound, SetupRequired, VersionConflict
from app.schemas.base import CamelIn
from tests.api.conftest import BASE_URL


class _Body(CamelIn):
    work_left: float


class _ListBody(CamelIn):
    day_hours: list[float]


@pytest.fixture
def mini_client() -> Iterator[TestClient]:
    """A bare app with only the error handlers, to test each mapping in isolation."""
    app = FastAPI()
    install_error_handlers(app)

    @app.get("/api/domain")
    def domain() -> None:  # pyright: ignore[reportUnusedFunction]
        raise DomainError("SOMETHING_OFF", "Something is off.", "moveDate", 422)

    @app.get("/api/not-found")
    def not_found() -> None:  # pyright: ignore[reportUnusedFunction]
        raise NotFound("No such project.", "projectId")

    @app.get("/api/setup-required")
    def setup_required() -> None:  # pyright: ignore[reportUnusedFunction]
        raise SetupRequired()

    @app.get("/api/version")
    def version() -> None:  # pyright: ignore[reportUnusedFunction]
        raise VersionConflict()

    @app.get("/api/api-error")
    def api_error() -> None:  # pyright: ignore[reportUnusedFunction]
        raise ApiError(403, "NOPE", "Not allowed.")

    @app.get("/api/stub")
    def stub() -> None:  # pyright: ignore[reportUnusedFunction]
        not_implemented()

    @app.get("/api/boom")
    def boom() -> None:  # pyright: ignore[reportUnusedFunction]
        raise RuntimeError("secret detail that must not leak")

    @app.post("/api/body")
    def body(payload: _Body) -> None:  # pyright: ignore[reportUnusedFunction]
        return None

    @app.post("/api/list-body")
    def list_body(payload: _ListBody) -> None:  # pyright: ignore[reportUnusedFunction]
        return None

    @app.get("/elsewhere")
    def elsewhere() -> None:  # pyright: ignore[reportUnusedFunction]
        return None

    test_client = TestClient(app, base_url=BASE_URL, raise_server_exceptions=False)
    yield test_client
    test_client.close()


def _error(response_json: object) -> dict[str, object]:
    assert isinstance(response_json, dict)
    assert set(response_json) == {"error"}  # pyright: ignore[reportUnknownArgumentType]
    error = response_json["error"]  # pyright: ignore[reportUnknownVariableType]
    assert isinstance(error, dict)
    assert set(error) == {"code", "message", "field"}  # pyright: ignore[reportUnknownArgumentType]
    return error  # pyright: ignore[reportUnknownVariableType]


def test_domain_error_keeps_code_field_and_status(mini_client: TestClient) -> None:
    response = mini_client.get("/api/domain")
    assert response.status_code == 422
    assert _error(response.json()) == {
        "code": "SOMETHING_OFF",
        "message": "Something is off.",
        "field": "moveDate",
    }


@pytest.mark.parametrize(
    ("path", "status", "code"),
    [
        ("/api/not-found", 404, "NOT_FOUND"),
        ("/api/setup-required", 409, "SETUP_REQUIRED"),
        ("/api/version", 409, "VERSION_CONFLICT"),
        ("/api/api-error", 403, "NOPE"),
        ("/api/stub", 501, "NOT_IMPLEMENTED"),
    ],
)
def test_error_subclasses_map_to_their_status(
    mini_client: TestClient, path: str, status: int, code: str
) -> None:
    response = mini_client.get(path)
    assert response.status_code == status
    assert _error(response.json())["code"] == code


def test_unexpected_errors_are_500_without_details(mini_client: TestClient) -> None:
    response = mini_client.get("/api/boom")
    assert response.status_code == 500
    error = _error(response.json())
    assert error["code"] == "INTERNAL_ERROR"
    assert "secret" not in response.text


def test_body_validation_names_the_camel_case_field(mini_client: TestClient) -> None:
    response = mini_client.post("/api/body", json={"workLeft": "lots"})
    assert response.status_code == 422
    error = _error(response.json())
    assert error["code"] == "VALIDATION_ERROR"
    assert error["field"] == "workLeft"


def test_unknown_body_keys_are_rejected(mini_client: TestClient) -> None:
    response = mini_client.post("/api/body", json={"workLeft": 3, "bogus": 1})
    assert response.status_code == 422
    assert _error(response.json())["field"] == "bogus"


def test_unknown_api_path_is_a_json_404(client: TestClient) -> None:
    response = client.get("/api/definitely-not-a-route")
    assert response.status_code == 404
    assert response.headers["content-type"] == "application/json"
    assert _error(response.json())["code"] == "NOT_FOUND"


def test_unknown_api_path_is_a_json_404_for_mutations_too(client: TestClient) -> None:
    response = client.post("/api/definitely-not-a-route", json={})
    assert response.status_code == 404
    assert _error(response.json())["code"] == "NOT_FOUND"


def test_wrong_method_is_a_json_405(client: TestClient) -> None:
    response = client.patch("/api/health", json={})
    assert response.status_code == 405
    assert _error(response.json())["code"] == "METHOD_NOT_ALLOWED"


def test_non_api_paths_keep_default_http_errors(mini_client: TestClient) -> None:
    response = mini_client.get("/not-api-and-missing")
    assert response.status_code == 404
    assert "error" not in response.json()


def test_path_parameter_validation(client: TestClient) -> None:
    response = client.get("/api/day/2026-13-45")
    assert response.status_code == 422
    error = _error(response.json())
    assert error["code"] == "VALIDATION_ERROR"
    assert error["field"] == "iso"


def test_query_parameter_validation(client: TestClient) -> None:
    response = client.get("/api/month-snapshot", params={"month": "2026-13"})
    assert response.status_code == 422
    assert _error(response.json())["field"] == "month"


def test_enum_validation_on_create(client: TestClient) -> None:
    response = client.post("/api/projects", json={"domain": "equities"})
    assert response.status_code == 422
    assert _error(response.json())["field"] == "domain"


def test_replan_needs_exactly_one_input(client: TestClient) -> None:
    response = client.post("/api/projects/p-1/replan", json={"rate": 4, "workLeft": 10})
    assert response.status_code == 422
    assert _error(response.json())["code"] == "VALIDATION_ERROR"


def test_error_responses_helper_uses_the_envelope() -> None:
    responses = error_responses(404, 422)
    assert set(responses) == {404, 422}
    assert all(r["model"].__name__ == "ErrorOut" for r in responses.values())


# ---------------------------------------------------------------- whole-body validation errors
JSON_HEADERS = {"content-type": "application/json"}


@pytest.mark.parametrize(
    ("content", "message"),
    [
        ("{bad", "The request body is not valid JSON."),
        ('{"workLeft": 3,}', "The request body is not valid JSON."),
        ("", "A JSON request body is required."),
        ("null", "A JSON request body is required."),
        ("[1, 2]", "The request body must be a JSON object."),
        ('"text"', "The request body must be a JSON object."),
    ],
)
def test_whole_body_errors_name_no_field(
    mini_client: TestClient, content: str, message: str
) -> None:
    response = mini_client.post("/api/body", content=content, headers=JSON_HEADERS)
    assert response.status_code == 422
    assert _error(response.json()) == {
        "code": "VALIDATION_ERROR",
        "message": message,
        "field": None,
    }


def test_malformed_json_on_a_real_route_names_no_field(client: TestClient) -> None:
    # The JSON decoder reports the character offset (loc ("body", 1)); that is not a field.
    response = client.post("/api/projects", content="{bad", headers=JSON_HEADERS)
    assert response.status_code == 422
    error = _error(response.json())
    assert error["code"] == "VALIDATION_ERROR"
    assert error["field"] is None
    assert error["message"] == "The request body is not valid JSON."


def test_list_item_errors_keep_the_index_in_the_field(mini_client: TestClient) -> None:
    response = mini_client.post("/api/list-body", json={"dayHours": [1, "lots"]})
    assert response.status_code == 422
    error = _error(response.json())
    assert error["field"] == "dayHours.1"
    assert str(error["message"]).startswith("dayHours.1: ")
