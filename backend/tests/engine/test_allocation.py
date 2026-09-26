from dataclasses import replace
from datetime import date

import pytest

from remi.services.engine.allocation import (
    RunState,
    focus_tasks,
    month_snapshot,
    next_milestone,
    next_run_after,
)
from remi.services.engine.loads import DayLoad, build_loads
from remi.services.engine.model import Milestone, Project, RoutineDef, Task
from tests.engine import seed as S

d = S.d


@pytest.fixture(scope="module")
def loads() -> dict[date, DayLoad]:
    return build_loads(d("2026-09-01"), d("2027-04-30"), S.plans(), S.ctx())


def with_tasks(pid: str, *tasks: Task) -> Project:
    p = S.project(pid)
    now = replace(p.milestones[0], tasks=tasks)
    return replace(p, milestones=(now, *p.milestones[1:]))


def test_no_block_without_hours(loads: dict[date, DayLoad]) -> None:
    c = S.ctx()
    assert focus_tasks(S.project("ret"), S.TODAY, loads, c) is None
    assert focus_tasks(S.project("ret"), d("2026-10-10"), loads, c) is None


def test_today_keeps_tasks_done_today_and_drops_earlier_ones(loads: dict[date, DayLoad]) -> None:
    c = S.ctx(d("2026-10-06"))
    p = with_tasks(
        "ret",
        Task("a", "Done earlier", 1, done=True, done_on=d("2026-10-01")),
        Task("b", "Done today", 1, done=True, done_on=d("2026-10-06")),
        Task("c", "Open", 2),
        Task("e", "Later", 2),
    )
    block = focus_tasks(p, d("2026-10-06"), loads, c)
    assert block is not None
    assert [t.id for t in block.tasks] == ["b", "c", "e"]


def test_a_later_day_starts_after_the_hours_planned_before_it(loads: dict[date, DayLoad]) -> None:
    c = S.ctx()
    block = focus_tasks(S.project("manco"), d("2026-10-06"), loads, c)
    assert block is not None
    assert [t.id for t in block.tasks] == ["man-3", "man-4"]
    used = focus_tasks(S.project("manco"), d("2026-10-09"), loads, c)
    assert used is not None
    assert (used.tasks, used.empty) == ((), "used_up")


def test_a_later_day_drops_done_tasks(loads: dict[date, DayLoad]) -> None:
    block = focus_tasks(S.project("ret"), d("2026-10-06"), loads, S.ctx())
    assert block is not None
    assert [t.id for t in block.tasks] == ["ret-2"]


def test_no_tasks_in_now(loads: dict[date, DayLoad]) -> None:
    block = focus_tasks(with_tasks("play"), d("2026-10-06"), loads, S.ctx())
    assert block is not None
    assert (block.tasks, block.empty) == ((), "no_tasks")


def test_next_milestone_on_the_day() -> None:
    nm = next_milestone(S.project("ret"), d("2026-10-15"))
    assert nm is not None
    assert (nm.name, nm.due_on_day) == ("Security-level data feed connected", True)
    assert next_milestone(S.project("ret"), d("2026-11-28")) is None
    explicit_only = Project(
        S.PLANS["ret"], milestones=(Milestone("x", "E", d("2026-11-01"), "explicit"),)
    )
    assert next_milestone(explicit_only, S.TODAY) is None


def test_next_run_after() -> None:
    c = S.ctx()
    assert next_run_after(d("2026-10-06"), c) == d("2026-10-12")
    assert next_run_after(d("2026-10-12"), c) == d("2026-11-04")
    assert next_run_after(d("2026-12-10"), c) is None


def test_month_snapshot_rows_and_order() -> None:
    snap = month_snapshot(2026, 10, S.projects(), S.ctx(), S.RUNS)
    assert (snap.first_bd, snap.last_bd) == (d("2026-10-01"), d("2026-10-30"))
    bau = [r for r in snap.rows if r.group == "bau"]
    assert [(r.ref_id, r.due, r.bdm, r.done) for r in bau] == [
        ("r-ret", d("2026-10-05"), 3, False),
        ("r-man", d("2026-10-12"), 8, False),
    ]
    projects = [r for r in snap.rows if r.group == "projects"]
    assert [r.ref_id for r in projects[:5]] == ["man-0", "ret-2", "ret-3", "ret-4", "ret-5"]
    assert [(r.ref_id, r.done_on) for r in projects[-2:]] == [
        ("fi-1", d("2026-10-02")),
        ("ret-1", d("2026-10-01")),
    ]
    assert any(r.kind == "milestone" and r.ref_id == "fion-next-0" for r in projects)
    assert all(r.project_id != "alpha" for r in projects)


def test_month_snapshot_bars() -> None:
    snap = month_snapshot(2026, 10, S.projects(), S.ctx(), S.RUNS)
    bars = {b.day: b for b in snap.bars}
    first = bars[d("2026-10-01")]
    assert (first.plan, first.done, first.late, first.past) == (0, 1, 0, True)
    fri = bars[d("2026-10-02")]
    assert (fri.plan, fri.done, fri.late) == (1, 2, 0)
    today = bars[S.TODAY]
    assert (today.plan, today.done, today.late, today.today) == (2, 2, 1, True)
    future = bars[d("2026-10-30")]
    assert (future.plan, future.done, future.late, future.past) == (17, 0, 0, False)


def test_checklist_and_run_completion() -> None:
    c = S.ctx()
    full = {("r-ret", S.TODAY): RunState(ticks_done=12, last_tick_on=S.TODAY)}
    snap = month_snapshot(2026, 10, S.projects(), c, full)
    ret_row = next(r for r in snap.rows if r.ref_id == "r-ret")
    assert (ret_row.done, ret_row.done_on) == (True, S.TODAY)
    ran = {("r-man", d("2026-10-12")): RunState(completed_on=d("2026-10-13"))}
    snap = month_snapshot(2026, 10, S.projects(), S.ctx(d("2026-10-14")), ran)
    man_row = next(r for r in snap.rows if r.ref_id == "r-man")
    assert (man_row.done, man_row.done_on, man_row.late) == (True, d("2026-10-13"), False)
    ret_row = next(r for r in snap.rows if r.ref_id == "r-ret")
    assert (ret_row.late, ret_row.overdue_bd) == (True, 7)


def test_month_after_the_move_has_no_pc_bau() -> None:
    snap = month_snapshot(2027, 1, S.projects(), S.ctx(), {})
    assert [r for r in snap.rows if r.group == "bau"] == []


def test_done_milestone_without_a_date_falls_back_to_the_first_bd() -> None:
    p = S.project("fion")
    ms = tuple(replace(m, done=True) if m.id == "fion-next-0" else m for m in p.milestones)
    snap = month_snapshot(2026, 10, [replace(p, milestones=ms)], S.ctx(), {})
    row = next(r for r in snap.rows if r.ref_id == "fion-next-0")
    assert (row.done, row.done_on) == (True, d("2026-10-01"))


def test_month_snapshot_skips_runs_before_a_routine_started() -> None:
    # A daily routine added today (Mon 5 Oct) is not overdue for 1 and 2 Oct.
    new = RoutineDef("r-new", "pc", "daily", 0.5, starts_on=S.TODAY)
    c = replace(S.ctx(), routines=(*S.ctx().routines, new))
    snap = month_snapshot(2026, 10, S.projects(), c, S.RUNS)
    rows = [r for r in snap.rows if r.ref_id == "r-new"]
    assert rows[0].due == S.TODAY
    assert not any(r.late for r in rows)
    base = month_snapshot(2026, 10, S.projects(), S.ctx(), S.RUNS)
    assert (snap.late, snap.total) == (base.late, base.total + len(rows))
    assert len(rows) == 20
