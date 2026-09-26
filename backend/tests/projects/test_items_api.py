"""Charter items, milestones, tasks and readiness items (the Workspace and Transition lists).

The prototype's commit rules: adds append, a blank text deletes, dates snap forward to a
business day, ``done`` stamps today's business date. One event per change.
"""

from typing import Any

import pytest

from tests.projects.helpers import JSON, Api

TODAY = "2026-10-05"


def _charter(api: Api, project_id: str, key: str) -> list[JSON]:
    return list(api.project(project_id)["charter"][key])


def by_project(out: JSON) -> dict[str, JSON]:
    return {p["id"]: p for p in out["plan"]["projects"]}


def _milestone(api: Api, milestone_id: str) -> JSON | None:
    for p in api.plan()["projects"]:
        for m in p["milestones"]:
            if m["id"] == milestone_id:
                return dict(m)
    return None


# ---------------------------------------------------------------------------- charter
def test_charter_item_add_edit_delete(api: Api) -> None:
    before = _charter(api, "ret", "inScope")
    out = api.call("POST", "/projects/ret/charter/inScope", {"text": " FX share classes "}, 201)
    item = out["entity"]
    assert (item["list"], item["text"], item["projectId"]) == ("inScope", "FX share classes", "ret")
    assert item["sortOrder"] == len(before)
    assert [c["id"] for c in _charter(api, "ret", "inScope")][-1] == item["id"]

    edited = api.call("PATCH", f"/charter-items/{item['id']}", {"text": "FX classes"})["entity"]
    assert edited["text"] == "FX classes"

    out = api.call("DELETE", f"/charter-items/{item['id']}")
    assert "entity" not in out
    assert [c["id"] for c in _charter(api, "ret", "inScope")] == [c["id"] for c in before]


def test_charter_item_blank_is_allowed_while_adding(api: Api) -> None:
    item = api.call("POST", "/projects/ret/charter/constraints", {}, 201)["entity"]
    assert item["text"] == ""


@pytest.mark.parametrize("blank", ["", "   "])
def test_a_blank_edit_deletes_the_charter_item(api: Api, blank: str) -> None:
    first = _charter(api, "ret", "success")[0]
    out = api.call("PATCH", f"/charter-items/{first['id']}", {"text": blank})
    assert out["entity"] == first  # the item as it was
    assert first["id"] not in [c["id"] for c in _charter(api, "ret", "success")]


def test_charter_reorder(api: Api) -> None:
    ids = [c["id"] for c in _charter(api, "ret", "success")]
    assert len(ids) > 1
    reordered = list(reversed(ids))
    out = api.call("PUT", "/projects/ret/charter/success/order", {"ids": reordered})
    assert [c["id"] for c in out["entity"]["charter"]["success"]] == reordered
    error = api.error("PUT", "/projects/ret/charter/success/order", {"ids": ids[:-1]}, 422)
    assert error["field"] == "ids"
    api.error("PUT", "/projects/ret/charter/success/order", {"ids": [*ids, ids[0]]}, 422)


def test_charter_errors(api: Api) -> None:
    assert api.error("POST", "/projects/ret/charter/why", {"text": "x"}, 422)["field"] == "list"
    api.error("POST", "/projects/nope/charter/success", {"text": "x"}, 404)
    api.error("PATCH", "/charter-items/nope", {"text": "x"}, 404)
    api.error("DELETE", "/charter-items/nope", None, 404)


# ---------------------------------------------------------------------------- milestones
@pytest.mark.parametrize(("horizon", "due"), [("now", "2026-10-16"), ("next", "2026-11-02")])
def test_milestone_defaults(api: Api, horizon: str, due: str) -> None:
    count = sum(1 for m in api.project("play")["milestones"] if m["horizon"] == horizon)
    item = api.call("POST", "/projects/play/milestones", {"horizon": horizon}, 201)["entity"]
    assert (item["horizon"], item["name"], item["dueDate"]) == (horizon, "", due)
    assert item["sortOrder"] == count
    assert item["tasks"] == []
    assert (item["done"], item["doneOn"]) == (False, None)


def test_milestone_due_snaps_and_edits(api: Api) -> None:
    item = api.call(
        "POST",
        "/projects/play/milestones",
        {"horizon": "next", "name": "Dry run", "dueDate": "2026-12-25"},  # Christmas Day
        201,
    )["entity"]
    assert item["dueDate"] == "2026-12-29"  # Fri 25 and Mon 28 Dec are bank holidays
    mid = item["id"]
    edited = api.call("PATCH", f"/milestones/{mid}", {"name": "Dry run 2", "dueDate": None})[
        "entity"
    ]
    assert (edited["name"], edited["dueDate"]) == ("Dry run 2", None)
    done = api.call("PATCH", f"/milestones/{mid}", {"done": True})["entity"]
    assert (done["done"], done["doneOn"]) == (True, TODAY)
    undone = api.call("PATCH", f"/milestones/{mid}", {"done": False})["entity"]
    assert (undone["done"], undone["doneOn"]) == (False, None)


def test_a_blank_milestone_name_deletes_it_with_its_tasks(api: Api) -> None:
    out = api.call("PATCH", "/milestones/ret-now-0", {"name": " "})
    assert out["entity"]["id"] == "ret-now-0"
    assert [t["id"] for t in out["entity"]["tasks"]] == ["ret-1", "ret-2"]
    assert _milestone(api, "ret-now-0") is None
    assert api.client.patch("/api/tasks/ret-2", json={"done": True}).status_code == 404


def test_milestone_delete_and_reorder(api: Api) -> None:
    nexts = [m["id"] for m in api.project("ret")["milestones"] if m["horizon"] == "next"]
    out = api.call("PUT", "/projects/ret/milestones/order", {"ids": list(reversed(nexts))})
    now_ids = [m["id"] for m in out["entity"]["milestones"] if m["horizon"] == "now"]
    next_ids = [m["id"] for m in out["entity"]["milestones"] if m["horizon"] == "next"]
    assert next_ids == list(reversed(nexts))
    assert now_ids == ["ret-now-0", "ret-now-1"]
    api.error("PUT", "/projects/ret/milestones/order", {"ids": nexts[:1]}, 422)
    api.error("PUT", "/projects/ret/milestones/order", {"ids": ["nope"]}, 422)
    api.call("DELETE", "/milestones/ret-next-0")
    assert _milestone(api, "ret-next-0") is None
    api.error("DELETE", "/milestones/ret-next-0", None, 404)


# The prototype's msSync: a Now/Next milestone's rename, re-date or removal carries to the
# explicit milestone with its old name, so derived.milestones shows no phantom twin.
def _derived(api: Api, project_id: str) -> list[tuple[str, str, str]]:
    ms = api.project(project_id)["derived"]["milestones"]
    return [(m["milestoneId"], m["name"], m["date"]) for m in ms]


def _explicit(api: Api, project_id: str) -> dict[str, tuple[str, str | None]]:
    ms = api.project(project_id)["milestones"]
    return {m["id"]: (m["name"], m["dueDate"]) for m in ms if m["horizon"] == "explicit"}


@pytest.mark.parametrize("how", ["delete", "blank"])
def test_removing_a_now_milestone_removes_its_explicit_twin(api: Api, how: str) -> None:
    if how == "delete":
        out = api.call("DELETE", "/milestones/manco-now-0")
    else:
        out = api.call("PATCH", "/milestones/manco-now-0", {"name": ""})
    assert "manco-ms-0" not in _explicit(api, "manco")
    nxt = by_project(out)["manco"]["derived"]["nextMilestone"]
    assert (nxt["milestoneId"], nxt["name"], nxt["date"]) == (
        "manco-next-0",
        "First self-built pack, November BD8",
        "2026-11-11",
    )
    assert "Performance section builds itself" not in [n for _, n, _ in _derived(api, "manco")]
    event = api.events()[-1]
    assert event.type == "milestone.deleted"
    assert event.payload["effects"]["syncedIds"] == ["manco-ms-0"]


def test_removing_a_now_milestone_leaves_no_phantom(api: Api) -> None:
    api.call("DELETE", "/milestones/ret-now-1")
    assert "ret-ms-0" not in _explicit(api, "ret")
    assert "Fund-level engine reconciles" not in [n for _, n, _ in _derived(api, "ret")]


def test_renaming_and_redating_a_next_milestone_carries_to_its_twin(api: Api) -> None:
    api.call("PATCH", "/milestones/ret-next-1", {"name": "SL attribution"})
    api.call("PATCH", "/milestones/ret-next-1", {"dueDate": "2026-11-25"})
    assert _explicit(api, "ret")["ret-ms-2"] == ("SL attribution", "2026-11-25")
    derived = _derived(api, "ret")
    assert ("ret-next-1", "SL attribution", "2026-11-25") in derived
    assert [n for _, n, _ in derived].count("SL attribution") == 1
    assert "Security-level attribution" not in [n for _, n, _ in derived]
    assert "2026-11-20" not in [d for _, _, d in derived]


def test_a_rename_and_redate_in_one_patch_carry_together(api: Api) -> None:
    api.call("PATCH", "/milestones/ret-next-0", {"name": "Parallel run", "dueDate": "2026-11-07"})
    assert _explicit(api, "ret")["ret-ms-1"] == ("Parallel run", "2026-11-09")  # Sat snaps
    event = api.events()[-1]
    assert event.payload["effects"]["syncedIds"] == ["ret-ms-1"]


def test_only_the_twin_with_the_old_name_follows(api: Api) -> None:
    before = _explicit(api, "ret")
    api.call("PATCH", "/milestones/ret-next-2", {"name": "Runbook signed off"})  # no twin
    api.call("PATCH", "/milestones/ret-now-1", {"done": True})  # done does not sync
    assert _explicit(api, "ret") == before
    assert "syncedIds" not in api.events()[-1].payload.get("effects", {})


def test_editing_an_explicit_milestone_touches_nothing_else(api: Api) -> None:
    api.call("PATCH", "/milestones/ret-ms-1", {"name": "Parallel run (data)"})
    ret = api.project("ret")
    nxt = next(m for m in ret["milestones"] if m["id"] == "ret-next-0")
    assert nxt["name"] == "Parallel run on November BD3"


def test_milestone_errors(api: Api) -> None:
    api.error("POST", "/projects/nope/milestones", {"horizon": "now"}, 404)
    api.error("POST", "/projects/ret/milestones", {"horizon": "explicit"}, 422)
    error = api.error("PATCH", "/milestones/ret-now-0", {"dueDate": "1900-01-01"}, 422)
    assert (error["code"], error["field"]) == ("OUT_OF_RANGE", "dueDate")


# ---------------------------------------------------------------------------- tasks
def test_task_add_defaults_to_an_hour(api: Api) -> None:
    out = api.call("POST", "/milestones/ret-now-1/tasks", {"text": "Map FX classes"}, 201)
    task = out["entity"]
    assert (task["text"], task["hours"], task["milestoneId"]) == ("Map FX classes", 1, "ret-now-1")
    assert (task["done"], task["doneOn"], task["dueDate"]) == (False, None, None)
    assert task["sortOrder"] == 3  # after ret-3, ret-4 and ret-5
    milestone = _milestone(api, "ret-now-1")
    assert milestone is not None
    assert [t["id"] for t in milestone["tasks"]][-1] == task["id"]
    assert out["movements"] == []


def test_tasks_only_go_under_now_milestones(api: Api) -> None:
    error = api.error("POST", "/milestones/ret-next-0/tasks", {"text": "x"}, 409)
    assert error["code"] == "CONFLICT"
    api.error("POST", "/milestones/nope/tasks", {"text": "x"}, 404)


def test_task_edit_tick_and_blank_delete(api: Api) -> None:
    edited = api.call("PATCH", "/tasks/ret-3", {"text": "Reconcile", "hours": 2.5})["entity"]
    assert (edited["text"], edited["hours"]) == ("Reconcile", 2.5)
    ticked = api.call("PATCH", "/tasks/ret-3", {"done": True})["entity"]
    assert (ticked["done"], ticked["doneOn"]) == (True, TODAY)
    again = api.call("PATCH", "/tasks/ret-1", {"done": True})["entity"]
    assert again["doneOn"] == "2026-10-01"  # already done: the original date stays
    unticked = api.call("PATCH", "/tasks/ret-3", {"done": False})["entity"]
    assert (unticked["done"], unticked["doneOn"]) == (False, None)
    due = api.call("PATCH", "/tasks/ret-3", {"dueDate": "2026-10-10"})["entity"]
    assert due["dueDate"] == "2026-10-12"
    removed = api.call("PATCH", "/tasks/ret-3", {"text": ""})["entity"]
    assert removed["id"] == "ret-3"
    milestone = _milestone(api, "ret-now-1")
    assert milestone is not None
    assert "ret-3" not in [t["id"] for t in milestone["tasks"]]


@pytest.mark.parametrize(
    ("body", "field"),
    [({"hours": 25}, "hours"), ({"hours": -1}, "hours"), ({"done": None}, "done")],
)
def test_task_refusals(api: Api, body: dict[str, Any], field: str) -> None:
    assert api.error("PATCH", "/tasks/ret-3", body, 422)["field"] == field


def test_task_reorder_and_delete(api: Api) -> None:
    out = api.call("PUT", "/milestones/ret-now-1/tasks/order", {"ids": ["ret-5", "ret-3", "ret-4"]})
    assert [t["id"] for t in out["entity"]["tasks"]] == ["ret-5", "ret-3", "ret-4"]
    api.error("PUT", "/milestones/ret-now-1/tasks/order", {"ids": ["ret-5"]}, 422)
    api.call("DELETE", "/tasks/ret-4")
    milestone = _milestone(api, "ret-now-1")
    assert milestone is not None
    assert [t["id"] for t in milestone["tasks"]] == ["ret-5", "ret-3"]
    api.error("DELETE", "/tasks/ret-4", None, 404)


# ---------------------------------------------------------------------------- readiness items
def test_readiness_items_crud(api: Api) -> None:
    before = api.project("fion")["readinessItems"]
    item = api.call(
        "POST",
        "/projects/fion/readiness-items",
        {"text": "Desk walkthrough", "dueDate": "2026-12-19"},
        201,
    )["entity"]
    assert (item["text"], item["dueDate"], item["sortOrder"]) == (
        "Desk walkthrough",
        "2026-12-21",  # Sat 19 Dec rolls to Mon 21 Dec
        len(before),
    )
    rid = item["id"]
    ticked = api.call("PATCH", f"/readiness-items/{rid}", {"done": True})["entity"]
    assert (ticked["done"], ticked["doneOn"]) == (True, TODAY)
    ids = [r["id"] for r in api.project("fion")["readinessItems"]]
    order = [ids[-1], *ids[:-1]]
    out = api.call("PUT", "/projects/fion/readiness-items/order", {"ids": order})
    assert [r["id"] for r in out["entity"]["readinessItems"]] == order
    removed = api.call("PATCH", f"/readiness-items/{rid}", {"text": ""})["entity"]
    assert removed["id"] == rid
    assert rid not in [r["id"] for r in api.project("fion")["readinessItems"]]
    api.call("DELETE", "/readiness-items/fion-rd-0")
    api.error("DELETE", "/readiness-items/fion-rd-0", None, 404)
    api.error("POST", "/projects/nope/readiness-items", {"text": "x"}, 404)


def test_item_routes_before_setup_are_409(bare: Api) -> None:
    for method, path, body in (
        ("POST", "/projects/ret/charter/success", {"text": "x"}),
        ("POST", "/projects/ret/milestones", {"horizon": "now"}),
        ("PATCH", "/tasks/ret-1", {"done": True}),
        ("POST", "/projects/ret/readiness-items", {"text": "x"}),
    ):
        assert bare.error(method, path, body, 409)["code"] == "SETUP_REQUIRED"
