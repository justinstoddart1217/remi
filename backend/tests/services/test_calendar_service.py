"""The calendar service: year spans, extension on ``OutOfCalendar`` and the horizon."""

from datetime import date

import pytest

from remi.core.clock import FixedClock
from remi.core.errors import OutOfRange
from remi.core.uow import UnitOfWorkFactory
from remi.services.calendar import (
    YearSpan,
    calendar_for,
    check_within_horizon,
    default_span,
    extend_for,
    horizon_year,
    load_holidays,
    read_span,
    walk_span,
    with_calendar,
)
from remi.services.engine.calendar import BusinessCalendar, OutOfCalendar

TODAY = date(2026, 10, 5)


def test_year_span() -> None:
    span = YearSpan(2026, 2027)
    assert (span.start, span.end) == (date(2026, 1, 1), date(2027, 12, 31))
    assert list(span.years) == [2026, 2027]
    assert span.covers(date(2027, 6, 1)) and not span.covers(date(2028, 1, 1))
    assert span.including([date(2030, 1, 1), None]) == YearSpan(2026, 2030)
    assert span.union(YearSpan(2020, 2021)) == YearSpan(2020, 2027)
    assert YearSpan(2020, 2030).contains(span)


def test_default_span_covers_the_move_and_a_year_after() -> None:
    assert default_span(TODAY) == YearSpan(2025, 2029)
    assert default_span(TODAY, date(2031, 3, 1)) == YearSpan(2025, 2032)


def test_extend_for_grows_towards_the_missing_day() -> None:
    span = YearSpan(2025, 2028)
    assert extend_for(span, OutOfCalendar(date(2030, 5, 1)), TODAY) == YearSpan(2025, 2031)
    assert extend_for(span, OutOfCalendar(date(2023, 5, 1)), TODAY) == YearSpan(2022, 2028)
    assert extend_for(span, OutOfCalendar(date(2028, 12, 31)), TODAY) == YearSpan(2025, 2029)
    assert extend_for(span, OutOfCalendar(date(2025, 1, 1)), TODAY) == YearSpan(2024, 2028)


def test_extend_for_stops_at_the_horizon() -> None:
    assert horizon_year(TODAY) == 2036
    with pytest.raises(OutOfRange):
        extend_for(YearSpan(2025, 2036), OutOfCalendar(date(2036, 12, 31)), TODAY)
    with pytest.raises(OutOfRange):
        extend_for(YearSpan(1990, 2028), OutOfCalendar(date(1990, 1, 1)), TODAY)
    with pytest.raises(OutOfRange):
        extend_for(YearSpan(2025, 2028), OutOfCalendar(date(2037, 1, 5)), TODAY)
    # A day inside the limit is reached even when a year of slack does not fit.
    grown = extend_for(YearSpan(2025, 2028), OutOfCalendar(date(2036, 6, 1)), TODAY)
    assert grown == YearSpan(2025, 2036)


def test_extend_for_within_explicit_limits() -> None:
    span = YearSpan(2025, 2028)
    assert extend_for(
        span, OutOfCalendar(date(2016, 3, 1)), TODAY, first_year=2015, limit_year=2037
    ) == YearSpan(2015, 2028)
    with pytest.raises(OutOfRange):
        extend_for(span, OutOfCalendar(date(2014, 3, 1)), TODAY, first_year=2015)
    # A span already past the limits (the plan's own dates) is never shrunk.
    wide = YearSpan(2010, 2040)
    with pytest.raises(OutOfRange):
        extend_for(wide, OutOfCalendar(date(2040, 12, 31)), TODAY, limit_year=2037)


def test_read_span_is_ten_years_either_way() -> None:
    assert read_span(TODAY) == YearSpan(2016, 2036)
    assert walk_span(TODAY) == YearSpan(2015, 2037)
    assert read_span(date(1995, 1, 1)) == YearSpan(1990, 2005)
    check_within_horizon(date(2036, 12, 31), TODAY)
    with pytest.raises(OutOfRange):
        check_within_horizon(date(2037, 1, 1), TODAY)
    with pytest.raises(OutOfRange):
        check_within_horizon(date(2015, 12, 31), TODAY)


def test_calendar_before_setup_is_generated_in_memory(
    uow_factory: UnitOfWorkFactory, clock: FixedClock
) -> None:
    cal = calendar_for(uow_factory, clock, "GB-ENG", YearSpan(2026, 2026), persist=False)
    assert cal.holiday(date(2026, 8, 31)) == "Late Summer Bank Holiday"
    assert cal.bdm(TODAY) == 3
    with uow_factory.read() as uow:
        assert uow.repo("events").latest_seq() == 0


def test_with_calendar_widens_and_retries(
    uow_factory: UnitOfWorkFactory, clock: FixedClock
) -> None:
    seen: list[YearSpan] = []

    def walk(cal: BusinessCalendar) -> date:
        seen.append(YearSpan(cal.start.year, cal.end.year))
        return cal.add_bd(TODAY, 600)  # about two and a half years of business days

    landed = with_calendar(uow_factory, clock, "GB-ENG", YearSpan(2026, 2026), walk, persist=True)
    assert landed.year == 2029
    assert seen[0] == YearSpan(2026, 2026)
    assert seen[-1].last >= 2029


def test_with_calendar_gives_up_past_the_horizon(
    uow_factory: UnitOfWorkFactory, clock: FixedClock
) -> None:
    def forever(cal: BusinessCalendar) -> date:
        return cal.add_bd(TODAY, 100_000)

    with pytest.raises(OutOfRange):
        with_calendar(uow_factory, clock, "GB-ENG", YearSpan(2026, 2027), forever, persist=False)


def test_in_memory_holidays_keep_stored_rows_and_fill_missing_years(
    uow_factory: UnitOfWorkFactory, clock: FixedClock
) -> None:
    from remi.core.uow import ref
    from remi.repositories.registry import HOLIDAYS
    from remi.services import holidays

    with uow_factory() as uow:
        holidays.ensure_years_in(uow, "GB-ENG", [2026], today=TODAY)
        repo = uow.repo(HOLIDAYS)
        repo.add_manual("GB-ENG", date(2026, 10, 12), "Team day")
        christmas = repo.get("GB-ENG", date(2026, 12, 25))
        assert christmas is not None
        repo.suppress(christmas)
        repo.add_manual("GB-ENG", date(2027, 3, 1), "Offsite")
        uow.record("test.holidays", [ref("holidays", "GB-ENG")])
    got = load_holidays(uow_factory, clock, "GB-ENG", YearSpan(2026, 2027), persist=False)
    assert got[date(2026, 10, 12)] == "Team day"
    assert date(2026, 12, 25) not in got  # suppressed
    assert got[date(2027, 3, 1)] == "Offsite"  # manual, in a year never generated
    assert got[date(2027, 12, 27)] == "Christmas Day (substitute)"  # generated in memory
    with uow_factory.read() as uow:
        assert sorted(uow.repo(HOLIDAYS).covered_years("GB-ENG")) == [2026]
