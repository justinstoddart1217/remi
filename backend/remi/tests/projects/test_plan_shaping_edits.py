"""Edits that change the hours per day or the calendar keep every forecast consistent.

ADR-0007's invariant, ``finish_for(from, work_left) == forecast``, must hold after every
mutation: the move date, the holiday region, holidays, routine rules and a project's own hour
rules re-place the work left each plan had before the change (``carry_work_left``), so work
left never changes silently and a forecast never sits on a day that lost its hours. Plus the
Fixed Income after-move rate, and the 0.05h..24h range of every stored hour figure.

The design seed: today Mon 5 Oct 2026, the move Mon 4 Jan 2027.
"""

from typing import Any

import pytest

from remi.tests.projects.helpers import JSON, Api

PARSE_ID = "5b0f7c0e-2d0c-4d0e-9a51-7f1f7c3b8a10"


def planned(api: Api) -> list[JSON]:
    return [p for p in api.plan()["projects"] if p["forecastDate"] is not None]


def assert_invariant(api: Api) -> None:
    """Re-entering each project's own work left changes nothing (refits are idempotent), and
    no forecast sits on a day without hours unless hours are unplaced."""
    for p in planned(api):
        left = p["derived"]["workLeft"]
        response = api.client.post(
            f"/api/projects/{p['id']}/replan/preview", json={"workLeft": left}
        )
        assert response.status_code == 200, response.text
        shown = response.json()
        assert (shown["toForecast"], shown["unplacedH"]) == (
            p["forecastDate"],
            pytest.approx(p["unplacedH"]),
        ), p["id"]
        if p["unplacedH"] == 0:
            assert p["derived"]["dayHours"].get(p["forecastDate"], 0) > 0, p["id"]


def work_left(api: Api) -> dict[str, float]:
    return {p["id"]: p["derived"]["workLeft"] for p in planned(api)}


# ---------------------------------------------------------------------------- the move date
def test_an_earlier_move_keeps_the_work_left_and_moves_the_forecasts(api: Api) -> None:
    before = work_left(api)
    assert before["ret"] == pytest.approx(144)
    out = api.call("PATCH", "/settings", {"moveDate": "2026-12-01"})
    moved = {m["projectId"]: m for m in out["movements"]}
    # Every Private Credit forecast moves, and fion too (its after-move rate starts earlier).
    assert set(moved) == {"ret", "manco", "play", "fion"}
    assert {m["cause"] for m in moved.values()} == {"settings"}
    # Private Credit hours stop at the new move: ret places 137h before it, and the 7h left
    # over are unplaced (they land after the move), not lost.
    ret = api.project("ret")
    assert (ret["forecastDate"], ret["unplacedH"]) == ("2026-12-01", pytest.approx(7))
    assert ret["derived"]["workLeft"] == pytest.approx(144)
    sentence = ret["derived"]["sentence"]
    assert (sentence["case"], sentence["params"]["cutH"]) == ("after_move", 7)
    assert work_left(api) == pytest.approx(before)
    assert api.plan()["verdict"]["state"] == "off_track"
    assert_invariant(api)
    # Moving it back restores every forecast: nothing was lost on the way.
    api.call("PATCH", "/settings", {"moveDate": "2027-01-04"})
    assert api.project("ret")["forecastDate"] == "2026-12-02"
    assert api.project("ret")["unplacedH"] == 0
    assert work_left(api) == pytest.approx(before)
    assert_invariant(api)


def test_a_later_move_places_hours_that_were_unplaced(api: Api) -> None:
    body = {
        "changes": [{"type": "scope_add", "projectId": "play", "text": "Extra", "hours": 16}],
        "source": "simple",
        "parseId": PARSE_ID,
    }
    api.call("POST", "/checkins/apply", body)
    play = api.project("play")
    assert (play["forecastDate"], play["unplacedH"]) == ("2027-01-04", 9)
    left = play["derived"]["workLeft"]
    out = api.call("PATCH", "/settings", {"moveDate": "2027-02-01"})
    play = api.project("play")
    assert play["unplacedH"] == 0
    assert "2027-01-04" < play["forecastDate"] < "2027-02-01"
    assert left <= play["derived"]["workLeft"] < left + 1
    assert "play" in {m["projectId"] for m in out["movements"]}
    verdict = api.plan()["verdict"]
    assert verdict["state"] != "off_track"
    assert play["derived"]["sentence"]["case"] != "after_move"
    assert_invariant(api)


def test_a_new_region_moves_forecasts_off_its_holidays(api: Api) -> None:
    before = work_left(api)
    api.call("PATCH", "/settings", {"holidayRegion": "ZA"})
    after = work_left(api)
    for pid, left in before.items():
        assert left - 1e-6 <= after[pid], pid
    assert_invariant(api)


# ---------------------------------------------------------------------------- holidays
def test_a_holiday_on_a_forecast_day_moves_the_forecast_off_it(api: Api) -> None:
    out = api.call("POST", "/holidays", {"date": "2026-12-02", "name": "Company day"}, 201)
    ret = api.project("ret")
    # Wed 2 Dec is now a holiday, so Thu 3 Dec is BD2 (3.5h for ret) and the returns run moves
    # to Fri 4 Dec. The 144h still end on Thu 3 Dec. Every project that had hours on 2 Dec
    # moves a day later instead of losing them from its work left.
    assert ret["forecastDate"] == "2026-12-03"
    assert ret["derived"]["workLeft"] == pytest.approx(144)
    moved = {m["projectId"]: m["cause"] for m in out["movements"]}
    assert moved == {"ret": "calendar", "manco": "calendar", "play": "calendar", "fion": "calendar"}
    assert_invariant(api)
    # A check-in preview now labels the real move honestly (no "±0 BD" for a day's slip).
    response = api.client.post(
        "/api/checkins/preview",
        json={"changes": [{"type": "scope_add", "projectId": "ret", "text": "x", "hours": 0.25}]},
    )
    (shown,) = response.json()["projects"]
    assert shown["from"] == "2026-12-03"
    assert shown["deltaBd"] > 0
    assert shown["label"] != "±0 BD"
    # Removing it places the same work left again.
    api.call("DELETE", "/holidays/2026-12-02")
    assert api.project("ret")["forecastDate"] == "2026-12-02"
    assert_invariant(api)


# ---------------------------------------------------------------------------- routines
def test_a_routine_day_move_onto_a_forecast_day_moves_the_forecast(api: Api) -> None:
    # ret has 0h on returns-run days. Moving the run from BD3 to BD2 puts it on Wed 2 Dec,
    # ret's forecast day: the forecast moves to Thu 3 Dec (now 3.5h for ret).
    out = api.call("PATCH", "/routines/r-ret", {"bd": 2})
    ret = api.project("ret")
    assert ret["forecastDate"] == "2026-12-03"
    assert ret["derived"]["dayHours"]["2026-12-03"] == 3.5
    assert "2026-12-02" not in ret["derived"]["dayHours"]
    assert ("ret", "routine") in {(m["projectId"], m["cause"]) for m in out["movements"]}
    assert_invariant(api)


def test_the_documented_routine_day_move_keeps_every_forecast(api: Api) -> None:
    # ADR-0007 "Routine day moves": ManCo pack BD8 -> BD10 keeps 144 / 74.5 / 50.5 / 57h and
    # every forecast, because each moved day stays inside every forecast window.
    before = {p["id"]: p["forecastDate"] for p in planned(api)}
    out = api.call("PATCH", "/routines/r-man", {"bd": 10})
    assert out["movements"] == []
    assert {p["id"]: p["forecastDate"] for p in planned(api)} == before
    assert_invariant(api)


def test_removing_a_routine_keeps_the_work_left(api: Api) -> None:
    before = work_left(api)
    api.call("DELETE", "/routines/r-ret")
    after = work_left(api)
    for pid, left in before.items():
        assert left - 1e-6 <= after[pid] < left + 8, pid
    assert_invariant(api)


# ---------------------------------------------------------------------------- Fixed Income
def new_fi(api: Api, name: str = "Curve builder") -> str:
    out = api.call("POST", "/projects", {"domain": "fi", "name": name}, 201)
    return str(out["entity"]["id"])


def test_a_new_fixed_income_project_plans_hours_after_the_move(api: Api) -> None:
    pid = new_fi(api)
    created = api.project(pid)
    assert (created["rate"], created["rateAfterMove"], created["forecastDate"]) == (0, 0, None)
    api.call("POST", f"/projects/{pid}/replan", {"startDate": "2027-01-11"})
    api.call("PATCH", f"/projects/{pid}", {"targetDate": "2027-03-01"})
    entity = api.call("POST", f"/projects/{pid}/replan", {"workLeft": 40})["entity"]
    # The first work left plans at 1h a day, after the move too: 40 BD from Mon 11 Jan.
    assert (entity["rate"], entity["rateAfterMove"]) == (1, 1)
    assert (entity["forecastDate"], entity["unplacedH"]) == ("2027-03-05", 0)
    assert entity["derived"]["workLeft"] == pytest.approx(40)
    assert entity["derived"]["status"] == "risk"  # 5 Mar is after the 1 Mar target
    faster = api.call("POST", f"/projects/{pid}/replan", {"rate": 4})["entity"]
    assert (faster["rate"], faster["rateAfterMove"]) == (4, 4)
    assert (faster["forecastDate"], faster["unplacedH"]) == ("2027-01-22", 0)
    assert faster["derived"]["status"] == "on"
    assert faster["derived"]["sentence"]["case"] == "buffer"
    assert faster["derived"]["need"]["state"] == "ok"
    assert_invariant(api)


def test_a_fixed_income_project_that_starts_today_carries_on_after_the_move(api: Api) -> None:
    pid = new_fi(api)
    api.call("PATCH", f"/projects/{pid}", {"targetDate": "2027-03-01"})
    entity = api.call("POST", f"/projects/{pid}/replan", {"workLeft": 100})["entity"]
    assert entity["unplacedH"] == 0
    assert entity["forecastDate"] > "2027-01-04"
    assert entity["derived"]["workLeft"] == pytest.approx(100)
    assert_invariant(api)


def test_unplaced_fixed_income_hours_are_never_on_track(api: Api) -> None:
    # An after-move rate of 0 set through the API stalls Fixed Income work at the move too; its
    # unplaced hours show like Private Credit ones (at risk, "after_move"), never "on".
    pid = new_fi(api)
    api.call("PATCH", f"/projects/{pid}", {"targetDate": "2027-03-01"})
    api.call("POST", f"/projects/{pid}/replan", {"workLeft": 100})
    out = api.call("PATCH", f"/projects/{pid}", {"rateAfterMove": 0})
    entity = out["entity"]
    assert (entity["forecastDate"], entity["unplacedH"]) == ("2027-01-04", pytest.approx(38))
    assert entity["derived"]["workLeft"] == pytest.approx(100)
    assert entity["derived"]["status"] == "risk"
    sentence = entity["derived"]["sentence"]
    assert (sentence["case"], sentence["params"]["cutH"]) == ("after_move", 38)
    assert [(m["projectId"], m["cause"]) for m in out["movements"]] == [(pid, "rate")]
    assert_invariant(api)


# ---------------------------------------------------------------------------- 24h a day
@pytest.mark.parametrize("rate", [17, 24])
def test_a_rate_that_would_scale_past_24h_is_refused(api: Api, rate: int) -> None:
    # alpha: 2h a day, 3h after the move. 17h a day would plan 25.5h after it.
    for path in ("/projects/alpha/replan/preview", "/projects/alpha/replan"):
        response = api.client.post(f"/api{path}", json={"rate": rate})
        assert response.status_code == 422, response.text
        assert response.json()["error"]["field"] == "rate"
    assert api.client.post("/api/projects/alpha/replan/preview", json={"rate": 16}).is_success


def test_an_override_that_would_scale_past_24h_is_refused(api: Api) -> None:
    api.call("PUT", "/projects/play/overrides/2026-10-20", {"hours": 6})
    for path in ("/projects/play/replan/preview", "/projects/play/replan"):
        response = api.client.post(f"/api{path}", json={"rate": 5})
        assert response.status_code == 422, response.text
        assert response.json()["error"]["field"] == "rate"
    assert api.project("play")["rate"] == 1


def test_an_hours_a_day_check_in_past_24h_is_refused(api: Api) -> None:
    changes: list[dict[str, Any]] = [{"type": "hours_per_day", "projectId": "alpha", "value": 24}]
    shown = api.client.post("/api/checkins/preview", json={"changes": changes})
    assert shown.status_code == 422, shown.text
    assert shown.json()["error"]["field"] == "changes.0.value"
    body = {"changes": changes, "source": "simple", "parseId": PARSE_ID}
    api.error("POST", "/checkins/apply", body, 422)


def test_hour_figures_above_24h_are_refused(api: Api) -> None:
    assert api.error("PUT", "/projects/ret/overrides/2026-10-06", {"hours": 25}, 422)
    assert api.error("PATCH", "/projects/ret", {"rateAfterMove": 25}, 422)


# ---------------------------------------------------------------------------- proposals
@pytest.mark.parametrize(
    "text",
    [
        "ManCo at 0.01h a day.",  # below the 0.05h floor
        "Playbook at 0.06h a day.",  # its 0.5h BAU-day hours would rescale to 0.03h
    ],
)
def test_the_simple_reading_never_proposes_hours_the_preview_refuses(api: Api, text: str) -> None:
    response = api.client.post(
        "/api/checkins/parse-simple", json={"text": text, "parseId": PARSE_ID}
    )
    assert response.status_code == 200, response.text
    changes = response.json()["changes"]
    assert not [c for c in changes if c["type"] == "hours_per_day"]
    shown = api.client.post("/api/checkins/preview", json={"changes": changes})
    assert shown.status_code == 200, shown.text
