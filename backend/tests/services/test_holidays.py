"""Holiday generation: offline, weekday-only, prototype names, versioned per year."""

from datetime import date

import pytest
from sqlalchemy import select

from app.core.clock import FixedClock
from app.core.errors import OutOfRange
from app.core.uow import UnitOfWorkFactory
from app.repositories import models as orm
from app.repositories.registry import HOLIDAYS
from app.services import holidays


def test_generate_gb_eng_2026_matches_the_prototype_plus_31_aug() -> None:
    days = holidays.generate("GB-ENG", [2026])
    assert days[date(2026, 8, 31)] == "Late Summer Bank Holiday"
    assert days[date(2026, 12, 25)] == "Christmas Day"
    assert days[date(2026, 12, 28)] == "Boxing Day (substitute)"
    assert date(2026, 12, 26) not in days  # Saturday
    assert all(d.isoweekday() <= 5 for d in days)
    assert all("(observed)" not in name for name in days.values())


def test_generate_2027_substitutes_and_za() -> None:
    days = holidays.generate("GB-ENG", [2027])
    assert days[date(2027, 12, 27)] == "Christmas Day (substitute)"
    assert days[date(2027, 12, 28)] == "Boxing Day (substitute)"
    assert date(2027, 12, 25) not in days
    za = holidays.generate("ZA", [2026])
    assert za[date(2026, 12, 16)] == "Day of Reconciliation"
    assert date(2026, 8, 9) not in za  # a Sunday
    assert za[date(2026, 8, 10)] == "National Women's Day (substitute)"


def test_generate_refuses_years_outside_the_calendar() -> None:
    with pytest.raises(OutOfRange):
        holidays.generate("GB-ENG", [1989])
    with pytest.raises(OutOfRange):
        holidays.generate("GB-ENG", [2101])


def test_ensure_years_is_idempotent_and_records_one_event(
    uow_factory: UnitOfWorkFactory, clock: FixedClock
) -> None:
    assert holidays.ensure_years(uow_factory, clock, "GB-ENG", [2026, 2027]) == [2026, 2027]
    assert holidays.ensure_years(uow_factory, clock, "GB-ENG", [2026, 2027]) == []
    with uow_factory.read() as uow:
        events = uow.session.scalars(select(orm.RemiEvent)).all()
        assert [(e.type, e.actor) for e in events] == [("holidays.generated", "system")]
        covered = uow.repo(HOLIDAYS).covered_years("GB-ENG")
        assert covered == {2026: holidays.package_version(), 2027: holidays.package_version()}


def test_new_package_version_regenerates_but_keeps_manual_and_suppressed_rows(
    uow_factory: UnitOfWorkFactory, clock: FixedClock
) -> None:
    holidays.ensure_years(uow_factory, clock, "GB-ENG", [2026])
    with uow_factory() as uow:
        repo = uow.repo(HOLIDAYS)
        repo.add_manual("GB-ENG", date(2026, 12, 24), "Christmas Eve")
        boxing = repo.get("GB-ENG", date(2026, 12, 28))
        assert boxing is not None
        repo.suppress(boxing)
        marker = uow.session.get(orm.HolidayYear, ("GB-ENG", 2026))
        assert marker is not None
        marker.package_version = "0.1-old"
        uow.record("test.setup", [])
    assert holidays.ensure_years(uow_factory, clock, "GB-ENG", [2026]) == [2026]
    with uow_factory.read() as uow:
        rows = {h.date: h for h in uow.repo(HOLIDAYS).list("GB-ENG")}
        assert rows[date(2026, 12, 24)].source == "manual"
        assert rows[date(2026, 12, 28)].suppressed is True
        assert rows[date(2026, 8, 31)].source == "generated"
        effective = uow.repo(HOLIDAYS).effective("GB-ENG", date(2026, 1, 1), date(2026, 12, 31))
        assert date(2026, 12, 28) not in effective
        assert effective[date(2026, 12, 24)] == "Christmas Eve"


def test_old_years_with_another_version_are_left_alone(
    uow_factory: UnitOfWorkFactory, clock: FixedClock
) -> None:
    holidays.ensure_years(uow_factory, clock, "GB-ENG", [2024])
    with uow_factory() as uow:
        marker = uow.session.get(orm.HolidayYear, ("GB-ENG", 2024))
        assert marker is not None
        marker.package_version = "0.1-old"
        uow.record("test.setup", [])
    assert holidays.ensure_years(uow_factory, clock, "GB-ENG", [2024]) == []
