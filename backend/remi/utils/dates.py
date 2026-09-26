"""Date helpers shared by the engine and the services.

Everything here is pure. ``business_today`` reads the wall clock only when no ``now`` is
passed; business logic should get "today" from a ``Clock`` instead.

Formatting uses fixed English (en-GB) names, never the process locale, so the server and the
client format dates identically: ``Mon 5 Oct``, ``5 Oct``, ``Monday 5 October``.
"""

import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

WEEKDAYS_SHORT = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
WEEKDAYS_LONG = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
MONTHS_SHORT = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
MONTHS_LONG = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)

_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def iso(d: date) -> str:
    """``YYYY-MM-DD``."""
    return d.isoformat()


def is_iso_date(value: object) -> bool:
    """True for a ``YYYY-MM-DD`` string that names a real date."""
    if not isinstance(value, str) or not _ISO_RE.match(value):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def parse_iso(value: str) -> date:
    """Parse a strict ``YYYY-MM-DD`` string. Raises ``ValueError`` for anything else."""
    if not _ISO_RE.match(value):
        msg = f"not a YYYY-MM-DD date: {value!r}"
        raise ValueError(msg)
    return date.fromisoformat(value)


def iso_week(d: date) -> int:
    """ISO-8601 week number (weeks start on Monday; week 1 holds the first Thursday)."""
    return d.isocalendar().week


def js_weekday(d: date) -> int:
    """Weekday in the prototype's ``getUTCDay`` convention: 0 = Sunday ... 6 = Saturday."""
    return d.isoweekday() % 7


def monday_of(d: date) -> date:
    """The Monday of ``d``'s week."""
    return d - timedelta(days=d.weekday())


def month_end(d: date) -> date:
    """The last calendar day of ``d``'s month."""
    first_next = date(d.year + 1, 1, 1) if d.month == 12 else date(d.year, d.month + 1, 1)
    return first_next - timedelta(days=1)


def add_months(d: date, months: int) -> date:
    """The first day of the month ``months`` after ``d``'s month."""
    index = d.year * 12 + (d.month - 1) + months
    return date(index // 12, index % 12 + 1, 1)


def days_between(a: date, b: date) -> int:
    """Signed calendar days from ``a`` to ``b``."""
    return (b - a).days


def business_today(tz: str, override: date | None = None, now: datetime | None = None) -> date:
    """Today in the business timezone ``tz``, or ``override`` when one is set.

    ``now`` must be timezone-aware when given; it defaults to the current instant.
    """
    if override is not None:
        return override
    zone = ZoneInfo(tz)
    instant = now if now is not None else datetime.now(zone)
    if instant.tzinfo is None:
        msg = "business_today needs a timezone-aware datetime"
        raise ValueError(msg)
    return instant.astimezone(zone).date()


def fmt_s(d: date) -> str:
    """``Mon 5 Oct`` (the prototype's ``F.s``)."""
    return f"{WEEKDAYS_SHORT[d.weekday()]} {d.day} {MONTHS_SHORT[d.month - 1]}"


def fmt_dm(d: date) -> str:
    """``5 Oct`` (the prototype's ``F.dm``)."""
    return f"{d.day} {MONTHS_SHORT[d.month - 1]}"


def fmt_l(d: date) -> str:
    """``Monday 5 October`` (the prototype's ``F.l``)."""
    return f"{WEEKDAYS_LONG[d.weekday()]} {d.day} {MONTHS_LONG[d.month - 1]}"
