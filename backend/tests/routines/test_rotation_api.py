"""``/rotation``: the Fixed Income rotation on the design seed (starts with the move, Mon 4 Jan
2027; 10 Build segments of 46 BD ending Mon 8 Mar, then a 3 BD Germany refresh)."""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.routines.support import body, error, events_since, load_ids, one_event, revision

SEGMENT_IDS = [f"rot-{i}" for i in range(11)]


def _segments(client: TestClient) -> list[dict[str, Any]]:
    return body(client.get("/api/rotation"))["segments"]


def _as_input(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": s["id"],
            "country": s["country"],
            "code": s["code"],
            "lengthBd": s["lengthBd"],
            "pass": s["pass"],
        }
        for s in segments
    ]


def test_get_rotation(client: TestClient) -> None:
    rotation = body(client.get("/api/rotation"))
    assert [s["id"] for s in rotation["segments"]] == SEGMENT_IDS
    assert (rotation["totalBd"], rotation["loopBd"], rotation["loopEnd"]) == (
        49,
        46,
        "2027-03-08",
    )
    assert rotation["refresh"] == {"start": "2027-03-09", "end": "2027-03-11"}
    assert (rotation["startDate"], rotation["startFollowsMove"]) == ("2027-01-04", True)
    assert rotation["current"]["status"] == "waiting"
    assert rotation == body(client.get("/api/plan"))["rotation"]


def test_rotation_needs_setup(fresh_client: TestClient) -> None:
    for response in (
        fresh_client.get("/api/rotation"),
        fresh_client.patch("/api/rotation", json={"hoursPerDay": 3}),
        fresh_client.put("/api/rotation/segments", json={"segments": []}),
    ):
        assert response.status_code == 409
        assert error(response)["code"] == "SETUP_REQUIRED"


def test_patch_hours_title_and_start(client: TestClient) -> None:
    seq = revision(client)
    out = body(client.patch("/api/rotation", json={"hoursPerDay": 3, "title": " FI rotation "}))
    assert (out["entity"]["hoursPerDay"], out["entity"]["title"]) == (3, "FI rotation")
    germany = next(i for i in out["plan"]["loads"]["2027-01-04"]["items"] if i["refId"] == "rot-0")
    assert germany["h"] == 3
    assert one_event(client, seq)["type"] == "rotation.updated"

    # A Saturday start rolls forward to Monday.
    moved = body(client.patch("/api/rotation", json={"startDate": "2027-01-09"}))["entity"]
    assert (moved["startDate"], moved["startFollowsMove"]) == ("2027-01-11", False)
    assert moved["segments"][0]["start"] == "2027-01-11"
    plan = body(client.get("/api/plan"))
    assert "rot-0" not in load_ids(plan, "2027-01-04")
    assert "rot-0" in load_ids(plan, "2027-01-11")

    back = body(client.patch("/api/rotation", json={"startDate": None}))["entity"]
    assert (back["startDate"], back["startFollowsMove"]) == ("2027-01-04", True)


@pytest.mark.parametrize(
    ("patch", "field"),
    [
        ({"title": "   "}, "title"),
        ({"title": None}, "title"),
        ({"hoursPerDay": None}, "hoursPerDay"),
        ({"hoursPerDay": 25}, "hoursPerDay"),
        ({"startDate": "2099-01-05"}, "startDate"),
        ({"bogus": 1}, "bogus"),
    ],
)
def test_patch_validation(client: TestClient, patch: dict[str, Any], field: str) -> None:
    seq = revision(client)
    response = client.patch("/api/rotation", json=patch)
    assert response.status_code == 422, response.text
    assert error(response)["field"] == field
    assert events_since(client, seq) == []


def test_replace_segments_keeps_ids_and_renumbers_loops(client: TestClient) -> None:
    current = _as_input(_segments(client))
    # Drop the refresh, swap France and Germany, add a new Build segment at the end.
    wanted = [current[1], current[0], *current[2:10]]
    wanted.append({"country": "Denmark", "code": "DK", "lengthBd": 2, "pass": "Build"})
    seq = revision(client)
    response = client.put("/api/rotation/segments", json={"segments": wanted})
    assert response.status_code == 200, response.text
    rotation = body(response)["entity"]
    segments = rotation["segments"]
    assert [s["id"] for s in segments[:10]] == [SEGMENT_IDS[1], SEGMENT_IDS[0], *SEGMENT_IDS[2:10]]
    assert segments[10]["code"] == "DK"
    assert segments[10]["id"] not in SEGMENT_IDS
    assert [s["order"] for s in segments] == list(range(11))
    assert {s["loop"] for s in segments} == {1}
    assert (rotation["totalBd"], rotation["loopBd"], rotation["refresh"]) == (48, 48, None)
    assert segments[0]["start"] == "2027-01-04"
    assert segments[0]["country"] == "France"
    event = one_event(client, seq)
    assert event["type"] == "rotation.segments_replaced"
    assert event["payload"]["effects"] == {"segments": 11}


def test_a_build_after_the_refresh_leaves_loop_one_alone(client: TestClient) -> None:
    """Loop 1 is the first Build pass only (the prototype's ``ROT.slice(0, 10)``)."""
    wanted = [
        *_as_input(_segments(client)),
        {"country": "Greece", "code": "GR", "lengthBd": 3, "pass": "Build"},
    ]
    rotation = body(client.put("/api/rotation/segments", json={"segments": wanted}))["entity"]
    assert [s["loop"] for s in rotation["segments"]] == [1] * 10 + [2, 3]
    assert (rotation["totalBd"], rotation["loopBd"], rotation["loopEnd"]) == (
        52,
        46,
        "2027-03-08",
    )
    assert rotation["refresh"] == {"start": "2027-03-09", "end": "2027-03-11"}
    assert rotation["segments"][-1]["end"] == "2027-03-16"


def test_empty_rotation(client: TestClient) -> None:
    rotation = body(client.put("/api/rotation/segments", json={"segments": []}))["entity"]
    assert rotation["segments"] == []
    assert rotation["current"]["status"] == "none"
    assert "rot-0" not in load_ids(body(client.get("/api/plan")), "2027-01-04")


def test_segment_ids_must_be_known_and_unique(client: TestClient) -> None:
    current = _as_input(_segments(client))
    seq = revision(client)
    unknown = [*current[:2], {**current[2], "id": "nope"}]
    response = client.put("/api/rotation/segments", json={"segments": unknown})
    assert response.status_code == 422
    assert error(response)["field"] == "segments.2.id"
    twice = [current[0], current[0]]
    response = client.put("/api/rotation/segments", json={"segments": twice})
    assert response.status_code == 422
    assert error(response)["field"] == "segments.1.id"
    blank = [{**current[0], "country": "  "}]
    response = client.put("/api/rotation/segments", json={"segments": blank})
    assert response.status_code == 422
    assert error(response)["field"] == "segments.0.country"
    assert events_since(client, seq) == []
    assert [s["id"] for s in _segments(client)] == SEGMENT_IDS


def test_rotation_past_the_calendar_is_refused(client: TestClient) -> None:
    seq = revision(client)
    huge = [
        {"country": "Germany", "code": "DE", "lengthBd": 130, "pass": "Build"} for _ in range(60)
    ]
    response = client.put("/api/rotation/segments", json={"segments": huge})
    assert response.status_code == 422, response.text
    assert (error(response)["code"], error(response)["field"]) == ("OUT_OF_RANGE", "segments")
    # Checked before any widening: not even a holidays.generated event is written.
    assert events_since(client, seq) == []
    assert [s["id"] for s in _segments(client)] == SEGMENT_IDS
    assert client.get("/api/plan").status_code == 200


def test_a_rotation_that_fits_widens_the_calendar_as_it_needs(client: TestClient) -> None:
    seq = revision(client)
    long = [{"country": "Germany", "code": "DE", "lengthBd": 130, "pass": "Build"}] * 10
    rotation = body(client.put("/api/rotation/segments", json={"segments": long}))["entity"]
    assert (rotation["totalBd"], rotation["segments"][-1]["end"]) == (1300, "2032-02-20")
    types = [e["type"] for e in events_since(client, seq)]
    assert types[-1] == "rotation.segments_replaced"
    assert set(types[:-1]) <= {"holidays.generated"}


def test_a_start_past_the_calendar_is_refused(client: TestClient) -> None:
    seq = revision(client)
    response = client.patch("/api/rotation", json={"startDate": "2036-12-01"})
    assert response.status_code == 422, response.text
    assert (error(response)["code"], error(response)["field"]) == ("OUT_OF_RANGE", "segments")
    assert events_since(client, seq) == []
    rotation = body(client.patch("/api/rotation", json={"startDate": "2036-06-02"}))["entity"]
    assert (rotation["startDate"], rotation["segments"][-1]["end"]) == (
        "2036-06-02",
        "2036-08-07",
    )


def test_a_move_date_that_pushes_the_rotation_past_the_calendar_is_refused(
    client: TestClient,
) -> None:
    """The rotation follows the move, so a late move date is checked as a late start is."""
    seq = revision(client)
    response = client.patch("/api/settings", json={"moveDate": "2036-12-01"})
    assert response.status_code == 422, response.text
    assert (error(response)["code"], error(response)["field"]) == ("OUT_OF_RANGE", "moveDate")
    assert events_since(client, seq) == []
    assert body(client.get("/api/settings"))["moveDate"] == "2027-01-04"

    moved = body(client.patch("/api/settings", json={"moveDate": "2036-06-02"}))
    assert moved["entity"]["moveDate"] == "2036-06-02"
    assert moved["plan"]["rotation"]["segments"][-1]["end"] == "2036-08-07"

    # A rotation with its own start does not follow the move, so the late move is accepted.
    body(client.patch("/api/rotation", json={"startDate": "2027-01-04"}))
    late = body(client.patch("/api/settings", json={"moveDate": "2036-12-01"}))
    assert late["entity"]["moveDate"] == "2036-12-01"
    assert late["plan"]["rotation"]["segments"][-1]["end"] == "2027-03-11"


def test_the_horizon_holds_once_the_plan_calendar_reaches_past_it(client: TestClient) -> None:
    """The plan's calendar runs to the year after the move, so once a 2036 move is stored it
    already covers 2037. A rotation that would end there is still refused, with no event."""
    moved = body(client.patch("/api/settings", json={"moveDate": "2036-06-02"}))
    assert moved["plan"]["rotation"]["segments"][-1]["end"] == "2036-08-07"
    seq = revision(client)

    late_start = client.patch("/api/rotation", json={"startDate": "2036-12-15"})
    assert late_start.status_code == 422, late_start.text
    assert (error(late_start)["code"], error(late_start)["field"]) == ("OUT_OF_RANGE", "segments")

    late_move = client.patch("/api/settings", json={"moveDate": "2036-12-02"})
    assert late_move.status_code == 422, late_move.text
    assert (error(late_move)["code"], error(late_move)["field"]) == ("OUT_OF_RANGE", "moveDate")

    extra = {"country": "Germany", "code": "DE", "lengthBd": 130, "pass": "Refresh"}
    longer = [*_as_input(_segments(client)), extra]
    more = client.put("/api/rotation/segments", json={"segments": longer})
    assert more.status_code == 422, more.text
    assert (error(more)["code"], error(more)["field"]) == ("OUT_OF_RANGE", "segments")

    assert events_since(client, seq) == []
    assert body(client.get("/api/settings"))["moveDate"] == "2036-06-02"
    rotation = body(client.get("/api/rotation"))
    assert (rotation["startFollowsMove"], rotation["segments"][-1]["end"]) == (True, "2036-08-07")

    # A pinned start lets a late move in; following that move again is then refused.
    body(client.patch("/api/rotation", json={"startDate": "2036-06-02"}))
    body(client.patch("/api/settings", json={"moveDate": "2036-12-01"}))
    seq = revision(client)
    follow = client.patch("/api/rotation", json={"startDate": None})
    assert follow.status_code == 422, follow.text
    assert (error(follow)["code"], error(follow)["field"]) == ("OUT_OF_RANGE", "segments")
    assert events_since(client, seq) == []


def test_setup_refuses_a_rotation_past_the_calendar(fresh_client: TestClient) -> None:
    huge = [{"country": "Germany", "code": "DE", "lengthBd": 130, "pass": "Build"}] * 60
    response = fresh_client.post(
        "/api/setup",
        json={
            "moveDate": "2027-01-04",
            "timezone": "Europe/London",
            "holidayRegion": "GB-ENG",
            "capacityHoursPerDay": 8,
            "rotation": {"hoursPerDay": 4, "segments": huge},
        },
    )
    assert response.status_code == 422, response.text
    assert (error(response)["code"], error(response)["field"]) == ("OUT_OF_RANGE", "segments")
    assert events_since(fresh_client, 0) == []
    assert body(fresh_client.get("/api/setup"))["needsSetup"] is True
