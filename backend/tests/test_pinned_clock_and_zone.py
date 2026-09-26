"""``REMI_NOW`` and ``REMI_DEFAULT_TIMEZONE``: deterministic dev and test runs.

``REMI_NOW`` stands the clock still at an aware instant (note stamps, ``createdAt``);
``REMI_DEFAULT_TIMEZONE`` replaces ``/etc/localtime`` as the wizard's pre-filled zone. Both are
refused when ``REMI_ENV=prod``. ``REMI_TODAY`` keeps its own behaviour.
"""

from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.clock import FixedClock, OffsetClock, build_clock
from app.core.config import RemiConfig
from app.main import create_app
from tests.fixtures import design_seed

BST = timezone(timedelta(hours=1))
PINNED = datetime(2026, 10, 5, 9, 30, tzinfo=BST)

ENV_NAMES = ("ENV", "NOW", "TODAY", "DEFAULT_TIMEZONE", "DATA_DIR", "HOST", "PORT")


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ENV_NAMES:
        monkeypatch.delenv(f"REMI_{name}", raising=False)


# ---------------------------------------------------------------------------- config
def test_remi_now_and_default_timezone_are_read_in_test_runs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("REMI_ENV", "test")
    monkeypatch.setenv("REMI_NOW", "2026-10-05T09:30:00+01:00")
    monkeypatch.setenv("REMI_TODAY", "2026-10-05")
    monkeypatch.setenv("REMI_DEFAULT_TIMEZONE", "Europe/London")
    cfg = RemiConfig()
    assert cfg.now == PINNED
    assert cfg.default_timezone == "Europe/London"
    assert cfg.today == date(2026, 10, 5)


@pytest.mark.parametrize(
    ("name", "value"),
    [("REMI_NOW", "2026-10-05T09:30:00+01:00"), ("REMI_DEFAULT_TIMEZONE", "Europe/London")],
)
def test_prod_refuses_the_pins(monkeypatch: pytest.MonkeyPatch, name: str, value: str) -> None:
    monkeypatch.setenv(name, value)  # REMI_ENV defaults to prod
    with pytest.raises(ValidationError, match=f"{name} is for dev and test runs only"):
        RemiConfig()
    monkeypatch.setenv("REMI_ENV", "dev")
    assert RemiConfig().env == "dev"


def test_prod_names_both_pins_when_both_are_set(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REMI_NOW", "2026-10-05T09:30:00+01:00")
    monkeypatch.setenv("REMI_DEFAULT_TIMEZONE", "Europe/London")
    with pytest.raises(
        ValidationError, match="REMI_NOW and REMI_DEFAULT_TIMEZONE are for dev and test runs only"
    ):
        RemiConfig()


def test_remi_now_must_be_aware_and_agree_with_remi_today(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("REMI_ENV", "test")
    monkeypatch.setenv("REMI_NOW", "2026-10-05T09:30:00")
    with pytest.raises(ValidationError, match="timezone"):
        RemiConfig()
    monkeypatch.setenv("REMI_NOW", "2026-10-06T00:30:00+01:00")
    monkeypatch.setenv("REMI_TODAY", "2026-10-05")
    with pytest.raises(ValidationError, match="REMI_NOW falls on 2026-10-06"):
        RemiConfig()


def test_default_timezone_must_be_an_iana_zone(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REMI_ENV", "test")
    monkeypatch.setenv("REMI_DEFAULT_TIMEZONE", "Mars/Olympus")
    with pytest.raises(ValidationError, match="IANA zone"):
        RemiConfig()


# ---------------------------------------------------------------------------- clock
def test_build_clock_pins_now_and_keeps_remi_today_otherwise() -> None:
    pinned = build_clock(None, now_override=PINNED)
    assert isinstance(pinned, FixedClock)
    assert pinned.now() == PINNED.astimezone(UTC)
    assert pinned.today() == date(2026, 10, 5)
    assert build_clock(date(2026, 10, 5), now_override=PINNED).today() == date(2026, 10, 5)
    assert isinstance(build_clock(date(2026, 10, 5)), OffsetClock)


# ---------------------------------------------------------------------------- end to end
@pytest.fixture
def pinned_client(tmp_path: Path) -> Iterator[TestClient]:
    """The real app factory (clock built from the config), migrated by its lifespan."""
    config = RemiConfig(
        env="test",
        data_dir=tmp_path / "data",
        open_browser=False,
        today=date(2026, 10, 5),
        now=PINNED,
        default_timezone="Europe/London",
    )
    app = create_app(config)
    with TestClient(
        app, base_url=design_seed.BASE_URL, headers=design_seed.CLIENT_HEADERS
    ) as client:
        yield client


def test_setup_prefills_the_configured_zone(pinned_client: TestClient) -> None:
    status = pinned_client.get("/api/setup").json()
    assert status["defaults"]["timezone"] == "Europe/London"
    assert status["defaults"]["holidayRegion"] == "GB-ENG"
    assert status["today"] == "2026-10-05"


def test_setup_follows_the_machine_zone_without_the_pin(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.services import setup as setup_service

    monkeypatch.setattr(setup_service, "machine_timezone", lambda: "Africa/Johannesburg")
    app = create_app(RemiConfig(env="test", data_dir=tmp_path / "data", open_browser=False))
    with TestClient(app, base_url=design_seed.BASE_URL) as client:
        defaults = client.get("/api/setup").json()["defaults"]
    assert (defaults["timezone"], defaults["holidayRegion"]) == ("Africa/Johannesburg", "ZA")


def test_a_note_is_stamped_at_the_pinned_time(pinned_client: TestClient) -> None:
    design_seed.load_via_api(pinned_client)
    response = pinned_client.post("/api/notes", json={"day": "2026-10-05", "text": "Pinned"})
    assert response.status_code == 201, response.text
    note = response.json()["entity"]
    assert note["timeLabel"] == "09:30"
    assert note["createdAt"] == "2026-10-05T08:30:00Z"
    plan = response.json()["plan"]
    assert (plan["today"]["iso"], plan["today"]["overridden"]) == ("2026-10-05", True)


PINNED_Z = "2026-10-05T08:30:00Z"


def test_repeated_writes_keep_the_pinned_updated_at(pinned_client: TestClient) -> None:
    """Under a frozen clock the unit of work stamps ``updatedAt`` with the value the row
    already holds, so the column is simply left out of the UPDATE and keeps the pinned time.
    The column has no ``onupdate``, so nothing stamps wall-clock time in its place."""
    design_seed.load_via_api(pinned_client)
    note = pinned_client.post("/api/notes", json={"day": "2026-10-05", "text": "Pinned"})
    note_id = note.json()["entity"]["id"]
    for text in ("First edit", "Second edit", "Third edit"):
        response = pinned_client.patch(f"/api/notes/{note_id}", json={"text": text})
        assert response.status_code == 200, response.text
        entity = response.json()["entity"]
        assert (entity["createdAt"], entity["updatedAt"]) == (PINNED_Z, PINNED_Z)

    for title in ("Rotation one", "Rotation two"):
        response = pinned_client.patch("/api/textbook/pages/fi-rot", json={"title": title})
        assert response.status_code == 200, response.text
        assert response.json()["updatedAt"] == PINNED_Z
    assert pinned_client.get("/api/textbook/pages/fi-rot").json()["updatedAt"] == PINNED_Z
    # The seed pages are all stamped at the pinned instant too, so no page falls behind them.
    recent = pinned_client.get("/api/textbook/home").json()["recent"]
    assert {page["id"]: page["updatedAt"] for page in recent}["fi-rot"] == PINNED_Z
    assert {page["updatedAt"] for page in recent} == {PINNED_Z}

    for start in ("2026-11-02", "2026-11-03"):
        response = pinned_client.patch("/api/rotation", json={"startDate": start})
        assert response.status_code == 200, response.text
        assert response.json()["entity"]["updatedAt"] == PINNED_Z

    for days in (10, 11):
        response = pinned_client.patch("/api/settings", json={"staleThresholdDays": days})
        assert response.status_code == 200, response.text
        assert response.json()["entity"]["updatedAt"] == PINNED_Z
