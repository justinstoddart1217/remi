"""``/settings``, the AI key, holidays and leave (on the design seed)."""

from typing import Any

import pytest
from fastapi.testclient import TestClient


def _error(response: Any) -> dict[str, Any]:
    body: dict[str, Any] = response.json()
    return body["error"]


def test_get_settings_never_includes_a_key(seeded_client: TestClient) -> None:
    settings = seeded_client.get("/api/settings").json()
    assert settings["setupComplete"] is True
    assert settings["keyProjectId"] == "ret"
    assert not any(k.lower() == "key" or k == "apiKey" for k in settings)
    assert settings["uiPrefs"]["lastTextbookPageId"] == "fi-rates"
    assert settings["uiPrefs"]["timelineZoom"] == "3m"


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"keyProjectId": "nope"}, "keyProjectId"),
        ({"keyRoutineId": "nope"}, "keyRoutineId"),
        ({"moveDate": None}, "moveDate"),
        ({"moveDate": "2026-10-02"}, "moveDate"),
        ({"capacityHoursPerDay": None}, "capacityHoursPerDay"),
        ({"ollamaBaseUrl": "http://example.com:11434"}, "ollamaBaseUrl"),
        ({"aiProvider": None}, "aiProvider"),
    ],
)
def test_patch_settings_validation(
    seeded_client: TestClient, body: dict[str, Any], field: str
) -> None:
    before = seeded_client.get("/api/plan").json()["revision"]
    response = seeded_client.patch("/api/settings", json=body)
    assert response.status_code == 422, response.text
    assert _error(response)["field"] == field
    assert seeded_client.get("/api/plan").json()["revision"] == before


def test_patch_settings_schema_validation(seeded_client: TestClient) -> None:
    for body in (
        {"capacityHoursPerDay": 30},
        {"accentPc": "red"},
        {"timezone": "Nowhere/Land"},
        {"surprise": 1},
    ):
        assert seeded_client.patch("/api/settings", json=body).status_code == 422, body


def test_patch_key_items_appearance_and_ai(seeded_client: TestClient) -> None:
    response = seeded_client.patch(
        "/api/settings",
        json={
            "keyProjectId": "manco",
            "keyRoutineId": "r-man",
            "accentPc": "#112233",
            "motionPreference": "reduced",
            "serifDisplay": False,
            "aiProvider": "ollama",
            "aiModel": "llama3.2",
            "aiSendRecentNotes": True,
            "ollamaBaseUrl": "http://localhost:11434",
            "uiPrefs": {"timelineZoom": "2w"},
        },
    )
    assert response.status_code == 200, response.text
    out = response.json()
    entity = out["entity"]
    assert (entity["keyProjectId"], entity["keyRoutineId"]) == ("manco", "r-man")
    assert (entity["accentPc"], entity["motionPreference"], entity["serifDisplay"]) == (
        "#112233",
        "reduced",
        False,
    )
    assert (entity["aiProvider"], entity["aiModel"], entity["aiSendRecentNotes"]) == (
        "ollama",
        "llama3.2",
        True,
    )
    assert entity["uiPrefs"]["timelineZoom"] == "2w"
    assert entity["uiPrefs"]["lastTextbookPageId"] == "fi-rates"  # merged, not replaced
    assert out["plan"]["verdict"]["keyProjectId"] == "manco"
    assert out["plan"]["verdict"]["keyRun"] == "2026-12-10"
    assert out["plan"]["settings"] == entity
    cleared = seeded_client.patch("/api/settings", json={"keyProjectId": None, "aiModel": None})
    assert cleared.json()["entity"]["keyProjectId"] is None
    assert cleared.json()["entity"]["aiModel"] is None
    assert cleared.json()["plan"]["verdict"]["keyProjectId"] is None


def test_patch_capacity_reshapes_loads_but_moves_no_forecast(seeded_client: TestClient) -> None:
    response = seeded_client.patch("/api/settings", json={"capacityHoursPerDay": 10})
    assert response.status_code == 200
    out = response.json()
    assert out["movements"] == []
    assert out["plan"]["loads"]["2026-11-04"]["over"] is False
    assert out["plan"]["flags"]["upcomingOverloads"] == []


def test_patch_move_date_snaps_and_is_recorded(seeded_client: TestClient) -> None:
    response = seeded_client.patch("/api/settings", json={"moveDate": "2027-01-01"})
    assert response.status_code == 200
    assert response.json()["entity"]["moveDate"] == "2027-01-04"
    unchanged = seeded_client.get("/api/plan").json()["revision"]
    # Snapping to the same date is no change: no event, same revision.
    assert seeded_client.patch("/api/settings", json={"moveDate": "2027-01-02"}).status_code == 200
    assert seeded_client.get("/api/plan").json()["revision"] == unchanged
    later = seeded_client.patch("/api/settings", json={"moveDate": "2027-02-01"}).json()
    assert later["plan"]["move"]["countdownBd"] == 81
    assert later["plan"]["rotation"]["segments"][0]["start"] == "2027-02-01"


def test_patch_region_switches_the_calendar(seeded_client: TestClient) -> None:
    response = seeded_client.patch("/api/settings", json={"holidayRegion": "ZA"})
    assert response.status_code == 200, response.text
    days = {d["iso"]: d for d in response.json()["plan"]["calendar"]["days"]}
    assert days["2026-12-16"]["hol"] == "Day of Reconciliation"
    assert days["2026-12-28"]["hol"] is None


def test_patch_timezone(seeded_client: TestClient) -> None:
    out = seeded_client.patch("/api/settings", json={"timezone": "Africa/Johannesburg"}).json()
    assert out["entity"]["timezone"] == "Africa/Johannesburg"
    assert out["plan"]["today"]["tz"] == "Africa/Johannesburg"
    assert out["plan"]["today"]["nextRolloverAt"].startswith("2026-10-05T22:00:00")


def test_ai_key_is_write_only(seeded_client: TestClient) -> None:
    key = "sk-ant-test-0123456789"
    put = seeded_client.put("/api/settings/ai-key", json={"apiKey": key})
    assert put.status_code == 200, put.text
    assert put.json()["keySet"] is True
    assert key not in put.text
    assert seeded_client.get("/api/settings").json()["aiKeyConfigured"] is True
    plan = seeded_client.get("/api/plan")
    assert plan.json()["settings"]["aiKeyConfigured"] is True
    assert key not in plan.text
    deleted = seeded_client.delete("/api/settings/ai-key")
    assert deleted.status_code == 200
    assert deleted.json()["keySet"] is False
    assert seeded_client.get("/api/plan").json()["settings"]["aiKeyConfigured"] is False


# ---------------------------------------------------------------------------- holidays and leave
def test_add_and_remove_a_manual_holiday(seeded_client: TestClient) -> None:
    added = seeded_client.post(
        "/api/holidays", json={"date": "2026-12-24", "name": "Christmas Eve"}
    )
    assert added.status_code == 201, added.text
    out = added.json()
    assert out["entity"] == {
        "date": "2026-12-24",
        "name": "Christmas Eve",
        "region": "GB-ENG",
        "source": "manual",
        "suppressed": False,
    }
    day = next(d for d in out["plan"]["calendar"]["days"] if d["iso"] == "2026-12-24")
    assert (day["bd"], day["hol"]) == (False, "Christmas Eve")
    assert "2026-12-24" not in out["plan"]["loads"]
    removed = seeded_client.delete("/api/holidays/2026-12-24")
    assert removed.status_code == 200
    holidays = seeded_client.get(
        "/api/holidays", params={"from": "2026-12-01", "to": "2026-12-31"}
    ).json()
    assert "2026-12-24" not in {h["date"] for h in holidays}


def test_removing_a_generated_holiday_suppresses_it(seeded_client: TestClient) -> None:
    response = seeded_client.delete("/api/holidays/2026-12-28")
    assert response.status_code == 200
    day = next(d for d in response.json()["plan"]["calendar"]["days"] if d["iso"] == "2026-12-28")
    assert (day["bd"], day["hol"]) == (True, None)
    holidays = seeded_client.get(
        "/api/holidays", params={"from": "2026-12-01", "to": "2026-12-31"}
    ).json()
    assert {h["date"]: h["suppressed"] for h in holidays}["2026-12-28"] is True
    again = seeded_client.delete("/api/holidays/2026-12-28")
    assert again.status_code == 404
    restored = seeded_client.post(
        "/api/holidays", json={"date": "2026-12-28", "name": "Boxing Day (substitute)"}
    )
    assert restored.status_code == 201
    assert restored.json()["entity"]["source"] == "manual"


def test_holiday_validation(seeded_client: TestClient) -> None:
    weekend = seeded_client.post("/api/holidays", json={"date": "2026-12-26", "name": "Sat"})
    assert weekend.status_code == 422
    assert _error(weekend)["field"] == "date"
    taken = seeded_client.post("/api/holidays", json={"date": "2026-12-25", "name": "Again"})
    assert taken.status_code == 409
    missing = seeded_client.delete("/api/holidays/2026-10-06")
    assert missing.status_code == 404


def test_leave_days(seeded_client: TestClient) -> None:
    put = seeded_client.put("/api/leave/2026-10-06", json={"hours": 4, "note": "Dentist"})
    assert put.status_code == 200, put.text
    out = put.json()
    assert out["entity"] == {"date": "2026-10-06", "hours": 4.0, "note": "Dentist"}
    load = out["plan"]["loads"]["2026-10-06"]
    assert (load["capacity"], load["total"], load["over"]) == (4, 7, True)
    listed = seeded_client.get("/api/leave").json()
    assert [x["date"] for x in listed] == ["2026-10-06"]
    assert seeded_client.delete("/api/leave/2026-10-06").status_code == 200
    assert seeded_client.delete("/api/leave/2026-10-06").status_code == 404
    assert seeded_client.get("/api/leave").json() == []
