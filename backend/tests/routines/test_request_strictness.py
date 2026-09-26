"""Request bodies are strict (``schemas/base.py``: ``CamelIn``): no ``"yes"`` for ``true``, no
``true`` for 1, no strings or ``3.0`` for integers, no strings or booleans for numbers. ISO dates
and UUIDs still parse from their JSON strings. A refused body writes nothing.
"""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.routines.support import body, error, events_since, revision

TODAY = "2026-10-05"  # a BD3: the returns routine runs today


def _refused(client: TestClient, method: str, url: str, payload: Any, field: str) -> None:
    seq = revision(client)
    response = client.request(method, url, json=payload)
    assert response.status_code == 422, response.text
    assert (error(response)["code"], error(response)["field"]) == ("VALIDATION_ERROR", field)
    assert events_since(client, seq) == []


@pytest.mark.parametrize("value", ["yes", "true", 1, 0])
def test_booleans_must_be_true_or_false(client: TestClient, value: Any) -> None:
    _refused(client, "PUT", f"/api/routines/r-ret/runs/{TODAY}", {"completed": value}, "completed")
    _refused(
        client, "PATCH", "/api/routines/r-man", {"coTagWithProject": value}, "coTagWithProject"
    )
    _refused(client, "PATCH", "/api/settings", {"serifDisplay": value}, "serifDisplay")


def test_a_real_boolean_still_works(client: TestClient) -> None:
    out = body(client.put(f"/api/routines/r-ret/runs/{TODAY}", json={"completed": True}))
    assert out["entity"]["completed"] is True


@pytest.mark.parametrize("value", [True, "10", 10.0, 10.5])
def test_integers_must_be_json_integers(client: TestClient, value: Any) -> None:
    _refused(client, "PATCH", "/api/routines/r-man", {"bd": value}, "bd")
    _refused(client, "PATCH", "/api/projects/ret", {"confidence": value}, "confidence")


@pytest.mark.parametrize("value", [True, False, "1"])
def test_integer_literals_refuse_booleans_and_strings(client: TestClient, value: Any) -> None:
    _refused(client, "PATCH", "/api/routines/r-man", {"stage": value}, "stage")
    _refused(client, "PATCH", "/api/projects/ret", {"phase": value}, "phase")


@pytest.mark.parametrize("value", [True, "2", "2.5"])
def test_numbers_must_be_json_numbers(client: TestClient, value: Any) -> None:
    _refused(client, "PATCH", "/api/routines/r-man", {"hours": value}, "hours")
    _refused(client, "POST", "/api/projects/ret/replan", {"rate": value}, "rate")


def test_integers_are_fine_where_a_number_is_expected(client: TestClient) -> None:
    assert body(client.patch("/api/routines/r-man", json={"hours": 2}))["entity"]["hours"] == 2
    assert body(client.patch("/api/routines/r-man", json={"bd": 10}))["entity"]["rule"]["bd"] == 10


def test_nested_models_are_strict_too(client: TestClient) -> None:
    segment = {"country": "Germany", "code": "DE", "lengthBd": "5", "pass": "Build"}
    _refused(
        client, "PUT", "/api/rotation/segments", {"segments": [segment]}, "segments.0.lengthBd"
    )
    change = {"type": "confidence", "projectId": "ret", "value": "3"}
    response = client.post("/api/checkins/preview", json={"changes": [change]})
    assert response.status_code == 422, response.text


@pytest.mark.parametrize("value", [20261005, "2026-10-05T00:00:00", "5 Oct 2026", True])
def test_dates_must_be_iso_strings(client: TestClient, value: Any) -> None:
    _refused(client, "POST", "/api/notes", {"day": value, "text": "Probe"}, "day")
    _refused(client, "PATCH", "/api/projects/ret", {"targetDate": value}, "targetDate")


def test_iso_dates_and_uuids_still_parse_from_json(client: TestClient) -> None:
    note = client.post("/api/notes", json={"day": TODAY, "text": "Probe"})
    assert note.status_code == 201, note.text
    assert body(note)["entity"]["day"] == TODAY
    target = body(client.patch("/api/projects/ret", json={"targetDate": "2026-12-04"}))
    assert target["entity"]["targetDate"] == "2026-12-04"
    parse_id = str(uuid.uuid4())
    parsed = client.post(
        "/api/checkins/parse-simple", json={"text": "Returns BAU is done", "parseId": parse_id}
    )
    assert parsed.status_code == 200, parsed.text
    assert body(parsed)["parseId"] == parse_id
    _refused(
        client,
        "POST",
        "/api/checkins/parse-simple",
        {"text": "x", "parseId": "not-a-uuid"},
        "parseId",
    )
