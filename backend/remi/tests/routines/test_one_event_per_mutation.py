"""Every mutating route of routines, rotation, notes and aliases writes exactly one event, and a
refused request writes none."""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from remi.repositories.models.events import PLAN_NEUTRAL_EVENTS
from remi.tests.routines.support import events_since, revision

TODAY = "2026-10-05"
SEGMENTS = [
    {"id": "rot-0", "country": "Germany", "code": "DE", "lengthBd": 6, "pass": "Build"},
    {"country": "France", "code": "FR", "lengthBd": 5, "pass": "Build"},
]

# (method, path, body, success status, event type)
MUTATIONS: list[tuple[str, str, dict[str, Any] | None, int, str]] = [
    ("POST", "/api/routines", {}, 201, "routine.created"),
    ("PATCH", "/api/routines/r-ret", {"bd": 4}, 200, "routine.updated"),
    ("PATCH", "/api/routines/r-ret", {"stage": 2}, 200, "routine.stage_changed"),
    ("DELETE", "/api/routines/r-man", None, 200, "routine.deleted"),
    (
        "PUT",
        "/api/routines/r-man/runs/2026-10-12",
        {"completed": True},
        200,
        "routine.run_completed",
    ),
    (
        "PUT",
        "/api/routines/r-man/runs/2026-10-12",
        {"completed": False},
        200,
        "routine.run_reopened",
    ),
    ("PUT", f"/api/routines/r-ret/runs/{TODAY}/items", {"done": True}, 200, "routine.ticks_set"),
    (
        "PUT",
        f"/api/routines/r-ret/runs/{TODAY}/items/r-ret-fund-09",
        {"done": True},
        200,
        "routine.tick_set",
    ),
    (
        "POST",
        "/api/routines/r-man/checklist-items",
        {"label": "Charts"},
        201,
        "routine.checklist_item_added",
    ),
    (
        "PATCH",
        "/api/routine-checklist-items/r-ret-fund-01",
        {"label": "SDL I"},
        200,
        "routine.checklist_item_renamed",
    ),
    (
        "DELETE",
        "/api/routine-checklist-items/r-ret-fund-01",
        None,
        200,
        "routine.checklist_item_removed",
    ),
    ("PATCH", "/api/rotation", {"hoursPerDay": 3}, 200, "rotation.updated"),
    ("PUT", "/api/rotation/segments", {"segments": SEGMENTS}, 200, "rotation.segments_replaced"),
    ("POST", "/api/notes", {"day": TODAY, "text": "Jot"}, 201, "note.created"),
    ("PATCH", "/api/notes/n1", {"text": "Edited"}, 200, "note.updated"),
    ("DELETE", "/api/notes/n1", None, 200, "note.deleted"),
    (
        "POST",
        "/api/aliases",
        {"entityType": "project", "entityId": "ret", "alias": "fx fix"},
        201,
        "alias.created",
    ),
    ("DELETE", "/api/aliases/al-ret-1", None, 200, "alias.deleted"),
]


@pytest.mark.parametrize(
    ("method", "path", "payload", "status", "event_type"),
    MUTATIONS,
    ids=[f"{m[0]} {m[1]} {m[4]}" for m in MUTATIONS],
)
def test_exactly_one_event(
    client: TestClient,
    method: str,
    path: str,
    payload: dict[str, Any] | None,
    status: int,
    event_type: str,
) -> None:
    seq = revision(client)
    response = client.request(method, path, json=payload)
    assert response.status_code == status, response.text
    written = events_since(client, seq)
    assert [e["type"] for e in written] == [event_type]
    # A note text edit cannot change the plan, so it keeps the revision (and the ETag).
    expected = seq if event_type in PLAN_NEUTRAL_EVENTS else written[0]["seq"]
    assert response.json()["plan"]["revision"] == expected


def test_ordered_reorder_writes_one_event(client: TestClient) -> None:
    ids = [f"r-ret-fund-{i:02d}" for i in range(12, 0, -1)]
    seq = revision(client)
    response = client.put("/api/routines/r-ret/checklist-items/order", json={"ids": ids})
    assert response.status_code == 200, response.text
    assert [e["type"] for e in events_since(client, seq)] == ["routine.checklist_reordered"]
