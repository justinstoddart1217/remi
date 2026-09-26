"""Today and Calendar: focus-block task allocation, the month snapshot, next BAU run."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Literal

from app.services.engine.loads import DayLoad
from app.services.engine.model import EngineCtx, Project, RoutineKind, Task
from app.services.engine.routines import counts_on

_TOL = 0.01


# ---------------------------------------------------------------------------- focus blocks
@dataclass(frozen=True, slots=True)
class NextMilestone:
    milestone_id: str
    name: str
    day: date
    due_on_day: bool
    """``Milestone due this day`` rather than ``Next milestone``."""


FocusEmpty = Literal["no_tasks", "used_up"]


@dataclass(frozen=True, slots=True)
class FocusBlock:
    project_id: str
    day: date
    hours: float
    tasks: tuple[Task, ...]
    empty: FocusEmpty | None
    """``no_tasks``: nothing in Now. ``used_up``: Now is used up before this day."""
    next_milestone: NextMilestone | None


def next_milestone(p: Project, day: date) -> NextMilestone | None:
    """The first Now or Next item due on or after ``day`` (by due date, stable)."""
    items = sorted(
        (m for m in p.milestones if m.horizon != "explicit" and m.due is not None and m.due >= day),
        key=lambda m: m.due or day,
    )
    if not items:
        return None
    m = items[0]
    due = m.due or day
    return NextMilestone(m.id, m.name, due, due == day)


def focus_tasks(
    p: Project, day: date, loads: Mapping[date, DayLoad], ctx: EngineCtx
) -> FocusBlock | None:
    """The Now tasks that fill this project's hours on ``day``, or ``None`` when the project
    has no hours that day.

    Tasks are laid end to end in plan order. Today keeps tasks done today (they stay in place)
    and drops tasks done earlier; other days drop every done task. On a later day the window
    starts after the project's planned hours from today up to the day before. A task is in the
    block when it overlaps ``(off, off + hours)`` by more than 0.01h.
    """
    load = loads.get(day)
    hours = load.project_hours(p.id) if load is not None else 0.0
    if hours <= 0:
        return None
    if day == ctx.today:
        tasks = [t for t in p.now_tasks() if not t.done or t.done_on == ctx.today]
        off = 0.0
    else:
        tasks = [t for t in p.now_tasks() if not t.done]
        off = 0.0
        if day > ctx.today:
            for d in ctx.cal.bds(ctx.today, day):
                if d < day and (earlier := loads.get(d)) is not None:
                    off += earlier.project_hours(p.id)
    picked: list[Task] = []
    a0 = 0.0
    for t in tasks:
        a1 = a0 + max(0.0, t.hours)
        if a1 > off + _TOL and a0 < off + hours - _TOL:
            picked.append(t)
        a0 = a1
    empty: FocusEmpty | None = None
    if not tasks:
        empty = "no_tasks"
    elif not picked:
        empty = "used_up"
    return FocusBlock(p.id, day, hours, tuple(picked), empty, next_milestone(p, day))


def next_run_after(day: date, ctx: EngineCtx) -> date | None:
    """The first business day after ``day`` on which any routine counts (``None``: no more
    BAU runs, which the UI words as "after the move")."""
    for d in ctx.cal.iter_bds(day):
        if d > day and any(counts_on(r, d, ctx) for r in ctx.routines):
            return d
    return None


# ---------------------------------------------------------------------------- month snapshot
@dataclass(frozen=True, slots=True)
class RunState:
    """What was recorded for one routine occurrence."""

    completed_on: date | None = None
    ticks_done: int = 0
    last_tick_on: date | None = None


SnapshotKind = Literal["bau", "task", "milestone"]
SnapshotGroup = Literal["bau", "projects"]


@dataclass(frozen=True, slots=True)
class SnapshotRow:
    kind: SnapshotKind
    group: SnapshotGroup
    ref_id: str
    """Routine id (``bau``), task id or milestone id."""
    project_id: str | None
    due: date
    done: bool
    done_on: date | None
    late: bool
    """Not done and due before today."""
    overdue_bd: int | None
    """``bd_diff(due, today)`` when late."""
    bdm: int | None = None
    """The occurrence's business day of the month (``bau`` rows)."""
    routine_kind: RoutineKind | None = None


@dataclass(frozen=True, slots=True)
class SnapshotBar:
    day: date
    plan: int
    """Rows due by this day."""
    done: int
    """Rows done by this day (past days only)."""
    late: int
    """Rows overdue on this day (past days only)."""
    past: bool
    today: bool


@dataclass(frozen=True, slots=True)
class MonthSnapshot:
    year: int
    month: int
    first_bd: date
    last_bd: date
    rows: tuple[SnapshotRow, ...]
    """BAU rows then project rows; in each group open rows by due date, then done rows by
    completion date, newest first."""
    total: int
    done: int
    late: int
    bars: tuple[SnapshotBar, ...]


def _order(rows: list[SnapshotRow]) -> list[SnapshotRow]:
    open_rows = sorted((r for r in rows if not r.done), key=lambda r: r.due)
    done_rows = sorted((r for r in rows if r.done), key=lambda r: -(r.done_on or r.due).toordinal())
    return open_rows + done_rows


def _row(
    kind: SnapshotKind,
    ref_id: str,
    project_id: str | None,
    due: date,
    done: bool,
    done_on: date | None,
    ctx: EngineCtx,
    bdm: int | None = None,
    routine_kind: RoutineKind | None = None,
) -> SnapshotRow:
    late = not done and due < ctx.today
    return SnapshotRow(
        kind=kind,
        group="bau" if kind == "bau" else "projects",
        ref_id=ref_id,
        project_id=project_id,
        due=due,
        done=done,
        done_on=done_on,
        late=late,
        overdue_bd=ctx.cal.bd_diff(due, ctx.today) if late else None,
        bdm=bdm,
        routine_kind=routine_kind,
    )


def month_snapshot(
    year: int,
    month: int,
    projects: Sequence[Project],
    ctx: EngineCtx,
    runs: Mapping[tuple[str, date], RunState],
) -> MonthSnapshot:
    """Everything due in a month: BAU occurrences that count, and for projects with a
    forecast every Now task due by the month's last business day (earlier overdue ones too)
    plus Next milestones due by then. ``runs`` is keyed by (routine id, occurrence day).

    A BAU occurrence is done when a run was recorded, or when its checklist is fully ticked.
    """
    cal = ctx.cal
    today = ctx.today
    bds = cal.month_bds(year, month)
    if not bds:
        msg = f"{year}-{month:02d} has no business days"
        raise ValueError(msg)
    first, last = bds[0], bds[-1]

    bau: list[SnapshotRow] = []
    for r in ctx.routines:
        for d in bds:
            if not counts_on(r, d, ctx):
                continue
            run = runs.get((r.id, d))
            done = run is not None and (
                run.completed_on is not None
                or (r.checklist_size > 0 and run.ticks_done >= r.checklist_size)
            )
            done_on = (
                (run.completed_on or run.last_tick_on or d) if run is not None and done else None
            )
            bau.append(_row("bau", r.id, r.project_id, d, done, done_on, ctx, cal.bdm(d), r.kind))
    proj: list[SnapshotRow] = []
    for p in projects:
        if p.plan.forecast is None:
            continue
        for m in p.milestones:
            if m.horizon == "now":
                for t in m.tasks:
                    due = t.due or m.due
                    if due is None or due > last:
                        continue
                    proj.append(
                        _row(
                            "task",
                            t.id,
                            p.id,
                            due,
                            t.done,
                            (t.done_on or first) if t.done else None,
                            ctx,
                        )
                    )
            elif m.horizon == "next" and m.due is not None and m.due <= last:
                proj.append(
                    _row(
                        "milestone",
                        m.id,
                        p.id,
                        m.due,
                        m.done,
                        (m.done_on or first) if m.done else None,
                        ctx,
                    )
                )
    rows = bau + proj
    bars: list[SnapshotBar] = []
    for d in bds:
        past = d <= today
        done_by = (
            sum(1 for x in rows if x.done and x.done_on is not None and x.done_on <= d)
            if past
            else 0
        )
        late_by = (
            sum(
                1
                for x in rows
                if x.due < d and not (x.done and x.done_on is not None and x.done_on <= d)
            )
            if past
            else 0
        )
        plan = sum(1 for x in rows if x.due <= d)
        bars.append(SnapshotBar(d, plan, done_by, late_by, past, d == today))
    return MonthSnapshot(
        year=year,
        month=month,
        first_bd=first,
        last_bd=last,
        rows=tuple(_order(bau) + _order(proj)),
        total=len(rows),
        done=sum(1 for x in rows if x.done),
        late=sum(1 for x in rows if x.late),
        bars=tuple(bars),
    )
