"""The business-day calendar.

A business day (BD) is Monday to Friday and not a holiday. ``bdm`` numbers the business days
of each calendar month from 1 (``BD3`` is the third). Holidays are an input mapping; the
engine never generates them (``services/holidays`` does, from the ``holidays`` package).

The calendar covers whole months: ``build`` widens ``start`` to the 1st of its month and
``end`` to the last day of its month, so ``bdm`` is always right. Any date outside the range
raises ``OutOfCalendar`` instead of clamping; the service extends the range and retries.

Conventions (ADR-0009):
- ``next_bd(d)`` rolls forward: ``d`` itself when it is a business day.
- ``prev_bd(d)`` is the last business day strictly before ``d``.
- ``bd_diff(a, b)`` is a signed offset: ``index(next_bd(b)) - index(next_bd(a))``.
- ``bd_between(a, b)`` counts business days strictly between ``a`` and ``b`` (0 when b <= a).
  User-facing day counts (countdown, buffer) use it.
"""

from bisect import bisect_left, bisect_right
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from datetime import date

from remi.utils.dates import iso_week, js_weekday, month_end


class OutOfCalendar(LookupError):
    """A date, or a business-day walk, fell outside the calendar's range."""

    def __init__(self, day: date, what: str = "") -> None:
        self.day = day
        detail = f" ({what})" if what else ""
        super().__init__(f"{day.isoformat()} is outside the business calendar{detail}")

    @property
    def year(self) -> int:
        """The year the calendar would need to cover."""
        return self.day.year


CalendarExhausted = OutOfCalendar
"""Alias used by the data architecture."""


@dataclass(frozen=True, slots=True)
class DayInfo:
    """One calendar day as the read model sends it."""

    day: date
    w: int
    """Weekday, 0 = Sunday ... 6 = Saturday."""
    bd: bool
    bdm: int | None
    holiday: str | None
    week: int
    """ISO week number."""


class BusinessCalendar:
    """Business days, month numbering and holidays over a fixed range of whole months.

    Instances are immutable after construction.
    """

    __slots__ = ("_bd_ords", "_bdm", "_end", "_hol", "_idx", "_n", "_next", "_s0", "_start")

    def __init__(self, start: date, end: date, holidays: Mapping[date, str]) -> None:
        if end < start:
            msg = f"calendar end {end} is before start {start}"
            raise ValueError(msg)
        first = start.replace(day=1)
        last = month_end(end)
        s0 = first.toordinal()
        n = last.toordinal() - s0 + 1
        bd_ords: list[int] = []
        idx: dict[int, int] = {}
        bdm: dict[int, int] = {}
        hol: dict[int, str] = {}
        month = 0
        count = 0
        for off in range(n):
            o = s0 + off
            d = date.fromordinal(o)
            if d.month != month:
                month = d.month
                count = 0
            name = holidays.get(d)
            if name is not None:
                hol[o] = name
            if d.isoweekday() <= 5 and name is None:
                count += 1
                idx[o] = len(bd_ords)
                bdm[o] = count
                bd_ords.append(o)
        nxt = [len(bd_ords)] * n
        j = len(bd_ords)
        for off in range(n - 1, -1, -1):
            found = idx.get(s0 + off)
            if found is not None:
                j = found
            nxt[off] = j
        self._start = first
        self._end = last
        self._s0 = s0
        self._n = n
        self._bd_ords = tuple(bd_ords)
        self._idx = idx
        self._bdm = bdm
        self._hol = hol
        self._next = tuple(nxt)

    @classmethod
    def build(cls, start: date, end: date, holidays: Mapping[date, str]) -> "BusinessCalendar":
        """A calendar over the whole months from ``start`` to ``end``."""
        return cls(start, end, holidays)

    # ------------------------------------------------------------------ range
    @property
    def start(self) -> date:
        """First covered day (the 1st of a month)."""
        return self._start

    @property
    def end(self) -> date:
        """Last covered day (the last day of a month)."""
        return self._end

    def covers(self, d: date) -> bool:
        """True when ``d`` is inside the range."""
        return 0 <= d.toordinal() - self._s0 < self._n

    def _off(self, d: date) -> int:
        off = d.toordinal() - self._s0
        if not 0 <= off < self._n:
            raise OutOfCalendar(d)
        return off

    def _index(self, d: date) -> int:
        """Index of ``next_bd(d)`` in the business-day list."""
        j = self._next[self._off(d)]
        if j >= len(self._bd_ords):
            raise OutOfCalendar(d, "no business day on or after it")
        return j

    # ------------------------------------------------------------------ single days
    def is_bd(self, d: date) -> bool:
        """Monday to Friday and not a holiday."""
        self._off(d)
        return d.toordinal() in self._idx

    def bdm(self, d: date) -> int | None:
        """Business day of the month (1-based), or ``None`` on a non-business day."""
        self._off(d)
        return self._bdm.get(d.toordinal())

    def holiday(self, d: date) -> str | None:
        """The holiday's name, or ``None``. Weekend holidays are reported too."""
        self._off(d)
        return self._hol.get(d.toordinal())

    def day_info(self, d: date) -> DayInfo:
        """Everything the read model needs about one day."""
        self._off(d)
        o = d.toordinal()
        return DayInfo(
            day=d,
            w=js_weekday(d),
            bd=o in self._idx,
            bdm=self._bdm.get(o),
            holiday=self._hol.get(o),
            week=iso_week(d),
        )

    def iso_week(self, d: date) -> int:
        """ISO-8601 week number."""
        return iso_week(d)

    # ------------------------------------------------------------------ business-day arithmetic
    def next_bd(self, d: date) -> date:
        """``d`` if it is a business day, otherwise the next one (rolls forward)."""
        return date.fromordinal(self._bd_ords[self._index(d)])

    def prev_bd(self, d: date) -> date:
        """The last business day strictly before ``d``."""
        self._off(d)
        i = bisect_left(self._bd_ords, d.toordinal()) - 1
        if i < 0:
            raise OutOfCalendar(d, "no business day before it")
        return date.fromordinal(self._bd_ords[i])

    def add_bd(self, d: date, k: int) -> date:
        """``k`` business days after ``next_bd(d)`` (``k`` may be negative). Never clamps."""
        i = self._index(d) + k
        if not 0 <= i < len(self._bd_ords):
            raise OutOfCalendar(d, f"{k:+d} business days")
        return date.fromordinal(self._bd_ords[i])

    def bd_diff(self, a: date, b: date) -> int:
        """Signed offset ``index(next_bd(b)) - index(next_bd(a))``."""
        return self._index(b) - self._index(a)

    def bd_between(self, a: date, b: date) -> int:
        """Business days strictly between ``a`` and ``b``; 0 when ``b <= a``."""
        self._off(a)
        self._off(b)
        if b <= a:
            return 0
        return bisect_left(self._bd_ords, b.toordinal()) - bisect_right(
            self._bd_ords, a.toordinal()
        )

    def bds(self, a: date, b: date) -> list[date]:
        """Business days in ``[a, b]``, both ends included (empty when ``b < a``)."""
        self._off(a)
        self._off(b)
        lo = bisect_left(self._bd_ords, a.toordinal())
        hi = bisect_right(self._bd_ords, b.toordinal())
        return [date.fromordinal(o) for o in self._bd_ords[lo:hi]]

    def iter_bds(self, a: date) -> Iterator[date]:
        """Business days from ``next_bd(a)`` to the end of the range, ascending."""
        self._off(a)
        for o in self._bd_ords[bisect_left(self._bd_ords, a.toordinal()) :]:
            yield date.fromordinal(o)

    def iter_bds_before(self, a: date) -> Iterator[date]:
        """Business days strictly before ``a`` back to the start of the range, descending."""
        self._off(a)
        for i in range(bisect_left(self._bd_ords, a.toordinal()) - 1, -1, -1):
            yield date.fromordinal(self._bd_ords[i])

    def month_bds(self, year: int, month: int) -> list[date]:
        """The business days of one calendar month."""
        first = date(year, month, 1)
        return self.bds(first, month_end(first))

    @property
    def business_days(self) -> tuple[date, ...]:
        """Every business day in the range, ascending."""
        return tuple(date.fromordinal(o) for o in self._bd_ords)
