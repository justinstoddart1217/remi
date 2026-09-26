"""``/routines``: create, edit, remove, occurrences, on the design seed (today Mon 5 Oct 2026)."""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.routines.support import (
    body,
    error,
    events_since,
    load_ids,
    one_event,
    project,
    revision,
    routine,
    rows,
)


def _patch(client: TestClient, routine_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    response = client.patch(f"/api/routines/{routine_id}", json=patch)
    assert response.status_code == 200, response.text
    return body(response)


# ---------------------------------------------------------------------------- reads
def test_list_and_get_routines(client: TestClient) -> None:
    routines = rows(client.get("/api/routines"))
    assert [r["id"] for r in routines] == ["r-ret", "r-man"]
    ret = body(client.get("/api/routines/r-ret"))
    assert ret["short"] == "Returns"
    assert ret["rule"] == {"kind": "monthly", "bd": 3, "weekday": 2}
    assert [o["iso"] for o in ret["derived"]["next"]] == ["2026-10-05", "2026-11-04", "2026-12-03"]
    assert ret == routines[0]


def test_get_unknown_routine_is_404(client: TestClient) -> None:
    response = client.get("/api/routines/nope")
    assert response.status_code == 404
    assert error(response)["code"] == "NOT_FOUND"


def test_routine_reads_need_setup(fresh_client: TestClient) -> None:
    for path in ("/api/routines", "/api/routines/r-ret", "/api/routines/r-ret/occurrences"):
        response = fresh_client.get(path)
        assert response.status_code == 409, path
        assert error(response)["code"] == "SETUP_REQUIRED"


def test_occurrences_next_and_range(client: TestClient) -> None:
    upcoming = rows(client.get("/api/routines/r-ret/occurrences"))
    assert [(o["iso"], o["bdm"], o["today"], o["bdAway"]) for o in upcoming] == [
        ("2026-10-05", 3, True, 0),
        ("2026-11-04", 3, False, 22),
        ("2026-12-03", 3, False, 43),
    ]
    after = rows(
        client.get("/api/routines/r-man/occurrences", params={"after": "2026-12-11", "limit": 2})
    )
    assert [(o["iso"], o["afterMove"]) for o in after] == [
        ("2027-01-13", True),
        ("2027-02-10", True),
    ]
    in_range = rows(
        client.get(
            "/api/routines/r-ret/occurrences", params={"from": "2026-10-01", "to": "2026-12-31"}
        )
    )
    assert [o["iso"] for o in in_range] == ["2026-10-05", "2026-11-04", "2026-12-03"]


def test_occurrences_validation(client: TestClient) -> None:
    only_from = client.get("/api/routines/r-ret/occurrences", params={"from": "2026-10-01"})
    assert only_from.status_code == 422
    assert error(only_from)["field"] == "to"
    backwards = client.get(
        "/api/routines/r-ret/occurrences", params={"from": "2026-12-01", "to": "2026-10-01"}
    )
    assert backwards.status_code == 422
    far = client.get("/api/routines/r-ret/occurrences", params={"after": "2099-01-01"})
    assert far.status_code == 422
    assert error(far)["code"] == "OUT_OF_RANGE"
    assert client.get("/api/routines/nope/occurrences").status_code == 404


# ---------------------------------------------------------------------------- create
def test_create_uses_the_design_defaults(client: TestClient) -> None:
    seq = revision(client)
    response = client.post("/api/routines", json={})
    assert response.status_code == 201, response.text
    out = body(response)
    entity = out["entity"]
    assert entity["domain"] == "pc"
    assert (entity["name"], entity["short"], entity["detail"]) == ("", "", "")
    assert entity["rule"] == {"kind": "monthly", "bd": 5, "weekday": 2}
    assert (entity["hours"], entity["stage"], entity["projectId"]) == (1.0, 0, None)
    assert entity["sortOrder"] == 2
    assert [o["iso"] for o in entity["derived"]["next"]] == [
        "2026-10-07",
        "2026-11-06",
        "2026-12-07",
    ]
    assert routine(out["plan"], entity["id"]) == entity
    assert out["movements"] == []
    # BD5 (Wed 7 Oct) now carries the new routine's hour.
    assert entity["id"] in load_ids(out["plan"], "2026-10-07")
    event = one_event(client, seq)
    assert event["type"] == "routine.created"
    assert event["refs"] == [{"type": "routine", "id": entity["id"]}]


def test_create_with_a_name_sets_the_short(client: TestClient) -> None:
    entity = body(client.post("/api/routines", json={"name": "  Cash recs ", "domain": "fi"}))[
        "entity"
    ]
    assert (entity["name"], entity["short"], entity["domain"]) == ("Cash recs", "Cash recs", "fi")


def test_a_new_routine_is_not_overdue_for_runs_before_it_existed(
    fresh_client: TestClient,
) -> None:
    # Set up on Mon 5 Oct (BD3) and add a daily routine and a monthly BD1 routine: their runs
    # on Thu 1 and Fri 2 Oct were never planned, so they are not due, overdue or loaded.
    setup = {
        "moveDate": "2027-01-04",
        "timezone": "Europe/London",
        "holidayRegion": "GB-ENG",
        "capacityHoursPerDay": 8,
    }
    assert fresh_client.post("/api/setup", json=setup).status_code == 201
    daily = body(fresh_client.post("/api/routines", json={"name": "Daily reconciliation"}))
    daily_id = daily["entity"]["id"]
    _patch(fresh_client, daily_id, {"kind": "daily"})
    monthly_id = body(fresh_client.post("/api/routines", json={"name": "Month-end close"}))[
        "entity"
    ]["id"]
    _patch(fresh_client, monthly_id, {"bd": 1})

    snap = body(fresh_client.get("/api/month-snapshot", params={"month": "2026-10"}))
    assert snap["totals"]["late"] == 0
    assert min(r["due"] for r in snap["rows"]) == "2026-10-05"
    daily_rows = [r for r in snap["rows"] if r["routineId"] == daily_id]
    assert daily_rows[0]["due"] == "2026-10-05"
    assert len(daily_rows) == 20  # 5 to 30 Oct
    assert [r for r in snap["rows"] if r["routineId"] == monthly_id] == []
    assert snap["totals"]["total"] == 20
    loads = body(fresh_client.get("/api/loads", params={"from": "2026-10-01", "to": "2026-10-05"}))
    assert daily_id not in [i["refId"] for i in loads["loads"]["2026-10-02"]["items"]]
    assert daily_id in [i["refId"] for i in loads["loads"]["2026-10-05"]["items"]]
    # Next month's BD1 is due as usual.
    november = body(fresh_client.get("/api/month-snapshot", params={"month": "2026-11"}))
    assert [r["due"] for r in november["rows"] if r["routineId"] == monthly_id] == ["2026-11-02"]


def test_create_needs_setup(fresh_client: TestClient) -> None:
    response = fresh_client.post("/api/routines", json={})
    assert response.status_code == 409
    assert error(response)["code"] == "SETUP_REQUIRED"


# ---------------------------------------------------------------------------- patch
def test_rename_keeps_a_curated_short(client: TestClient) -> None:
    out = _patch(client, "r-ret", {"name": "Fund returns run"})
    entity = out["entity"]
    assert (entity["name"], entity["short"]) == ("Fund returns run", "Returns")


def test_rename_moves_a_blank_or_mirrored_short(client: TestClient) -> None:
    new_id = body(client.post("/api/routines", json={}))["entity"]["id"]
    first = _patch(client, new_id, {"name": " Cash reconciliation "})["entity"]
    assert (first["name"], first["short"]) == ("Cash reconciliation", "Cash reconciliation")
    second = _patch(client, new_id, {"name": "Cash recs"})["entity"]
    assert second["short"] == "Cash recs"
    curated = _patch(client, new_id, {"short": "Cash"})["entity"]
    assert curated["short"] == "Cash"
    third = _patch(client, new_id, {"name": "Daily cash reconciliation"})["entity"]
    assert third["short"] == "Cash"
    blank_short = _patch(client, new_id, {"short": "  "})["entity"]
    assert blank_short["short"] == "Daily cash reconciliation"


def test_blank_name_is_allowed(client: TestClient) -> None:
    entity = _patch(client, "r-man", {"name": ""})["entity"]
    assert entity["name"] == ""
    assert entity["short"] == "ManCo pack"


def test_the_timeline_label_is_curated_data(client: TestClient) -> None:
    """``RoutineOut.label``: the design's shortened Timeline row label (``Timeline.dc.html:309``);
    ``null`` shows the name. A rename clears it unless the same patch sends one."""
    plan = body(client.get("/api/plan"))
    labels = {r["id"]: r["label"] for r in plan["routines"]}
    assert labels == {"r-ret": "Fund & security returns", "r-man": None}

    assert _patch(client, "r-man", {"label": " ManCo "})["entity"]["label"] == "ManCo"
    assert _patch(client, "r-man", {"label": "   "})["entity"]["label"] is None
    assert _patch(client, "r-man", {"label": "ManCo"})["entity"]["label"] == "ManCo"
    assert _patch(client, "r-man", {"label": None})["entity"]["label"] is None

    renamed = _patch(client, "r-ret", {"name": "Fund returns"})["entity"]
    assert (renamed["name"], renamed["label"]) == ("Fund returns", None)
    both = _patch(client, "r-ret", {"name": "Returns", "label": "All returns"})["entity"]
    assert (both["name"], both["label"]) == ("Returns", "All returns")
    same = _patch(client, "r-ret", {"name": "Returns", "short": "Ret"})["entity"]
    assert same["label"] == "All returns"  # the name did not change


def test_hours_clamp_to_capacity(client: TestClient) -> None:
    """Any value from 0 is clamped to the settings capacity, as the prototype's field is."""
    assert _patch(client, "r-man", {"hours": 12})["entity"]["hours"] == 8
    assert _patch(client, "r-man", {"hours": 99})["entity"]["hours"] == 8
    assert _patch(client, "r-man", {"hours": 1e6})["entity"]["hours"] == 8
    assert _patch(client, "r-man", {"hours": 1.5})["entity"]["hours"] == 1.5
    assert _patch(client, "r-man", {"hours": 0})["entity"]["hours"] == 0


def test_moving_a_routine_day_moves_its_load(client: TestClient) -> None:
    before = body(client.get("/api/plan"))
    assert "r-man" in load_ids(before, "2026-10-12")
    forecasts = {p["id"]: p["forecastDate"] for p in before["projects"]}

    out = _patch(client, "r-man", {"bd": 10})
    plan = out["plan"]
    entity = out["entity"]
    assert entity["rule"]["bd"] == 10
    assert [o["iso"] for o in entity["derived"]["next"]] == [
        "2026-10-14",
        "2026-11-13",
        "2026-12-14",
    ]
    assert "r-man" not in load_ids(plan, "2026-10-12")
    assert "r-man" in load_ids(plan, "2026-10-14")
    # ADR-0007 "routine-r-man-bd10": the projects' BAU-day hours move with the pack, so only
    # 4 Nov stays overloaded, and no stored forecast moves.
    assert [(o["iso"], o["total"]) for o in plan["flags"]["upcomingOverloads"]] == [
        ("2026-11-04", 9.5)
    ]
    assert plan["loads"]["2026-10-14"]["total"] == 8
    assert plan["loads"]["2026-11-13"]["total"] == 8
    assert {p["id"]: p["forecastDate"] for p in plan["projects"]} == forecasts
    assert out["movements"] == []
    assert body(client.get("/api/plan"))["loads"] == plan["loads"]


def test_weekly_and_daily_rules(client: TestClient) -> None:
    weekly = _patch(client, "r-man", {"kind": "weekly", "weekday": 3})["entity"]
    assert [o["iso"] for o in weekly["derived"]["next"]] == [
        "2026-10-07",
        "2026-10-14",
        "2026-10-21",
    ]
    assert (weekly["derived"]["monthlyEffortH"], weekly["derived"]["monthlyEffortApprox"]) == (
        17.2,
        True,
    )
    daily = _patch(client, "r-man", {"kind": "daily"})["entity"]
    assert [o["iso"] for o in daily["derived"]["next"]] == [
        "2026-10-05",
        "2026-10-06",
        "2026-10-07",
    ]
    assert daily["derived"]["runsToday"] is True
    # The monthly business day is kept for a switch back.
    assert _patch(client, "r-man", {"kind": "monthly"})["entity"]["rule"]["bd"] == 8


def test_stage_change_logs_a_feed_item(client: TestClient) -> None:
    seq = revision(client)
    out = _patch(client, "r-man", {"stage": 2})
    assert out["entity"]["stage"] == 2
    event = one_event(client, seq)
    assert event["type"] == "routine.stage_changed"
    assert event["payload"]["effects"]["changed"] == {"stage": [1, 2]}
    newest = body(client.get("/api/feed"))["items"][0]
    assert newest["title"] == "Managing Committee pack"
    assert newest["body"] == "Handover status Automating → Shadowed."
    assert (newest["kind"], newest["delta"], newest["tone"]) == ("edit", "BAU", "quiet")
    assert (newest["routineId"], newest["projectId"], newest["day"]) == (
        "r-man",
        None,
        "2026-10-05",
    )


def test_stage_three_drops_the_routine_off_the_plan(client: TestClient) -> None:
    before = body(client.get("/api/plan"))
    assert "r-ret" in load_ids(before, "2026-10-05")
    assert routine(before, "r-ret")["derived"]["countsToday"] is True

    out = _patch(client, "r-ret", {"stage": 3})
    entity = out["entity"]
    assert entity["derived"]["handedOver"] is True
    assert entity["derived"]["countsToday"] is False
    # The dates still show (Routines :63); only the time comes off the plan.
    assert entity["derived"]["runsToday"] is True
    assert len(entity["derived"]["next"]) == 3
    plan = out["plan"]
    assert "r-ret" not in load_ids(plan, "2026-10-05")
    assert "r-ret" not in load_ids(plan, "2026-11-04")
    assert plan["loads"]["2026-10-05"]["bau"] < before["loads"]["2026-10-05"]["bau"]
    newest = body(client.get("/api/feed"))["items"][0]
    assert newest["title"] == "Fund & security-level returns"
    assert newest["body"] == ("Handover status Automating → Handed over. It drops off your plan.")


def test_same_stage_logs_no_feed_item(client: TestClient) -> None:
    before = body(client.get("/api/feed"))["items"]
    seq = revision(client)
    _patch(client, "r-ret", {"stage": 1})
    assert one_event(client, seq)["type"] == "routine.updated"
    assert body(client.get("/api/feed"))["items"] == before


def test_unnamed_stage_change_uses_routine_as_title(client: TestClient) -> None:
    new_id = body(client.post("/api/routines", json={}))["entity"]["id"]
    _patch(client, new_id, {"stage": 1})
    newest = body(client.get("/api/feed"))["items"][0]
    assert (newest["title"], newest["body"]) == ("Routine", "Handover status Manual → Automating.")


def test_notes_links_and_text_fields(client: TestClient) -> None:
    out = _patch(
        client,
        "r-man",
        {
            "statusNote": "  Commentary stays manual.  ",
            "detail": "Monthly pack",
            "transitionNote": "  ",
            "projectId": "play",
            "coTagWithProject": True,
        },
    )
    entity = out["entity"]
    assert entity["statusNote"] == "Commentary stays manual."
    assert entity["transitionNote"] is None
    assert (entity["projectId"], entity["coTagWithProject"]) == ("play", True)
    cleared = _patch(client, "r-man", {"projectId": None})["entity"]
    assert cleared["projectId"] is None


@pytest.mark.parametrize(
    ("patch", "status", "field"),
    [
        ({"projectId": "nope"}, 422, "projectId"),
        ({"name": None}, 422, "name"),
        ({"hours": None}, 422, "hours"),
        ({"stage": None}, 422, "stage"),
        ({"bd": 21}, 422, "bd"),
        ({"weekday": 6}, 422, "weekday"),
        ({"stage": 4}, 422, "stage"),
        ({"kind": "quarterly"}, 422, "kind"),
        ({"hours": -0.5}, 422, "hours"),
        ({"surprise": 1}, 422, "surprise"),
    ],
)
def test_patch_validation(
    client: TestClient, patch: dict[str, Any], status: int, field: str
) -> None:
    seq = revision(client)
    response = client.patch("/api/routines/r-ret", json=patch)
    assert response.status_code == status, response.text
    assert error(response)["field"] == field
    assert events_since(client, seq) == []


@pytest.mark.parametrize("raw", ["Infinity", "NaN"])
def test_hours_must_be_a_finite_number(client: TestClient, raw: str) -> None:
    response = client.patch(
        "/api/routines/r-man",
        content=f'{{"hours": {raw}}}',
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422, response.text
    assert error(response)["field"] == "hours"


def test_patch_unknown_routine_is_404(client: TestClient) -> None:
    response = client.patch("/api/routines/nope", json={"name": "x"})
    assert response.status_code == 404


# ---------------------------------------------------------------------------- delete
def test_delete_logs_removal_and_takes_its_rules(client: TestClient) -> None:
    before = body(client.get("/api/plan"))
    assert "r-man" in project(before, "ret")["bauDayHours"]
    assert any(a["entityId"] == "r-man" for a in before["aliases"])
    seq = revision(client)

    response = client.delete("/api/routines/r-man")
    assert response.status_code == 200, response.text
    plan = body(response)["plan"]
    assert "entity" not in body(response)
    assert [r["id"] for r in plan["routines"]] == ["r-ret"]
    assert "r-man" not in project(plan, "ret")["bauDayHours"]
    assert not any(a["entityId"] == "r-man" for a in plan["aliases"])
    assert "r-man" not in load_ids(plan, "2026-10-12")
    assert one_event(client, seq)["type"] == "routine.deleted"
    newest = body(client.get("/api/feed"))["items"][0]
    assert (newest["title"], newest["body"], newest["delta"]) == (
        "Managing Committee pack",
        "Routine removed from the plan.",
        "BAU",
    )
    assert client.get("/api/routines/r-man").status_code == 404


def test_deleting_the_key_routine_clears_the_setting(client: TestClient) -> None:
    assert body(client.get("/api/settings"))["keyRoutineId"] == "r-ret"
    plan = body(client.delete("/api/routines/r-ret"))["plan"]
    assert plan["settings"]["keyRoutineId"] is None


def test_delete_unnamed_routine_logs_nothing(client: TestClient) -> None:
    new_id = body(client.post("/api/routines", json={}))["entity"]["id"]
    before = body(client.get("/api/feed"))["items"]
    assert client.delete(f"/api/routines/{new_id}").status_code == 200
    assert body(client.get("/api/feed"))["items"] == before


def test_delete_unknown_routine_is_404(client: TestClient) -> None:
    seq = revision(client)
    assert client.delete("/api/routines/nope").status_code == 404
    assert events_since(client, seq) == []
