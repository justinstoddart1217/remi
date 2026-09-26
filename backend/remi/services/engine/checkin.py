"""Check-in changes: the one code path that both previews and applies them.

``plan_project_changes`` is the only place a check-in moves a forecast. ``/checkins/preview``
and ``/checkins/apply`` both call ``preview`` (which calls it per project); apply saves each
outcome's ``after`` plan exactly as returned, so what the review showed is what lands.

Order per project:
1. ``target_move``: the last one wins, snapped to the next business day;
2. ``hours_per_day``: the first value above 0, applied as a rate refit (``forecast.refit``);
3. ``scope_add``: the hours are summed and slip the plan from step 2
   (``finish_for(work_left + H)``);
4. ``task_add``, ``task_done``, ``note``, ``blocker`` and ``confidence`` never move a forecast.

``prev`` ends as the forecast before the check-in when the forecast moved.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date
from typing import Literal

from remi.services.engine.calendar import BusinessCalendar
from remi.services.engine.flags import Overload
from remi.services.engine.forecast import RateEdit, apply_scope, refit
from remi.services.engine.loads import build_loads
from remi.services.engine.model import (
    Blocker,
    Change,
    Confidence,
    EngineCtx,
    HoursPerDay,
    Note,
    ProjectPlan,
    ScopeAdd,
    TargetMove,
    TaskAdd,
    TaskDone,
)
from remi.services.engine.verdict import key_run
from remi.utils.text import fmt_num, shift_label

Cause = Literal["scope", "rate", "work_left", "start", "target", "checkin", "routine"]


@dataclass(frozen=True, slots=True)
class ProjectOutcome:
    """What a check-in does to one project. Apply saves ``after``."""

    project_id: str
    before: ProjectPlan
    after: ProjectPlan
    from_forecast: date | None
    to_forecast: date | None
    delta_bd: int | None
    """``bd_diff(from, to)``; ``None`` in Define."""
    label: str
    """``+3 BD``, ``\u00b10 BD`` or ``\u22122 BD`` (see ``shift_label``); empty in Define."""
    target_before: date
    target_after: date
    late: bool
    """The new forecast is after the (new) target."""
    past_target_bd: int | None
    """``bd_diff(target_after, to)`` when late."""
    scope_h: float
    scope_from: date | None
    """The forecast the scope slipped from (after any hours-a-day change)."""
    scope_to: date | None
    scope_slip_bd: int
    causes: tuple[Cause, ...]
    """What moved something: ``target``, ``rate``, ``scope``."""
    new_over: tuple[Overload, ...] = ()
    """Days that become overloaded where this project now has more hours (``preview`` fills
    it), from today to the later of the old and new forecast."""
    misses_key_run: bool = False
    crosses_move: bool = False

    @property
    def moved(self) -> bool:
        return self.from_forecast != self.to_forecast


def _mine(p: ProjectPlan, changes: Sequence[Change]) -> list[Change]:
    return [c for c in changes if getattr(c, "project_id", None) == p.id]


def plan_project_changes(
    p: ProjectPlan, changes: Sequence[Change], ctx: EngineCtx
) -> ProjectOutcome:
    """The outcome of this project's changes (changes for other projects are ignored)."""
    cal = ctx.cal
    mine = _mine(p, changes)
    plan = p
    causes: list[Cause] = []

    targets = [c for c in mine if isinstance(c, TargetMove)]
    if targets:
        target = cal.next_bd(targets[-1].date)
        if target != plan.target:
            plan = replace(plan, target=target)
            causes.append("target")

    hpd = next((c for c in mine if isinstance(c, HoursPerDay) and c.value > 0), None)
    if hpd is not None and hpd.value != plan.rate:
        plan = refit(plan, RateEdit(hpd.value), ctx).plan
        causes.append("rate")

    scope_h = sum(c.hours for c in mine if isinstance(c, ScopeAdd) and c.hours > 0)
    scope_from = plan.forecast
    scope_to = scope_from
    slip = 0
    if scope_h > 0 and plan.forecast is not None:
        plan = apply_scope(plan, scope_h, ctx)
        scope_to = plan.forecast
        if scope_from is not None and scope_to is not None:
            slip = cal.bd_diff(scope_from, scope_to)
        causes.append("scope")

    moved = p.forecast is not None and plan.forecast != p.forecast
    plan = replace(plan, prev=p.forecast if moved else p.prev)
    to = plan.forecast
    delta = cal.bd_diff(p.forecast, to) if p.forecast is not None and to is not None else None
    # The same rule as the project status and the verdict (``bd_diff``): a target that is not
    # a business day (a holiday added on it) counts as the next business day.
    late = to is not None and cal.bd_diff(plan.target, to) > 0
    return ProjectOutcome(
        project_id=p.id,
        before=p,
        after=plan,
        from_forecast=p.forecast,
        to_forecast=to,
        delta_bd=delta,
        label=shift_label(delta) if delta is not None else "",
        target_before=p.target,
        target_after=plan.target,
        late=late,
        past_target_bd=cal.bd_diff(plan.target, to) if late and to is not None else None,
        scope_h=scope_h,
        scope_from=scope_from,
        scope_to=scope_to,
        scope_slip_bd=slip,
        causes=tuple(causes),
    )


def _project_order(changes: Sequence[Change]) -> list[str]:
    order: list[str] = []
    for c in changes:
        pid = getattr(c, "project_id", None)
        if isinstance(pid, str) and pid not in order:
            order.append(pid)
    return order


def preview(
    changes: Sequence[Change], projects: Sequence[ProjectPlan], ctx: EngineCtx
) -> list[ProjectOutcome]:
    """One outcome per project the changes name (in order of first mention; unknown ids are
    skipped), with the days each project newly overloads and the key-run and move flags.

    Apply uses exactly this list: save each ``after`` plan.
    """
    by_id = {p.id: p for p in projects}
    outcomes = [
        plan_project_changes(by_id[pid], changes, ctx)
        for pid in _project_order(changes)
        if pid in by_id
    ]
    if not outcomes:
        return outcomes
    changed = {o.project_id: o.after for o in outcomes}
    after_plans = [changed.get(p.id, p) for p in projects]
    ends = [d for o in outcomes for d in (o.from_forecast, o.to_forecast) if d is not None]
    loads_before = build_loads(ctx.today, max(ends), projects, ctx) if ends else {}
    loads_after = build_loads(ctx.today, max(ends), after_plans, ctx) if ends else {}
    run = key_run(ctx)
    result: list[ProjectOutcome] = []
    for o in outcomes:
        new_over: list[Overload] = []
        last = max((d for d in (o.from_forecast, o.to_forecast) if d is not None), default=None)
        if last is not None:
            for d in ctx.cal.bds(ctx.today, last):
                after = loads_after.get(d)
                before = loads_before.get(d)
                if after is None or not after.over or (before is not None and before.over):
                    continue
                was = before.project_hours(o.project_id) if before is not None else 0.0
                if after.project_hours(o.project_id) > was + 1e-9:
                    new_over.append(
                        Overload(d, ctx.cal.bdm(d) or 0, after.total, after.capacity, after.over_by)
                    )
        to = o.to_forecast
        result.append(
            replace(
                o,
                new_over=tuple(new_over),
                misses_key_run=(
                    o.project_id == ctx.key_project_id
                    and run is not None
                    and to is not None
                    and to >= run
                ),
                crosses_move=o.after.domain == "pc"
                and ((to is not None and to >= ctx.move) or o.after.unplaced_h > 0),
            )
        )
    return result


def apply_changes(
    changes: Sequence[Change], projects: Sequence[ProjectPlan], ctx: EngineCtx
) -> tuple[list[ProjectPlan], list[ProjectOutcome]]:
    """The plans after the check-in (same order as ``projects``) and the outcomes."""
    outcomes = preview(changes, projects, ctx)
    changed = {o.project_id: o.after for o in outcomes}
    return [changed.get(p.id, p) for p in projects], outcomes


# ---------------------------------------------------------------------------- movements
@dataclass(frozen=True, slots=True)
class Movement:
    """Drives the "plan moves" animation."""

    project_id: str
    from_forecast: date | None
    to_forecast: date | None
    delta_bd: int | None
    from_target: date
    to_target: date
    cause: Cause
    label: str
    flash: bool
    """The forecast changed (ghost bar for 1100ms)."""
    moved: bool
    """``delta_bd != 0`` (delta chip for 5200ms)."""


def diff_movements(
    before: Sequence[ProjectPlan],
    after: Sequence[ProjectPlan],
    causes: Mapping[str, Cause],
    cal: BusinessCalendar,
    default_cause: Cause = "checkin",
) -> list[Movement]:
    """A movement for every project whose forecast or target changed."""
    old = {p.id: p for p in before}
    out: list[Movement] = []
    for a in after:
        b = old.get(a.id)
        if b is None or (b.forecast == a.forecast and b.target == a.target):
            continue
        delta = (
            cal.bd_diff(b.forecast, a.forecast)
            if b.forecast is not None and a.forecast is not None
            else None
        )
        out.append(
            Movement(
                project_id=a.id,
                from_forecast=b.forecast,
                to_forecast=a.forecast,
                delta_bd=delta,
                from_target=b.target,
                to_target=a.target,
                cause=causes.get(a.id, default_cause),
                label=shift_label(delta) if delta is not None else "",
                flash=b.forecast != a.forecast,
                moved=bool(delta),
            )
        )
    return out


# ---------------------------------------------------------------------------- the record
@dataclass(frozen=True, slots=True)
class CheckinSummary:
    """What the check-in record stores for one project (the prototype's ``applyCheckIn``)."""

    project_id: str
    done_task_ids: tuple[str, ...]
    task_adds: tuple[TaskAdd, ...]
    changed: str
    """Note texts, each without one trailing full stop, joined with ``. ``."""
    scope_what: str
    """Scope texts joined with ``, ``, or ``New scope``."""
    scope_h: float
    blocker: str | None
    """The first blocker; every check-in replaces (or clears) the project's blocker."""
    confidence: int | None
    record_note: str
    """``changed``, ``{what} added, +{h}h`` and ``Blocked: {blocker}`` joined with ``. ``,
    or ``Plan confirmed.``"""


def summarise_checkin(project_id: str, changes: Sequence[Change]) -> CheckinSummary:
    """The check-in record for one project's accepted changes."""
    mine = [c for c in changes if getattr(c, "project_id", None) == project_id]
    notes = [c.text.removesuffix(".") for c in mine if isinstance(c, Note)]
    scopes = [c for c in mine if isinstance(c, ScopeAdd) and c.hours > 0]
    scope_h = sum(c.hours for c in scopes)
    what = ", ".join(c.text for c in scopes).strip() or "New scope"
    blocker = next((c.text for c in mine if isinstance(c, Blocker)), None)
    confidence = next((c.value for c in mine if isinstance(c, Confidence)), None)
    changed = ". ".join(notes)
    parts = [
        changed,
        f"{what} added, +{fmt_num(scope_h)}h" if scope_h > 0 else "",
        f"Blocked: {blocker}" if blocker else "",
    ]
    note = ". ".join(x for x in parts if x) or "Plan confirmed."
    return CheckinSummary(
        project_id=project_id,
        done_task_ids=tuple(c.task_id for c in mine if isinstance(c, TaskDone)),
        task_adds=tuple(c for c in mine if isinstance(c, TaskAdd)),
        changed=changed,
        scope_what=what,
        scope_h=scope_h,
        blocker=blocker,
        confidence=confidence,
        record_note=note,
    )
