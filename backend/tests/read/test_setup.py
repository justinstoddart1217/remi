"""First run: the setup gate, reads before setup, ``POST /setup`` and the dev fixtures."""

from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core.uow import UnitOfWorkFactory
from app.repositories import models as orm

SETUP_BODY: dict[str, Any] = {
    "moveDate": "2027-01-04",
    "timezone": "Europe/London",
    "holidayRegion": "GB-ENG",
    "capacityHoursPerDay": 8,
}


def _factory(client: TestClient) -> UnitOfWorkFactory:
    app: FastAPI = client.app  # type: ignore[assignment]
    factory: UnitOfWorkFactory = app.state.uow_factory
    return factory


def _events(client: TestClient) -> list[tuple[str, str]]:
    with _factory(client).read() as uow:
        rows = uow.session.scalars(select(orm.RemiEvent).order_by(orm.RemiEvent.seq))
        return [(e.type, e.actor) for e in rows]


def _count(client: TestClient, model: type[orm.Base]) -> int:
    with _factory(client).read() as uow:
        return int(uow.session.scalar(select(func.count()).select_from(model)) or 0)


def _error(response: Any) -> dict[str, Any]:
    body: dict[str, Any] = response.json()
    return body["error"]


# ---------------------------------------------------------------------------- before setup
def test_fresh_database_needs_setup_and_has_no_projects(fresh_client: TestClient) -> None:
    status = fresh_client.get("/api/setup").json()
    assert status["needsSetup"] is True
    assert status["missing"] == ["moveDate"]
    assert status["defaults"]["capacityHoursPerDay"] == 8
    assert status["defaults"]["aiProvider"] == "none"
    assert status["defaults"]["holidayRegion"] in ("GB-ENG", "ZA")
    assert [r["code"] for r in status["regions"]] == ["GB-ENG", "ZA"]
    assert status["ai"]["provider"] == "none"
    assert status["ai"]["available"] is True
    assert _count(fresh_client, orm.Project) == 0


def test_home_works_before_setup_with_zeros(fresh_client: TestClient) -> None:
    home = fresh_client.get("/api/home").json()
    assert home == {
        "needsSetup": True,
        "today": "2026-10-05",
        "isBd": True,
        "bdm": 3,
        "moveDate": None,
        "countdownBd": None,
        "projectCount": 0,
        "routineCount": 0,
        "notesToday": 0,
        "keyProject": None,
        "textbook": {"pages": 0, "liveCharts": 0},
    }


@pytest.mark.parametrize(
    "path", ["/api/plan", "/api/day/2026-10-05", "/api/month-snapshot", "/api/loads"]
)
def test_reads_that_need_the_move_date_are_409_before_setup(
    fresh_client: TestClient, path: str
) -> None:
    response = fresh_client.get(path)
    assert response.status_code == 409
    assert _error(response)["code"] == "SETUP_REQUIRED"


def test_settings_and_calendar_work_before_setup_and_write_nothing(
    fresh_client: TestClient,
) -> None:
    settings = fresh_client.get("/api/settings").json()
    assert settings["setupComplete"] is False
    assert settings["moveDate"] is None
    assert settings["aiKeyConfigured"] is False
    calendar = fresh_client.get("/api/calendar", params={"holidayRegion": "ZA"}).json()
    assert calendar["region"] == "ZA"
    assert calendar["from"] == "2026-09-28"
    holidays = fresh_client.get(
        "/api/holidays", params={"from": "2026-08-01", "to": "2026-12-31"}
    ).json()
    assert {"date": "2026-08-31", "name": "Late Summer Bank Holiday"}.items() <= holidays[0].items()
    assert _events(fresh_client) == []
    assert _count(fresh_client, orm.Holiday) == 0


def test_patch_settings_needs_setup(fresh_client: TestClient) -> None:
    response = fresh_client.patch("/api/settings", json={"capacityHoursPerDay": 7})
    assert response.status_code == 409
    assert _error(response)["code"] == "SETUP_REQUIRED"


def test_countdown_for_a_candidate_move(fresh_client: TestClient) -> None:
    body = fresh_client.get(
        "/api/setup/countdown", params={"moveDate": "2027-01-01", "holidayRegion": "GB-ENG"}
    ).json()
    assert body == {
        "today": "2026-10-05",
        "moveDate": "2027-01-04",
        "snapped": True,
        "countdownBd": 61,
    }
    far = fresh_client.get("/api/setup/countdown", params={"moveDate": "2150-01-01"})
    assert far.status_code == 422
    assert _error(far)["code"] == "OUT_OF_RANGE"


def test_countdown_never_stores_holiday_years_past_the_horizon(seeded_client: TestClient) -> None:
    # Today is 2026: the read horizon ends in 2036, plus a year of slack for walks (2037). A
    # move further out is answered from memory (PATCH /settings would refuse it).
    def last_stored_year() -> int:
        with _factory(seeded_client).read() as uow:
            return max(uow.session.scalars(select(orm.HolidayYear.year)))

    far = seeded_client.get("/api/setup/countdown", params={"moveDate": "2037-06-01"})
    assert far.status_code == 200, far.text
    assert far.json()["countdownBd"] > 2600
    assert last_stored_year() <= 2037
    very_far = seeded_client.get("/api/setup/countdown", params={"moveDate": "2100-06-01"})
    assert very_far.status_code == 200, very_far.text
    assert last_stored_year() <= 2037
    # Inside the horizon the current region's years are still stored (manual rows apply).
    near = seeded_client.get("/api/setup/countdown", params={"moveDate": "2035-06-01"})
    assert near.status_code == 200
    assert last_stored_year() >= 2036


# ---------------------------------------------------------------------------- setup
def test_setup_generates_holidays_sections_rotation_and_one_event(
    fresh_client: TestClient,
) -> None:
    body = {
        **SETUP_BODY,
        "moveDate": "2027-01-01",
        "rotation": {
            "hoursPerDay": 4,
            "segments": [
                {"country": "Germany", "code": "DE", "lengthBd": 6, "pass": "Build"},
                {"country": "Germany", "code": "DE", "lengthBd": 3, "pass": "Refresh"},
            ],
        },
    }
    response = fresh_client.post("/api/setup", json=body)
    assert response.status_code == 201, response.text
    out = response.json()
    assert out["movements"] == []
    assert out["entity"]["setupComplete"] is True
    assert out["entity"]["moveDate"] == "2027-01-04"  # snapped past New Year's Day
    plan = out["plan"]
    assert plan["move"]["countdownBd"] == 61
    assert plan["projects"] == []
    assert plan["verdict"]["state"] == "no_pc"
    assert [(s["code"], s["pass"], s["loop"]) for s in plan["rotation"]["segments"]] == [
        ("DE", "Build", 1),
        ("DE", "Refresh", 2),
    ]
    assert _events(fresh_client) == [("setup.completed", "setup")]

    holidays = fresh_client.get(
        "/api/holidays", params={"from": "2026-08-01", "to": "2026-12-31"}
    ).json()
    by_date = {h["date"]: h for h in holidays}
    assert by_date["2026-08-31"]["name"] == "Late Summer Bank Holiday"
    assert by_date["2026-12-28"]["name"] == "Boxing Day (substitute)"
    assert by_date["2026-12-28"]["source"] == "generated"
    assert "2026-12-26" not in by_date  # a Saturday: a plain weekend day
    assert by_date["2026-12-25"]["name"] == "Christmas Day"
    with _factory(fresh_client).read() as uow:
        sections = uow.session.scalars(
            select(orm.TextbookSection).order_by(orm.TextbookSection.sort_order)
        ).all()
        assert [s.label for s in sections] == ["Fixed Income", "Private Credit", "General"]
        assert _count(fresh_client, orm.TextbookPage) == 0
    day = fresh_client.get("/api/calendar", params={"from": "2026-12-26", "to": "2026-12-28"})
    assert [(d["iso"], d["bd"], d["hol"]) for d in day.json()["days"]] == [
        ("2026-12-26", False, None),
        ("2026-12-27", False, None),
        ("2026-12-28", False, "Boxing Day (substitute)"),
    ]
    assert fresh_client.get("/api/setup").json()["needsSetup"] is False


def test_setup_twice_is_refused(fresh_client: TestClient) -> None:
    assert fresh_client.post("/api/setup", json=SETUP_BODY).status_code == 201
    again = fresh_client.post("/api/setup", json=SETUP_BODY)
    assert again.status_code == 409
    assert _error(again)["code"] == "SETUP_ALREADY_DONE"
    assert len(_events(fresh_client)) == 1


def test_setup_validates_its_body(fresh_client: TestClient) -> None:
    bad_tz = fresh_client.post("/api/setup", json={**SETUP_BODY, "timezone": "Mars/Base"})
    assert bad_tz.status_code == 422
    bad_capacity = fresh_client.post("/api/setup", json={**SETUP_BODY, "capacityHoursPerDay": 0})
    assert bad_capacity.status_code == 422
    too_far = fresh_client.post("/api/setup", json={**SETUP_BODY, "moveDate": "2045-01-02"})
    assert too_far.status_code == 422
    assert _error(too_far)["code"] == "OUT_OF_RANGE"
    past = fresh_client.post("/api/setup", json={**SETUP_BODY, "moveDate": "2026-06-01"})
    assert past.status_code == 422
    assert (_error(past)["code"], _error(past)["field"]) == ("VALIDATION_FAILED", "moveDate")
    assert _events(fresh_client) == []
    # Today itself is allowed (countdown 0).
    today = fresh_client.post("/api/setup", json={**SETUP_BODY, "moveDate": "2026-10-05"})
    assert today.status_code == 201, today.text
    assert today.json()["plan"]["move"]["countdownBd"] == 0


# ---------------------------------------------------------------------------- dev fixtures
def test_design_fixture_is_one_event_and_keeps_the_prototype_ids(
    fresh_client: TestClient,
) -> None:
    response = fresh_client.post("/api/dev/fixtures", json={"fixture": "design"})
    assert response.status_code == 200, response.text
    plan = response.json()["plan"]
    assert [p["id"] for p in plan["projects"]] == ["ret", "manco", "play", "fion", "alpha"]
    assert [r["id"] for r in plan["routines"]] == ["r-ret", "r-man"]
    assert _events(fresh_client) == [("dev.fixture_loaded", "import")]
    assert response.json()["movements"] == []


def test_design_fixture_reloads_cleanly(seeded_client: TestClient) -> None:
    again = seeded_client.post("/api/dev/fixtures", json={"fixture": "design"})
    assert again.status_code == 200
    assert _count(seeded_client, orm.Project) == 5
    assert _count(seeded_client, orm.Note) == 6
    assert [t for t, _ in _events(seeded_client)] == ["dev.fixture_loaded"] * 2


def test_empty_fixture_resets_to_first_run(seeded_client: TestClient) -> None:
    response = seeded_client.post("/api/dev/fixtures", json={"fixture": "empty"})
    assert response.status_code == 204
    assert seeded_client.get("/api/setup").json()["needsSetup"] is True
    assert _count(seeded_client, orm.Project) == 0
    assert _count(seeded_client, orm.TextbookSection) == 0
    assert seeded_client.get("/api/plan").status_code == 409


def test_design_fixture_chart_is_stored_without_web_fonts(seeded_client: TestClient) -> None:
    app: FastAPI = seeded_client.app  # type: ignore[assignment]
    with _factory(seeded_client).read() as uow:
        asset = uow.session.get(orm.ChartAsset, "chart-price-yield")
        assert asset is not None
        relpath, digest = asset.storage_relpath, asset.content_hash
    path = app.state.config.data_dir / relpath
    html = path.read_text(encoding="utf-8")
    assert relpath == f"charts/{digest[:2]}/{digest}.html"
    assert "fonts.googleapis.com" not in html
    assert "https://" not in html
    assert "<svg" in html
