"""ORM rows -> the engine's frozen dataclasses (and a plan back onto its row).

The engine never touches the database. Services load rows through the repositories, convert
them here, call the engine, and (for mutations) write a changed ``ProjectPlan`` back with
:func:`save_plan`.
"""

import datetime as dt
from collections.abc import Mapping, Sequence
from typing import Final

from remi.repositories import models as orm
from remi.services.engine.calendar import BusinessCalendar
from remi.services.engine.model import (
    EngineCtx,
    Horizon,
    Milestone,
    Project,
    ProjectPlan,
    RotationDef,
    RoutineDef,
    SegmentDef,
    Task,
)

HORIZON_ORDER: Final[Mapping[str, int]] = {"now": 0, "next": 1, "explicit": 2}


def plan_of(p: orm.Project) -> ProjectPlan:
    """The forecast inputs of a project row (``bau_day_hours`` and ``hour_overrides`` loaded)."""
    return ProjectPlan(
        id=p.id,
        domain=p.domain,
        start=p.start_date,
        target=p.target_date,
        forecast=p.forecast_date,
        prev=p.prev_forecast_date,
        rate=p.rate_hours_per_day,
        rate_after=p.rate_after_move,
        bau_day_hours={r.routine_id: r.hours for r in p.bau_day_hours},
        overrides={o.date: o.hours for o in p.hour_overrides},
        unplaced_h=p.unplaced_hours,
        short=p.short or p.name,
    )


def ordered_milestones(p: orm.Project) -> list[orm.Milestone]:
    """Now items, then Next items, then explicit milestones, each by ``sort_order``."""
    return sorted(p.milestones, key=lambda m: (HORIZON_ORDER.get(m.horizon, 3), m.sort_order))


def task_of(t: orm.Task) -> Task:
    return Task(
        id=t.id,
        text=t.text,
        hours=t.hours,
        done=t.done,
        done_on=t.done_on,
        due=t.due_date,
    )


def milestone_of(m: orm.Milestone) -> Milestone:
    horizon: Horizon = m.horizon
    tasks = tuple(task_of(t) for t in sorted(m.tasks, key=lambda t: t.sort_order))
    return Milestone(
        id=m.id,
        name=m.name,
        due=m.due_date,
        horizon=horizon,
        tasks=tasks if horizon == "now" else (),
        done=m.done,
        done_on=m.done_on,
    )


def project_of(p: orm.Project, plan: ProjectPlan | None = None) -> Project:
    """A plan plus the stored fields the read model derives from (children loaded)."""
    return Project(
        plan=plan if plan is not None else plan_of(p),
        name=p.name,
        confidence=p.confidence,
        last_checkin=p.last_checkin_date,
        baseline_h=p.baseline_hours,
        scope_added_h=sum(s.hours for s in p.scope_changes),
        milestones=tuple(milestone_of(m) for m in ordered_milestones(p)),
        target_label=p.target_label,
    )


def routine_of(r: orm.Routine) -> RoutineDef:
    """A routine row as the engine's ``RoutineDef`` (``checklist_items`` loaded)."""
    return RoutineDef(
        id=r.id,
        domain=r.domain,
        kind=r.kind,
        hours=r.hours,
        stage=r.stage,
        bd=r.bd,
        weekday=r.weekday,
        project_id=r.project_id,
        name=r.name,
        short=r.short,
        checklist_size=len(r.checklist_items),
        co_tag=r.co_tag_with_project,
        starts_on=r.starts_on,
    )


def rotation_of(r: orm.Rotation | None) -> RotationDef | None:
    """The rotation, or ``None`` when there is none (segments loaded)."""
    if r is None:
        return None
    segments = tuple(
        SegmentDef(
            country=s.country,
            code=s.code,
            length_bd=s.length_bd,
            kind=s.pass_kind,
            id=s.id,
        )
        for s in sorted(r.segments, key=lambda s: s.sort_order)
    )
    return RotationDef(segments=segments, hours_per_day=r.hours_per_day, start=r.start_date)


def engine_ctx(
    settings: orm.Settings,
    cal: BusinessCalendar,
    *,
    today: dt.date,
    routines: Sequence[RoutineDef] = (),
    rotation: RotationDef | None = None,
    leave: Mapping[dt.date, float | None] | None = None,
) -> EngineCtx:
    """The engine context from the settings row. The move date must be set (after setup)."""
    move = settings.move_date
    if move is None:
        msg = "the move date is not set (setup has not completed)"
        raise ValueError(msg)
    return EngineCtx(
        today=today,
        move=move,
        capacity=settings.capacity_hours_per_day,
        cal=cal,
        routines=tuple(routines),
        rotation=rotation,
        key_project_id=settings.key_project_id,
        key_routine_id=settings.key_routine_id,
        key_run_override=settings.key_run_date_override,
        stale_days=settings.stale_threshold_days,
        lookahead_bd=settings.overload_lookahead_bd,
        leave=dict(leave or {}),
    )


def save_plan(p: orm.Project, plan: ProjectPlan) -> None:
    """Write a changed plan back onto its row: dates, rates, unplaced hours, BAU-day hours and
    overrides (children are updated in place, removed ones deleted)."""
    if plan.id != p.id:
        msg = f"plan {plan.id!r} does not belong to project {p.id!r}"
        raise ValueError(msg)
    p.start_date = plan.start
    p.target_date = plan.target
    p.forecast_date = plan.forecast
    p.prev_forecast_date = plan.prev
    p.rate_hours_per_day = plan.rate
    p.rate_after_move = plan.rate_after
    p.unplaced_hours = plan.unplaced_h

    overrides = {o.date: o for o in p.hour_overrides}
    for day, hours in plan.overrides.items():
        row = overrides.pop(day, None)
        if row is None:
            p.hour_overrides.append(orm.HourOverride(project_id=p.id, date=day, hours=hours))
        elif row.hours != hours:
            row.hours = hours
    for row in overrides.values():
        p.hour_overrides.remove(row)

    rules = {r.routine_id: r for r in p.bau_day_hours}
    for routine_id, hours in plan.bau_day_hours.items():
        rule = rules.pop(routine_id, None)
        if rule is None:
            p.bau_day_hours.append(
                orm.ProjectBauDayHours(project_id=p.id, routine_id=routine_id, hours=hours)
            )
        elif rule.hours != hours:
            rule.hours = hours
    for rule in rules.values():
        p.bau_day_hours.remove(rule)
