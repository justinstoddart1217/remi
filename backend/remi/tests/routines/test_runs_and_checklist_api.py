"""Routine runs, checklist ticks and checklist items (today is Mon 5 Oct 2026, BD3).

The seed ticks funds 1-5 of the returns run (``r-ret``) today. ``r-ret`` runs on BD3 (5 Oct,
4 Nov, 3 Dec); ``r-man`` on BD8 (12 Oct ...).
"""

from fastapi.testclient import TestClient

from remi.tests.routines.support import body, error, events_since, one_event, revision, routine

FUNDS = [f"r-ret-fund-{i:02d}" for i in range(1, 13)]
TODAY = "2026-10-05"


# ---------------------------------------------------------------------------- runs
def test_mark_a_future_run_complete_and_reopen_it(client: TestClient) -> None:
    seq = revision(client)
    response = client.put("/api/routines/r-man/runs/2026-10-12", json={"completed": True})
    assert response.status_code == 200, response.text
    run = body(response)["entity"]
    assert run["routineId"] == "r-man"
    assert run["occurrenceDate"] == "2026-10-12"
    assert (run["completed"], run["done"], run["completedOn"]) == (True, True, TODAY)
    assert run["completedAt"] is not None
    assert (run["itemCount"], run["tickedItemIds"]) == (0, [])
    event = one_event(client, seq)
    assert event["type"] == "routine.run_completed"
    assert event["payload"]["input"] == {"iso": "2026-10-12", "completed": True}

    reopened = body(client.put("/api/routines/r-man/runs/2026-10-12", json={"completed": False}))
    assert (reopened["entity"]["completed"], reopened["entity"]["completedOn"]) == (False, None)


def test_completing_twice_keeps_the_first_completion(client: TestClient) -> None:
    first = body(client.put("/api/routines/r-man/runs/2026-10-12", json={"completed": True}))
    second = body(client.put("/api/routines/r-man/runs/2026-10-12", json={"completed": True}))
    assert second["entity"]["completedAt"] == first["entity"]["completedAt"]


def test_today_run_shows_in_the_plan(client: TestClient) -> None:
    out = body(client.put(f"/api/routines/r-ret/runs/{TODAY}", json={"completed": True}))
    today_run = routine(out["plan"], "r-ret")["derived"]["todayRun"]
    assert today_run == out["entity"]
    assert today_run["tickedItemIds"] == FUNDS[:5]
    assert today_run["done"] is True


def test_run_on_a_day_the_routine_does_not_run_is_422(client: TestClient) -> None:
    seq = revision(client)
    for iso in ("2026-11-05", "2026-10-10"):  # a BD4, a Saturday
        response = client.put(f"/api/routines/r-ret/runs/{iso}", json={"completed": True})
        assert response.status_code == 422, iso
        assert error(response) == {
            "code": "NOT_AN_OCCURRENCE",
            "message": "This routine does not run on that day.",
            "field": "iso",
        }
    assert events_since(client, seq) == []


def test_run_far_away_is_out_of_range(client: TestClient) -> None:
    response = client.put("/api/routines/r-ret/runs/2099-01-06", json={"completed": True})
    assert response.status_code == 422
    assert error(response)["code"] == "OUT_OF_RANGE"


def test_run_of_unknown_routine_is_404(client: TestClient) -> None:
    response = client.put(f"/api/routines/nope/runs/{TODAY}", json={"completed": True})
    assert response.status_code == 404


# ---------------------------------------------------------------------------- ticks
def test_tick_one_item_of_today_run(client: TestClient) -> None:
    seq = revision(client)
    response = client.put(f"/api/routines/r-ret/runs/{TODAY}/items/{FUNDS[5]}", json={"done": True})
    assert response.status_code == 200, response.text
    out = body(response)
    run = out["entity"]
    assert run["tickedItemIds"] == FUNDS[:6]
    assert (run["itemCount"], run["done"], run["completed"]) == (12, False, False)
    assert routine(out["plan"], "r-ret")["derived"]["todayRun"] == run
    event = one_event(client, seq)
    assert event["type"] == "routine.tick_set"

    untick = body(
        client.put(f"/api/routines/r-ret/runs/{TODAY}/items/{FUNDS[0]}", json={"done": False})
    )
    assert untick["entity"]["tickedItemIds"] == FUNDS[1:6]


def test_tick_all_makes_the_run_done(client: TestClient) -> None:
    seq = revision(client)
    out = body(client.put(f"/api/routines/r-ret/runs/{TODAY}/items", json={"done": True}))
    run = out["entity"]
    assert run["tickedItemIds"] == FUNDS
    assert (run["done"], run["completed"]) == (True, False)
    event = one_event(client, seq)
    assert (event["type"], event["payload"]["effects"]["changed"]) == ("routine.ticks_set", 7)
    day = body(client.get(f"/api/day/{TODAY}"))
    assert day is not None

    cleared = body(client.put(f"/api/routines/r-ret/runs/{TODAY}/items", json={"done": False}))
    assert (cleared["entity"]["tickedItemIds"], cleared["entity"]["done"]) == ([], False)


def test_only_today_run_takes_ticks(client: TestClient) -> None:
    seq = revision(client)
    future = client.put(
        f"/api/routines/r-ret/runs/2026-11-04/items/{FUNDS[0]}", json={"done": True}
    )
    assert future.status_code == 409
    assert error(future)["code"] == "RUN_NOT_EDITABLE"
    all_future = client.put("/api/routines/r-ret/runs/2026-11-04/items", json={"done": True})
    assert all_future.status_code == 409
    not_a_run = client.put(
        f"/api/routines/r-ret/runs/2026-10-06/items/{FUNDS[0]}", json={"done": True}
    )
    assert not_a_run.status_code == 422
    assert error(not_a_run)["code"] == "NOT_AN_OCCURRENCE"
    assert events_since(client, seq) == []


def test_tick_unknown_or_foreign_item_is_404(client: TestClient) -> None:
    item = body(client.post("/api/routines/r-man/checklist-items", json={"label": "Charts"}))[
        "entity"
    ]
    for item_id in ("nope", item["id"]):
        response = client.put(
            f"/api/routines/r-ret/runs/{TODAY}/items/{item_id}", json={"done": True}
        )
        assert response.status_code == 404, item_id
        assert error(response)["field"] == "itemId"


def test_tick_all_on_a_routine_without_checklist(client: TestClient) -> None:
    # r-man does not run today (BD3), so first move it to today's business day.
    client.patch("/api/routines/r-man", json={"bd": 3})
    out = body(client.put(f"/api/routines/r-man/runs/{TODAY}/items", json={"done": True}))
    assert (out["entity"]["itemCount"], out["entity"]["done"]) == (0, False)


# ---------------------------------------------------------------------------- checklist items
def test_checklist_item_lifecycle(client: TestClient) -> None:
    seq = revision(client)
    created = client.post("/api/routines/r-man/checklist-items", json={})
    assert created.status_code == 201, created.text
    item = body(created)["entity"]
    assert (item["routineId"], item["label"], item["sortOrder"]) == ("r-man", "", 0)
    assert one_event(client, seq)["type"] == "routine.checklist_item_added"
    assert routine(body(created)["plan"], "r-man")["checklistItems"] == [item]

    second = body(client.post("/api/routines/r-man/checklist-items", json={"label": " Charts "}))
    assert (second["entity"]["label"], second["entity"]["sortOrder"]) == ("Charts", 1)

    renamed = client.patch(
        f"/api/routine-checklist-items/{item['id']}", json={"label": "Commentary"}
    )
    assert renamed.status_code == 200, renamed.text
    assert body(renamed)["entity"]["label"] == "Commentary"

    order = [second["entity"]["id"], item["id"]]
    reordered = body(client.put("/api/routines/r-man/checklist-items/order", json={"ids": order}))
    assert [i["id"] for i in reordered["entity"]["checklistItems"]] == order
    assert [i["sortOrder"] for i in reordered["entity"]["checklistItems"]] == [0, 1]

    seq = revision(client)
    deleted = client.delete(f"/api/routine-checklist-items/{item['id']}")
    assert deleted.status_code == 200, deleted.text
    assert [i["id"] for i in routine(body(deleted)["plan"], "r-man")["checklistItems"]] == [
        second["entity"]["id"]
    ]
    assert one_event(client, seq)["type"] == "routine.checklist_item_removed"
    assert client.delete(f"/api/routine-checklist-items/{item['id']}").status_code == 404


def test_deleting_a_ticked_item_drops_its_tick(client: TestClient) -> None:
    out = body(client.delete(f"/api/routine-checklist-items/{FUNDS[0]}"))
    today_run = routine(out["plan"], "r-ret")["derived"]["todayRun"]
    assert today_run["tickedItemIds"] == FUNDS[1:5]
    assert today_run["itemCount"] == 11


def test_blank_label_is_422(client: TestClient) -> None:
    seq = revision(client)
    for label in ("   ", ""):
        response = client.patch(f"/api/routine-checklist-items/{FUNDS[0]}", json={"label": label})
        assert response.status_code == 422, label
        assert error(response)["field"] == "label"
    assert events_since(client, seq) == []


def test_reorder_needs_every_id_once(client: TestClient) -> None:
    for ids in (FUNDS[:11], [*FUNDS[:11], FUNDS[0]], [*FUNDS[:11], "nope"]):
        response = client.put("/api/routines/r-ret/checklist-items/order", json={"ids": ids})
        assert response.status_code == 422
        assert error(response)["field"] == "ids"
    reversed_ids = list(reversed(FUNDS))
    out = body(client.put("/api/routines/r-ret/checklist-items/order", json={"ids": reversed_ids}))
    assert [i["id"] for i in out["entity"]["checklistItems"]] == reversed_ids
    # Ticks follow the checklist order.
    assert out["entity"]["derived"]["todayRun"]["tickedItemIds"] == list(reversed(FUNDS[:5]))


def test_checklist_items_of_unknown_routine_or_item_are_404(client: TestClient) -> None:
    assert client.post("/api/routines/nope/checklist-items", json={}).status_code == 404
    assert (
        client.put("/api/routines/nope/checklist-items/order", json={"ids": []}).status_code == 404
    )
    assert client.patch("/api/routine-checklist-items/nope", json={"label": "x"}).status_code == 404
