"""Business-day calendar, day loads, holidays and leave."""

import datetime as dt
from typing import Literal

from pydantic import AliasChoices, Field

from remi.schemas.base import CamelIn, CamelModel, DateIn, Domain
from remi.schemas.settings import HolidayRegion


class CalendarDayOut(CamelModel):
    """One calendar day. The client uses these for lookups and geometry only."""

    iso: dt.date
    w: int = Field(ge=0, le=6)
    """Weekday, 0 = Sunday ... 6 = Saturday (the prototype's ``getUTCDay``)."""
    bd: bool
    """Business day: Monday to Friday and not a holiday."""
    bdm: int | None
    """Business day of the month (BD3 = 3), or ``null`` on non-business days."""
    hol: str | None
    """Holiday name, or ``null``."""
    week: int
    """ISO week number."""


class CalendarOut(CamelModel):
    """``GET /calendar`` and ``PlanOut.calendar``: every day in ``[from, to]``, both included."""

    from_: dt.date = Field(
        validation_alias=AliasChoices("from", "from_"), serialization_alias="from"
    )
    to: dt.date
    region: HolidayRegion
    days: list[CalendarDayOut]


LoadRefType = Literal["routine", "rotation", "project"]


class DayLoadItemOut(CamelModel):
    """One contribution to a day's load. BAU items (routine, rotation) come first."""

    ref_type: LoadRefType
    ref_id: str
    """Routine id, rotation segment id, or project id."""
    domain: Domain
    h: float
    name: str
    """Routine short name, ``"Germany · Build"`` for a rotation segment, or project short."""


class DayLoadOut(CamelModel):
    """Planned hours on one business day against capacity."""

    items: list[DayLoadItemOut]
    bau: float
    proj: float
    total: float
    free: float
    """``max(0, capacity - total)``."""
    capacity: float
    over: bool
    """``total > capacity``."""


class LoadsOut(CamelModel):
    """``GET /loads``: business-day loads keyed by ISO date (only business days appear)."""

    from_: dt.date = Field(
        validation_alias=AliasChoices("from", "from_"), serialization_alias="from"
    )
    to: dt.date
    capacity: float
    loads: dict[dt.date, DayLoadOut]


# ---------------------------------------------------------------- holidays and leave
HolidaySource = Literal["generated", "manual"]


class HolidayOut(CamelModel):
    date: dt.date
    name: str
    region: HolidayRegion
    source: HolidaySource
    suppressed: bool
    """A generated holiday the user removed. Suppressed days are business days."""


class HolidayCreate(CamelIn):
    """``POST /holidays``: add a manual holiday in the current region."""

    date: DateIn
    name: str = Field(min_length=1, max_length=120)


class LeaveDayOut(CamelModel):
    """Personal leave. Data only: it does not change BD numbering."""

    date: dt.date
    hours: float | None
    """Hours off; ``null`` = the whole day."""
    note: str


class LeavePut(CamelIn):
    hours: float | None = Field(default=None, gt=0, le=24)
    note: str = Field(default="", max_length=200)
