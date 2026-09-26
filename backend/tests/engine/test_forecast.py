from dataclasses import replace

import pytest

from app.services.engine.calendar import OutOfCalendar
from app.services.engine.forecast import (
    Finish,
    InvalidEdit,
    RateEdit,
    StartEdit,
    WorkLeftEdit,
    absorb_h,
    apply_scope,
    carry_work_left,
    cut_before_move_h,
    cut_to_target_h,
    day_hours,
    finish_for,
    plan_from,
    plan_hours_problem,
    refit,
    rescale,
    slip_for_scope,
    solve_need_rate,
    with_finish,
    work_between,
    work_left,
)
from app.services.engine.model import EngineCtx, ProjectPlan, RoutineDef
from tests.engine import seed as S

d = S.d
RET = S.PLANS["ret"]
MANCO = S.PLANS["manco"]


def ctx_with(*routines: RoutineDef) -> EngineCtx:
    c = S.ctx()
    return replace(c, routines=routines)


# ---------------------------------------------------------------- day_hours precedence
def test_non_business_day_is_zero() -> None:
    c = S.ctx()
    assert day_hours(RET, d("2026-10-10"), c) == 0
    assert day_hours(replace(RET, overrides={d("2026-12-25"): 5}), d("2026-12-25"), c) == 0


def test_override_wins_even_when_zero() -> None:
    c = S.ctx()
    assert day_hours(RET, d("2026-11-04"), c) == 3.5
    assert day_hours(MANCO, d("2026-11-04"), c) == 0
    after_move = replace(RET, overrides={d("2027-01-05"): 2})
    assert day_hours(after_move, d("2027-01-05"), c) == 2


def test_after_the_move_is_rate_after() -> None:
    c = S.ctx()
    assert day_hours(RET, d("2027-01-04"), c) == 0
    assert day_hours(S.PLANS["fion"], d("2027-01-04"), c) == 1
    assert day_hours(S.PLANS["alpha"], d("2027-01-06"), c) == 3


def test_routine_days_use_the_bau_day_hours() -> None:
    c = S.ctx()
    assert day_hours(RET, d("2026-10-05"), c) == 0
    assert day_hours(RET, d("2026-10-12"), c) == 2
    assert day_hours(MANCO, d("2026-10-05"), c) == 2
    assert day_hours(RET, d("2026-10-06"), c) == 3.5


def test_lowest_rule_wins_when_routines_share_a_day() -> None:
    weekly = RoutineDef("w", "pc", "weekly", 1, weekday=1)
    c = ctx_with(S.ROUTINES[0], weekly)
    p = replace(RET, bau_day_hours={"r-ret": 1.0, "w": 0.5})
    assert day_hours(p, d("2026-10-05"), c) == 0.5
    assert day_hours(p, d("2026-10-12"), c) == 0.5
    assert day_hours(p, d("2026-10-13"), c) == 3.5


def test_rules_apply_only_when_the_routine_counts() -> None:
    handed = replace(S.ROUTINES[0], stage=3)
    c = ctx_with(handed, S.ROUTINES[1])
    assert day_hours(RET, d("2026-10-05"), c) == 3.5
    orphan = replace(RET, bau_day_hours={"gone": 0.0})
    assert day_hours(orphan, d("2026-10-05"), S.ctx()) == 3.5


def test_scale() -> None:
    c = S.ctx()
    assert day_hours(RET, d("2026-10-06"), c, scale=2) == 7
    assert work_between(RET, d("2026-10-05"), d("2026-10-09"), c) == 14
    assert work_between(RET, d("2026-10-05"), d("2026-10-09"), c, scale=0.5) == 7
    assert work_between(RET, d("2026-10-09"), d("2026-10-05"), c) == 0


# ---------------------------------------------------------------- finish_for
def test_finish_for_small_hours_is_the_next_business_day() -> None:
    c = S.ctx()
    assert finish_for(RET, d("2026-10-10"), 0, c) == Finish(d("2026-10-12"))
    assert finish_for(RET, d("2026-10-06"), 0.005, c) == Finish(d("2026-10-06"))


def test_finish_for_uses_the_epsilon() -> None:
    c = S.ctx()
    assert finish_for(RET, d("2026-10-06"), 7.005, c).day == d("2026-10-07")
    assert finish_for(RET, d("2026-10-06"), 7.02, c).day == d("2026-10-08")


def test_finish_for_skips_zero_hour_days() -> None:
    c = S.ctx()
    assert finish_for(RET, d("2026-10-05"), 3.5, c).day == d("2026-10-06")


def test_finish_for_stalls_after_the_move_and_records_unplaced_hours() -> None:
    c = S.ctx()
    p = replace(RET, start=d("2026-12-21"), forecast=None)
    fin = finish_for(p, d("2026-12-21"), 30, c)
    assert fin.day == S.MOVE
    assert fin.short_h == pytest.approx(30 - 7 * 3.5)
    assert not fin.placed


def test_finish_for_waits_for_later_overrides_before_stalling() -> None:
    c = S.ctx()
    p = replace(RET, start=d("2027-01-04"), overrides={d("2027-01-20"): 2})
    assert finish_for(p, d("2027-01-04"), 2, c) == Finish(d("2027-01-20"))
    stalled = finish_for(p, d("2027-01-04"), 5, c)
    assert stalled == Finish(d("2027-01-21"), 3)


def test_finish_for_stall_day_is_never_before_the_move() -> None:
    # A day off on the last business day before the move: the stall day is the move itself,
    # not the business day after the last day with hours (Thu 31 Dec, before the move).
    c = S.ctx()
    play = replace(S.PLANS["play"], overrides={d("2026-12-31"): 0})
    left = work_left(play, c)
    assert left is not None
    fin = finish_for(play, plan_from(play, c), left + 16, c)
    assert fin.day == S.MOVE
    assert fin.short_h > 0
    stalled = with_finish(play, fin)
    assert finish_for(stalled, plan_from(stalled, c), work_left(stalled, c) or 0, c) == fin


def test_finish_for_stalls_at_the_move_when_no_day_has_hours() -> None:
    daily = RoutineDef("daily", "pc", "daily", 0)
    c = ctx_with(daily)
    p = replace(RET, bau_day_hours={"daily": 0.0}, overrides={})
    new = refit(p, WorkLeftEdit(20), c).plan
    assert (new.forecast, new.unplaced_h) == (S.MOVE, 20)
    assert work_left(new, c) == 20
    assert refit(new, WorkLeftEdit(20), c).plan == new


def test_finish_for_with_nothing_placeable() -> None:
    c = S.ctx()
    p = replace(RET, start=d("2027-01-04"))
    assert finish_for(p, d("2027-01-04"), 4, c) == Finish(d("2027-01-04"), 4)


def test_finish_for_raises_when_the_calendar_runs_out() -> None:
    c = S.ctx()
    fi = replace(S.PLANS["fion"], rate_after=0.1)
    with pytest.raises(OutOfCalendar):
        finish_for(fi, d("2027-01-04"), 10_000, c)


# ---------------------------------------------------------------- work left, rescale, refit
def test_work_left_counts_from_today_or_start_and_adds_unplaced() -> None:
    c = S.ctx()
    assert plan_from(RET, c) == S.TODAY
    later = replace(RET, start=d("2026-10-06"), forecast=d("2026-10-07"))
    assert plan_from(later, c) == d("2026-10-06")
    assert work_left(later, c) == 7
    assert work_left(replace(later, unplaced_h=2.5), c) == 9.5
    assert work_left(replace(RET, forecast=None), c) is None


def test_with_finish_keeps_prev_when_the_forecast_holds() -> None:
    same = with_finish(RET, Finish(d("2026-12-02")))
    assert same.prev == RET.prev
    moved = with_finish(RET, Finish(d("2026-12-07"), 1.5))
    assert (moved.forecast, moved.prev, moved.unplaced_h) == (d("2026-12-07"), RET.forecast, 1.5)
    first = with_finish(replace(RET, forecast=None, prev=None), Finish(d("2026-12-07")))
    assert first.prev is None


def test_rescale_scales_rate_after_bau_hours_and_overrides() -> None:
    p = rescale(RET, 7.0)
    assert p.rate == 7
    assert p.bau_day_hours == {"r-ret": 0, "r-man": 4}
    assert p.overrides == {d("2026-11-04"): 7}
    zero = replace(RET, rate=0.0)
    assert rescale(zero, 2.0) == replace(zero, rate=2.0)


def test_rate_refit_keeps_work_left() -> None:
    c = S.ctx()
    out = refit(RET, RateEdit(4.0), c)
    assert out.after == d("2026-11-25")
    assert out.moved
    assert out.plan.prev == RET.forecast
    assert out.plan.overrides[d("2026-11-04")] == pytest.approx(4)
    left = work_left(out.plan, c)
    assert left is not None
    assert left >= 144 - c.eps


def test_rate_edit_to_zero() -> None:
    c = S.ctx()
    with pytest.raises(InvalidEdit):
        refit(RET, RateEdit(0), c)
    with pytest.raises(InvalidEdit):
        refit(RET, RateEdit(-1), c)
    define = S.PLANS["alpha"]
    out = refit(define, RateEdit(0), c)
    assert (out.plan.rate, out.plan.forecast, out.moved) == (0, None, False)
    assert refit(define, RateEdit(4), c).plan.rate == 4


def test_work_left_edit() -> None:
    c = S.ctx()
    out = refit(RET, WorkLeftEdit(144 + 7), c)
    assert out.after == d("2026-12-07")
    assert refit(RET, WorkLeftEdit(144), c).plan == RET
    with pytest.raises(InvalidEdit):
        refit(RET, WorkLeftEdit(-1), c)


def test_work_left_edit_gives_a_define_project_its_forecast_at_rate_one() -> None:
    c = S.ctx()
    new = ProjectPlan("new", "pc", S.TODAY, d("2026-11-16"))
    out = refit(new, WorkLeftEdit(10), c)
    assert out.plan.rate == 1
    assert out.plan.forecast == d("2026-10-16")
    assert out.plan.prev is None
    assert (out.before, out.after) == (None, d("2026-10-16"))


def test_start_edit_snaps_and_keeps_work_left() -> None:
    c = S.ctx()
    p = replace(RET, start=d("2026-10-12"), forecast=d("2026-10-16"), prev=None)
    left = work_left(p, c)
    assert left is not None
    assert left == 2 + 4 * 3.5
    out = refit(p, StartEdit(d("2026-10-17")), c)
    assert out.plan.start == d("2026-10-19")
    assert out.after == d("2026-10-23")
    after = work_left(out.plan, c)
    assert after is not None
    assert left - c.eps <= after < left + 3.5
    define = S.PLANS["alpha"]
    moved = refit(define, StartEdit(d("2026-12-05")), c)
    assert (moved.plan.start, moved.after) == (d("2026-12-07"), None)


# ---------------------------------------------------------------- scope, need, cuts
def test_slip_for_scope() -> None:
    c = S.ctx()
    assert slip_for_scope(RET, 6, c) == Finish(d("2026-12-07"))
    assert slip_for_scope(RET, 0, c) == Finish(d("2026-12-02"))
    assert slip_for_scope(S.PLANS["alpha"], 6, c) is None
    moved = apply_scope(RET, 6, c)
    assert (moved.forecast, moved.prev) == (d("2026-12-07"), d("2026-12-02"))
    assert apply_scope(RET, 0, c) is RET


def test_scope_past_the_move_becomes_unplaced() -> None:
    c = S.ctx()
    moved = apply_scope(RET, 200, c)
    assert moved.forecast == S.MOVE
    assert moved.unplaced_h > 0
    left = work_left(moved, c)
    assert left == pytest.approx(144 + 200)


def test_need_rate_states() -> None:
    c = S.ctx()
    assert solve_need_rate(RET, c).rate == 3.8
    assert solve_need_rate(S.PLANS["alpha"], c).state == "no_estimate"
    passed = replace(RET, target=d("2026-10-01"))
    assert solve_need_rate(passed, c).state == "target_passed"
    after_move = replace(S.PLANS["fion"], target=d("2027-01-04"), forecast=d("2027-01-20"))
    only_after = replace(after_move, rate=1, start=d("2027-01-04"), target=d("2027-01-04"))
    zero_rate_days = replace(only_after, rate=0.0)
    assert solve_need_rate(zero_rate_days, c).state == "no_capacity"
    big = replace(RET, target=d("2026-10-09"))
    need = solve_need_rate(big, c)
    assert need.state == "over_capacity"
    assert need.rate is not None
    assert need.rate > c.capacity


def test_need_rate_rounds_up_but_not_float_noise() -> None:
    c = S.ctx()
    need = solve_need_rate(MANCO, c)
    assert (need.rate, need.state) == (1.5, "ok")


def test_need_rate_from_a_zero_rate_is_linear() -> None:
    c = S.ctx()
    p = replace(RET, rate=0.0, forecast=d("2026-10-09"), target=d("2026-10-09"))
    left = work_left(p, c)
    assert left == 0
    need = solve_need_rate(replace(p, unplaced_h=8), c)
    assert need.rate == pytest.approx(2.0)


def test_absorb_and_cuts() -> None:
    c = S.ctx()
    assert cut_to_target_h(RET, c) == pytest.approx(10.5)
    assert absorb_h(RET, c) == 0
    assert absorb_h(S.PLANS["play"], c) == 0
    early = replace(S.PLANS["play"], target=d("2026-12-22"))
    assert absorb_h(early, c) == pytest.approx(2)
    assert cut_before_move_h(RET, c) == 0
    late = apply_scope(RET, 200, c)
    cut = cut_before_move_h(late, c)
    assert cut is not None
    assert cut == pytest.approx(late.unplaced_h)
    assert cut_to_target_h(S.PLANS["alpha"], c) is None
    assert absorb_h(S.PLANS["alpha"], c) is None
    assert cut_before_move_h(S.PLANS["alpha"], c) is None


# ---------------------------------------------------------------- Fixed Income after the move
def test_a_new_fixed_income_plan_takes_its_first_rate_after_the_move_too() -> None:
    c = S.ctx()
    new = ProjectPlan("fi-new", "fi", d("2027-01-11"), d("2027-03-01"))
    assert (new.rate, new.rate_after) == (0, 0)
    first = refit(new, WorkLeftEdit(40), c).plan
    assert (first.rate, first.rate_after, first.unplaced_h) == (1, 1, 0)
    assert first.forecast == d("2027-03-05")  # 40 BD at 1h from Mon 11 Jan
    faster = refit(first, RateEdit(4), c).plan
    assert (faster.rate, faster.rate_after, faster.forecast) == (4, 4, d("2027-01-22"))
    # A first rate on a Define project sets both too; Private Credit keeps 0h after the move.
    assert rescale(new, 3).rate_after == 3
    assert rescale(replace(new, domain="pc"), 3).rate_after == 0
    # A plan that starts before the move carries on after it instead of stalling there.
    today = refit(replace(new, start=S.TODAY), WorkLeftEdit(100), c).plan
    assert today.unplaced_h == 0
    assert today.forecast is not None
    assert today.forecast > S.MOVE


def test_an_explicit_zero_after_move_rate_is_kept_and_stalls() -> None:
    c = S.ctx()
    planned = refit(ProjectPlan("f", "fi", S.TODAY, d("2027-03-01")), WorkLeftEdit(100), c).plan
    paused = replace(planned, rate_after=0.0)
    stalled = carry_work_left(planned, c, paused, c)
    assert (stalled.forecast, stalled.unplaced_h) == (S.MOVE, pytest.approx(38))
    # Re-entering the same work left keeps it (refits stay idempotent).
    left = work_left(stalled, c)
    assert left is not None
    assert left == pytest.approx(100)
    again = refit(stalled, WorkLeftEdit(left), c).plan
    assert (again.forecast, again.rate_after) == (S.MOVE, 0)
    assert rescale(stalled, 2).rate_after == 0


# ---------------------------------------------------------------- carry_work_left
def test_carry_work_left_keeps_the_work_left_under_a_new_context() -> None:
    c = S.ctx()
    early = replace(c, move=d("2026-12-01"))
    moved = carry_work_left(RET, c, RET, early)
    assert (moved.forecast, moved.unplaced_h, moved.prev) == (
        d("2026-12-01"),
        pytest.approx(7),
        RET.forecast,
    )
    assert work_left(moved, early) == pytest.approx(144)
    back = carry_work_left(moved, early, moved, c)
    assert (back.forecast, back.unplaced_h) == (RET.forecast, 0)
    # Nothing moves: the same object comes back (no movement, no write).
    assert carry_work_left(RET, c, RET, c) is RET
    alpha = S.PLANS["alpha"]
    assert carry_work_left(alpha, c, alpha, early) is alpha


def test_carry_work_left_moves_a_forecast_off_a_day_that_lost_its_hours() -> None:
    c = S.ctx()
    lost = replace(RET, overrides={**RET.overrides, RET.forecast or S.TODAY: 0.0})
    placed = carry_work_left(RET, c, lost, c)
    assert placed.forecast == d("2026-12-04")  # past Thu 3 Dec, a BD3 with 0h for ret
    assert finish_for(placed, plan_from(placed, c), 144, c).day == placed.forecast


# ---------------------------------------------------------------- stored hour figures
def test_plan_hours_problem() -> None:
    assert plan_hours_problem(RET) is None
    assert plan_hours_problem(replace(RET, rate=0.0)) is None
    assert plan_hours_problem(replace(RET, rate_after=0.04)) == "below_min"
    assert plan_hours_problem(replace(RET, overrides={S.TODAY: 24.5})) == "above_max"
    alpha = S.PLANS["alpha"]  # 2h a day, 3h after the move
    assert plan_hours_problem(rescale(alpha, 16)) is None
    assert plan_hours_problem(rescale(alpha, 17)) == "above_max"
    play = S.PLANS["play"]  # 1h a day, 0.5h on ManCo pack days
    assert plan_hours_problem(rescale(play, 0.06)) == "below_min"
