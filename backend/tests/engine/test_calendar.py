from datetime import date

import pytest

from app.services.engine.calendar import BusinessCalendar, OutOfCalendar
from tests.engine import seed as S

d = S.d


def small() -> BusinessCalendar:
    """October-November 2026 with a made-up holiday on Wed 7 Oct."""
    return BusinessCalendar.build(d("2026-10-10"), d("2026-11-02"), {d("2026-10-07"): "Test day"})


def test_build_covers_whole_months() -> None:
    cal = small()
    assert cal.start == d("2026-10-01")
    assert cal.end == d("2026-11-30")
    assert cal.covers(d("2026-10-01"))
    assert cal.covers(d("2026-11-30"))
    assert not cal.covers(d("2026-09-30"))
    assert not cal.covers(d("2026-12-01"))


def test_build_rejects_end_before_start() -> None:
    with pytest.raises(ValueError, match="before start"):
        BusinessCalendar.build(d("2026-10-10"), d("2026-10-01"), {})


def test_business_days_and_bdm() -> None:
    cal = small()
    assert cal.is_bd(d("2026-10-01"))
    assert cal.bdm(d("2026-10-01")) == 1
    assert cal.bdm(d("2026-10-02")) == 2
    assert not cal.is_bd(d("2026-10-03"))
    assert cal.bdm(d("2026-10-03")) is None
    assert cal.bdm(d("2026-10-05")) == 3
    assert cal.bdm(d("2026-10-06")) == 4
    assert not cal.is_bd(d("2026-10-07"))
    assert cal.holiday(d("2026-10-07")) == "Test day"
    assert cal.bdm(d("2026-10-08")) == 5
    assert cal.bdm(d("2026-11-02")) == 1


def test_day_info() -> None:
    info = small().day_info(d("2026-10-04"))
    assert (info.w, info.bd, info.bdm, info.holiday, info.week) == (0, False, None, None, 40)
    monday = small().day_info(d("2026-10-05"))
    assert (monday.w, monday.bd, monday.bdm) == (1, True, 3)


def test_next_and_prev_bd() -> None:
    cal = small()
    assert cal.next_bd(d("2026-10-05")) == d("2026-10-05")
    assert cal.next_bd(d("2026-10-03")) == d("2026-10-05")
    assert cal.next_bd(d("2026-10-07")) == d("2026-10-08")
    assert cal.prev_bd(d("2026-10-05")) == d("2026-10-02")
    assert cal.prev_bd(d("2026-10-08")) == d("2026-10-06")
    assert cal.prev_bd(d("2026-10-04")) == d("2026-10-02")


def test_add_bd_raises_instead_of_clamping() -> None:
    cal = small()
    assert cal.add_bd(d("2026-10-05"), 2) == d("2026-10-08")
    assert cal.add_bd(d("2026-10-03"), 0) == d("2026-10-05")
    assert cal.add_bd(d("2026-10-08"), -2) == d("2026-10-05")
    with pytest.raises(OutOfCalendar):
        cal.add_bd(d("2026-11-30"), 1)
    with pytest.raises(OutOfCalendar):
        cal.add_bd(d("2026-10-01"), -1)


def test_out_of_range_dates_raise() -> None:
    cal = small()
    for call in (
        lambda: cal.is_bd(d("2026-12-01")),
        lambda: cal.next_bd(d("2026-09-30")),
        lambda: cal.bd_diff(d("2026-10-05"), d("2027-01-04")),
        lambda: cal.bds(d("2026-10-01"), d("2026-12-01")),
        lambda: cal.prev_bd(d("2026-10-01")),
    ):
        with pytest.raises(OutOfCalendar):
            call()


def test_out_of_calendar_reports_the_year() -> None:
    with pytest.raises(OutOfCalendar) as err:
        small().is_bd(d("2027-02-01"))
    assert err.value.year == 2027
    assert err.value.day == d("2027-02-01")


def test_next_bd_past_the_last_business_day_raises() -> None:
    cal = BusinessCalendar.build(d("2026-10-01"), d("2026-10-31"), {})
    assert cal.next_bd(d("2026-10-30")) == d("2026-10-30")
    with pytest.raises(OutOfCalendar):
        cal.next_bd(d("2026-10-31"))


def test_bd_diff_is_a_signed_offset_rolling_forward() -> None:
    cal = small()
    assert cal.bd_diff(d("2026-10-05"), d("2026-10-09")) == 3
    assert cal.bd_diff(d("2026-10-09"), d("2026-10-05")) == -3
    assert cal.bd_diff(d("2026-10-03"), d("2026-10-05")) == 0
    assert cal.bd_diff(d("2026-10-05"), d("2026-10-05")) == 0


def test_bd_between_counts_strictly_between() -> None:
    cal = small()
    assert cal.bd_between(d("2026-10-05"), d("2026-10-09")) == 2
    assert cal.bd_between(d("2026-10-05"), d("2026-10-06")) == 0
    assert cal.bd_between(d("2026-10-05"), d("2026-10-05")) == 0
    assert cal.bd_between(d("2026-10-09"), d("2026-10-05")) == 0
    assert cal.bd_between(d("2026-10-03"), d("2026-10-12")) == 4


def test_bds_and_iterators() -> None:
    cal = small()
    assert cal.bds(d("2026-10-05"), d("2026-10-09")) == [
        d("2026-10-05"),
        d("2026-10-06"),
        d("2026-10-08"),
        d("2026-10-09"),
    ]
    assert cal.bds(d("2026-10-09"), d("2026-10-05")) == []
    it = cal.iter_bds(d("2026-10-03"))
    assert [next(it), next(it)] == [d("2026-10-05"), d("2026-10-06")]
    back = cal.iter_bds_before(d("2026-10-05"))
    assert [next(back), next(back)] == [d("2026-10-02"), d("2026-10-01")]
    assert len(cal.business_days) == 21 + 21


def test_month_bds_and_iso_week() -> None:
    cal = S.calendar()
    assert len(cal.month_bds(2026, 12)) == 21
    assert cal.month_bds(2026, 12)[-1] == d("2026-12-31")
    assert cal.iso_week(date(2026, 10, 5)) == 41
    assert cal.iso_week(date(2027, 1, 1)) == 53


def test_weekend_holidays_are_reported_but_change_nothing() -> None:
    cal = S.calendar()
    assert cal.holiday(d("2026-12-26")) == "Boxing Day"
    assert cal.holiday(d("2026-12-28")) == "Boxing Day (observed)"
    assert cal.bdm(d("2026-12-29")) == 19
