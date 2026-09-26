from collections.abc import Sequence
from dataclasses import replace
from datetime import date, timedelta

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from app.services.engine.model import EngineCtx, ProjectPlan
from app.services.engine.verdict import (
    MoveStrip,
    countdown,
    key_run,
    last_pc_exit,
    move_strip,
    verdict,
)
from tests.engine import seed as S

d = S.d


def with_plan(**changes: ProjectPlan) -> list[ProjectPlan]:
    return [changes.get(p.id, p) for p in S.plans()]


def test_no_pc_projects() -> None:
    fi_only = [p for p in S.plans() if p.domain == "fi"]
    v = verdict(fi_only, S.ctx())
    assert v.state == "no_pc"
    assert (v.buffer_bd, v.last_pc_exit, v.key_project_id) == (None, None, None)


def test_off_track_when_a_pc_exit_lands_on_the_move() -> None:
    play = replace(S.PLANS["play"], forecast=S.MOVE)
    v = verdict(with_plan(play=play), S.ctx())
    assert (v.state, v.buffer_bd) == ("off_track", 0)


def test_off_track_when_hours_are_unplaced() -> None:
    play = replace(S.PLANS["play"], unplaced_h=2.0)
    v = verdict(with_plan(play=play), S.ctx())
    assert (v.state, v.unplaced) == ("off_track", True)


def test_at_risk_when_the_key_project_reaches_the_key_run() -> None:
    ret = replace(S.PLANS["ret"], forecast=d("2026-12-03"))
    v = verdict(with_plan(ret=ret), S.ctx())
    assert (v.state, v.to_run_bd) == ("at_risk", 0)


def test_on_track_when_nothing_is_late() -> None:
    ret = replace(S.PLANS["ret"], forecast=d("2026-11-27"))
    v = verdict(with_plan(ret=ret), S.ctx())
    assert (v.state, v.any_risk, v.to_run_bd) == ("on_track", False, 4)


def test_narrowly_counts_late_projects_in_either_domain() -> None:
    ret = replace(S.PLANS["ret"], forecast=d("2026-11-27"))
    fion = replace(S.PLANS["fion"], target=d("2026-12-31"))
    v = verdict(with_plan(ret=ret, fion=fion), S.ctx())
    assert v.state == "on_track_narrowly"


def test_missing_keys_skip_the_key_rule() -> None:
    ret = replace(S.PLANS["ret"], forecast=d("2026-12-09"))
    c = replace(S.ctx(), key_project_id=None)
    v = verdict(with_plan(ret=ret), c)
    assert (v.state, v.key_project_id, v.to_run_bd) == ("on_track_narrowly", None, None)
    no_routine = replace(S.ctx(), key_routine_id=None)
    assert key_run(no_routine) is None
    assert verdict(with_plan(ret=ret), no_routine).state == "on_track_narrowly"
    missing = replace(S.ctx(), key_project_id="deleted")
    assert verdict(with_plan(ret=ret), missing).state == "on_track_narrowly"


def test_key_run_override() -> None:
    c = replace(S.ctx(), key_run_override=d("2026-12-10"))
    assert key_run(c) == d("2026-12-10")
    ret = replace(S.PLANS["ret"], forecast=d("2026-12-09"))
    assert verdict(with_plan(ret=ret), c).state == "on_track_narrowly"


def test_last_pc_exit_ignores_define_projects() -> None:
    define = ProjectPlan("x", "pc", S.TODAY, d("2026-12-31"))
    assert last_pc_exit([define]) is None
    assert last_pc_exit([*S.plans(), define]) == d("2026-12-18")
    v = verdict([define], S.ctx())
    assert (v.state, v.buffer_bd) == ("no_pc", None)


def test_an_unplanned_pc_project_is_not_on_track() -> None:
    # A Private Credit project in Define has no exit yet, so the move cannot be "on track"
    # (and no "0 business days to spare" can be printed): the verdict stays "not planned yet"
    # until it has a forecast. The other exits still give the buffer.
    define = ProjectPlan("x", "pc", S.TODAY, d("2026-12-31"))
    ret = replace(S.PLANS["ret"], forecast=d("2026-11-27"))
    planned = with_plan(ret=ret)
    assert verdict(planned, S.ctx()).state == "on_track"
    v = verdict([*planned, define], S.ctx())
    assert (v.state, v.buffer_bd, v.last_pc_exit) == ("no_pc", 7, d("2026-12-18"))
    # An exit that already misses the move still says so.
    play = replace(S.PLANS["play"], unplaced_h=2.0)
    assert verdict([*with_plan(play=play), define], S.ctx()).state == "off_track"
    late = replace(S.PLANS["play"], forecast=S.MOVE)
    assert verdict([*with_plan(play=late), define], S.ctx()).state == "off_track"
    # An unplanned Fixed Income project does not hold the verdict back.
    fi_define = ProjectPlan("y", "fi", S.TODAY, d("2027-03-01"))
    assert verdict([*planned, fi_define], S.ctx()).state == "on_track"


def test_countdown_on_other_days() -> None:
    assert countdown(S.ctx(d("2027-01-01"))) == 0
    assert countdown(S.ctx(d("2026-12-31"))) == 0
    assert countdown(S.ctx(d("2026-12-30"))) == 1
    assert countdown(S.ctx(d("2027-01-05"))) == 0


def test_move_strip_after_the_move_is_empty() -> None:
    strip = move_strip(S.plans(), S.ctx(d("2027-01-05")))
    assert strip.remaining == ()
    # Every flag stands at slot 0, so the order is the insertion order (the prototype's
    # comparator sees NaN positions and keeps it too).
    assert order(strip) == ["ret", "manco", "play", "key_run", "move"]
    assert {f.slot for f in strip.flags} == {0}
    assert [f.lift_px for f in strip.flags] == [2, 18, 2, 18, 2]
    at_risk = [f.at_risk for f in move_strip(S.plans(), S.ctx()).flags if f.kind == "project"]
    assert at_risk == [True, False, False]


# ------------------------------------------------------------------------------- strip flags
def order(strip: MoveStrip) -> list[str]:
    return [f.project_id or f.kind for f in strip.flags]


def lifts(strip: MoveStrip) -> list[tuple[int, int]]:
    return [(f.lift_px, f.stick_px) for f in strip.flags]


ALTERNATING = [(2, 10), (18, 26), (2, 10), (18, 26), (2, 10)]


def test_flags_are_sorted_by_position() -> None:
    # ret's Wed 2 Dec flag stands at the right edge of its block, the Thu 3 Dec run at the left
    # edge of the next one: both at slot 42, so the stable sort keeps ret first.
    strip = move_strip(S.plans(), S.ctx())
    assert order(strip) == ["ret", "key_run", "manco", "play", "move"]
    assert [f.index for f in strip.flags] == [0, 1, 2, 3, 4]
    assert lifts(strip) == ALTERNATING


def test_a_forecast_on_the_key_run_day_stands_after_the_run() -> None:
    ret = replace(S.PLANS["ret"], forecast=d("2026-12-03"))
    strip = move_strip(with_plan(ret=ret), S.ctx())
    assert order(strip) == ["key_run", "ret", "manco", "play", "move"]
    assert [f.slot for f in strip.flags] == [42, 43, 49, 54, 61]
    assert lifts(strip) == ALTERNATING
    run, first = strip.flags[0], strip.flags[1]
    assert (run.lift_px, first.lift_px, first.at_risk) == (2, 18, True)


def test_ties_keep_project_order_then_the_key_run_then_the_move() -> None:
    manco = replace(S.PLANS["manco"], forecast=d("2026-12-02"))
    play = replace(S.PLANS["play"], forecast=S.MOVE, unplaced_h=9.0)
    strip = move_strip(with_plan(manco=manco, play=play), S.ctx())
    assert order(strip) == ["ret", "manco", "key_run", "play", "move"]
    assert [f.slot for f in strip.flags] == [42, 42, 42, 61, 61]
    assert lifts(strip) == ALTERNATING


def test_the_last_block_and_later_days_stand_at_the_end() -> None:
    # Thu 31 Dec is the last block (1 Jan is a bank holiday), so its right edge is the end.
    play = replace(S.PLANS["play"], forecast=d("2026-12-31"))
    manco = replace(S.PLANS["manco"], forecast=d("2027-01-05"))
    strip = move_strip(with_plan(play=play, manco=manco), S.ctx())
    assert order(strip) == ["ret", "key_run", "manco", "play", "move"]
    assert [f.slot for f in strip.flags] == [42, 42, 61, 61, 61]


def test_days_before_the_strip_stand_at_its_start() -> None:
    ret = replace(S.PLANS["ret"], forecast=S.TODAY)
    c = replace(S.ctx(), key_run_override=d("2026-10-01"))
    strip = move_strip(with_plan(ret=ret), c)
    assert order(strip) == ["ret", "key_run", "manco", "play", "move"]
    assert [f.slot for f in strip.flags] == [0, 0, 49, 54, 61]


def test_a_key_run_on_a_weekend_stands_at_the_next_block() -> None:
    c = replace(S.ctx(), key_run_override=d("2026-12-05"))
    strip = move_strip(S.plans(), c)
    assert order(strip) == ["ret", "key_run", "manco", "play", "move"]
    assert [f.slot for f in strip.flags] == [42, 44, 49, 54, 61]


def test_without_a_key_run_the_lifts_still_alternate() -> None:
    strip = move_strip(S.plans(), replace(S.ctx(), key_routine_id=None))
    assert order(strip) == ["ret", "manco", "play", "move"]
    assert lifts(strip) == ALTERNATING[:4]


def prototype_flags(projects: Sequence[ProjectPlan], ctx: EngineCtx) -> list[tuple[str, int]]:
    """``Transition.dc.html`` line for line: ``findIndex`` positions, then a stable sort."""
    rem = [x for x in ctx.cal.business_days if ctx.today < x < ctx.move]
    n = len(rem)

    def pos(day: date) -> int:
        return next((k for k, x in enumerate(rem) if x >= day), n)

    def pos_end(day: date) -> int:
        return next((k for k, x in enumerate(rem) if x > day), n)

    flags = [
        (p.id, pos_end(p.forecast)) for p in projects if p.domain == "pc" and p.forecast is not None
    ]
    run = key_run(ctx)
    if run is not None:
        flags.append(("key_run", pos(run)))
    flags.append(("move", n))
    return sorted(flags, key=lambda f: f[1])


DAYS = [d("2026-09-28") + timedelta(days=k) for k in range(120)]
PC = [p for p in S.plans() if p.domain == "pc"]


@settings(
    max_examples=150, deadline=None, database=None, suppress_health_check=[HealthCheck.too_slow]
)
@given(
    forecasts=st.lists(st.none() | st.sampled_from(DAYS), min_size=len(PC), max_size=len(PC)),
    run=st.none() | st.sampled_from(DAYS),
    today=st.sampled_from(DAYS),
)
def test_strip_flags_follow_the_prototype(
    forecasts: list[date | None], run: date | None, today: date
) -> None:
    projects = [replace(p, forecast=f) for p, f in zip(PC, forecasts, strict=True)]
    c = replace(S.ctx(today), key_run_override=run, key_routine_id=None if run is None else "r-ret")
    strip = move_strip(projects, c)
    assert [(f.project_id or f.kind, f.slot) for f in strip.flags] == prototype_flags(projects, c)
    for i, f in enumerate(strip.flags):
        assert f.index == i
        assert (f.lift_px, f.stick_px) == ((18, 26) if i % 2 else (2, 10))
