"""The engine's ``BusinessCalendar`` built from stored holidays, extended on demand.

The engine raises ``OutOfCalendar`` instead of clamping when a date or a business-day walk
falls outside the calendar. Services catch it, widen the covered years (generating holidays for
them) and retry, up to a horizon of ``HORIZON_YEARS`` after today (and the supported 1990-2100).
Past that they answer 422 ``OUT_OF_RANGE``.

``persist``: after setup, holidays are generated into the database (``holidays.ensure_years``,
which records a ``holidays.generated`` event) so manual and suppressed rows apply. Before setup
reads never write: holidays are generated in memory instead.

The read horizon (``read_span``): a ``GET`` may ask about any day from ten years before today's
year to ten years after it. The reads that need the plan (``/day``, ``/month-snapshot``,
``/loads``) answer 422 ``OUT_OF_RANGE`` outside it; the pure calendar reads (``/calendar``,
``/holidays``) serve such years from memory. Either way a ``GET`` never stores holiday years
outside the horizon (plus one year of slack for business-day walks that step past a day
inside it).
"""

import datetime as dt
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from typing import Final, TypeVar

from remi.core.clock import Clock
from remi.core.errors import OutOfRange, ValidationFailed
from remi.core.uow import UnitOfWork, UnitOfWorkFactory
from remi.repositories.models import HolidayRegion
from remi.repositories.registry import HOLIDAYS
from remi.services import holidays
from remi.services.engine.calendar import BusinessCalendar, OutOfCalendar

T = TypeVar("T")


HORIZON_YEARS: Final = 10
"""How far past today's year the calendar may be extended automatically."""
MAX_ATTEMPTS: Final = 16


@dataclass(frozen=True, slots=True)
class YearSpan:
    """Whole calendar years ``first..last``, both included."""

    first: int
    last: int

    @property
    def start(self) -> dt.date:
        return dt.date(self.first, 1, 1)

    @property
    def end(self) -> dt.date:
        return dt.date(self.last, 12, 31)

    @property
    def years(self) -> range:
        return range(self.first, self.last + 1)

    def covers(self, day: dt.date) -> bool:
        return self.first <= day.year <= self.last

    def contains(self, other: "YearSpan") -> bool:
        return self.first <= other.first and other.last <= self.last

    def union(self, other: "YearSpan | None") -> "YearSpan":
        if other is None:
            return self
        return YearSpan(min(self.first, other.first), max(self.last, other.last))

    def including(self, days: Iterable[dt.date | None]) -> "YearSpan":
        first, last = self.first, self.last
        for day in days:
            if day is not None:
                first = min(first, day.year)
                last = max(last, day.year)
        return YearSpan(first, last)


def horizon_year(today: dt.date) -> int:
    """The last year the calendar may be extended to automatically."""
    return min(holidays.MAX_YEAR, today.year + HORIZON_YEARS)


def read_span(today: dt.date) -> YearSpan:
    """The years a read may ask about: ten either side of today's (within 1990-2100)."""
    return YearSpan(max(holidays.MIN_YEAR, today.year - HORIZON_YEARS), horizon_year(today))


def walk_span(today: dt.date) -> YearSpan:
    """``read_span`` plus a year either side, for walks that step past a day inside it."""
    span = read_span(today)
    return YearSpan(max(holidays.MIN_YEAR, span.first - 1), min(holidays.MAX_YEAR, span.last + 1))


def check_within_horizon(
    day: dt.date, today: dt.date, what: str = "date", *, field: str | None = None
) -> None:
    """422 ``OUT_OF_RANGE`` for a day outside ``read_span(today)`` (or outside 1990-2100)."""
    check_in_range(day, what)
    if not read_span(today).covers(day):
        msg = f"That {what} is too far from today: Remi's calendar reaches ten years either way."
        raise OutOfRange(msg, field=field)


def check_in_range(day: dt.date, what: str = "date") -> None:
    """422 ``OUT_OF_RANGE`` outside 1990-2100."""
    if not holidays.MIN_YEAR <= day.year <= holidays.MAX_YEAR:
        msg = f"That {what} is outside the supported calendar (1990 to 2100)."
        raise OutOfRange(msg)


def default_span(today: dt.date, *days: dt.date | None) -> YearSpan:
    """Last year to two years ahead, widened to cover ``days`` (and a year after each)."""
    span = YearSpan(today.year - 1, today.year + 2).including(days)
    return YearSpan(max(holidays.MIN_YEAR, span.first), min(holidays.MAX_YEAR, span.last + 1))


def extend_for(
    span: YearSpan,
    error: OutOfCalendar,
    today: dt.date,
    *,
    limit_year: int | None = None,
    first_year: int | None = None,
) -> YearSpan:
    """The span widened past the day the engine ran out on, within ``first_year..limit_year``
    (default: 1990 to the horizon). ``OUT_OF_RANGE`` when the day is outside those years or the
    span cannot grow any further. A span already past the limits is never shrunk."""
    day = error.day
    last_ok = horizon_year(today) if limit_year is None else min(limit_year, holidays.MAX_YEAR)
    first_ok = holidays.MIN_YEAR if first_year is None else max(first_year, holidays.MIN_YEAR)
    first, last = span.first, span.last
    if day < span.start:
        first = day.year - 1
    elif day > span.end:
        last = day.year + 1
    else:
        # The walk hit an end of the range (e.g. no business day after it): grow that side.
        if (day - span.start).days < (span.end - day).days:
            first -= 1
        else:
            last += 1
    grown = YearSpan(min(span.first, max(first, first_ok)), max(span.last, min(last, last_ok)))
    if grown == span or not grown.covers(day):
        msg = "That is too far out for Remi's calendar."
        raise OutOfRange(msg)
    return grown


def build_calendar(holiday_days: Mapping[dt.date, str], span: YearSpan) -> BusinessCalendar:
    return BusinessCalendar.build(span.start, span.end, holiday_days)


def load_holidays(
    uow_factory: UnitOfWorkFactory,
    clock: Clock,
    region: HolidayRegion,
    span: YearSpan,
    *,
    persist: bool,
) -> dict[dt.date, str]:
    """``{date: name}`` of the holidays that count in ``span``.

    ``persist`` generates missing years into the database first. Otherwise nothing is written:
    stored rows apply (manual and suppressed ones included) and the years never generated are
    generated in memory."""
    for year in span.years:
        holidays.check_year(year)
    if persist:
        holidays.ensure_years(uow_factory, clock, region, span.years)
    with uow_factory.read() as uow:
        repo = uow.repo(HOLIDAYS)
        covered = repo.covered_years(region)
        stored = repo.list(region, span.start, span.end)
        known = {row.date for row in stored}
        out = {row.date: row.name for row in stored if not row.suppressed}
    missing = [year for year in span.years if year not in covered]
    for day, name in holidays.generate(region, missing).items():
        if day not in known:
            out[day] = name
    return dict(sorted(out.items()))


def calendar_for(
    uow_factory: UnitOfWorkFactory,
    clock: Clock,
    region: HolidayRegion,
    span: YearSpan,
    *,
    persist: bool,
) -> BusinessCalendar:
    """The business calendar over ``span`` for ``region``."""
    return build_calendar(load_holidays(uow_factory, clock, region, span, persist=persist), span)


def with_calendar(
    uow_factory: UnitOfWorkFactory,
    clock: Clock,
    region: HolidayRegion,
    span: YearSpan,
    fn: Callable[[BusinessCalendar], T],
    *,
    persist: bool,
    limit_year: int | None = None,
) -> T:
    """Run ``fn(calendar)``; on ``OutOfCalendar`` widen the span and retry."""
    today = clock.today()
    for _ in range(MAX_ATTEMPTS):
        cal = calendar_for(uow_factory, clock, region, span, persist=persist)
        try:
            return fn(cal)
        except OutOfCalendar as error:
            span = extend_for(span, error, today, limit_year=limit_year)
    msg = "That is too far out for Remi's calendar."
    raise OutOfRange(msg)


def calendar_in(
    uow: UnitOfWork, region: HolidayRegion, span: YearSpan, today: dt.date
) -> BusinessCalendar:
    """The calendar inside a write unit of work, generating any missing holiday years into it
    (no event of its own: the caller records one)."""
    holidays.ensure_years_in(uow, region, span.years, today=today)
    return build_calendar(uow.repo(HOLIDAYS).effective(region, span.start, span.end), span)


def snap_to_bd(cal: BusinessCalendar, day: dt.date, field: str | None = None) -> dt.date:
    """``day`` rolled forward to a business day (``OUT_OF_RANGE`` past the calendar)."""
    try:
        return cal.next_bd(day)
    except OutOfCalendar as error:
        msg = "That date is too far out for Remi's calendar."
        raise OutOfRange(msg, field=field) from error


def check_move_date(move_date: dt.date, today: dt.date) -> None:
    """The move must be in the supported calendar and within the horizon."""
    check_in_range(move_date, "move date")
    if move_date.year > horizon_year(today):
        msg = "The move must be within ten years."
        raise OutOfRange(msg, field="moveDate")


def check_move_not_past(move_date: dt.date, today: dt.date) -> None:
    """A move date the user sends may not be before today (422 ``VALIDATION_FAILED``).

    Only checked when the date is set (``POST /setup``, ``PATCH /settings {moveDate}``): once
    the move has happened, other settings changes still work."""
    if move_date < today:
        msg = "The move date has already passed. Choose today or a later day."
        raise ValidationFailed(msg, field="moveDate")
