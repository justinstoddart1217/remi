"""Small text and number helpers with the prototype's exact rounding and labels.

JavaScript's ``Math.round`` rounds halves up (towards +infinity); Python's ``round`` rounds
halves to even. Every figure Remi shows was rounded the JavaScript way, so the helpers here
reproduce ``Math.round(x * 10**n) / 10**n`` exactly.
"""

import math

MINUS = "\u2212"
"""U+2212, the minus sign used in delta labels."""

PLUS_MINUS = "\u00b1"


def round_half_up(x: float, ndigits: int = 0) -> float:
    """``Math.round(x * 10**ndigits) / 10**ndigits``, as the prototype computes it."""
    scale = 10**ndigits
    return math.floor(x * scale + 0.5) / scale


def hr1(x: float) -> float:
    """One decimal place (the Workspace's ``hr``)."""
    return round_half_up(x, 1)


def to_half(x: float) -> float:
    """Nearest half hour (``Math.round(x * 2) / 2``), used for the work-left display."""
    return math.floor(x * 2 + 0.5) / 2


def fmt_num(x: float, ndigits: int = 2) -> str:
    """A number the way JavaScript prints it after rounding: ``8``, ``9.5``, ``0.75``."""
    value = round_half_up(x, ndigits)
    if value == 0:
        return "0"
    if value == int(value):
        return str(int(value))
    return f"{value:.{ndigits}f}".rstrip("0").rstrip(".")


def fmt_hours(h: float) -> str:
    """``9.5h``: hours rounded to 2 decimals (the prototype's ``hrs``)."""
    return fmt_num(h, 2) + "h"


def ordinal(n: int) -> str:
    """``1st``, ``2nd``, ``3rd``, ``4th``, ``11th``, ``12th``, ``13th``, ``21st`` ..."""
    suffix = "th" if n % 100 in (11, 12, 13) else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def delta_label(delta_bd: int | None) -> str:
    """A project's delta against its target: ``+3 BD``, minus 2 BD, ``On target``, ``No forecast``.

    Negative deltas use U+2212 (``MINUS``)."""
    if delta_bd is None:
        return "No forecast"
    if delta_bd > 0:
        return f"+{delta_bd} BD"
    if delta_bd < 0:
        return f"{MINUS}{-delta_bd} BD"
    return "On target"


def shift_label(delta_bd: int) -> str:
    """A forecast movement: ``+3 BD``, ``\u00b10 BD`` (U+00B1) or minus 2 BD (U+2212)."""
    if delta_bd > 0:
        return f"+{delta_bd} BD"
    if delta_bd < 0:
        return f"{MINUS}{-delta_bd} BD"
    return f"{PLUS_MINUS}0 BD"


def since_label(since_days: int | None) -> str:
    """Days since the last check-in: ``Not yet``, ``Today``, ``Yesterday``, ``9 days ago``."""
    if since_days is None:
        return "Not yet"
    if since_days == 0:
        return "Today"
    if since_days == 1:
        return "Yesterday"
    return f"{since_days} days ago"


def plural(n: int, word: str, many: str | None = None) -> str:
    """``1 note`` / ``2 notes``."""
    return f"{n} {word if n == 1 else (many or word + 's')}"


def clip(text: str, limit: int) -> str:
    """The first ``limit`` characters (JavaScript's ``slice(0, limit)``)."""
    return text[:limit]
