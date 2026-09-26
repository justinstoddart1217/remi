"""``GET /plan`` and the parameterised reads on the design seed, against the goldens.

Today is Mon 5 Oct 2026. Values come from PLAN.md / ADR-0007 and ``parity/golden/*.json``
(the prototype, extracted), compared from 2026-09-01 on. The only differences allowed are the
ADR-0007 divergences: the verdict buffer is 7 (not 8) and 31 Aug 2026 is a bank holiday (so
August is not compared); rotation load items carry their segment id instead of ``rot``.
"""

from collections import Counter
from datetime import date
from typing import Any

import pytest
from fastapi.testclient import TestClient

from remi.tests.fixtures.design_seed import golden
from remi.utils.dates import fmt_s

pytestmark = pytest.mark.golden

GOLDEN_FROM = "2026-09-01"
GOLDEN_TO = "2027-04-30"


@pytest.fixture(scope="module")
def plan(design_client: TestClient) -> dict[str, Any]:
    response = design_client.get("/api/plan")
    assert response.status_code == 200, response.text
    return response.json()


def _project(plan: dict[str, Any], pid: str) -> dict[str, Any]:
    return next(p for p in plan["projects"] if p["id"] == pid)


def _hours(label: str) -> float:
    return float(label.removesuffix("h"))


# ---------------------------------------------------------------------------- headline figures
def test_countdown_is_61_and_today_is_bd3(plan: dict[str, Any]) -> None:
    assert plan["move"]["countdownBd"] == 61
    assert plan["move"]["date"] == "2027-01-04"
    today = plan["today"]
    assert (today["iso"], today["isBd"], today["bdm"], today["monthBds"]) == (
        "2026-10-05",
        True,
        3,
        22,
    )
    assert today["w"] == 1
    assert today["overridden"] is True
    assert today["tz"] == "Europe/London"
    assert today["nextRolloverAt"].startswith("2026-10-05T23:00:00")


def test_verdict_is_on_track_narrowly_with_a_7_day_buffer(plan: dict[str, Any]) -> None:
    verdict = plan["verdict"]
    assert verdict == {
        "state": "on_track_narrowly",
        "bufferBd": 7,  # ADR-0007: the prototype said 8
        "lastPcExit": "2026-12-18",
        "keyProjectId": "ret",
        "keyRun": "2026-12-03",
        "toRunBd": 1,
        "anyRisk": True,
    }
    assert golden("verdict")["toRun"] == verdict["toRunBd"]


def test_loads_5_oct_is_8h_and_4_nov_is_the_only_overload(plan: dict[str, Any]) -> None:
    loads = plan["loads"]
    oct5 = loads["2026-10-05"]
    assert [(i["refId"], i["h"]) for i in oct5["items"]] == [("r-ret", 6), ("manco", 2)]
    assert (oct5["bau"], oct5["proj"], oct5["total"], oct5["free"], oct5["over"]) == (
        6,
        2,
        8,
        0,
        False,
    )
    nov4 = loads["2026-11-04"]
    assert (nov4["total"], nov4["over"]) == (9.5, True)
    assert [day for day, load in loads.items() if load["over"]] == ["2026-11-04"]
    assert plan["flags"]["upcomingOverloads"] == [
        {"iso": "2026-11-04", "bdm": 3, "total": 9.5, "overBy": 1.5}
    ]


def test_attention_and_prompt_match_the_prototype(plan: dict[str, Any]) -> None:
    flags = plan["flags"]
    got = [(a["kind"], a["projectId"] or a["iso"], a["chip"]) for a in flags["attention"]]
    assert got == [
        ("at_risk", "ret", "+3 BD"),
        ("overload", "2026-11-04", "+1.5h"),
        ("stale", "manco", "9d"),
    ]
    reference = golden("attention")
    assert [a["chip"] for a in reference["attention"]] == [c for _, _, c in got]
    assert flags["promptProjectId"] == reference["prompt"] == "manco"
    assert flags["nextDueProjectId"] == reference["nextDue"] == "manco"


def test_routine_next_runs_match_the_prototype(plan: dict[str, Any]) -> None:
    reference = {r["id"]: r for r in golden("routines")}
    for routine in plan["routines"]:
        ref_next = reference[routine["id"]]["next"]
        got = routine["derived"]["next"]
        assert [o["iso"] for o in got] == [o["iso"] for o in ref_next]
        assert [o["afterMove"] for o in got] == [o["after"] for o in ref_next]
        assert [o["today"] for o in got] == [o["today"] for o in ref_next]
    ret = next(r for r in plan["routines"] if r["id"] == "r-ret")
    assert [o["bdAway"] for o in ret["derived"]["next"]] == [0, 22, 43]
    assert ret["derived"]["lastBeforeMove"] == "2026-12-03"
    assert ret["derived"]["runsToday"] and ret["derived"]["countsToday"]
    today_run = ret["derived"]["todayRun"]
    assert (len(today_run["tickedItemIds"]), today_run["itemCount"], today_run["done"]) == (
        5,
        12,
        False,
    )
    assert len(ret["checklistItems"]) == 12


def test_rotation_segments_match_the_prototype(plan: dict[str, Any]) -> None:
    rotation = plan["rotation"]
    reference = golden("rotation")
    got = [
        (s["country"], s["code"], s["lengthBd"], s["pass"], s["start"], s["end"])
        for s in rotation["segments"]
    ]
    assert got == [
        (r["country"], r["code"], r["len"], r["pass"], r["s"], r["e"]) for r in reference
    ]
    assert (rotation["loopBd"], rotation["loopEnd"], rotation["totalBd"]) == (46, "2027-03-08", 49)
    assert rotation["refresh"] == {"start": "2027-03-09", "end": "2027-03-11"}
    assert rotation["current"]["status"] == "waiting"
    assert rotation["current"]["bdToStart"] == 61
    assert rotation["startFollowsMove"] is True
    assert rotation["hoursPerDay"] == 4
    assert rotation["title"] == "Eurozone sovereign rotation"


def test_move_strip_has_61_blocks_7_to_spare_and_the_prototype_flags(
    plan: dict[str, Any],
) -> None:
    move = plan["move"]
    assert len(move["remaining"]) == golden("transition")["businessDaysStrictlyBetween"]
    assert sum(1 for d in move["remaining"] if not d["pcRunning"]) == 7
    assert [(f["kind"], f["projectId"], f["iso"]) for f in move["flags"]] == [
        ("project", "ret", "2026-12-02"),
        ("key_run", None, "2026-12-03"),
        ("project", "manco", "2026-12-11"),
        ("project", "play", "2026-12-18"),
        ("move", None, "2027-01-04"),
    ]
    flags = move["flags"]
    assert [f["index"] for f in flags] == [0, 1, 2, 3, 4]
    assert [(f["liftPx"], f["stickPx"]) for f in flags] == [(2, 10), (18, 26)] * 2 + [(2, 10)]
    slots = [f["slot"] for f in flags]
    assert slots == sorted(slots)
    assert slots[-1] == len(move["remaining"])
    # The prototype puts ret (2 Dec) and the Dec run on the same x.
    assert slots[0] == slots[1]


def test_projects_match_the_prototype(plan: dict[str, Any]) -> None:
    reference = golden("projects")
    assert [p["id"] for p in plan["projects"]] == [p["id"] for p in reference]
    for ref in reference:
        got = _project(plan, ref["id"])
        derived = got["derived"]
        assert got["startDate"] == ref["start"]
        assert got["targetDate"] == ref["target"]
        assert got["forecastDate"] == ref["forecast"]
        assert got["prevForecastDate"] == ref["prev"]
        assert got["confidence"] == ref["confidence"]
        assert got["rate"] == ref["rate"]
        assert got["rateAfterMove"] == ref["rateAfter"]
        assert got["bauDayHours"] == {"r-ret": ref["bd3"], "r-man": ref["bd8"]}
        assert got["overrides"] == ref["ov"]
        assert got["exitRoutes"] == ref["exit"]
        assert derived["deltaBd"] == ref["delta"]
        assert derived["status"] == ref["status"]
        assert derived["sinceDays"] == ref["since"]
        assert derived["stale"] == ref["stale"]
        assert derived["addedH"] == ref["added"]
        assert (derived["growthPct"] or 0) == ref["growth"]
        assert [(m["name"], m["date"]) for m in derived["milestones"]] == [
            (m["name"], m["date"]) for m in ref["milestones"]
        ]


def test_ret_derived_figures(plan: dict[str, Any]) -> None:
    derived = _project(plan, "ret")["derived"]
    assert derived["workLeftDisplay"] == 144
    assert derived["cutH"] == pytest.approx(10.5)
    assert derived["need"] == {"rate": 3.8, "state": "ok"}  # ADR-0007: the prototype said 3.6
    sentence = derived["sentence"]
    assert sentence["case"] == "late"
    params = sentence["params"]
    assert (params["lateBd"], params["needRate"], params["cutH"], params["rate"]) == (
        3,
        3.8,
        10.5,
        3.5,
    )
    assert params["firstOverDay"] == "2026-11-04"
    assert params["overDayCount"] == 1
    assert derived["overDays"] == ["2026-11-04"]
    assert _project(plan, "alpha")["derived"]["status"] == "define"
    assert _project(plan, "manco")["derived"]["sentence"]["params"]["staleDays"] == 9


def test_transition_notes_are_data(plan: dict[str, Any]) -> None:
    """The Transition screen's text the prototype hard-codes (Transition.dc.html) is seeded."""
    notes = {p["id"]: p["afterDayOneNote"] for p in plan["projects"]}
    assert notes == {
        "ret": None,
        "manco": None,
        "play": None,
        "fion": None,
        "alpha": "In Define, charter half-written. Planning starts once the rotation is under way.",
    }
    routine_notes = {r["id"]: r["transitionNote"] for r in plan["routines"]}
    assert routine_notes == {
        "r-ret": "Successor shadows the Thu 3 Dec run on the automated pipeline",
        "r-man": "Successor builds the Thu 10 Dec pack; commentary stays manual",
    }


@pytest.mark.parametrize(
    ("pid", "hours"), [("ret", 144.0), ("manco", 74.5), ("play", 50.5), ("fion", 57.0)]
)
def test_work_left(plan: dict[str, Any], pid: str, hours: float) -> None:
    assert _project(plan, pid)["derived"]["workLeft"] == pytest.approx(hours)


def test_counts_and_aliases(plan: dict[str, Any]) -> None:
    counts = plan["counts"]
    assert (counts["projects"], counts["routines"], counts["notesTotal"]) == (5, 2, 6)
    assert (counts["noteDays"], counts["notesToday"]) == (3, 3)
    assert counts["recentNotes"] == 6
    aliases = {(a["entityType"], a["entityId"], a["alias"]) for a in plan["aliases"]}
    assert ("project", "ret", "returns automation") in aliases
    assert ("routine", "r-ret", "funds") in aliases
    assert ("routine", "r-man", "bd8") in aliases


def test_settings_in_the_plan(plan: dict[str, Any]) -> None:
    settings = plan["settings"]
    assert settings["setupComplete"] is True
    assert (settings["moveDate"], settings["capacityHoursPerDay"]) == ("2027-01-04", 8)
    assert (settings["keyProjectId"], settings["keyRoutineId"]) == ("ret", "r-ret")
    assert settings["aiProvider"] == "none"
    assert "apiKey" not in settings


def test_plan_calendar_window(plan: dict[str, Any]) -> None:
    calendar = plan["calendar"]
    assert calendar["from"] == "2026-09-28"
    assert calendar["to"] == "2027-03-25"  # alpha's target (a Define project ends there)
    assert calendar["region"] == "GB-ENG"
    days = calendar["days"]
    assert days[0]["iso"] == calendar["from"] and days[-1]["iso"] == calendar["to"]
    business = {d["iso"] for d in days if d["bd"]}
    assert set(plan["loads"]) == business


# ---------------------------------------------------------------------------- ETag
def test_plan_etag_and_not_modified(design_client: TestClient) -> None:
    first = design_client.get("/api/plan")
    etag = first.headers["etag"]
    assert etag == f'"{first.json()["revision"]}-2026-10-05"'
    again = design_client.get("/api/plan", headers={"If-None-Match": etag})
    assert again.status_code == 304
    assert again.headers["etag"] == etag
    stale = design_client.get("/api/plan", headers={"If-None-Match": '"0-2026-10-04"'})
    assert stale.status_code == 200


# ---------------------------------------------------------------------------- broad goldens
def test_calendar_matches_the_prototype_from_september(design_client: TestClient) -> None:
    reference = golden("calendar")
    response = design_client.get("/api/calendar", params={"from": GOLDEN_FROM, "to": GOLDEN_TO})
    assert response.status_code == 200, response.text
    got = {d["iso"]: d for d in response.json()["days"]}
    compared = 0
    for day in reference["days"]:
        if day["iso"] < GOLDEN_FROM:
            continue
        mine = got[day["iso"]]
        assert (mine["w"], mine["bd"], mine["bdm"], mine["hol"]) == (
            day["w"],
            day["bd"],
            day["bdm"],
            day["hol"],
        ), day["iso"]
        compared += 1
    assert compared == len(got)
    per_month = Counter(d[:7] for d, x in got.items() if x["bd"])
    for month, count in reference["businessDaysPerMonth"].items():
        if month >= GOLDEN_FROM[:7]:
            assert per_month[month] == count, month


def _item(kind: str, ref_type: str) -> bool:
    return (kind == "proj") == (ref_type == "project")


def test_loads_match_the_prototype_from_september(design_client: TestClient) -> None:
    response = design_client.get("/api/loads", params={"from": GOLDEN_FROM, "to": GOLDEN_TO})
    assert response.status_code == 200, response.text
    got = response.json()["loads"]
    reference = [d for d in golden("loads") if d["iso"] >= GOLDEN_FROM]
    assert [d["iso"] for d in reference] == list(got)
    for day in reference:
        mine = got[day["iso"]]
        for key in ("bau", "proj", "total", "free", "over"):
            assert mine[key] == pytest.approx(day[key]), (day["iso"], key)
        assert len(mine["items"]) == len(day["items"]), day["iso"]
        for a, b in zip(mine["items"], day["items"], strict=True):
            assert _item(b["kind"], a["refType"]), (day["iso"], a, b)
            assert a["h"] == pytest.approx(b["h"]), day["iso"]
            assert a["name"] == b["name"], day["iso"]
            assert a["domain"] == b["domain"], day["iso"]
            if a["refType"] != "rotation":  # segment ids, not the prototype's "rot"
                assert a["refId"] == b["id"], day["iso"]


def test_month_snapshot_2_of_17_done_1_overdue(design_client: TestClient) -> None:
    response = design_client.get("/api/month-snapshot")
    assert response.status_code == 200, response.text
    snap = response.json()
    assert snap["month"] == "2026-10"
    assert snap["totals"] == {"total": 17, "done": 2, "late": 1}
    reference = golden("month_snapshot")["collapsed"]
    assert reference["headline"] == "2 of 17 done · 1 overdue"
    assert (snap["from"], snap["to"]) == ("2026-10-01", "2026-10-30")
    bau = [r for r in snap["rows"] if r["kind"] == "bau"]
    assert [(r["text"], r["sub"], r["done"]) for r in bau] == [
        (i["text"], i["sub"], i["done"]) for i in reference["groups"][0]["items"]
    ]
    late = [r for r in snap["rows"] if r["late"]]
    assert [(r["taskId"], r["text"], r["sub"]) for r in late] == [
        ("man-0", "Send the NAV bridge spec to Finance", "ManCo automation")
    ]
    project_rows = [r for r in snap["rows"] if r["kind"] != "bau"]
    shown = reference["groups"][1]["items"]
    assert [(r["text"], r["sub"]) for r in project_rows[: len(shown)]] == [
        (i["text"], i["sub"]) for i in shown
    ]
    total = reference["doneN"] and snap["totals"]["total"]
    for bar, ref in zip(snap["bars"], reference["bars"], strict=True):
        assert bar["plan"] == round(float(ref["plan"].rstrip("%")) * total / 100)
        if bar["past"]:
            assert bar["done"] == round(float(ref["doneH"].rstrip("%")) * total / 100)
            # The prototype stacks the overdue bar on the done bar.
            stacked = round(float(ref["lateH"].rstrip("%")) * total / 100)
            assert bar["done"] + bar["late"] == stacked


def test_day_5_oct_manco_focus_and_funds_checklist(design_client: TestClient) -> None:
    response = design_client.get("/api/day/2026-10-05")
    assert response.status_code == 200, response.text
    day = response.json()
    assert (day["isToday"], day["aheadBd"], day["bdm"], day["monthBds"]) == (True, 0, 3, 22)
    (block,) = day["focusBlocks"]
    assert block["projectId"] == "manco"
    assert block["hours"] == 2
    assert [t["hours"] for t in block["tasks"]] == [0.5, 0.75, 0.75]
    assert [t["id"] for t in block["tasks"]] == ["man-0", "man-1", "man-2"]
    assert block["tasks"][0]["milestoneId"] == "manco-now-0"
    assert block["nextMilestone"]["name"] == "Performance section builds itself"
    (bau,) = day["bauRows"]
    assert bau["routineId"] == "r-ret"
    assert (sum(1 for i in bau["checklist"] if i["done"]), len(bau["checklist"])) == (5, 12)
    assert bau["editable"] is True
    assert bau["done"] is False
    assert day["nextRunAfter"] is None
    assert day["load"]["total"] == 8


def _milestone_text(block: dict[str, Any]) -> str:
    milestone = block["nextMilestone"]
    if milestone is None:
        return ""
    prefix = "Milestone due this day" if milestone["dueThisDay"] else "Next milestone"
    return f"{prefix}: {milestone['name']} · {fmt_s(date.fromisoformat(milestone['date']))}"


_NO_TASKS = {
    "used_up": "The tasks in Now are used up before this day. Plan the next ones in the workspace.",
    "no_tasks": "No tasks planned in Now yet. Add them in the workspace.",
    None: None,
}


def _no_bau_text(day: dict[str, Any]) -> str | None:
    nxt = day["nextRunAfter"]
    if nxt is None:
        return None
    if nxt["date"] is None or nxt["afterMove"]:
        return "No BAU on this day. The next run is after the move."
    return f"No BAU on this day. The next run is {fmt_s(date.fromisoformat(nxt['date']))}."


def test_every_day_plan_matches_the_prototype(design_client: TestClient) -> None:
    reference = golden("today_day_plans")["days"]
    assert len(reference) > 100
    for ref in reference:
        response = design_client.get(f"/api/day/{ref['iso']}")
        assert response.status_code == 200, (ref["iso"], response.text)
        day = response.json()
        blocks = day["focusBlocks"]
        assert [b["projectId"] for b in blocks] == [b["id"] for b in ref["blocks"]], ref["iso"]
        for mine, theirs in zip(blocks, ref["blocks"], strict=True):
            assert mine["hours"] == pytest.approx(_hours(theirs["hours"])), ref["iso"]
            assert [t["id"] for t in mine["tasks"]] == [t["id"] for t in theirs["tasks"]]
            assert _NO_TASKS[mine["emptyReason"]] == theirs["noTasks"], ref["iso"]
            assert _milestone_text(mine) == theirs["milestone"], ref["iso"]
        returns = next((r for r in day["bauRows"] if r["routineId"] == "r-ret"), None)
        assert (returns is not None) == ref["returnsChecklist"]["shown"], ref["iso"]
        if returns is not None:
            ticked = sum(1 for i in returns["checklist"] if i["done"])
            assert ticked == ref["returnsChecklist"]["fundsDone"], ref["iso"]
        others = [r["name"] for r in day["bauRows"] if r["routineId"] != "r-ret"]
        assert others == [b["name"] for b in ref["otherBau"]], ref["iso"]
        assert _no_bau_text(day) == ref["noBau"], ref["iso"]
        load = day["load"]
        assert load["bau"] == pytest.approx(_hours(ref["load"]["bauH"])), ref["iso"]
        assert load["proj"] == pytest.approx(_hours(ref["load"]["projH"])), ref["iso"]
        assert load["free"] == pytest.approx(_hours(ref["load"]["freeH"])), ref["iso"]


def test_weekend_day_has_empty_rows(design_client: TestClient) -> None:
    day = design_client.get("/api/day/2026-10-10").json()
    assert (day["bdm"], day["load"], day["bauRows"], day["focusBlocks"]) == (None, None, [], [])
    assert day["nextRunAfter"] == {"routineId": "r-man", "date": "2026-10-12", "afterMove": False}


def test_holiday_day_reports_its_name(design_client: TestClient) -> None:
    day = design_client.get("/api/day/2026-12-28").json()
    assert day["holiday"] == "Boxing Day (substitute)"
    assert day["focusBlocks"] == []


def test_home_after_setup(design_client: TestClient) -> None:
    home = design_client.get("/api/home").json()
    assert home["needsSetup"] is False
    assert (home["countdownBd"], home["moveDate"], home["bdm"]) == (61, "2027-01-04", 3)
    assert (home["projectCount"], home["routineCount"], home["notesToday"]) == (5, 2, 3)
    assert home["keyProject"] == {
        "id": "ret",
        "name": "Returns pipeline automation",
        "short": "Returns pipeline",
        "domain": "pc",
        "status": "risk",
        "forecastDate": "2026-12-02",
        "targetDate": "2026-11-27",
        "deltaBd": 3,
    }
    assert home["textbook"] == {"pages": 4, "liveCharts": 1}


def test_out_of_range_days(design_client: TestClient) -> None:
    etag = design_client.get("/api/plan").headers["etag"]
    response = design_client.get("/api/day/1989-12-29")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "OUT_OF_RANGE"
    # More than ten years from today: refused, and nothing is stored (the ETag stays put).
    for path in ("/api/day/2099-06-01", "/api/day/1990-01-02", "/api/month-snapshot?month=2099-06"):
        response = design_client.get(path)
        assert response.status_code == 422, path
        assert response.json()["error"]["code"] == "OUT_OF_RANGE"
    assert design_client.get("/api/plan").headers["etag"] == etag
    response = design_client.get("/api/calendar", params={"from": "2101-01-01", "to": "2101-01-02"})
    assert response.json()["error"]["code"] == "OUT_OF_RANGE"
    response = design_client.get("/api/month-snapshot", params={"month": "2026-13"})
    assert response.status_code == 422
