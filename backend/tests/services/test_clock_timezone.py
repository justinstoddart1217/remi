"""The process clock reads its business timezone from settings."""

from datetime import UTC, date, datetime

from sqlalchemy.orm import Session, sessionmaker

from remi.core.clock import SystemClock, resolve_zone
from remi.core.db import Database
from remi.core.uow import UnitOfWorkFactory
from remi.repositories.registry import SETTINGS
from remi.schemas.settings import SettingsPatch
from remi.schemas.setup import SetupIn
from remi.services import settings as settings_service
from remi.services import setup as setup_service
from remi.services.settings import SettingsTimezone, timezone_changed


def test_settings_timezone_reads_and_refreshes(
    engine: object, session_factory: sessionmaker[Session], uow_factory: UnitOfWorkFactory
) -> None:
    from sqlalchemy import Engine

    assert isinstance(engine, Engine)
    database = Database(engine=engine, session_factory=session_factory)
    getter = SettingsTimezone(lambda: database, ttl=3600)
    assert getter() == "Europe/London"
    with uow_factory() as uow:
        uow.repo(SETTINGS).get().timezone = "Africa/Johannesburg"
        uow.record("test.tz", [])
    assert getter() == "Europe/London"  # cached
    timezone_changed()
    assert getter() == "Africa/Johannesburg"
    clock = SystemClock(getter)
    assert str(clock.zone()) == "Africa/Johannesburg"
    assert clock.now().tzinfo == UTC or clock.now().utcoffset() is not None
    assert isinstance(clock.today(), type(datetime.now(UTC).date()))


def test_settings_timezone_before_the_database_opens() -> None:
    getter = SettingsTimezone(lambda: None)
    assert getter() is None
    assert str(SystemClock(getter).zone()) == "Europe/London"


class _ZonedClock:
    """A frozen instant whose business date follows the settings timezone, as SystemClock's
    does (so a timezone change can move "today")."""

    overridden = False

    def __init__(self, instant: datetime, zone: SettingsTimezone) -> None:
        self._instant = instant
        self._zone = zone

    def now(self) -> datetime:
        return self._instant

    def today(self) -> date:
        return self._instant.astimezone(resolve_zone(self._zone())).date()


def test_setup_and_patch_timezone_apply_to_the_plan_they_return(
    engine: object, session_factory: sessionmaker[Session], uow_factory: UnitOfWorkFactory
) -> None:
    from sqlalchemy import Engine

    assert isinstance(engine, Engine)
    database = Database(engine=engine, session_factory=session_factory)
    # A long TTL: only the commit hook (not the cache expiring) can pick up the new zone.
    zone = SettingsTimezone(lambda: database, ttl=3600)
    instant = datetime(2026, 10, 5, 12, tzinfo=UTC)  # 02:00 on 6 Oct in Kiritimati (UTC+14)
    clock = _ZonedClock(instant, zone)
    assert clock.today() == date(2026, 10, 5)

    body = SetupIn(
        move_date=date(2027, 1, 4),
        timezone="Pacific/Kiritimati",
        holiday_region="GB-ENG",
        capacity_hours_per_day=8,
    )
    out = setup_service.complete_setup(uow_factory, clock, body)
    assert out.plan.today.tz == "Pacific/Kiritimati"
    assert out.plan.today.iso == date(2026, 10, 6)
    assert out.plan.today.next_rollover_at > instant

    back = settings_service.update_settings(
        uow_factory, clock, SettingsPatch.model_validate({"timezone": "Europe/London"})
    )
    assert back.plan.today.tz == "Europe/London"
    assert back.plan.today.iso == date(2026, 10, 5)
    assert back.plan.today.next_rollover_at == datetime(2026, 10, 5, 23, tzinfo=UTC)
