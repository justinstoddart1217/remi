"""The move verdict, the countdown and the Transition strip.

States, first match wins:
1. ``no_pc``: there are no Private Credit projects;
2. ``off_track``: a Private Credit forecast lands on or after the move, or has unplaced hours;
3. ``no_pc`` again: a Private Credit project has no plan yet (Define, no forecast). Its exit
   is unknown, so no "on track" answer (or buffer) can be given until it is planned; the state
   reads "Move not planned yet". A planned exit that already misses the move still wins (2);
4. ``at_risk``: the key project's forecast is on or after the key run (skipped when the key
   project, its forecast or the key run is missing);
5. ``on_track_narrowly``: any project (either domain) is late against its target, or has
   unplaced hours;
6. ``on_track``.

Counts follow ADR-0009: ``countdown = bd_between(today, move)`` and
``buffer = bd_between(last PC exit, move)``. ``to_run = bd_diff(key forecast, key run)``.

``move_strip`` builds the Transition strip: one block per remaining business day, and flags
sorted by position (stably, in the prototype's insertion order) with alternating label lifts.
"""

from bisect import bisect_left, bisect_right
from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import date
from typing import Literal

from app.services.engine.model import EngineCtx, ProjectPlan
from app.services.engine.routines import last_occurrence_before

VerdictState = Literal["no_pc", "off_track", "at_risk", "on_track_narrowly", "on_track"]


def countdown(ctx: EngineCtx) -> int:
    """Business days strictly between today and the move (61 in the fixture)."""
    return ctx.cal.bd_between(ctx.today, ctx.move)


def key_run(ctx: EngineCtx) -> date | None:
    """The override when set, else the key routine's last run before the move."""
    if ctx.key_run_override is not None:
        return ctx.key_run_override
    routine = ctx.routine(ctx.key_routine_id)
    if routine is None:
        return None
    return last_occurrence_before(routine, ctx, ctx.move)


def is_late(p: ProjectPlan, ctx: EngineCtx) -> bool:
    """The forecast is after the target, or hours are unplaced (status ``risk``)."""
    return p.forecast is not None and (
        p.unplaced_h > 0 or ctx.cal.bd_diff(p.target, p.forecast) > 0
    )


def last_pc_exit(projects: Sequence[ProjectPlan]) -> date | None:
    """The latest Private Credit forecast (Define projects are ignored)."""
    forecasts = [p.forecast for p in projects if p.domain == "pc" and p.forecast is not None]
    return max(forecasts) if forecasts else None


@dataclass(frozen=True, slots=True)
class Verdict:
    state: VerdictState
    buffer_bd: int | None
    last_pc_exit: date | None
    key_project_id: str | None
    key_forecast: date | None
    key_run: date | None
    to_run_bd: int | None
    any_risk: bool
    unplaced: bool
    """A Private Credit project has hours that could not be placed before the move."""


def verdict(projects: Sequence[ProjectPlan], ctx: EngineCtx) -> Verdict:
    """The move verdict (see the module docstring)."""
    pcs = [p for p in projects if p.domain == "pc"]
    last = last_pc_exit(projects)
    buffer = ctx.cal.bd_between(last, ctx.move) if last is not None else None
    key = next((p for p in projects if p.id == ctx.key_project_id), None)
    run = key_run(ctx)
    key_forecast = key.forecast if key is not None else None
    to_run = (
        ctx.cal.bd_diff(key_forecast, run) if key_forecast is not None and run is not None else None
    )
    any_risk = any(is_late(p, ctx) for p in projects)
    unplaced = any(p.unplaced_h > 0 for p in pcs)
    state: VerdictState
    if not pcs:
        state = "no_pc"
    elif unplaced or any(p.forecast is not None and p.forecast >= ctx.move for p in pcs):
        state = "off_track"
    elif any(p.forecast is None for p in pcs):
        state = "no_pc"
    elif key_forecast is not None and run is not None and key_forecast >= run:
        state = "at_risk"
    elif any_risk:
        state = "on_track_narrowly"
    else:
        state = "on_track"
    return Verdict(
        state=state,
        buffer_bd=buffer,
        last_pc_exit=last,
        key_project_id=key.id if key is not None else None,
        key_forecast=key_forecast,
        key_run=run,
        to_run_bd=to_run,
        any_risk=any_risk,
        unplaced=unplaced,
    )


# ---------------------------------------------------------------------------- transition strip
@dataclass(frozen=True, slots=True)
class StripDay:
    day: date
    bdm: int
    pc_running: bool
    """On or before the last Private Credit exit (filled block)."""


StripFlagKind = Literal["project", "key_run", "move"]

FLAG_LIFT_PX = (2, 18)
"""Label lift above the stick, by sorted index parity (even, odd)."""
FLAG_STICK_PX = (10, 26)
"""Stick height, by sorted index parity (even, odd)."""


@dataclass(frozen=True, slots=True)
class StripFlag:
    kind: StripFlagKind
    day: date
    project_id: str | None = None
    at_risk: bool = False
    slot: int = 0
    """The block boundary the flag stands on, ``0..len(remaining)``; its left edge is
    ``slot / len(remaining)`` of the strip. A project stands at the right edge of its forecast
    day's block (the prototype's ``posEnd``: the first remaining day after the forecast), the key
    run at the left edge of its block (``pos``: the first remaining day on or after it) and the
    move at the end. A day past the last block gives ``len(remaining)``."""
    index: int = 0
    """Position in the sorted flags. Label lift and stick height alternate on it."""
    lift_px: int = FLAG_LIFT_PX[0]
    """The label's bottom margin: 2px on an even index, 18px on an odd one."""
    stick_px: int = FLAG_STICK_PX[0]
    """The stick's height: 10px on an even index, 26px on an odd one."""


@dataclass(frozen=True, slots=True)
class MoveStrip:
    countdown_bd: int
    remaining: tuple[StripDay, ...]
    """Business days strictly between today and the move (one block each)."""
    flags: tuple[StripFlag, ...]
    """Sorted by ``slot``. Ties keep the prototype's insertion order: Private Credit forecasts
    in project order, then the key run, then the move."""


def move_strip(projects: Sequence[ProjectPlan], ctx: EngineCtx) -> MoveStrip:
    """The Transition screen's strip of remaining business days and its flags.

    Mirrors ``Transition.dc.html``: flags are sorted by position with a stable sort, and the
    sorted index picks the label lift and stick height, so neighbours alternate between a low
    and a high label. With the fixture, the returns pipeline (Wed 2 Dec, right edge) and the key
    run (Thu 3 Dec, left edge) share slot 42 of 61, so the order is ret, key run, manco, play,
    move.
    """
    cal = ctx.cal
    last = last_pc_exit(projects)
    days: list[StripDay] = []
    if ctx.move > ctx.today:
        for d in cal.bds(ctx.today, ctx.move):
            if ctx.today < d < ctx.move:
                bdm = cal.bdm(d)
                days.append(StripDay(d, bdm or 0, last is not None and d <= last))
    rem = [x.day for x in days]
    n = len(rem)
    placed = [
        StripFlag("project", p.forecast, p.id, is_late(p, ctx), slot=bisect_right(rem, p.forecast))
        for p in projects
        if p.domain == "pc" and p.forecast is not None
    ]
    run = key_run(ctx)
    if run is not None:
        placed.append(StripFlag("key_run", run, slot=bisect_left(rem, run)))
    placed.append(StripFlag("move", ctx.move, slot=n))
    placed.sort(key=lambda f: f.slot)  # stable: ties keep insertion order
    flags = tuple(
        replace(f, index=i, lift_px=FLAG_LIFT_PX[i % 2], stick_px=FLAG_STICK_PX[i % 2])
        for i, f in enumerate(placed)
    )
    return MoveStrip(countdown(ctx), tuple(days), flags)
