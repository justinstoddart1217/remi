"""Day loads: BAU, the rotation and project hours against capacity on each business day."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from remi.services.engine.forecast import day_hours
from remi.services.engine.model import Domain, EngineCtx, ProjectPlan
from remi.services.engine.routines import counts_on
from remi.utils.dates import add_months, monday_of, month_end

LoadRef = Literal["routine", "rotation", "project"]

_OVER_TOLERANCE = 1e-9


@dataclass(frozen=True, slots=True)
class LoadItem:
    ref_type: LoadRef
    ref_id: str
    domain: Domain
    hours: float
    name: str


@dataclass(frozen=True, slots=True)
class DayLoad:
    """One business day. BAU items (routines, then the rotation) come before projects."""

    day: date
    items: tuple[LoadItem, ...]
    bau: float
    proj: float
    total: float
    free: float
    """``max(0, capacity - total)``."""
    capacity: float
    over: bool
    """``total > capacity``, strictly."""

    @property
    def over_by(self) -> float:
        return max(0.0, self.total - self.capacity)

    def project_hours(self, project_id: str) -> float:
        """This project's hours on the day (0 when it has none)."""
        return sum(
            i.hours for i in self.items if i.ref_type == "project" and i.ref_id == project_id
        )

    def has_project(self, project_id: str) -> bool:
        return any(i.ref_type == "project" and i.ref_id == project_id for i in self.items)


def project_end(p: ProjectPlan) -> date:
    """The last day a project takes time: its forecast, or its target while in Define."""
    return p.forecast if p.forecast is not None else p.target


def day_load(d: date, projects: Sequence[ProjectPlan], ctx: EngineCtx) -> DayLoad | None:
    """The load on ``d``, or ``None`` when it is not a business day.

    BAU: every routine that ``counts_on`` the day (Private Credit routines before the move,
    Fixed Income routines from it), then the rotation segment covering the day. Projects: each
    project between its start and its end (forecast, or target in Define) with ``day_hours``
    above 0.
    """
    if not ctx.cal.is_bd(d):
        return None
    items: list[LoadItem] = []
    for r in ctx.routines:
        if counts_on(r, d, ctx):
            name = r.short or r.name or "Untitled routine"
            items.append(LoadItem("routine", r.id, r.domain, r.hours, name))
    seg = ctx.rotation_segment_on(d)
    if seg is not None and ctx.rotation_plan is not None:
        name = f"{seg.country} · {seg.kind}"
        items.append(LoadItem("rotation", seg.id, "fi", ctx.rotation_plan.hours_per_day, name))
    for p in projects:
        if d < p.start or d > project_end(p):
            continue
        h = day_hours(p, d, ctx)
        if h > 0:
            items.append(LoadItem("project", p.id, p.domain, h, p.short))
    bau = 0.0
    proj = 0.0
    for item in items:
        if item.ref_type == "project":
            proj += item.hours
        else:
            bau += item.hours
    total = bau + proj
    capacity = ctx.capacity_on(d)
    return DayLoad(
        day=d,
        items=tuple(items),
        bau=bau,
        proj=proj,
        total=total,
        free=max(0.0, capacity - total),
        capacity=capacity,
        over=total > capacity + _OVER_TOLERANCE,
    )


def build_loads(
    a: date, b: date, projects: Sequence[ProjectPlan], ctx: EngineCtx
) -> dict[date, DayLoad]:
    """Loads for every business day in ``[a, b]``, keyed by day."""
    out: dict[date, DayLoad] = {}
    for d in ctx.cal.bds(a, b):
        load = day_load(d, projects, ctx)
        if load is not None:
            out[d] = load
    return out


def plan_window(ctx: EngineCtx, projects: Sequence[ProjectPlan]) -> tuple[date, date]:
    """The read model's day window.

    From the Monday of the week before today, to the latest of: the move + 2 weeks, the end of
    the month after the move, ``lookahead_bd`` business days after the move, the rotation's
    end and the last project end.
    """
    a = monday_of(ctx.today - timedelta(days=7))
    ends = [
        ctx.move + timedelta(days=14),
        month_end(add_months(ctx.move, 1)),
        ctx.cal.add_bd(ctx.move, ctx.lookahead_bd),
    ]
    if ctx.rotation_plan is not None and ctx.rotation_plan.end is not None:
        ends.append(ctx.rotation_plan.end)
    ends.extend(project_end(p) for p in projects)
    return a, max(ends)


def loads_for(
    projects: Sequence[ProjectPlan], ctx: EngineCtx, window: tuple[date, date] | None = None
) -> Mapping[date, DayLoad]:
    """``build_loads`` over ``window`` (default: ``plan_window``)."""
    a, b = window if window is not None else plan_window(ctx, projects)
    return build_loads(a, b, projects, ctx)
