from datetime import UTC, date, datetime

import pytest

from remi.utils import dates, text


def test_iso_helpers() -> None:
    assert dates.iso(date(2026, 10, 5)) == "2026-10-05"
    assert dates.parse_iso("2026-10-05") == date(2026, 10, 5)
    assert dates.is_iso_date("2026-10-05")
    assert not dates.is_iso_date("2026-13-01")
    assert not dates.is_iso_date("5 Oct")
    assert not dates.is_iso_date(20261005)
    with pytest.raises(ValueError, match="YYYY-MM-DD"):
        dates.parse_iso("2026-10-5")


def test_week_helpers() -> None:
    assert dates.iso_week(date(2026, 10, 5)) == 41
    assert dates.js_weekday(date(2026, 10, 4)) == 0
    assert dates.js_weekday(date(2026, 10, 5)) == 1
    assert dates.monday_of(date(2026, 10, 8)) == date(2026, 10, 5)
    assert dates.month_end(date(2026, 12, 3)) == date(2026, 12, 31)
    assert dates.month_end(date(2027, 2, 3)) == date(2027, 2, 28)
    assert dates.add_months(date(2026, 12, 15), 1) == date(2027, 1, 1)
    assert dates.days_between(date(2026, 9, 26), date(2026, 10, 5)) == 9


def test_business_today() -> None:
    late_utc = datetime(2026, 10, 4, 23, 30, tzinfo=UTC)
    assert dates.business_today("Europe/London", now=late_utc) == date(2026, 10, 5)
    assert dates.business_today("UTC", now=late_utc) == date(2026, 10, 4)
    assert dates.business_today("UTC", override=date(2026, 1, 1)) == date(2026, 1, 1)
    with pytest.raises(ValueError, match="timezone-aware"):
        dates.business_today("UTC", now=datetime(2026, 10, 4))  # noqa: DTZ001
    assert isinstance(dates.business_today("Europe/London"), date)


def test_formatters() -> None:
    day = date(2026, 10, 5)
    assert dates.fmt_s(day) == "Mon 5 Oct"
    assert dates.fmt_dm(day) == "5 Oct"
    assert dates.fmt_l(day) == "Monday 5 October"


def test_rounding_matches_javascript() -> None:
    assert text.round_half_up(2.5) == 3
    assert text.round_half_up(-2.5) == -2
    assert text.round_half_up(0.25, 1) == 0.3
    assert text.hr1(3.7752) == 3.8
    assert text.to_half(144.2) == 144
    assert text.to_half(144.25) == 144.5
    assert text.fmt_num(8.0) == "8"
    assert text.fmt_num(9.5) == "9.5"
    assert text.fmt_num(1.5000000000000002) == "1.5"
    assert text.fmt_num(0.754) == "0.75"
    assert text.fmt_num(0) == "0"
    assert text.fmt_hours(0.75) == "0.75h"


def test_labels() -> None:
    assert [text.ordinal(n) for n in (1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 111)] == [
        "1st",
        "2nd",
        "3rd",
        "4th",
        "11th",
        "12th",
        "13th",
        "21st",
        "22nd",
        "23rd",
        "111th",
    ]
    assert text.delta_label(None) == "No forecast"
    assert text.delta_label(3) == "+3 BD"
    assert text.delta_label(-2) == "\u22122 BD"
    assert text.delta_label(0) == "On target"
    assert text.shift_label(0) == "\u00b10 BD"
    assert text.shift_label(-1) == "\u22121 BD"
    assert text.shift_label(2) == "+2 BD"
    assert [text.since_label(x) for x in (None, 0, 1, 9)] == [
        "Not yet",
        "Today",
        "Yesterday",
        "9 days ago",
    ]
    assert text.plural(1, "note") == "1 note"
    assert text.plural(2, "note") == "2 notes"
    assert text.plural(2, "day", "days") == "2 days"
    assert text.clip("abcdef", 3) == "abc"
