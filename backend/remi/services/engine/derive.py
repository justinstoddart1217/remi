"""Derived project fields: status, delta, staleness, growth, milestones and Workspace metrics.

The Workspace verdict sentence is returned as a case plus parameters; the client owns the
copy. Numbers in the sentence are already rounded to one decimal, the way they are printed.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from typing import Literal

from remi.services.engine.forecast import (
    Need,
    NeedState,
    absorb_h,
    cut_before_move_h,
    cut_to_target_h,
    day_hours,
    plan_from,
    solve_need_rate,
    work_left,
)
from remi.services.engine.loads import DayLoad, project_end
from remi.services.engine.model import Domain, EngineCtx, Horizon, Project
from remi.utils.text import delta_label, hr1, round_half_up, since_label, to_half

Status = Literal["define", "risk", "on"]
SentenceCase = Literal["no_plan", "after_move", "late", "no_buffer", "buffer"]
Dot = Literal["ink_faint", "overload", "risk", "ink"]


@dataclass(frozen=True, slots=True)
class DerivedMilestone:
    id: str
    name: str
    day: date
    horizon: Horizon
    passed: bool
    """``day < today``."""


@dataclass(frozen=True, slots=True)
class Sentence:
    """The Workspace verdict: which sentence applies and the figures it prints.

    Cases, first match wins: ``no_plan`` (no forecast); ``after_move`` (hours are unplaced, in
    either domain, since they count as landing after the move with no time planned for them; or
    Private Credit and the forecast is on or after the move); ``late`` (buffer < 0);
    ``no_buffer`` (buffer == 0); ``buffer``. The appended clauses (overloaded days, stale,
    starts in) are independent.
    """

    case: SentenceCase
    dot: Dot
    late: bool
    rate: float
    target: date
    move: date
    late_bd: int | None = None
    buffer_bd: int | None = None
    need_rate: float | None = None
    need_state: NeedState | None = None
    cut_h: float | None = None
    """``after_move``: cut to finish before the move. ``late``: cut to land on the target."""
    absorb_h: float | None = None
    over_days: int = 0
    first_over_day: date | None = None
    stale_days: int | None = None
    starts_in_bd: int | None = None


@dataclass(frozen=True, slots=True)
class DerivedProject:
    id: str
    domain: Domain
    status: Status
    delta_bd: int | None
    """``bd_diff(target, forecast)``: positive = late."""
    delta_label: str
    since_days: int | None
    """Calendar days since the last check-in."""
    since_label: str
    stale: bool
    added_h: float
    growth_pct: int | None
    """``None`` without a baseline."""
    work_left: float | None
    work_left_display: float | None
    bd_left: int | None
    bd_to_target: int
    need: Need
    avg_plan: float
    avg_differs: bool
    """Show "averages Xh once BAU days are counted" (more than 0.2h from the rate)."""
    buffer_bd: int | None
    absorb_h: float | None
    cut_h: float | None
    cut_before_move_h: float | None
    progress_pct: float
    started: bool
    starts_in_bd: int | None
    over_days: tuple[date, ...]
    sentence: Sentence
    milestones: tuple[DerivedMilestone, ...]
    next_milestone: DerivedMilestone | None
    now_estimate_h: float | None
    """Hours of undone Now tasks (2 decimals); ``None`` in Define."""
    day_hours: Mapping[date, float]
    """Planned hours per business day from the start to the end (only days above 0)."""


def derived_milestones(p: Project, today: date) -> tuple[DerivedMilestone, ...]:
    """The plan's Now and Next items with a due date, then explicit milestones whose name and
    date are both unused, sorted by date (stable). A later Now/Next item with the same name
    replaces an earlier one in its place."""
    by_name: dict[str, DerivedMilestone] = {}
    for m in p.milestones:
        if m.horizon != "explicit" and m.name and m.due is not None:
            # Like the prototype's ``Map.set``: the later item wins but keeps the first one's
            # position, which decides the order of milestones on the same date.
            by_name[m.name] = DerivedMilestone(m.id, m.name, m.due, m.horizon, m.due < today)
    used = {x.day for x in by_name.values()}
    for m in p.milestones:
        if (
            m.horizon == "explicit"
            and m.name
            and m.due is not None
            and m.name not in by_name
            and m.due not in used
        ):
            by_name[m.name] = DerivedMilestone(m.id, m.name, m.due, m.horizon, m.due < today)
    return tuple(sorted(by_name.values(), key=lambda x: x.day))


def _sentence(
    p: Project, ctx: EngineCtx, fig: "_Figures", over_days: tuple[date, ...], stale: bool
) -> Sentence:
    plan = p.plan
    f = plan.forecast
    case: SentenceCase
    dot: Dot
    late = False
    late_bd: int | None = None
    buffer_bd: int | None = None
    need_rate: float | None = None
    need_state: NeedState | None = None
    cut: float | None = None
    absorb: float | None = None
    if f is None:
        case, dot = "no_plan", "ink_faint"
    elif plan.unplaced_h > 0 or (plan.domain == "pc" and f >= ctx.move):
        case, dot, late = "after_move", "overload", True
        cut = hr1(fig.cut_before_move or 0.0)
    elif fig.buffer is not None and fig.buffer < 0:
        case, dot, late = "late", "risk", True
        late_bd = -fig.buffer
        need_rate, need_state = fig.need.rate, fig.need.state
        cut = hr1(fig.cut or 0.0)
    elif fig.buffer == 0:
        case, dot = "no_buffer", "risk"
        buffer_bd = 0
    else:
        case, dot = "buffer", "ink"
        buffer_bd = fig.buffer
        absorb = hr1(fig.absorb or 0.0)
    return Sentence(
        case=case,
        dot=dot,
        late=late,
        rate=hr1(plan.rate),
        target=plan.target,
        move=ctx.move,
        late_bd=late_bd,
        buffer_bd=buffer_bd,
        need_rate=need_rate,
        need_state=need_state,
        cut_h=cut,
        absorb_h=absorb,
        over_days=len(over_days) if f is not None else 0,
        first_over_day=over_days[0] if f is not None and over_days else None,
        stale_days=fig.since if stale else None,
        starts_in_bd=fig.starts_in if f is not None else None,
    )


@dataclass(frozen=True, slots=True)
class _Figures:
    since: int | None
    starts_in: int | None
    buffer: int | None
    need: Need
    cut: float | None
    cut_before_move: float | None
    absorb: float | None


def derive_project(p: Project, ctx: EngineCtx, loads: Mapping[date, DayLoad]) -> DerivedProject:
    """Every derived field the read model sends for one project."""
    cal = ctx.cal
    plan = p.plan
    today = ctx.today
    f = plan.forecast
    frm = plan_from(plan, ctx)
    delta = cal.bd_diff(plan.target, f) if f is not None else None
    # Unplaced hours never finish, so the plan is at risk whatever its stored forecast says.
    status: Status = (
        "define" if delta is None else "risk" if delta > 0 or plan.unplaced_h > 0 else "on"
    )
    since = (today - p.last_checkin).days if p.last_checkin is not None else None
    stale = since is not None and since >= ctx.stale_days
    growth = int(round_half_up(p.scope_added_h / p.baseline_h * 100)) if p.baseline_h else None
    left = work_left(plan, ctx)
    started = plan.start <= today
    bd_left = max(0, cal.bd_diff(frm, f) + 1) if f is not None else None
    bd_to_target = cal.bd_diff(frm, plan.target) + 1 if plan.target >= frm else 0
    need = solve_need_rate(plan, ctx)
    avg_plan = left / bd_left if left is not None and bd_left else plan.rate
    buffer = cal.bd_diff(f, plan.target) if f is not None else None
    total_bd = cal.bd_diff(plan.start, f) + 1 if f is not None else 0
    done_bd = max(0, cal.bd_diff(plan.start, today)) if started else 0
    progress = min(100.0, done_bd / total_bd * 100) if total_bd else 0.0
    starts_in = None if started else cal.bd_diff(today, plan.start)
    over_days: tuple[date, ...] = ()
    if f is not None:
        over_days = tuple(
            d
            for d in cal.bds(frm, f)
            if (load := loads.get(d)) is not None and load.over and load.has_project(plan.id)
        )
    figures = _Figures(
        since=since,
        starts_in=starts_in,
        buffer=buffer,
        need=need,
        cut=cut_to_target_h(plan, ctx),
        cut_before_move=cut_before_move_h(plan, ctx),
        absorb=absorb_h(plan, ctx),
    )
    milestones = derived_milestones(p, today)
    next_ms = next((m for m in milestones if m.day >= today), None)
    now_estimate = (
        None if f is None else round_half_up(sum(t.hours for t in p.now_tasks() if not t.done), 2)
    )
    hours: dict[date, float] = {}
    for d in cal.bds(plan.start, project_end(plan)):
        h = day_hours(plan, d, ctx)
        if h > 0:
            hours[d] = h
    return DerivedProject(
        id=plan.id,
        domain=plan.domain,
        status=status,
        delta_bd=delta,
        delta_label=delta_label(delta),
        since_days=since,
        since_label=since_label(since),
        stale=stale,
        added_h=p.scope_added_h,
        growth_pct=growth,
        work_left=left,
        work_left_display=to_half(left) if left is not None else None,
        bd_left=bd_left,
        bd_to_target=bd_to_target,
        need=need,
        avg_plan=avg_plan,
        avg_differs=f is not None and abs(avg_plan - plan.rate) > 0.2,
        buffer_bd=buffer,
        absorb_h=figures.absorb,
        cut_h=figures.cut,
        cut_before_move_h=figures.cut_before_move,
        progress_pct=progress,
        started=started,
        starts_in_bd=starts_in,
        over_days=over_days,
        sentence=_sentence(p, ctx, figures, over_days, stale),
        milestones=milestones,
        next_milestone=next_ms,
        now_estimate_h=now_estimate,
        day_hours=hours,
    )
