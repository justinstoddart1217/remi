"""Clocks. Business logic never reads the system time directly; it asks a ``Clock``.

* :class:`SystemClock` is real time. ``today()`` is the date in the business timezone, which it
  reads through ``tz_getter`` on every call (so a Settings change applies immediately).
* :class:`FixedClock` is frozen, for tests.
* :class:`OffsetClock` backs ``REMI_TODAY``: the wall-clock time keeps running, but the date is
  shifted by a whole number of days so that "today" starts on the requested date. ``now()`` is
  shifted by the same days, so timestamps agree with the business date.
* ``REMI_NOW`` (dev and test only) builds a :class:`FixedClock` at that instant, so a note
  jotted in a test run is stamped at the pinned time (the parity browser's clock is pinned
  too).
"""

from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta, tzinfo
from typing import Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TIMEZONE = "Europe/London"

TzGetter = Callable[[], str | tzinfo | None]
"""Returns the business timezone (an IANA name or a tzinfo); ``None`` means the default."""


class Clock(Protocol):
    def now(self) -> datetime:
        """The current instant, timezone-aware, in UTC."""
        ...

    def today(self) -> date:
        """The current business date in the business timezone."""
        ...


def resolve_zone(value: str | tzinfo | None) -> tzinfo:
    """A tzinfo for ``value``; unknown or empty names fall back to Europe/London."""
    if isinstance(value, tzinfo):
        return value
    if value:
        try:
            return ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            pass
    return ZoneInfo(DEFAULT_TIMEZONE)


def _default_tz() -> str:
    return DEFAULT_TIMEZONE


def _aware_utc(value: datetime, name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        msg = f"{name} must be timezone-aware"
        raise ValueError(msg)
    return value.astimezone(UTC)


class SystemClock:
    """Real time. ``today()`` is evaluated in the business timezone from ``tz_getter``."""

    __slots__ = ("_tz_getter",)
    overridden = False

    def __init__(self, tz_getter: TzGetter | None = None) -> None:
        self._tz_getter: TzGetter = tz_getter if tz_getter is not None else _default_tz

    def zone(self) -> tzinfo:
        """The business timezone right now (falls back to Europe/London if unreadable)."""
        return resolve_zone(self._tz_getter())

    def now(self) -> datetime:
        return datetime.now(UTC)

    def today(self) -> date:
        return datetime.now(self.zone()).date()

    def __repr__(self) -> str:
        return f"SystemClock(zone={self.zone()!s})"


class FixedClock:
    """A frozen clock for tests: ``FixedClock(date(2026, 10, 5), now=...)``.

    ``now`` must be timezone-aware; it defaults to 12:00 UTC on ``today``.
    """

    __slots__ = ("_now", "_today")
    overridden = True

    def __init__(self, today: date, now: datetime | None = None) -> None:
        self._today = today
        self._now = (
            _aware_utc(now, "now")
            if now is not None
            else datetime(today.year, today.month, today.day, 12, tzinfo=UTC)
        )

    @property
    def fixed_today(self) -> date:
        return self._today

    @property
    def fixed_now(self) -> datetime:
        return self._now

    def now(self) -> datetime:
        return self._now

    def today(self) -> date:
        return self._today

    def __repr__(self) -> str:
        return f"FixedClock(today={self._today.isoformat()}, now={self._now.isoformat()})"


class OffsetClock:
    """``REMI_TODAY``: the wall-clock time keeps running; the date is shifted.

    The shift is fixed when the clock is built (``target_date - real.today()``), so today()
    starts on ``target_date`` and rolls over at local midnight like a real day would. ``now()``
    keeps the real local wall-clock time on the shifted date, in the business timezone.
    """

    __slots__ = ("_offset", "_tz_getter", "real", "target_date")
    overridden = True

    def __init__(self, real: Clock, target_date: date, tz_getter: TzGetter | None = None) -> None:
        self.real = real
        self.target_date = target_date
        self._tz_getter = tz_getter
        self._offset: timedelta = target_date - real.today()

    @property
    def offset(self) -> timedelta:
        return self._offset

    def zone(self) -> tzinfo:
        if self._tz_getter is not None:
            return resolve_zone(self._tz_getter())
        if isinstance(self.real, SystemClock):
            return self.real.zone()
        return UTC

    def now(self) -> datetime:
        zone = self.zone()
        local = self.real.now().astimezone(zone)
        shifted = datetime.combine(local.date() + self._offset, local.time(), tzinfo=zone)
        return shifted.astimezone(UTC)

    def today(self) -> date:
        return self.real.today() + self._offset

    def __repr__(self) -> str:
        return f"OffsetClock(target_date={self.target_date.isoformat()}, real={self.real!r})"


def clock_overridden(clock: Clock) -> bool:
    """True when "today" is not the real date (``REMI_TODAY`` or a test clock)."""
    return bool(getattr(clock, "overridden", False))


def build_clock(
    today_override: date | None,
    tz_getter: TzGetter | None = None,
    *,
    now_override: datetime | None = None,
) -> Clock:
    """The process clock: real time, real time shifted onto ``REMI_TODAY``, or (``REMI_NOW``)
    a clock standing still at that instant, on ``REMI_TODAY`` or else the instant's own date."""
    if now_override is not None:
        today = today_override if today_override is not None else now_override.date()
        return FixedClock(today, now_override)
    system = SystemClock(tz_getter)
    return OffsetClock(system, today_override) if today_override is not None else system
