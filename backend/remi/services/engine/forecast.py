"""The unified forecast maths (ADR-0007). Every forecast Remi shows comes from here.

``day_hours(p, d)``, first match wins:
1. not a business day -> 0;
2. an override for ``d`` -> the override (an explicit 0 counts);
3. on or after the move -> ``rate_after``;
4. any routine with a BAU-day rule on this project counts on ``d`` -> the lowest of those
   rules' hours;
5. otherwise -> ``rate``.

``finish_for(p, a, H)`` is the first business day on or after ``a`` where the running total
reaches ``H - eps``. When the hours run out first (a Private Credit project with no hours after
the move), it returns the stall day and the leftover as ``short_h``; that leftover is stored as
``unplaced_h`` and counts as landing after the move. The stall day is the first business day on
or after the move with no hours and no later positive override, so a forecast with unplaced
hours is always on or after the move (never on a zero-hour day before it, such as a day off on
the last day before the move).

Fixed Income hours carry on after the move (that is the domain's main period), so a Fixed
Income plan with no hours yet (a zero rate and a zero after-move rate, as ``POST /projects``
makes it) takes its first rate after the move too (``rescale`` and ``_effective``). From then
on the after-move rate is scaled like any other figure. Only a Private Credit plan keeps 0h
after the move by default; a Fixed Income plan stalls only when its after-move rate is set to 0
explicitly (``PATCH /projects/{id}``), and its unplaced hours then show like Private Credit ones.

Invariant: ``finish_for(p, from, work_left(p)) == p.forecast`` for every stored forecast, as
long as each day's positive hours exceed ``eps``. Rate, work-left and start edits (``refit``),
scope slips and hours-a-day check-ins all go through these same functions, so a preview and
the applied change always agree. Edits that change a project's hours per day or the calendar
without touching its work left (the move date, the holiday region, holidays, routine rules,
BAU-day hours, overrides, the after-move rate) re-place the work left the plan had before the
edit (``carry_work_left``), so a forecast never stays on a day that lost its hours.

Stored hour figures (rates, BAU-day hours, overrides) are 0 or ``MIN_HOURS``..``MAX_HOURS``
(``plan_hours_problem``): below ``MIN_HOURS`` the invariant's precondition breaks, above
``MAX_HOURS`` a day would hold more than 24 hours.
"""

import math
from dataclasses import dataclass, replace
from datetime import date
from typing import Literal

from remi.services.engine.calendar import OutOfCalendar
from remi.services.engine.model import EngineCtx, ProjectPlan
from remi.services.engine.routines import counts_on

MIN_HOURS = 0.05
"""The smallest positive hours a rate, BAU-day rule or override may have."""
MAX_HOURS = 24.0
"""The most hours any one day of a plan may have (a rescale can push figures past it)."""


class InvalidEdit(ValueError):
    """An edit the engine refuses (for example a zero rate on a planned project)."""


PlanHoursProblem = Literal["below_min", "above_max"]


def plan_hours_problem(p: ProjectPlan) -> PlanHoursProblem | None:
    """Why a plan's stored hour figures are not all 0 or ``MIN_HOURS``..``MAX_HOURS``, if so.

    A rescale multiplies the after-move rate, BAU-day hours and overrides by the same factor,
    so a valid rate can still leave one of them outside the range."""
    values = [p.rate, p.rate_after, *p.bau_day_hours.values(), *p.overrides.values()]
    if any(0 < v < MIN_HOURS for v in values):
        return "below_min"
    if any(v > MAX_HOURS for v in values):
        return "above_max"
    return None


# ---------------------------------------------------------------------------- hours per day
def plan_from(p: ProjectPlan, ctx: EngineCtx) -> date:
    """Where remaining work starts: ``max(today, start)``."""
    return max(ctx.today, p.start)


def day_hours(p: ProjectPlan, d: date, ctx: EngineCtx, scale: float = 1.0) -> float:
    """Planned hours for ``p`` on ``d`` (see the module docstring for the precedence)."""
    if not ctx.cal.is_bd(d):
        return 0.0
    override = p.overrides.get(d)
    if override is not None:
        return scale * override
    if d >= ctx.move:
        return scale * p.rate_after
    lowest: float | None = None
    for routine_id, hours in p.bau_day_hours.items():
        r = ctx.routine(routine_id)
        if r is not None and counts_on(r, d, ctx) and (lowest is None or hours < lowest):
            lowest = hours
    if lowest is not None:
        return scale * lowest
    return scale * p.rate


def work_between(p: ProjectPlan, a: date, b: date, ctx: EngineCtx, scale: float = 1.0) -> float:
    """Sum of ``day_hours`` over the business days ``a..b``, both included (0 if ``b < a``)."""
    if b < a:
        return 0.0
    total = 0.0
    for d in ctx.cal.bds(a, b):
        total += day_hours(p, d, ctx, scale)
    return total


# ---------------------------------------------------------------------------- finish
@dataclass(frozen=True, slots=True)
class Finish:
    """Where ``H`` hours of work land. ``short_h > 0`` means they could not all be placed."""

    day: date
    short_h: float = 0.0

    @property
    def placed(self) -> bool:
        return self.short_h <= 0


def finish_for(p: ProjectPlan, start: date, hours: float, ctx: EngineCtx) -> Finish:
    """The first business day on or after ``start`` where the running total reaches
    ``hours - eps``; see the module docstring for the stall rule.

    Raises ``OutOfCalendar`` when the calendar ends before the hours are placed.
    """
    cal = ctx.cal
    eps = ctx.eps
    if hours <= eps:
        return Finish(cal.next_bd(start))
    goal = hours - eps
    last_positive_override = max((d for d, h in p.overrides.items() if h > 0), default=None)
    total = 0.0
    for d in cal.iter_bds(start):
        h = day_hours(p, d, ctx)
        if h > 0:
            total += h
            if total >= goal:
                return Finish(d)
            continue
        stalled = (
            d >= ctx.move
            and p.rate_after <= 0
            and (last_positive_override is None or d > last_positive_override)
        )
        if stalled:
            # The stall day itself: on or after the move, and every day after the last one with
            # hours up to it has 0h, so ``finish_for(from, work_left)`` lands here again.
            return Finish(d, short_h=hours - total)
    raise OutOfCalendar(cal.end, f"{hours:g}h of work do not fit before the calendar ends")


def work_left(p: ProjectPlan, ctx: EngineCtx) -> float | None:
    """Hours from ``max(today, start)`` to the forecast, plus unplaced hours. Not rounded
    (the display rounds to 0.5). ``None`` without a forecast."""
    if p.forecast is None:
        return None
    return work_between(p, plan_from(p, ctx), p.forecast, ctx) + p.unplaced_h


def with_finish(p: ProjectPlan, finish: Finish) -> ProjectPlan:
    """``p`` with a new forecast: ``prev`` becomes the old forecast when it moved."""
    moved = p.forecast is not None and p.forecast != finish.day
    return replace(
        p,
        forecast=finish.day,
        prev=p.forecast if moved else p.prev,
        unplaced_h=finish.short_h,
    )


def _follows_rate(p: ProjectPlan) -> bool:
    """A Fixed Income plan with no hours yet (zero rate, zero after-move rate): its first rate
    applies after the move too. Once it has a rate, an after-move rate of 0 is kept as set."""
    return p.domain == "fi" and p.rate <= 0 and p.rate_after <= 0


def _effective(p: ProjectPlan) -> ProjectPlan:
    """Forecasts are never computed at 0h a day: a zero rate plans at 1h (and is saved), and a
    Fixed Income plan with no hours yet plans 1h after the move too (``_follows_rate``)."""
    rate = p.rate if p.rate > 0 else 1.0
    rate_after = rate if _follows_rate(p) else p.rate_after
    if rate == p.rate and rate_after == p.rate_after:
        return p
    return replace(p, rate=rate, rate_after=rate_after)


# ---------------------------------------------------------------------------- rescale and refit
def rescale(p: ProjectPlan, rate: float) -> ProjectPlan:
    """Change the rate. With ``rate > 0`` before, ``rate_after``, the BAU-day hours and the
    overrides scale by the same factor; from a zero rate only the rate is set, except that a
    Fixed Income plan with no hours yet takes it after the move too (``_follows_rate``).

    Linear in ``rate`` either way, which the need solver relies on."""
    if p.rate > 0:
        k = rate / p.rate
        return replace(
            p,
            rate=rate,
            rate_after=p.rate_after * k,
            bau_day_hours={r: h * k for r, h in p.bau_day_hours.items()},
            overrides={d: h * k for d, h in p.overrides.items()},
        )
    if _follows_rate(p):
        return replace(p, rate=rate, rate_after=rate)
    return replace(p, rate=rate)


@dataclass(frozen=True, slots=True)
class RateEdit:
    rate: float


@dataclass(frozen=True, slots=True)
class WorkLeftEdit:
    hours: float


@dataclass(frozen=True, slots=True)
class StartEdit:
    start: date


Edit = RateEdit | WorkLeftEdit | StartEdit


@dataclass(frozen=True, slots=True)
class Refit:
    plan: ProjectPlan
    before: date | None
    after: date | None

    @property
    def moved(self) -> bool:
        return self.before != self.after


def refit(p: ProjectPlan, edit: Edit, ctx: EngineCtx) -> Refit:
    """Apply a Workspace edit and re-forecast with the same work left.

    - ``RateEdit(r)``: ``L = work_left(p)``, ``p' = rescale(p, r)``, forecast
      ``finish_for(p', from, L)``. A rate of 0 is refused on a planned project
      (``InvalidEdit``); on a Define project it only sets the rate.
    - ``WorkLeftEdit(H)``: forecast ``finish_for(p, from, H)``; a zero rate is saved as 1.
      This is how a Define project gets its first forecast.
    - ``StartEdit(s)``: the start snaps to ``next_bd(s)``; the work left before the edit is
      placed from ``max(today, start)``.

    ``prev`` becomes the old forecast when the forecast moves, otherwise it is unchanged.
    """
    before = p.forecast
    if isinstance(edit, RateEdit):
        if edit.rate < 0 or (edit.rate == 0 and p.forecast is not None):
            msg = "Hours a day must be more than 0 for a project with a forecast."
            raise InvalidEdit(msg)
        if edit.rate == 0:
            return Refit(replace(p, rate=0.0), before, before)
        left = work_left(p, ctx)
        scaled = rescale(p, edit.rate)
        if left is None:
            return Refit(scaled, before, None)
        new = with_finish(scaled, finish_for(scaled, plan_from(scaled, ctx), left, ctx))
        return Refit(new, before, new.forecast)
    if isinstance(edit, WorkLeftEdit):
        if edit.hours < 0 or math.isnan(edit.hours):
            msg = "Work left cannot be negative."
            raise InvalidEdit(msg)
        base = _effective(p)
        new = with_finish(base, finish_for(base, plan_from(base, ctx), edit.hours, ctx))
        return Refit(new, before, new.forecast)
    left = work_left(p, ctx)
    moved = replace(p, start=ctx.cal.next_bd(edit.start))
    if left is None:
        return Refit(moved, before, None)
    base = _effective(moved)
    new = with_finish(base, finish_for(base, plan_from(base, ctx), left, ctx))
    return Refit(new, before, new.forecast)


def carry_work_left(
    old: ProjectPlan, old_ctx: EngineCtx, new: ProjectPlan, new_ctx: EngineCtx
) -> ProjectPlan:
    """``new`` with the work left ``old`` had under ``old_ctx`` placed again under ``new_ctx``.

    For edits that change a project's hours per day or the calendar but not its work left:
    the move date or holiday region (``new_ctx``), a holiday, a routine's rule or stage, or the
    project's own BAU-day hours, overrides or after-move rate (``new``). Without it the stored
    forecast would stay put while its work left silently changed, and could sit on a day that no
    longer has hours. Returns ``new`` itself when nothing moves (no forecast, or the same day
    and unplaced hours); otherwise ``prev`` becomes the old forecast, as in ``refit``.
    """
    left = work_left(old, old_ctx)
    if left is None or new.forecast is None:
        return new
    finish = finish_for(new, plan_from(new, new_ctx), left, new_ctx)
    if finish.day == new.forecast and abs(finish.short_h - new.unplaced_h) <= 1e-9:
        return new
    return with_finish(new, finish)


def slip_for_scope(p: ProjectPlan, hours: float, ctx: EngineCtx) -> Finish | None:
    """Where the forecast lands after ``hours`` of new scope: ``finish_for(work_left + H)``.
    ``None`` for a project with no forecast."""
    if p.forecast is None:
        return None
    base = _effective(p)
    left = work_left(base, ctx)
    if left is None:
        return None
    return finish_for(base, plan_from(base, ctx), left + max(0.0, hours), ctx)


def apply_scope(p: ProjectPlan, hours: float, ctx: EngineCtx) -> ProjectPlan:
    """``p`` after ``hours`` of new scope (unchanged without a forecast or hours)."""
    finish = slip_for_scope(p, hours, ctx) if hours > 0 else None
    if finish is None:
        return p
    return with_finish(_effective(p), finish)


# ---------------------------------------------------------------------------- need and cuts
NeedState = Literal["ok", "no_estimate", "target_passed", "no_capacity", "over_capacity"]


@dataclass(frozen=True, slots=True)
class Need:
    """Hours a day needed to land on the target.

    ``rate`` is what is shown and applied: the exact solution rounded up to 0.1, so applying it
    lands on or before the target. ``over_capacity`` (above the day's capacity) is data only.
    """

    rate: float | None
    state: NeedState
    exact: float | None = None


def solve_need_rate(p: ProjectPlan, ctx: EngineCtx) -> Need:
    """Solve ``work_between(rescale(p, r), from, target) == work_left`` for ``r``.

    ``W(r)`` is a straight line in ``r``, so ``r* = (L - W(0)) / (W(1) - W(0))``; with a
    positive rate this is ``rate * L / W(rate)``.
    """
    left = work_left(p, ctx)
    if left is None:
        return Need(None, "no_estimate")
    frm = plan_from(p, ctx)
    if p.target < frm:
        return Need(None, "target_passed")
    w0 = work_between(rescale(p, 0.0), frm, p.target, ctx)
    w1 = work_between(rescale(p, 1.0), frm, p.target, ctx)
    slope = w1 - w0
    if slope <= 1e-9:
        return Need(None, "no_capacity")
    exact = (left - w0) / slope
    shown = max(0.0, math.ceil(exact * 10 - 1e-6) / 10)
    return Need(shown, "over_capacity" if shown > ctx.capacity else "ok", exact)


def _work_to_target(p: ProjectPlan, ctx: EngineCtx) -> float:
    return work_between(p, plan_from(p, ctx), p.target, ctx)


def absorb_h(p: ProjectPlan, ctx: EngineCtx) -> float | None:
    """New scope the plan can take before the forecast passes the target."""
    left = work_left(p, ctx)
    return None if left is None else max(0.0, _work_to_target(p, ctx) - left)


def cut_to_target_h(p: ProjectPlan, ctx: EngineCtx) -> float | None:
    """Work to cut so the current rate lands on the target."""
    left = work_left(p, ctx)
    return None if left is None else max(0.0, left - _work_to_target(p, ctx))


def cut_before_move_h(p: ProjectPlan, ctx: EngineCtx) -> float | None:
    """Work to cut so the project finishes before the move (the last business day before it)."""
    left = work_left(p, ctx)
    if left is None:
        return None
    last = ctx.cal.prev_bd(ctx.move)
    return max(0.0, left - work_between(p, plan_from(p, ctx), last, ctx))
