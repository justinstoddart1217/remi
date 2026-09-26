"""Golden values from PLAN.md, ADR-0007 and the prototype, on the seed (today Mon 5 Oct 2026).

Values the unified maths deliberately changes (buffer 7, need 3.8, ret +6h -> Mon 7 Dec) are
asserted at their new value; ADR-0007 lists them.
"""

from dataclasses import replace
from datetime import date

import pytest

from remi.services.engine import allocation, checkin, derive, flags, forecast, loads, verdict
from remi.services.engine.model import HoursPerDay, ScopeAdd
from remi.services.engine.rotation import current
from remi.services.engine.routines import next_occurrences
from remi.tests.engine import seed as S

pytestmark = pytest.mark.golden

d = S.d


@pytest.fixture(scope="module")
def all_loads() -> dict[date, loads.DayLoad]:
    return loads.build_loads(d("2026-09-01"), d("2027-04-30"), S.plans(), S.ctx())


def test_countdown_is_61_business_days_strictly_between() -> None:
    c = S.ctx()
    assert verdict.countdown(c) == 61
    assert c.cal.bd_diff(S.TODAY, S.MOVE) == 62


@pytest.mark.parametrize(
    ("year", "month", "count"),
    [(2026, 10, 22), (2026, 11, 21), (2026, 12, 21), (2027, 1, 20), (2027, 2, 20), (2027, 3, 21)],
)
def test_business_days_per_month(year: int, month: int, count: int) -> None:
    assert len(S.calendar().month_bds(year, month)) == count


def test_today_is_bd3_and_31_aug_is_a_holiday() -> None:
    cal = S.calendar()
    assert cal.bdm(S.TODAY) == 3
    assert cal.holiday(d("2026-08-31")) is not None
    assert cal.is_bd(d("2026-12-28")) is False


def test_load_mon_5_oct_is_8h(all_loads: dict[date, loads.DayLoad]) -> None:
    load = all_loads[d("2026-10-05")]
    assert [(i.ref_id, i.hours) for i in load.items] == [("r-ret", 6), ("manco", 2)]
    assert (load.bau, load.proj, load.total, load.free, load.over) == (6, 2, 8, 0, False)


def test_ordinary_october_day_is_7h(all_loads: dict[date, loads.DayLoad]) -> None:
    load = all_loads[d("2026-10-06")]
    assert [(i.ref_id, i.hours) for i in load.items] == [
        ("ret", 3.5),
        ("manco", 1.5),
        ("play", 1),
        ("fion", 1),
    ]
    assert load.total == 7


def test_load_mon_12_oct_bd8_is_8h(all_loads: dict[date, loads.DayLoad]) -> None:
    load = all_loads[d("2026-10-12")]
    assert [(i.ref_id, i.hours) for i in load.items] == [
        ("r-man", 4),
        ("ret", 2),
        ("manco", 1.5),
        ("play", 0.5),
    ]
    assert load.total == 8
    assert not load.over


def test_load_wed_4_nov_is_the_only_overload(all_loads: dict[date, loads.DayLoad]) -> None:
    load = all_loads[d("2026-11-04")]
    assert [(i.ref_id, i.hours) for i in load.items] == [("r-ret", 6), ("ret", 3.5)]
    assert load.total == 9.5
    assert load.over
    assert [day for day, x in all_loads.items() if x.over] == [d("2026-11-04")]


def test_load_mon_4_jan_is_8h(all_loads: dict[date, loads.DayLoad]) -> None:
    load = all_loads[d("2027-01-04")]
    assert [(i.name, i.hours) for i in load.items] == [
        ("Germany · Build", 4),
        ("FI onboarding", 1),
        ("Alpha engine", 3),
    ]
    assert load.total == 8


def test_rotation_dates() -> None:
    c = S.ctx()
    plan = c.rotation_plan
    assert plan is not None
    spans = [(s.code, s.start, s.end) for s in plan.segments]
    assert spans == [
        ("DE", d("2027-01-04"), d("2027-01-11")),
        ("FR", d("2027-01-12"), d("2027-01-18")),
        ("IT", d("2027-01-19"), d("2027-01-26")),
        ("ES", d("2027-01-27"), d("2027-02-02")),
        ("NL", d("2027-02-03"), d("2027-02-08")),
        ("BE", d("2027-02-09"), d("2027-02-12")),
        ("AT", d("2027-02-15"), d("2027-02-18")),
        ("PT", d("2027-02-19"), d("2027-02-24")),
        ("IE", d("2027-02-25"), d("2027-03-02")),
        ("FI", d("2027-03-03"), d("2027-03-08")),
        ("DE", d("2027-03-09"), d("2027-03-11")),
    ]
    assert plan.total_bd == 49
    assert plan.loop_bd == 46
    assert plan.loop_end == d("2027-03-08")
    assert (plan.refresh_start, plan.refresh_end) == (d("2027-03-09"), d("2027-03-11"))
    status = current(plan, S.TODAY, c.cal)
    assert (status.status, status.bd_to_start) == ("waiting", 61)


def test_routine_next_runs_and_key_run() -> None:
    c = S.ctx()
    ret, man = S.ROUTINES
    assert [o.day for o in next_occurrences(ret, c)] == [
        d("2026-10-05"),
        d("2026-11-04"),
        d("2026-12-03"),
    ]
    assert [o.bd_away for o in next_occurrences(ret, c)] == [0, 22, 43]
    assert [o.day for o in next_occurrences(man, c)] == [
        d("2026-10-12"),
        d("2026-11-11"),
        d("2026-12-10"),
    ]
    assert verdict.key_run(c) == d("2026-12-03")


@pytest.mark.parametrize(
    ("pid", "hours"), [("ret", 144.0), ("manco", 74.5), ("play", 50.5), ("fion", 57.0)]
)
def test_work_left_and_finish_for_reproduces_the_forecast(pid: str, hours: float) -> None:
    c = S.ctx()
    p = S.PLANS[pid]
    left = forecast.work_left(p, c)
    assert left == pytest.approx(hours)
    assert forecast.finish_for(p, forecast.plan_from(p, c), hours, c).day == p.forecast


def test_alpha_has_no_forecast() -> None:
    assert forecast.work_left(S.PLANS["alpha"], S.ctx()) is None


def test_ret_is_plus_3_bd_and_at_risk(all_loads: dict[date, loads.DayLoad]) -> None:
    c = S.ctx()
    dp = derive.derive_project(S.project("ret"), c, all_loads)
    assert (dp.status, dp.delta_bd, dp.delta_label) == ("risk", 3, "+3 BD")
    assert dp.growth_pct == 17
    assert dp.since_days == 2
    assert dp.work_left_display == 144
    assert dp.cut_h == pytest.approx(10.5)
    assert dp.need.rate == 3.8
    assert dp.sentence.case == "late"
    assert (dp.sentence.late_bd, dp.sentence.need_rate, dp.sentence.cut_h) == (3, 3.8, 10.5)
    assert dp.sentence.first_over_day == d("2026-11-04")
    assert len(dp.milestones) == 5


def test_verdict_is_on_track_narrowly() -> None:
    v = verdict.verdict(S.plans(), S.ctx())
    assert v.state == "on_track_narrowly"
    assert v.buffer_bd == 7
    assert v.to_run_bd == 1
    assert v.last_pc_exit == d("2026-12-18")
    assert v.key_run == d("2026-12-03")


def test_move_strip_has_61_blocks_and_7_buffer_blocks() -> None:
    strip = verdict.move_strip(S.plans(), S.ctx())
    assert len(strip.remaining) == 61
    assert sum(1 for x in strip.remaining if not x.pc_running) == 7
    assert [(f.kind, f.project_id, f.day) for f in strip.flags] == [
        ("project", "ret", d("2026-12-02")),
        ("key_run", None, d("2026-12-03")),
        ("project", "manco", d("2026-12-11")),
        ("project", "play", d("2026-12-18")),
        ("move", None, d("2027-01-04")),
    ]


def test_move_strip_flags_match_the_prototype_positions_and_lifts() -> None:
    # parity/golden/transition.json: the flags' x, in the prototype's sorted order.
    strip = verdict.move_strip(S.plans(), S.ctx())
    n = len(strip.remaining)
    assert [f.slot for f in strip.flags] == [42, 42, 49, 54, 61]
    assert [f"{f.slot / n * 100:.3f}%" for f in strip.flags[:-1]] == [
        "68.852%",
        "68.852%",
        "80.328%",
        "88.525%",
    ]
    assert [f.index for f in strip.flags] == [0, 1, 2, 3, 4]
    assert [f.lift_px for f in strip.flags] == [2, 18, 2, 18, 2]
    assert [f.stick_px for f in strip.flags] == [10, 26, 10, 26, 10]


def test_attention_and_prompt(all_loads: dict[date, loads.DayLoad]) -> None:
    c = S.ctx()
    derived = [derive.derive_project(p, c, all_loads) for p in S.projects()]
    overloads = flags.upcoming_overloads(all_loads, c)
    assert [(o.day, o.total) for o in overloads] == [(d("2026-11-04"), 9.5)]
    items = flags.attention(derived, overloads)
    assert [(a.kind, a.project_id or a.day, a.chip) for a in items] == [
        ("at_risk", "ret", "+3 BD"),
        ("overload", d("2026-11-04"), "+1.5h"),
        ("stale", "manco", "9d"),
    ]
    prompt = flags.checkin_prompt(derived)
    assert prompt.prompt_project_id == "manco"
    assert prompt.next_due_project_id == "manco"


def test_manco_focus_tasks_today(all_loads: dict[date, loads.DayLoad]) -> None:
    block = allocation.focus_tasks(S.project("manco"), S.TODAY, all_loads, S.ctx())
    assert block is not None
    assert block.hours == 2
    assert [t.hours for t in block.tasks] == [0.5, 0.75, 0.75]
    assert [t.id for t in block.tasks] == ["man-0", "man-1", "man-2"]
    assert block.next_milestone is not None
    assert block.next_milestone.name == "Performance section builds itself"
    assert block.next_milestone.day == d("2026-10-16")


def test_month_snapshot_2_of_17_done_1_overdue() -> None:
    snap = allocation.month_snapshot(2026, 10, S.projects(), S.ctx(), S.RUNS)
    assert (snap.total, snap.done, snap.late) == (17, 2, 1)
    assert sum(1 for r in snap.rows if r.group == "bau") == 2
    late = [r for r in snap.rows if r.late]
    assert [(r.ref_id, r.overdue_bd) for r in late] == [("man-0", 1)]


def test_need_rate_is_3_8_and_applying_it_lands_on_the_target() -> None:
    c = S.ctx()
    ret = S.PLANS["ret"]
    need = forecast.solve_need_rate(ret, c)
    assert need.rate == 3.8
    applied = forecast.refit(ret, forecast.RateEdit(3.8), c).plan
    assert applied.forecast == d("2026-11-27")


def test_ret_plus_6h_lands_mon_7_dec_with_new_overloads() -> None:
    c = S.ctx()
    (out,) = checkin.preview([ScopeAdd("ret", "FX attribution", 6)], S.plans(), c)
    assert out.to_forecast == d("2026-12-07")
    assert (out.delta_bd, out.label) == (3, "+3 BD")
    assert [(o.day, o.total) for o in out.new_over] == [
        (d("2026-12-04"), 9.0),
        (d("2026-12-07"), 9.0),
    ]
    assert out.misses_key_run
    assert out.after.prev == d("2026-12-02")
    moved = [p if p.id != "ret" else out.after for p in S.plans()]
    assert verdict.verdict(moved, c).state == "at_risk"


@pytest.mark.parametrize(("pid", "rate"), [("manco", 2.0), ("ret", 4.0)])
def test_hours_a_day_checkins_land_wed_25_nov(pid: str, rate: float) -> None:
    (out,) = checkin.preview([HoursPerDay(pid, rate)], S.plans(), S.ctx())
    assert out.to_forecast == d("2026-11-25")


def test_ret_at_4h_scales_its_4_nov_override_to_4h() -> None:
    c = S.ctx()
    (out,) = checkin.preview([HoursPerDay("ret", 4.0)], S.plans(), c)
    assert out.after.overrides[d("2026-11-04")] == pytest.approx(4.0)
    after = [out.after if p.id == "ret" else p for p in S.plans()]
    load = loads.day_load(d("2026-11-04"), after, c)
    assert load is not None
    assert load.total == pytest.approx(10.0)


# ------------------------------------------------------------ ADR-0007 divergences (round 3)
@pytest.mark.parametrize(
    ("hours", "to", "chips"),
    [
        (4, "2026-12-07", ["2026-12-04", "2026-12-07"]),
        (8, "2026-12-08", ["2026-12-04", "2026-12-07", "2026-12-08"]),
        (16, "2026-12-10", ["2026-12-04", "2026-12-07", "2026-12-08", "2026-12-09"]),
        (40, "2026-12-21", ["2026-12-04", "2026-12-07", "2026-12-08", "2026-12-09", "2026-12-11"]),
    ],
)
def test_ret_scope_new_overload_chips(hours: float, to: str, chips: list[str]) -> None:
    (out,) = checkin.preview([ScopeAdd("ret", "x", hours)], S.plans(), S.ctx())
    assert out.to_forecast == d(to)
    assert [o.day for o in out.new_over] == [d(x) for x in chips]


@pytest.mark.parametrize(("hours", "unplaced"), [(8, 1.0), (16, 9.0), (40, 33.0)])
def test_play_scope_stops_at_the_move_with_a_plus_8_bd_label(hours: float, unplaced: float) -> None:
    (out,) = checkin.preview([ScopeAdd("play", "x", hours)], S.plans(), S.ctx())
    assert (out.to_forecast, out.delta_bd, out.label) == (S.MOVE, 8, "+8 BD")
    assert out.after.unplaced_h == pytest.approx(unplaced)


def test_moving_the_manco_pack_to_bd10_moves_the_bau_day_hours() -> None:
    routines = tuple(replace(r, bd=10) if r.id == "r-man" else r for r in S.ROUTINES)
    c = replace(S.ctx(), routines=routines)
    moved = loads.loads_for(S.plans(), c)
    overloads = flags.upcoming_overloads(moved, c)
    assert [(o.day, o.total) for o in overloads] == [(d("2026-11-04"), 9.5)]
    assert (moved[d("2026-10-14")].total, moved[d("2026-11-13")].total) == (8.0, 8.0)
    for p in S.plans():
        if p.forecast is not None:
            assert forecast.work_left(p, c) == forecast.work_left(p, S.ctx())
