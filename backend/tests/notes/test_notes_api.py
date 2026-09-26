"""``/notes`` on the design seed: n1-n3 on Mon 5 Oct, n4-n5 on Fri 2 Oct, n6 on Thu 1 Oct.

Tags come from the engine's alias tagger (word boundaries, three characters or more): n2 names
the pipeline and the funds, so it tags the project and its co-tagging returns routine.
"""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.routines.support import body, error, events_since, one_event, revision

TODAY = "2026-10-05"


def _labels(tags: list[dict[str, Any]]) -> list[str]:
    return [t["label"] for t in tags]


# ---------------------------------------------------------------------------- one day
def test_day_notes_with_tags_and_mentions(client: TestClient) -> None:
    out = body(client.get("/api/notes", params={"day": TODAY}))
    assert out["day"] == TODAY
    notes = out["notes"]
    assert [(n["id"], n["seq"], n["timeLabel"]) for n in notes] == [
        ("n1", 0, "08:41"),
        ("n2", 1, "09:55"),
        ("n3", 2, "11:20"),
    ]
    assert _labels(notes[0]["tags"]) == ["Returns · BAU"]
    assert _labels(notes[1]["tags"]) == ["Returns pipeline", "Returns · BAU"]
    assert _labels(notes[2]["tags"]) == ["ManCo automation"]
    assert notes[1]["tags"][0] == {
        "targetType": "project",
        "targetId": "ret",
        "label": "Returns pipeline",
        "domain": "pc",
    }
    assert [(m["targetId"], m["count"]) for m in out["mentions"]] == [
        ("r-ret", 2),
        ("ret", 1),
        ("manco", 1),
    ]


def test_empty_day(client: TestClient) -> None:
    out = body(client.get("/api/notes", params={"day": "2026-10-06"}))
    assert (out["notes"], out["mentions"]) == ([], [])


def test_other_days_tag_fi_and_playbook(client: TestClient) -> None:
    friday = body(client.get("/api/notes", params={"day": "2026-10-02"}))["notes"]
    assert [_labels(n["tags"]) for n in friday] == [["Handover playbook"], ["FI onboarding"]]
    assert friday[1]["tags"][0]["domain"] == "fi"


@pytest.mark.parametrize(
    ("text", "labels"),
    [
        ("The alphabet soup is cold", []),
        ("Alpha engine signal looks good", ["Alpha engine"]),
        ("Entitlements are in", []),
        ("Chased the entitlement forms", ["FI onboarding"]),
        ("ManCo pack went out", ["ManCo automation"]),
        ("BD8 pack went out", ["ManCo pack · BAU"]),
        ("RETURNS PIPELINE and funds", ["Returns pipeline", "Returns · BAU"]),
        ("", []),
    ],
)
def test_tag_preview_uses_word_boundaries(client: TestClient, text: str, labels: list[str]) -> None:
    out = body(client.post("/api/notes/tags", json={"text": text}))
    assert _labels(out["tags"]) == labels


# ---------------------------------------------------------------------------- index and rail
def test_note_days_index_and_rail(client: TestClient) -> None:
    out = body(client.get("/api/notes/days"))
    assert (out["from"], out["to"], out["total"], out["dayCount"]) == (None, None, 6, 3)
    days = out["days"]
    assert [(d["day"], d["count"]) for d in days] == [
        ("2026-10-05", 3),
        ("2026-10-02", 2),
        ("2026-10-01", 1),
    ]
    assert days[0] == {
        "day": TODAY,
        "count": 3,
        "latestPreview": "Finance happy to review the ManCo NAV bridge spec on Thursday.",
        "w": 1,
        "bd": True,
        "bdm": 3,
        "hol": None,
        "weekOf": TODAY,
        "today": True,
    }
    assert (days[1]["weekOf"], days[1]["bdm"], days[1]["today"]) == ("2026-09-28", 2, False)

    rail = out["rail"]
    # Business days from today back to Tue 8 Sep (TODAY - 27), newest first.
    assert rail[0]["day"] == TODAY
    assert rail[-1]["day"] == "2026-09-08"
    assert len(rail) == 20
    assert all(r["bd"] for r in rail)
    empty = next(r for r in rail if r["day"] == "2026-09-30")
    assert (empty["count"], empty["latestPreview"], empty["bdm"]) == (0, "", 22)


def test_note_days_range(client: TestClient) -> None:
    out = body(client.get("/api/notes/days", params={"from": "2026-10-01", "to": "2026-10-02"}))
    assert [d["day"] for d in out["days"]] == ["2026-10-02", "2026-10-01"]
    assert (out["total"], out["dayCount"]) == (6, 3)
    assert len(out["rail"]) == 20
    backwards = client.get("/api/notes/days", params={"from": "2026-10-02", "to": "2026-10-01"})
    assert backwards.status_code == 422


def test_rail_keeps_old_and_future_note_days(client: TestClient) -> None:
    client.post("/api/notes", json={"day": "2026-08-31", "text": "Bank holiday jot"})
    client.post("/api/notes", json={"day": "2026-10-09", "text": "Friday plan"})
    rail = body(client.get("/api/notes/days"))["rail"]
    assert rail[0]["day"] == "2026-10-09"
    holiday = rail[-1]
    assert (holiday["day"], holiday["bd"], holiday["hol"]) == (
        "2026-08-31",
        False,
        "Late Summer Bank Holiday",
    )


# ---------------------------------------------------------------------------- recent and prefill
def test_recent_notes_cover_five_business_days(client: TestClient) -> None:
    out = body(client.get("/api/notes/recent"))
    assert out["businessDays"] == [
        "2026-09-29",
        "2026-09-30",
        "2026-10-01",
        "2026-10-02",
        "2026-10-05",
    ]
    assert out["count"] == 6
    assert [n["id"] for n in out["notes"]] == ["n6", "n4", "n5", "n1", "n2", "n3"]
    two = body(client.get("/api/notes/recent", params={"businessDays": 2}))
    assert (two["businessDays"], two["count"]) == (["2026-10-02", TODAY], 5)
    assert client.get("/api/notes/recent", params={"businessDays": 21}).status_code == 422


def test_day_text_for_today_and_a_past_day(client: TestClient) -> None:
    today = body(client.get("/api/notes/day-text", params={"day": TODAY}))
    assert today["count"] == 3
    assert today["text"] == (
        "08:41 Admin files landed at 07:40 this morning instead of last night, so returns "
        "started late.\n"
        "09:55 5 of 12 funds done. Unitranche needed the manual FX fix again, which is exactly "
        "what the pipeline should remove.\n"
        "11:20 Finance happy to review the ManCo NAV bridge spec on Thursday."
    )
    friday = body(client.get("/api/notes/day-text", params={"day": "2026-10-02"}))
    assert friday["count"] == 2
    assert friday["text"].split("\n") == [
        "Fri 2 Oct",
        "16:10 Recorded the September BD3 run as raw notes for the playbook. Needs tidying "
        "into steps.",
        "17:32 FI desk suggested Bloomberg curve data rather than the internal feed for day one.",
    ]
    empty = body(client.get("/api/notes/day-text", params={"day": "2026-10-06"}))
    assert (empty["text"], empty["count"]) == ("", 0)


# ---------------------------------------------------------------------------- writes
def test_create_note(client: TestClient) -> None:
    seq = revision(client)
    response = client.post(
        "/api/notes", json={"day": TODAY, "text": "  Sent the NAV bridge spec to Finance.  "}
    )
    assert response.status_code == 201, response.text
    out = body(response)
    note = out["entity"]
    assert note["text"] == "Sent the NAV bridge spec to Finance."
    assert (note["day"], note["seq"], note["timeLabel"]) == (TODAY, 3, "09:00")
    assert note["createdAt"] == "2026-10-05T08:00:00Z"
    assert _labels(note["tags"]) == ["ManCo automation"]
    assert out["movements"] == []
    counts = out["plan"]["counts"]
    assert (counts["notesTotal"], counts["notesToday"], counts["recentNotes"]) == (7, 4, 7)
    event = one_event(client, seq)
    assert (event["type"], event["refs"]) == ("note.created", [{"type": "note", "id": note["id"]}])
    listed = body(client.get("/api/notes", params={"day": TODAY}))["notes"]
    assert listed[-1] == note


def test_backfilled_note_keeps_its_day(client: TestClient) -> None:
    note = body(client.post("/api/notes", json={"day": "2026-10-02", "text": "Late jot"}))["entity"]
    assert (note["day"], note["seq"], note["timeLabel"]) == ("2026-10-02", 2, "09:00")
    days = body(client.get("/api/notes/days"))["days"]
    assert next(d for d in days if d["day"] == "2026-10-02")["latestPreview"] == "Late jot"


def test_edit_note_retags(client: TestClient) -> None:
    seq = revision(client)
    response = client.patch("/api/notes/n3", json={"text": "The playbook needs the ManCo steps."})
    assert response.status_code == 200, response.text
    note = body(response)["entity"]
    assert _labels(note["tags"]) == ["ManCo automation", "Handover playbook"]
    assert (note["seq"], note["timeLabel"]) == (2, "11:20")
    assert one_event(client, seq)["type"] == "note.updated"


def test_delete_note(client: TestClient) -> None:
    seq = revision(client)
    response = client.delete("/api/notes/n1")
    assert response.status_code == 200, response.text
    assert body(response)["plan"]["counts"]["notesToday"] == 2
    assert one_event(client, seq)["type"] == "note.deleted"
    assert [n["id"] for n in body(client.get("/api/notes", params={"day": TODAY}))["notes"]] == [
        "n2",
        "n3",
    ]
    assert client.delete("/api/notes/n1").status_code == 404
    assert client.patch("/api/notes/n1", json={"text": "x"}).status_code == 404


@pytest.mark.parametrize(
    ("method", "path", "payload", "field"),
    [
        ("POST", "/api/notes", {"day": TODAY, "text": "   "}, "text"),
        ("POST", "/api/notes", {"day": TODAY, "text": ""}, "text"),
        ("POST", "/api/notes", {"day": "2099-01-02", "text": "far"}, "day"),
        ("POST", "/api/notes", {"day": "not-a-day", "text": "x"}, "day"),
        ("PATCH", "/api/notes/n1", {"text": "  "}, "text"),
        ("PATCH", "/api/notes/n1", {"text": ""}, "text"),
    ],
)
def test_note_validation(
    client: TestClient, method: str, path: str, payload: dict[str, Any], field: str
) -> None:
    seq = revision(client)
    response = client.request(method, path, json=payload)
    assert response.status_code == 422, response.text
    assert error(response)["field"] == field
    assert events_since(client, seq) == []


# ---------------------------------------------------------------------------- before setup
def test_note_reads_work_before_setup(fresh_client: TestClient) -> None:
    assert body(fresh_client.get("/api/notes", params={"day": TODAY}))["notes"] == []
    days = body(fresh_client.get("/api/notes/days"))
    assert (days["days"], days["total"], days["dayCount"]) == ([], 0, 0)
    assert days["rail"][0]["day"] == TODAY
    assert len(days["rail"]) == 20
    text = body(fresh_client.get("/api/notes/day-text", params={"day": TODAY}))
    assert text == {"day": TODAY, "text": "", "count": 0}
    assert body(fresh_client.post("/api/notes/tags", json={"text": "returns"}))["tags"] == []
    recent = fresh_client.get("/api/notes/recent")
    assert recent.status_code == 409


def test_note_writes_need_setup_and_save_nothing(fresh_client: TestClient) -> None:
    response = fresh_client.post("/api/notes", json={"day": TODAY, "text": "Too early"})
    assert response.status_code == 409
    assert error(response)["code"] == "SETUP_REQUIRED"
    assert body(fresh_client.get("/api/notes", params={"day": TODAY}))["notes"] == []
