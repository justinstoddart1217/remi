"""The plan revision (``PlanOut.revision`` and the ``GET /plan`` ETag) moves only with events
that can change the plan. Textbook edits and note text edits are in ``PLAN_NEUTRAL_EVENTS``:
autosave while typing must not turn every ``GET /plan`` into a rebuild and a 200.

Every neutral event type is exercised here, and after each one a plan rebuilt from scratch
(cache dropped) must equal the plan from before it, so the set can never hide a real change.
"""

from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from app import services
from app.repositories.models.events import PLAN_NEUTRAL_EVENTS
from app.services import views

CHART = b"<!doctype html><title>Yield</title><svg viewBox='0 0 10 10'></svg>"


def _ok(response: Any, status: int = 200) -> Any:
    assert response.status_code == status, response.text
    return response.json() if response.content else None


def _plan(client: TestClient) -> tuple[dict[str, Any], str]:
    response = client.get("/api/plan")
    return _ok(response), response.headers["ETag"]


def _fresh_plan(client: TestClient) -> dict[str, Any]:
    """The plan built from the database again, not served from the cache."""
    views.invalidate_plan_cache()
    return _plan(client)[0]


def _latest_seq(client: TestClient) -> int:
    seq = 0
    while True:
        page = _ok(client.get("/api/events", params={"since": seq, "limit": 200}))
        if page["items"]:
            seq = page["items"][-1]["seq"]
        if page["nextSince"] is None:
            return seq
        seq = page["nextSince"]


def _types_since(client: TestClient, seq: int) -> list[str]:
    page = _ok(client.get("/api/events", params={"since": seq, "limit": 200}))
    return [item["type"] for item in page["items"]]


def _put_blocks(client: TestClient, page_id: str, blocks: list[dict[str, Any]]) -> None:
    page = _ok(client.get(f"/api/textbook/pages/{page_id}"))
    _ok(
        client.put(
            f"/api/textbook/pages/{page_id}/blocks",
            json={"blocks": blocks, "baseVersion": page["version"]},
        )
    )


def _chart_block(asset_id: str) -> dict[str, Any]:
    return {
        "id": "rev-chart",
        "type": "chart",
        "assetId": asset_id,
        "name": "yield.html",
        "height": 380,
        "caption": "",
    }


def test_neutral_events_leave_the_plan_its_revision_and_etag_alone(
    seeded_client: TestClient,
) -> None:
    client = seeded_client
    before, etag = _plan(client)
    start = _latest_seq(client)
    note = _ok(client.post("/api/notes", json={"day": "2026-10-05", "text": "Revision probe"}), 201)
    before, etag = _plan(client)  # creating a note moves the counts, so the revision
    assert before["revision"] > start

    def still_the_same(what: str) -> None:
        response = client.get("/api/plan", headers={"If-None-Match": etag})
        assert response.status_code == 304, what
        assert response.headers["ETag"] == etag
        assert _fresh_plan(client) == before, what

    edited = _ok(client.patch(f"/api/notes/{note['entity']['id']}", json={"text": "Probe v2"}))
    assert edited["plan"]["revision"] == before["revision"]
    still_the_same("note text edit")

    gen = _ok(client.get("/api/textbook/pages/gen-how"))
    _put_blocks(client, "gen-how", [*gen["blocks"], {"id": "rev-p", "type": "p", "text": "Hi"}])
    still_the_same("blocks save")
    _ok(client.patch("/api/textbook/pages/gen-how", json={"title": "How it works"}))
    still_the_same("page rename")
    section = _ok(client.post("/api/textbook/sections", json={"label": "Scratch"}), 201)
    still_the_same("section create")
    _ok(client.patch(f"/api/textbook/sections/{section['id']}", json={"collapsed": True}))
    still_the_same("section update")
    tree = _ok(client.get("/api/textbook"))
    order = [s["id"] for s in tree["sections"]]
    _ok(client.put("/api/textbook/sections/order", json={"ids": order[::-1]}))
    still_the_same("sections reorder")
    _ok(client.delete(f"/api/textbook/sections/{section['id']}"), 204)
    still_the_same("section delete")
    _ok(client.post("/api/textbook/pages", json={"sectionId": "gen", "title": "Draft"}), 201)
    still_the_same("page create")

    upload = client.post("/api/textbook/charts", files={"file": ("yield.html", CHART, "text/html")})
    asset_id = _ok(upload, 201)["assetId"]
    still_the_same("chart upload")
    gen = _ok(client.get("/api/textbook/pages/gen-how"))
    _put_blocks(client, "gen-how", [*gen["blocks"], _chart_block(asset_id)])
    _put_blocks(client, "gen-how", gen["blocks"])  # drops the chart: collected at once
    still_the_same("charts collected")
    other = client.post(
        "/api/textbook/charts", files={"file": ("other.html", b"<p>other</p>", "text/html")}
    )
    _ok(client.delete(f"/api/textbook/charts/{_ok(other, 201)['assetId']}"), 204)
    still_the_same("chart delete")

    seen = set(_types_since(client, start))
    assert seen >= PLAN_NEUTRAL_EVENTS, sorted(PLAN_NEUTRAL_EVENTS - seen)
    assert _plan(client)[0]["revision"] == before["revision"]


def test_plan_affecting_events_move_the_revision(seeded_client: TestClient) -> None:
    client = seeded_client
    first, etag = _plan(client)
    note = _ok(client.post("/api/notes", json={"day": "2026-10-05", "text": "Counted"}), 201)
    assert note["plan"]["revision"] > first["revision"]
    assert note["plan"]["counts"]["notesToday"] == first["counts"]["notesToday"] + 1
    assert client.get("/api/plan", headers={"If-None-Match": etag}).status_code == 200

    second, etag = _plan(client)
    _ok(client.delete(f"/api/notes/{note['entity']['id']}"))
    third, _ = _plan(client)
    assert third["revision"] > second["revision"]
    assert third["counts"]["notesToday"] == first["counts"]["notesToday"]

    # Deleting a page may rewrite settings.uiPrefs (the plan carries them): not neutral.
    _ok(client.delete("/api/textbook/pages/gen-how"))
    fourth, _ = _plan(client)
    assert fourth["revision"] > third["revision"]
    assert "textbook.page_deleted" not in PLAN_NEUTRAL_EVENTS


def test_every_neutral_type_is_a_recorded_event_type() -> None:
    """No typos: each member is an event type some service records."""
    sources = "\n".join(
        path.read_text(encoding="utf-8") for path in Path(services.__file__).parent.glob("*.py")
    )
    for event_type in PLAN_NEUTRAL_EVENTS:
        assert f'"{event_type}"' in sources, event_type
