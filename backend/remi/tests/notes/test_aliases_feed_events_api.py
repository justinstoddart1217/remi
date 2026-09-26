"""Aliases, the feed and the event log (data only), on the design seed."""

from fastapi.testclient import TestClient

from remi.tests.routines.support import body, error, events_since, one_event, revision, rows

TODAY = "2026-10-05"


def _n1_labels(client: TestClient) -> list[str]:
    notes = body(client.get("/api/notes", params={"day": TODAY}))["notes"]
    return [t["label"] for t in notes[0]["tags"]]


# ---------------------------------------------------------------------------- aliases
def test_list_aliases(client: TestClient) -> None:
    aliases = rows(client.get("/api/aliases"))
    assert {"id": "al-ret-1", "entityType": "project", "entityId": "ret", "alias": "pipeline"} in (
        aliases
    )
    assert {
        "id": "al-r-ret-1",
        "entityType": "routine",
        "entityId": "r-ret",
        "alias": "funds",
    } in aliases
    assert aliases == body(client.get("/api/plan"))["aliases"]


def test_aliases_list_before_setup(fresh_client: TestClient) -> None:
    assert rows(fresh_client.get("/api/aliases")) == []


def test_an_alias_retags_notes_and_goes_again(client: TestClient) -> None:
    assert _n1_labels(client) == ["Returns · BAU"]
    seq = revision(client)
    response = client.post(
        "/api/aliases",
        json={"entityType": "project", "entityId": "play", "alias": " Admin  FILES "},
    )
    assert response.status_code == 201, response.text
    out = body(response)
    alias = out["entity"]
    assert (alias["entityType"], alias["entityId"], alias["alias"]) == (
        "project",
        "play",
        "admin files",
    )
    assert alias in out["plan"]["aliases"]
    assert out["movements"] == []
    assert one_event(client, seq)["type"] == "alias.created"
    assert _n1_labels(client) == ["Handover playbook", "Returns · BAU"]

    seq = revision(client)
    deleted = client.delete(f"/api/aliases/{alias['id']}")
    assert deleted.status_code == 200, deleted.text
    assert alias not in body(deleted)["plan"]["aliases"]
    assert one_event(client, seq)["type"] == "alias.deleted"
    assert _n1_labels(client) == ["Returns · BAU"]
    assert client.delete(f"/api/aliases/{alias['id']}").status_code == 404


def test_routine_alias(client: TestClient) -> None:
    out = body(
        client.post(
            "/api/aliases", json={"entityType": "routine", "entityId": "r-man", "alias": "pack"}
        )
    )
    assert out["entity"]["entityType"] == "routine"
    tags = body(client.post("/api/notes/tags", json={"text": "The pack is late"}))["tags"]
    assert [t["label"] for t in tags] == ["ManCo pack · BAU"]


def test_alias_errors(client: TestClient) -> None:
    seq = revision(client)
    duplicate = client.post(
        "/api/aliases", json={"entityType": "project", "entityId": "ret", "alias": "Pipeline"}
    )
    assert duplicate.status_code == 409
    assert error(duplicate)["field"] == "alias"
    unknown = client.post(
        "/api/aliases", json={"entityType": "routine", "entityId": "ret", "alias": "loop"}
    )
    assert unknown.status_code == 404
    assert error(unknown)["field"] == "entityId"
    too_short = client.post(
        "/api/aliases", json={"entityType": "project", "entityId": "ret", "alias": "a  "}
    )
    assert too_short.status_code == 422
    assert error(too_short)["field"] == "alias"
    schema = client.post(
        "/api/aliases", json={"entityType": "team", "entityId": "ret", "alias": "loop"}
    )
    assert schema.status_code == 422
    assert events_since(client, seq) == []


def test_alias_writes_need_setup(fresh_client: TestClient) -> None:
    response = fresh_client.post(
        "/api/aliases", json={"entityType": "project", "entityId": "ret", "alias": "loop"}
    )
    assert response.status_code == 409


# ---------------------------------------------------------------------------- feed
def test_feed_pages_newest_first(client: TestClient) -> None:
    client.patch("/api/routines/r-man", json={"stage": 2})
    client.patch("/api/routines/r-man", json={"stage": 3})
    first = body(client.get("/api/feed", params={"limit": 2}))
    assert [i["body"] for i in first["items"]] == [
        "Handover status Shadowed → Handed over. It drops off your plan.",
        "Handover status Automating → Shadowed.",
    ]
    assert first["nextBefore"] == first["items"][-1]["id"]
    rest = body(client.get("/api/feed", params={"limit": 2, "before": first["nextBefore"]}))
    assert [i["id"] for i in rest["items"]] == ["f1"]
    assert rest["nextBefore"] is None
    assert rest["items"][0]["kind"] == "scope"


def test_feed_unknown_cursor_is_422(client: TestClient) -> None:
    response = client.get("/api/feed", params={"before": "nope"})
    assert response.status_code == 422
    assert error(response)["field"] == "before"


def test_feed_before_setup_is_empty(fresh_client: TestClient) -> None:
    assert body(fresh_client.get("/api/feed")) == {"items": [], "nextBefore": None}


# ---------------------------------------------------------------------------- events
def test_events_page_oldest_first(client: TestClient) -> None:
    first = body(client.get("/api/events", params={"since": 0, "limit": 1}))
    (event,) = first["items"]
    assert (event["seq"], event["type"], event["actor"]) == (1, "dev.fixture_loaded", "import")
    assert event["refs"] == [{"type": "fixture", "id": "design"}]
    assert event["schemaVersion"] == 1
    assert first["nextSince"] == 1
    latest = revision(client)
    tail = body(client.get("/api/events", params={"since": latest}))
    assert tail == {"items": [], "nextSince": None}
    assert client.get("/api/events", params={"since": -1}).status_code == 422


def test_events_carry_the_input_and_diff(client: TestClient) -> None:
    seq = revision(client)
    client.post("/api/notes", json={"day": TODAY, "text": "Quick jot"})
    event = one_event(client, seq)
    assert event["payload"]["input"] == {"day": TODAY, "text": "Quick jot"}
    assert [d["table"] for d in event["payload"]["diff"]] == ["notes"]
    assert event["businessDate"] == TODAY
    assert event["actor"] == "user"
