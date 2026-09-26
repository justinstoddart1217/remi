"""``/api/checkins``: preview and apply (one transaction), with ADR-0007 goldens.

The design seed's today is Mon 5 Oct 2026 (BD3, so the returns routine ``r-ret`` runs).
"""

from typing import Any

import pytest
from sqlalchemy import select

from remi.core.uow import ref
from remi.repositories import models as orm
from tests.projects.helpers import JSON, Api

TODAY = "2026-10-05"
PARSE_ID = "5b0f7c0e-2d0c-4d0e-9a51-7f1f7c3b8a10"
SCOPE_6H: list[JSON] = [
    {"type": "scope_add", "projectId": "ret", "text": "FX attribution", "hours": 6}
]
CLAUDE_FIXTURE: list[JSON] = [
    # parity/golden/claude-fixture.mjs CLAUDE_FIXTURE_REPLY.changes, in API casing
    {"type": "task_done", "projectId": "ret", "taskId": "ret-2"},
    {"type": "scope_add", "projectId": "ret", "text": "FX attribution", "hours": 6},
    {"type": "blocker", "projectId": "ret", "text": "Administrator files for the last 4 funds"},
    {"type": "confidence", "projectId": "ret", "value": 2},
    {"type": "hours_per_day", "projectId": "manco", "value": 2},
    {
        "type": "note",
        "projectId": "manco",
        "text": "Moving to 2h a day to protect the November pack.",
    },
    {"type": "target_move", "projectId": "play", "date": "2027-01-08"},
    {"type": "bau_done", "routineId": "r-ret"},
]


def preview(api: Api, changes: list[JSON], status: int = 200) -> JSON:
    before = api.event_count()
    response = api.client.post("/api/checkins/preview", json={"changes": changes})
    assert response.status_code == status, response.text
    assert api.event_count() == before, "a preview must not record an event"
    return dict(response.json())


def apply(api: Api, changes: list[JSON], **extra: Any) -> JSON:
    body: JSON = {"changes": changes, "source": "simple", **extra}
    return api.call("POST", "/checkins/apply", body)


def by_id(items: list[JSON], key: str = "id") -> dict[str, JSON]:
    return {item[key]: item for item in items}


# ---------------------------------------------------------------------------- the golden slip
def test_preview_ret_plus_6h_is_the_adr_golden(api: Api) -> None:
    revision = api.plan()["revision"]
    (shown,) = preview(api, SCOPE_6H)["projects"]
    assert shown == {
        "projectId": "ret",
        "from": "2026-12-02",
        "to": "2026-12-07",  # ADR-0007: Mon 7 Dec (+3 BD), not the prototype's Fri 4 Dec
        "deltaBd": 3,
        "late": True,
        "label": "+3 BD",
        "targetAfter": "2026-11-27",
        "newOver": ["2026-12-04", "2026-12-07"],
        "missesKeyRun": True,
        "pastTargetBd": 6,  # 27 Nov → 7 Dec: the review's "now 6 BD past target"
    }
    assert api.plan()["revision"] == revision
    assert api.project("ret")["forecastDate"] == "2026-12-02"


def test_apply_ret_plus_6h(api: Api) -> None:
    out = apply(api, SCOPE_6H, rawText="They want FX attribution too, about 6h.", parseId=PARSE_ID)
    (movement,) = out["movements"]
    assert movement == {
        "projectId": "ret",
        "fromForecast": "2026-12-02",
        "toForecast": "2026-12-07",
        "deltaBd": 3,
        "fromTarget": "2026-11-27",
        "toTarget": "2026-11-27",
        "cause": "scope",
        "label": "+3 BD",
        "flash": True,
        "moved": True,
    }
    entity = out["entity"]
    assert entity["projectIds"] == ["ret"]
    assert entity["routineIds"] == []
    (checkin_id,) = entity["checkinIds"]

    ret = by_id(out["plan"]["projects"])["ret"]
    assert (ret["forecastDate"], ret["prevForecastDate"]) == ("2026-12-07", "2026-12-02")
    assert ret["lastCheckinDate"] == TODAY
    assert ret["blocker"] is None
    assert ret["confidence"] == 3
    scope = ret["scopeChanges"][-1]
    assert scope == {
        "id": scope["id"],
        "projectId": "ret",
        "checkinId": checkin_id,
        "date": TODAY,
        "what": "FX attribution",
        "hours": 6,
        "slipBd": 3,
        "fromForecast": "2026-12-02",
        "toForecast": "2026-12-07",
    }
    assert ret["derived"]["addedH"] == 16
    assert ret["derived"]["growthPct"] == 27
    overloads = [o["iso"] for o in out["plan"]["flags"]["upcomingOverloads"]]
    assert overloads == ["2026-11-04", "2026-12-04", "2026-12-07"]

    item = api.feed()[0]
    assert (item["projectId"], item["kind"], item["tone"]) == ("ret", "scope", "risk")
    assert item["title"] == "Returns pipeline"
    assert item["body"] == "Scope added (fx attribution, +6h). Forecast moved 2 Dec → 7 Dec."
    assert item["delta"] == "+3 BD"

    snap = api.client.get("/api/projects/ret/snapshots").json()[-1]
    assert snap["checkinId"] == checkin_id
    assert (snap["date"], snap["source"]) == (TODAY, "simple")
    assert (snap["forecastDate"], snap["targetDate"]) == ("2026-12-07", "2026-11-27")
    assert snap["note"] == "FX attribution added, +6h"
    # the derived milestones (derivedMs), as GET /plan shows them: no explicit twins
    derived = [
        {"milestoneId": m["milestoneId"], "name": m["name"], "date": m["date"]}
        for m in ret["derived"]["milestones"]
    ]
    assert snap["milestones"] == derived
    assert [m["milestoneId"] for m in derived] == [
        "ret-now-0",
        "ret-now-1",
        "ret-next-0",
        "ret-next-1",
        "ret-next-2",
    ]

    event = api.events()[-1]
    assert (event.type, event.actor) == ("checkin.applied", "simple-proposal-accepted")
    assert event.payload["effects"]["batchId"] == entity["batchId"]
    with api.uow_factory.read() as uow:
        row = uow.session.get(orm.CheckIn, checkin_id)
        assert row is not None
        assert (row.batch_id, row.parse_id) == (entity["batchId"], PARSE_ID)
        assert row.raw_text == "They want FX attribution too, about 6h."
        assert row.changes == SCOPE_6H
        assert row.snapshot["target"] == "2026-11-27"
        assert row.snapshot["forecast"] == "2026-12-07"


# ---------------------------------------------------------------------------- the claude fixture
def test_claude_fixture_preview_equals_apply_equals_plan(api: Api) -> None:
    shown = by_id(preview(api, CLAUDE_FIXTURE)["projects"], "projectId")
    assert set(shown) == {"ret", "manco", "play"}
    assert (shown["manco"]["to"], shown["manco"]["deltaBd"]) == ("2026-11-25", -12)
    assert shown["manco"]["label"] == "\N{MINUS SIGN}12 BD"
    assert (shown["play"]["to"], shown["play"]["targetAfter"]) == ("2026-12-18", "2027-01-08")
    assert shown["play"]["late"] is False

    out = api.call(
        "POST",
        "/checkins/apply",
        {"changes": CLAUDE_FIXTURE, "source": "ai", "parseId": PARSE_ID, "rawText": "update"},
    )
    plan = api.plan()
    assert plan == out["plan"]
    projects = by_id(plan["projects"])
    movements = by_id(out["movements"], "projectId")
    for pid, p in shown.items():
        assert projects[pid]["forecastDate"] == p["to"], pid
        assert projects[pid]["targetDate"] == p["targetAfter"], pid
    assert (movements["ret"]["cause"], movements["ret"]["label"]) == ("scope", "+3 BD")
    assert (movements["manco"]["cause"], movements["manco"]["deltaBd"]) == ("rate", -12)
    assert movements["play"]["cause"] == "target"
    assert (movements["play"]["flash"], movements["play"]["moved"]) == (False, False)

    ret, manco, play = projects["ret"], projects["manco"], projects["play"]
    assert (ret["confidence"], ret["blocker"]) == (2, "Administrator files for the last 4 funds")
    task = by_id([t for m in ret["milestones"] for t in m["tasks"]])["ret-2"]
    assert (task["done"], task["doneOn"]) == (True, TODAY)
    assert manco["rate"] == 2
    assert manco["bauDayHours"] == {"r-ret": pytest.approx(8 / 3), "r-man": pytest.approx(2)}
    assert (manco["blocker"], play["blocker"]) == (None, None)
    for p in (ret, manco, play):
        assert p["lastCheckinDate"] == TODAY
    assert projects["fion"]["lastCheckinDate"] == "2026-09-30"  # untouched

    r_ret = by_id(plan["routines"])["r-ret"]["derived"]["todayRun"]
    assert (r_ret["done"], len(r_ret["tickedItemIds"]), r_ret["itemCount"]) == (True, 12, 12)

    entity = out["entity"]
    assert entity["projectIds"] == ["ret", "manco", "play"]
    assert entity["routineIds"] == ["r-ret"]
    with api.uow_factory.read() as uow:
        rows = {
            c.project_id: (c.note, c.source, c.batch_id)
            for c in uow.session.scalars(
                select(orm.CheckIn).where(orm.CheckIn.id.in_(entity["checkinIds"]))
            )
        }
    assert rows == {
        "ret": (
            "FX attribution added, +6h. Blocked: Administrator files for the last 4 funds",
            "ai",
            entity["batchId"],
        ),
        "manco": ("Moving to 2h a day to protect the November pack", "ai", entity["batchId"]),
        "play": ("Plan confirmed.", "ai", entity["batchId"]),
    }
    feed = {item["projectId"]: item for item in api.feed()[:3]}
    assert feed["manco"]["body"] == (
        "Checked in. Moving to 2h a day to protect the November pack. "
        "Forecast moved 11 Dec → 25 Nov."
    )
    assert (feed["manco"]["kind"], feed["manco"]["delta"]) == ("checkin", "\N{MINUS SIGN}12 BD")
    assert feed["play"]["body"] == "Checked in. Forecast holds at 18 Dec."
    assert feed["play"]["delta"] == "±0 BD"
    assert api.events()[-1].actor == "ai-proposal-accepted"


# ---------------------------------------------------------------------------- ADR-0007 slip grid
@pytest.mark.parametrize(
    ("pid", "hours", "to", "delta", "unplaced"),
    [
        ("ret", 0.5, "2026-12-04", 2, 0),
        ("ret", 2, "2026-12-04", 2, 0),
        ("ret", 4, "2026-12-07", 3, 0),
        ("ret", 8, "2026-12-08", 4, 0),
        ("ret", 16, "2026-12-10", 6, 0),
        ("ret", 40, "2026-12-21", 13, 0),
        ("manco", 40, "2027-01-04", 13, 22),  # stall rule: PC hours stop at the move
        ("play", 8, "2027-01-04", 8, 1),
    ],
)
def test_scope_slips_match_the_adr_divergence_table(
    api: Api, pid: str, hours: float, to: str, delta: int, unplaced: float
) -> None:
    change = [{"type": "scope_add", "projectId": pid, "text": "More", "hours": hours}]
    (shown,) = preview(api, change)["projects"]
    assert (shown["to"], shown["deltaBd"]) == (to, delta)
    out = apply(api, change)
    project = by_id(out["plan"]["projects"])[pid]
    assert project["forecastDate"] == to
    assert project["unplacedH"] == pytest.approx(unplaced)
    (movement,) = out["movements"]
    assert (movement["toForecast"], movement["deltaBd"]) == (to, delta)


# ---------------------------------------------------------------------------- per-change rules
def test_task_add_goes_to_the_first_now_milestone(api: Api) -> None:
    out = apply(api, [{"type": "task_add", "projectId": "ret", "text": "FX map", "hours": 2}])
    now0 = by_id(by_id(out["plan"]["projects"])["ret"]["milestones"])["ret-now-0"]
    assert [(t["text"], t["hours"]) for t in now0["tasks"]][-1] == ("FX map", 2)
    assert out["movements"] == []  # a task never moves the forecast


def test_task_add_creates_a_now_milestone_when_there_is_none(api: Api) -> None:
    assert not [m for m in api.project("alpha")["milestones"] if m["horizon"] == "now"]
    out = apply(api, [{"type": "task_add", "projectId": "alpha", "text": "Sketch", "hours": 1.5}])
    alpha = by_id(out["plan"]["projects"])["alpha"]
    (now,) = [m for m in alpha["milestones"] if m["horizon"] == "now"]
    assert (now["name"], now["dueDate"]) == ("Added from an update", "2026-10-16")
    assert [(t["text"], t["hours"]) for t in now["tasks"]] == [("Sketch", 1.5)]


def test_every_check_in_replaces_or_clears_the_blocker(api: Api) -> None:
    api.call("PATCH", "/projects/manco", {"blocker": "Old blocker"})
    out = apply(api, [{"type": "note", "projectId": "manco", "text": "All good."}])
    manco = by_id(out["plan"]["projects"])["manco"]
    assert manco["blocker"] is None
    assert api.feed()[0]["body"] == "Checked in. All good. Forecast holds at 11 Dec."


def test_scope_on_a_define_project_is_logged_without_a_forecast(api: Api) -> None:
    out = apply(api, [{"type": "scope_add", "projectId": "alpha", "text": "Extra", "hours": 4}])
    alpha = by_id(out["plan"]["projects"])["alpha"]
    assert alpha["forecastDate"] is None
    scope = alpha["scopeChanges"][-1]
    assert (scope["hours"], scope["slipBd"], scope["fromForecast"]) == (4, 0, None)
    assert out["movements"] == []
    assert api.feed()[0]["body"] == "Checked in."


def test_bau_done_without_a_checklist_records_the_run(api: Api) -> None:
    with api.uow_factory("user") as uow:
        routine = uow.session.get(orm.Routine, "r-man")
        assert routine is not None
        routine.bd = 3  # make the ManCo pack run today (it has no checklist)
        uow.record("test.routine_moved", [ref("routine", "r-man")], {"bd": 3})
    out = apply(api, [{"type": "bau_done", "routineId": "r-man"}])
    run = by_id(out["plan"]["routines"])["r-man"]["derived"]["todayRun"]
    assert (run["completed"], run["completedOn"], run["done"]) == (True, TODAY, True)
    assert out["entity"]["checkinIds"] == []


def test_preview_lists_only_projects_whose_forecast_or_target_is_touched(api: Api) -> None:
    changes: list[JSON] = [
        {"type": "note", "projectId": "manco", "text": "Fine."},
        {"type": "confidence", "projectId": "play", "value": 3},
        {"type": "task_done", "projectId": "ret", "taskId": "ret-3"},
    ]
    assert preview(api, changes)["projects"] == []
    assert preview(api, [])["projects"] == []


# ---------------------------------------------------------------------------- refusals
@pytest.mark.parametrize(
    ("change", "status", "field", "code"),
    [
        ({"type": "note", "projectId": "nope", "text": "x"}, 404, "changes.0.projectId", None),
        (
            {"type": "task_done", "projectId": "ret", "taskId": "nope"},
            404,
            "changes.0.taskId",
            None,
        ),
        (
            {"type": "task_done", "projectId": "ret", "taskId": "man-1"},
            422,
            "changes.0.taskId",
            None,
        ),
        ({"type": "bau_done", "routineId": "nope"}, 404, "changes.0.routineId", None),
        (
            {"type": "bau_done", "routineId": "r-man"},  # ManCo pack runs on BD8, not today
            422,
            "changes.0.routineId",
            "NOT_AN_OCCURRENCE",
        ),
        (
            {"type": "hours_per_day", "projectId": "ret", "value": 0.01},
            422,
            "changes.0.value",
            None,
        ),
        (
            {"type": "hours_per_day", "projectId": "ret", "value": 0.06},  # 2h rule -> 0.034h
            422,
            "changes.0.value",
            None,
        ),
        (
            {"type": "target_move", "projectId": "ret", "date": "2150-01-01"},
            422,
            "changes.0.date",
            "OUT_OF_RANGE",
        ),
        ({"type": "scope_add", "projectId": "ret", "text": "x", "hours": 0.1}, 422, None, None),
    ],
)
def test_apply_and_preview_refuse_the_same_changes(
    api: Api, change: JSON, status: int, field: str | None, code: str | None
) -> None:
    for path in ("/checkins/preview", "/checkins/apply"):
        body: JSON = {"changes": [change]}
        if path.endswith("apply"):
            body["source"] = "simple"
        error = api.error("POST", path, body, status)
        if field is not None:
            assert error["field"] == field, path
        if code is not None:
            assert error["code"] == code, path


def test_apply_refuses_an_unknown_focus_project(api: Api) -> None:
    body = {"changes": SCOPE_6H, "source": "simple", "focusProjectId": "nope"}
    assert api.error("POST", "/checkins/apply", body, 404)["field"] == "focusProjectId"


def test_apply_needs_changes(api: Api) -> None:
    api.error("POST", "/checkins/apply", {"changes": [], "source": "simple"}, 422)


def test_check_ins_before_setup_are_409(bare: Api) -> None:
    body: JSON = {"changes": SCOPE_6H, "source": "simple"}
    assert bare.error("POST", "/checkins/apply", body, 409)["code"] == "SETUP_REQUIRED"
    assert bare.error("POST", "/checkins/preview", {"changes": SCOPE_6H}, 409)["code"] == (
        "SETUP_REQUIRED"
    )
    assert bare.error("POST", "/checkins/preview", {"changes": []}, 409)["code"] == (
        "SETUP_REQUIRED"
    )
