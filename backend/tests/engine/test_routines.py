from dataclasses import replace

import pytest

from remi.services.engine.model import RoutineDef
from remi.services.engine.routines import (
    counts_on,
    in_domain_window,
    last_occurrence_before,
    monthly_effort_h,
    next_occurrences,
    occurs,
    rule_short,
    rule_text,
)
from tests.engine import seed as S

d = S.d
RET, MAN = S.ROUTINES


def test_monthly_occurs_on_its_business_day() -> None:
    cal = S.calendar()
    assert occurs(RET, d("2026-10-05"), cal)
    assert not occurs(RET, d("2026-10-06"), cal)
    assert occurs(MAN, d("2026-10-12"), cal)
    assert not occurs(RET, d("2026-10-03"), cal)


def test_monthly_bd_beyond_the_month_never_fires() -> None:
    cal = S.calendar()
    r = RoutineDef("r", "pc", "monthly", 1, bd=21)
    assert [x for x in cal.month_bds(2027, 1) if occurs(r, x, cal)] == []
    assert [x for x in cal.month_bds(2026, 10) if occurs(r, x, cal)] == [d("2026-10-29")]


def test_weekly_and_daily() -> None:
    cal = S.calendar()
    tue = RoutineDef("w", "pc", "weekly", 1, weekday=2)
    daily = RoutineDef("x", "pc", "daily", 1)
    assert occurs(tue, d("2026-10-06"), cal)
    assert not occurs(tue, d("2026-10-07"), cal)
    assert occurs(daily, d("2026-10-07"), cal)
    assert not occurs(daily, d("2026-10-10"), cal)
    assert not occurs(daily, d("2026-12-25"), cal)


def test_domain_window() -> None:
    assert in_domain_window("pc", d("2027-01-01"), S.MOVE)
    assert not in_domain_window("pc", S.MOVE, S.MOVE)
    assert in_domain_window("fi", S.MOVE, S.MOVE)
    assert not in_domain_window("fi", d("2026-12-31"), S.MOVE)


def test_counts_on_uses_stage_and_domain() -> None:
    c = S.ctx()
    assert counts_on(RET, d("2026-10-05"), c)
    assert not counts_on(RET, d("2027-02-03"), c)
    handed = replace(RET, stage=3)
    assert not counts_on(handed, d("2026-10-05"), c)
    fi = RoutineDef("fi", "fi", "daily", 1)
    assert not counts_on(fi, d("2026-12-31"), c)
    assert counts_on(fi, d("2027-01-04"), c)


def test_next_occurrences_ignore_stage_and_mark_after_move() -> None:
    c = S.ctx()
    handed = replace(RET, stage=3)
    occ = next_occurrences(handed, c, after=d("2026-12-01"))
    assert [o.day for o in occ] == [d("2026-12-03"), d("2027-01-06"), d("2027-02-03")]
    assert [o.after_move for o in occ] == [False, True, True]
    assert next_occurrences(RET, c)[0].today
    assert next_occurrences(RET, c, limit=0) == []


def test_weekly_next_occurrences() -> None:
    tue = RoutineDef("w", "pc", "weekly", 1, weekday=2)
    occ = next_occurrences(tue, S.ctx())
    assert [(o.day, o.bd_away) for o in occ] == [
        (d("2026-10-06"), 1),
        (d("2026-10-13"), 6),
        (d("2026-10-20"), 11),
    ]


def test_last_occurrence_before() -> None:
    c = S.ctx()
    assert last_occurrence_before(RET, c, S.MOVE) == d("2026-12-03")
    assert last_occurrence_before(MAN, c, S.MOVE) == d("2026-12-10")
    assert last_occurrence_before(RET, c, d("2026-12-03")) == d("2026-11-04")
    never = RoutineDef("n", "pc", "monthly", 1, bd=30)
    assert last_occurrence_before(never, c, S.MOVE) is None


@pytest.mark.parametrize(
    ("routine", "hours", "approx"),
    [
        (RoutineDef("a", "pc", "daily", 1.5), 32.0, True),
        (RoutineDef("b", "pc", "weekly", 1.5), 6.5, True),
        (RoutineDef("c", "pc", "monthly", 6), 6.0, False),
    ],
)
def test_monthly_effort(routine: RoutineDef, hours: float, approx: bool) -> None:
    effort = monthly_effort_h(routine)
    assert (effort.hours, effort.approx) == (hours, approx)


def test_rule_text() -> None:
    assert rule_text(RET) == "3rd business day, monthly"
    assert rule_text(replace(RET, bd=11)) == "11th business day, monthly"
    assert rule_text(RoutineDef("w", "pc", "weekly", 1, weekday=2)) == "Every Tuesday"
    assert rule_text(RoutineDef("x", "pc", "daily", 1)) == "Every business day"
    assert rule_short(MAN) == "BD8"
    assert rule_short(RoutineDef("w", "pc", "weekly", 1, weekday=5)) == "Weekly · Fri"
    assert rule_short(RoutineDef("x", "pc", "daily", 1)) == "Daily"


def test_a_routine_counts_only_from_the_day_it_starts() -> None:
    c = S.ctx()
    daily = RoutineDef("r-new", "pc", "daily", 1, starts_on=d("2026-10-05"))
    assert not counts_on(daily, d("2026-10-02"), c)
    assert counts_on(daily, d("2026-10-05"), c)
    assert counts_on(replace(daily, starts_on=None), d("2026-10-02"), c)
    # The rule itself still fires (the Routines rows list dates from the rule).
    assert occurs(daily, d("2026-10-02"), c.cal)
