"""``/api/projects``: create, read, edit, re-plan, delete and the data-only hour rules.

Runs on the design seed (today Mon 5 Oct 2026). Every successful mutation records exactly one
event (``Api.call`` checks it); every refused one records none (``Api.error``).
"""

from typing import Any

import pytest

from app.services.projects import MIN_HOURS
from tests.projects.helpers import Api

TODAY = "2026-10-05"


# ---------------------------------------------------------------------------- create
@pytest.mark.parametrize(("domain", "exit_routes"), [("pc", []), ("fi", None)])
def test_create_starts_in_define_with_the_defaults(
    api: Api, domain: str, exit_routes: list[str] | None
) -> None:
    before = {p["id"] for p in api.plan()["projects"]}
    out = api.call("POST", "/projects", {"domain": domain}, status=201)
    entity = out["entity"]
    assert entity["id"] not in before
    assert (entity["name"], entity["short"]) == ("Untitled project", "Untitled project")
    assert entity["domain"] == domain
    assert (entity["goal"], entity["whyNow"], entity["laterIntent"]) == ("", "", "")
    assert entity["endName"] == "Done"
    assert entity["startDate"] == TODAY
    assert entity["targetDate"] == "2026-11-16"  # today + 30 business days (Settings)
    assert entity["targetLabel"] is None
    assert entity["forecastDate"] is None  # ADR-0007: Define, no invented forecast
    assert entity["prevForecastDate"] is None
    assert (entity["rate"], entity["rateAfterMove"], entity["baselineHours"]) == (0, 0, 0)
    assert entity["confidence"] is None
    assert entity["lastCheckinDate"] is None
    assert entity["phase"] == 0
    assert entity["exitRoutes"] == exit_routes
    assert entity["bauDayHours"] == {}
    assert entity["derived"]["status"] == "define"
    assert out["movements"] == []
    ids = [p["id"] for p in out["plan"]["projects"] if p["domain"] == domain]
    assert ids[-1] == entity["id"]  # appended to the end of its group


def test_create_takes_a_name(api: Api) -> None:
    entity = api.call("POST", "/projects", {"domain": "fi", "name": "  Curve tool  "}, 201)[
        "entity"
    ]
    assert (entity["name"], entity["short"]) == ("Curve tool", "Curve tool")


def test_create_before_setup_is_409(bare: Api) -> None:
    error = bare.error("POST", "/projects", {"domain": "pc"}, 409)
    assert error["code"] == "SETUP_REQUIRED"


def test_create_refuses_an_unknown_domain(api: Api) -> None:
    error = api.error("POST", "/projects", {"domain": "eq"}, 422)
    assert error["field"] == "domain"


# ---------------------------------------------------------------------------- read
def test_list_and_get_come_from_the_plan(api: Api) -> None:
    listed = api.client.get("/api/projects").json()
    assert [p["id"] for p in listed] == ["ret", "manco", "play", "fion", "alpha"]
    one = api.client.get("/api/projects/ret").json()
    assert one == listed[0]
    assert one["derived"]["deltaBd"] == 3  # golden: ret +3 BD and at risk
    assert one["derived"]["status"] == "risk"
    missing = api.client.get("/api/projects/nope")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "NOT_FOUND"


def test_reads_before_setup_are_409(bare: Api) -> None:
    for path in ("/api/projects", "/api/projects/ret", "/api/projects/ret/snapshots"):
        response = bare.client.get(path)
        assert response.status_code == 409, path
        assert response.json()["error"]["code"] == "SETUP_REQUIRED"


def test_snapshots_are_oldest_first(api: Api) -> None:
    snaps = api.client.get("/api/projects/ret/snapshots").json()
    assert snaps
    assert [s["date"] for s in snaps] == sorted(s["date"] for s in snaps)
    assert api.client.get("/api/projects/nope/snapshots").status_code == 404


# ---------------------------------------------------------------------------- edit
def test_patch_text_fields(api: Api) -> None:
    body = {
        "name": "Returns engine",
        "goal": "  All twelve funds in minutes.  ",
        "whyNow": "Line one\nline two",
        "laterIntent": "Hand it over",
        "endName": "Handover-ready",
    }
    entity = api.call("PATCH", "/projects/ret", body)["entity"]
    assert entity["name"] == "Returns engine"
    assert entity["short"] == "Returns engine"  # name also sets short unless short is sent
    assert entity["goal"] == "All twelve funds in minutes."
    assert entity["whyNow"] == "Line one\nline two"
    assert entity["laterIntent"] == "Hand it over"
    entity = api.call("PATCH", "/projects/ret", {"name": "Returns", "short": "Ret"})["entity"]
    assert (entity["name"], entity["short"]) == ("Returns", "Ret")


def test_patch_target_snaps_clears_the_label_and_logs_the_move(api: Api) -> None:
    out = api.call("PATCH", "/projects/ret", {"targetDate": "2026-11-28"})  # a Saturday
    entity = out["entity"]
    assert entity["targetDate"] == "2026-11-30"
    assert entity["derived"]["deltaBd"] == 2
    (movement,) = out["movements"]
    assert movement["cause"] == "target"
    assert (movement["fromTarget"], movement["toTarget"]) == ("2026-11-27", "2026-11-30")
    assert movement["flash"] is False  # the forecast did not move
    item = api.feed()[0]
    assert item["projectId"] == "ret"
    assert (item["kind"], item["delta"], item["title"]) == ("edit", "Target", "Returns pipeline")
    assert item["body"] == "Target moved Fri 27 Nov → Mon 30 Nov."
    assert item["day"] == TODAY


def test_patch_target_uses_the_fuzzy_label_in_the_feed(api: Api) -> None:
    assert api.project("alpha")["targetLabel"] == "Late Mar 2027"
    entity = api.call("PATCH", "/projects/alpha", {"targetDate": "2027-04-01"})["entity"]
    assert entity["targetDate"] == "2027-04-01"
    assert entity["targetLabel"] is None
    assert api.feed()[0]["body"] == "Target moved Late Mar 2027 → Thu 1 Apr."


def test_patch_to_the_same_target_is_a_no_op(api: Api) -> None:
    feed_before = api.feed()
    out = api.call("PATCH", "/projects/ret", {"targetDate": "2026-11-27"})
    assert out["movements"] == []
    assert api.feed() == feed_before


def test_patch_data_only_fields(api: Api) -> None:
    body: dict[str, Any] = {
        "confidence": 2,
        "readiness": 0.75,
        "blocker": "Waiting on the admin",
        "afterDayOneNote": "Starts in March",
        "baselineHours": 70,
        "rateAfterMove": 0.5,
        "phase": 3,
        "exitRoutes": ["Hand over"],
        "targetLabel": "Late Nov",
    }
    entity = api.call("PATCH", "/projects/ret", body)["entity"]
    for key, value in body.items():
        assert entity[key] == value, key
    assert api.feed()[0]["body"] == "Phase moved Run → Close."
    cleared = api.call(
        "PATCH",
        "/projects/ret",
        {"confidence": None, "blocker": None, "targetLabel": None, "readiness": None},
    )["entity"]
    assert (cleared["confidence"], cleared["blocker"], cleared["targetLabel"]) == (
        None,
        None,
        None,
    )
    assert cleared["readiness"] is None


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"name": None}, "name"),
        ({"name": "   "}, "name"),
        ({"targetDate": None}, "targetDate"),
        ({"rateAfterMove": 0.01}, "rateAfterMove"),
        ({"exitRoutes": ["Stop", "Stop"]}, "exitRoutes"),
        ({"confidence": 6}, "confidence"),
        ({"shortName": "x"}, "shortName"),
    ],
)
def test_patch_refuses_bad_values(api: Api, body: dict[str, Any], field: str) -> None:
    error = api.error("PATCH", "/projects/ret", body, 422)
    assert error["field"] == field


def test_exit_routes_are_private_credit_only(api: Api) -> None:
    error = api.error("PATCH", "/projects/fion", {"exitRoutes": ["Finish"]}, 422)
    assert error["field"] == "exitRoutes"


def test_patch_an_unknown_project_is_404(api: Api) -> None:
    assert api.error("PATCH", "/projects/nope", {"goal": "x"}, 404)["code"] == "NOT_FOUND"


# ---------------------------------------------------------------------------- delete
def test_delete_cascades_and_clears_the_key_links(api: Api) -> None:
    assert api.plan()["settings"]["keyProjectId"] == "ret"
    out = api.call("DELETE", "/projects/ret")
    assert "entity" not in out
    plan = out["plan"]
    assert [p["id"] for p in plan["projects"]] == ["manco", "play", "fion", "alpha"]
    assert plan["settings"]["keyProjectId"] is None
    r_ret = next(r for r in plan["routines"] if r["id"] == "r-ret")
    assert r_ret["projectId"] is None
    assert all(a["entityId"] != "ret" for a in plan["aliases"])
    assert all(item["projectId"] != "ret" for item in api.feed())
    assert api.client.get("/api/projects/ret").status_code == 404
    assert api.client.get("/api/projects/ret/snapshots").status_code == 404


def test_deleting_the_last_project_is_allowed(api: Api) -> None:
    for pid in ("ret", "manco", "play", "fion", "alpha"):
        out = api.call("DELETE", f"/projects/{pid}")
    assert out["plan"]["projects"] == []
    assert out["plan"]["verdict"]["state"] == "no_pc"


def test_delete_an_unknown_project_is_404(api: Api) -> None:
    assert api.error("DELETE", "/projects/nope", None, 404)["code"] == "NOT_FOUND"


# ---------------------------------------------------------------------------- replan
def test_replan_rate_refits_with_the_same_work_left(api: Api) -> None:
    work_left = api.project("ret")["derived"]["workLeft"]
    out = api.call("POST", "/projects/ret/replan", {"rate": 3.8})  # the golden "need" rate
    entity = out["entity"]
    assert entity["rate"] == 3.8
    assert entity["forecastDate"] == "2026-11-27"  # lands on the target
    assert entity["prevForecastDate"] == "2026-12-02"
    # the same hours, placed at the new rate (the last day may take a little more)
    assert work_left <= entity["derived"]["workLeft"] < work_left + 3.8
    (movement,) = out["movements"]
    assert (movement["cause"], movement["deltaBd"], movement["label"]) == (
        "rate",
        -3,
        "\N{MINUS SIGN}3 BD",
    )


def test_replan_work_left_gives_a_define_project_its_first_forecast(api: Api) -> None:
    created = api.call("POST", "/projects", {"domain": "pc"}, 201)["entity"]
    out = api.call("POST", f"/projects/{created['id']}/replan", {"workLeft": 10})
    entity = out["entity"]
    assert entity["rate"] == 1  # a zero rate plans at 1h a day
    assert entity["forecastDate"] == "2026-10-16"  # 10 business days from today
    assert entity["derived"]["status"] == "on"
    (movement,) = out["movements"]
    assert movement["cause"] == "work_left"
    assert movement["fromForecast"] is None


def test_replan_start_snaps_forward(api: Api) -> None:
    out = api.call("POST", "/projects/ret/replan", {"startDate": "2026-10-10"})
    assert out["entity"]["startDate"] == "2026-10-12"
    (movement,) = out["movements"]
    assert movement["cause"] == "start"
    assert movement["deltaBd"] > 0


@pytest.mark.parametrize(
    ("body", "field", "code"),
    [
        ({"rate": 0}, "rate", "VALIDATION_FAILED"),  # a planned project needs hours a day
        ({"rate": MIN_HOURS / 5}, "rate", "VALIDATION_FAILED"),
        ({"rate": 25}, "rate", "VALIDATION_ERROR"),
        ({"rate": 3, "workLeft": 10}, None, "VALIDATION_ERROR"),
        ({"workLeft": -1}, "workLeft", "VALIDATION_ERROR"),
        ({"startDate": "2199-01-01"}, "startDate", "OUT_OF_RANGE"),
    ],
)
def test_replan_refuses(api: Api, body: dict[str, Any], field: str | None, code: str) -> None:
    error = api.error("POST", "/projects/ret/replan", body, 422)
    assert error["code"] == code
    if field is not None:
        assert error["field"] == field


def test_replan_that_would_shrink_rules_below_the_floor_is_422(api: Api) -> None:
    # A rate edit rescales the BAU-day hours: ret's 2h ManCo-day rule at 0.05h a day (from
    # 3.5h) would be 0.029h, below the 0.05h floor.
    error = api.error("POST", "/projects/ret/replan", {"rate": 0.05}, 422)
    assert error["field"] == "rate"


def test_replan_preview_equals_the_replan_and_saves_nothing(api: Api) -> None:
    revision = api.plan()["revision"]
    preview = api.client.post("/api/projects/ret/replan/preview", json={"rate": 4})
    assert preview.status_code == 200, preview.text
    shown = preview.json()
    assert api.plan()["revision"] == revision
    assert api.project("ret")["rate"] == 3.5
    entity = api.call("POST", "/projects/ret/replan", {"rate": 4})["entity"]
    assert shown["toForecast"] == entity["forecastDate"] == "2026-11-25"  # ADR-0007 golden
    assert shown["fromForecast"] == "2026-12-02"
    assert shown["deltaBd"] == -5
    assert shown["rate"] == entity["rate"]
    assert shown["derived"] == entity["derived"]


def test_replan_preview_errors(api: Api) -> None:
    response = api.client.post("/api/projects/nope/replan/preview", json={"rate": 4})
    assert response.status_code == 404
    response = api.client.post("/api/projects/ret/replan/preview", json={"rate": 0})
    assert response.status_code == 422
    assert response.json()["error"]["field"] == "rate"  # as the replan itself says


# ---------------------------------------------------------------------------- hour rules
def test_bau_day_hours_keep_the_work_left_and_move_the_forecast(api: Api) -> None:
    # ret loses 1h on each ManCo pack day (2h -> 1h): the 144h of work left are placed again,
    # so the forecast moves later instead of the work left dropping (ADR-0007). As with a rate
    # edit, the new forecast day counts in full, so the work left can grow by up to a day.
    before = api.project("ret")
    assert before["derived"]["workLeft"] == pytest.approx(144)
    body = {"rules": [{"routineId": "r-ret", "hours": 0}, {"routineId": "r-man", "hours": 1}]}
    out = api.call("PUT", "/projects/ret/bau-day-hours", body)
    entity = out["entity"]
    assert entity["bauDayHours"] == {"r-ret": 0, "r-man": 1}
    assert 144 <= entity["derived"]["workLeft"] < 144 + 3.5
    assert entity["forecastDate"] > before["forecastDate"]
    assert [(m["projectId"], m["cause"]) for m in out["movements"]] == [("ret", "bau_day_hours")]
    cleared = api.call("PUT", "/projects/ret/bau-day-hours", {"rules": []})["entity"]
    assert cleared["bauDayHours"] == {}
    assert cleared["derived"]["workLeft"] >= entity["derived"]["workLeft"]


@pytest.mark.parametrize(
    ("rules", "status", "field"),
    [
        ([{"routineId": "r-x", "hours": 1}], 404, "rules.0.routineId"),
        ([{"routineId": "r-ret", "hours": 1}, {"routineId": "r-ret", "hours": 2}], 422, None),
        ([{"routineId": "r-ret", "hours": 0.02}], 422, "rules.0.hours"),
    ],
)
def test_bau_day_hours_refusals(
    api: Api, rules: list[dict[str, Any]], status: int, field: str | None
) -> None:
    error = api.error("PUT", "/projects/ret/bau-day-hours", {"rules": rules}, status)
    if field is not None:
        assert error["field"] == field


def test_overrides_set_and_clear(api: Api) -> None:
    # 2h instead of 3.5h on Tue 6 Oct: the 144h of work left go on past Wed 2 Dec and Thu
    # 3 Dec (a BD3 with 0h for ret) to Fri 4 Dec, which counts in full (146h).
    before = api.project("ret")
    out = api.call("PUT", "/projects/ret/overrides/2026-10-06", {"hours": 2})
    entity = out["entity"]
    assert entity["overrides"] == {**before["overrides"], "2026-10-06": 2}
    assert (entity["prevForecastDate"], entity["forecastDate"]) == ("2026-12-02", "2026-12-04")
    assert entity["derived"]["workLeft"] == pytest.approx(146)
    assert [(m["projectId"], m["cause"]) for m in out["movements"]] == [("ret", "override")]
    assert entity["derived"]["dayHours"]["2026-10-06"] == 2
    # Clearing it keeps those 146h, which still end on Fri 4 Dec (147.5h with the 1.5h back).
    entity = api.call("DELETE", "/projects/ret/overrides/2026-10-06")["entity"]
    assert entity["overrides"] == before["overrides"]
    assert entity["forecastDate"] == "2026-12-04"
    assert entity["derived"]["workLeft"] == pytest.approx(147.5)
    again = api.call("DELETE", "/projects/ret/overrides/2026-10-06")  # idempotent
    assert again["entity"]["overrides"] == before["overrides"]
    assert again["movements"] == []


def test_an_override_of_zero_on_the_forecast_day_moves_the_forecast_off_it(api: Api) -> None:
    # The forecast never stays on a day that lost its hours (refits stay idempotent).
    entity = api.call("PUT", "/projects/ret/overrides/2026-12-02", {"hours": 0})["entity"]
    assert entity["forecastDate"] == "2026-12-04"
    assert entity["derived"]["workLeft"] == pytest.approx(144)  # 2 Dec's 3.5h move to 4 Dec
    left = entity["derived"]["workLeft"]
    preview = api.client.post("/api/projects/ret/replan/preview", json={"workLeft": left})
    assert preview.json()["toForecast"] == "2026-12-04"


def test_override_floor_and_unknown_project(api: Api) -> None:
    error = api.error("PUT", "/projects/ret/overrides/2026-10-06", {"hours": 0.04}, 422)
    assert error["field"] == "hours"
    api.error("PUT", "/projects/nope/overrides/2026-10-06", {"hours": 1}, 404)
    api.error("DELETE", "/projects/nope/overrides/2026-10-06", None, 404)
