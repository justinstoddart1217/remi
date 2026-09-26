"""``validate()``: every check a proposed check-in change must pass before the user sees it.

The same rules apply to AI output and to the simple reading. Input is loose JSON; output is
the typed ``Change`` dataclasses. Anything dropped is recorded with a reason (for the audit
log only).

Rules:
- drop an item that is not an object, has no or an unknown ``type``, or names an unknown
  project (every type but ``bau_done`` needs one);
- ``bau_done``: the routine exists and counts today;
- ``task_done``: the task is open and belongs to that project;
- ``task_add`` / ``scope_add``: text required, cut to 120 characters; hours
  ``clamp(hours or (1 for task_add, 0 for scope_add), 0.25, 80)``;
- ``blocker`` / ``note``: text required, cut to 160; only the first note per project;
- ``confidence``: rounded; 1..5 and different from the current value;
- ``target_move``: a ``YYYY-MM-DD`` date inside the calendar, snapped to the next business day;
- ``hours_per_day``: ``MIN_HOURS <= v <= capacity`` (0.05h, the services' floor), and the rate
  change it makes must keep every figure the rescale touches (after-move rate, BAU-day hours,
  overrides) at 0 or ``MIN_HOURS``..``MAX_HOURS``, as the preview and apply require. Anything
  else would fail the whole preview, so it is dropped here with the reason;
- exact duplicates (canonical JSON) are removed; at most 4 ``unplaced`` strings are kept.
"""

import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, fields
from datetime import date
from typing import cast

from remi.services.engine.calendar import BusinessCalendar, OutOfCalendar
from remi.services.engine.forecast import MAX_HOURS, MIN_HOURS, plan_hours_problem, rescale
from remi.services.engine.model import (
    BauDone,
    Blocker,
    Change,
    Confidence,
    EngineCtx,
    HoursPerDay,
    Note,
    Project,
    ProjectPlan,
    ScopeAdd,
    TargetMove,
    TaskAdd,
    TaskDone,
)
from remi.services.engine.routines import counts_on
from remi.utils.dates import is_iso_date
from remi.utils.text import round_half_up

TASK_TEXT_MAX = 120
NOTE_TEXT_MAX = 160
HOURS_MIN = 0.25
HOURS_MAX = 80.0
UNPLACED_MAX = 4

KNOWN_TYPES = frozenset(
    {
        "task_done",
        "task_add",
        "scope_add",
        "blocker",
        "confidence",
        "target_move",
        "hours_per_day",
        "note",
        "bau_done",
    }
)


@dataclass(frozen=True, slots=True)
class RawProposal:
    """A proposal before validation: loose JSON-like values, as a provider returned them."""

    summary: object = ""
    changes: object = field(default_factory=list[object])
    unplaced: object = field(default_factory=list[object])


@dataclass(frozen=True, slots=True)
class ValidationState:
    project_confidence: Mapping[str, int | None]
    """Every known project id and its current confidence."""
    open_tasks: Mapping[str, str]
    """Open Now task id -> project id."""
    routines: frozenset[str]
    routines_today: frozenset[str]
    """Routines that count today."""
    cal: BusinessCalendar
    capacity: float
    plans: Mapping[str, ProjectPlan] = field(default_factory=dict[str, ProjectPlan])
    """Every known project's plan (an hours-a-day change is checked against its rescale)."""


def validation_state(projects: Sequence[Project], ctx: EngineCtx) -> ValidationState:
    """The state ``validate`` checks against, from the engine inputs."""
    return ValidationState(
        project_confidence={p.id: p.confidence for p in projects},
        open_tasks={t.id: p.id for p in projects for t in p.open_now_tasks()},
        routines=frozenset(r.id for r in ctx.routines),
        routines_today=frozenset(r.id for r in ctx.routines if counts_on(r, ctx.today, ctx)),
        cal=ctx.cal,
        capacity=ctx.capacity,
        plans={p.id: p.plan for p in projects},
    )


@dataclass(frozen=True, slots=True)
class Dropped:
    index: int
    reason: str
    item: object


@dataclass(frozen=True, slots=True)
class ValidatedProposal:
    summary: str
    changes: tuple[Change, ...]
    unplaced: tuple[str, ...]
    dropped: tuple[Dropped, ...] = ()


def _num(value: object) -> float | None:
    """JavaScript's ``+value`` for the values JSON can hold; ``None`` for NaN."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int | float):
        number = float(value)
    elif isinstance(value, str):
        try:
            number = float(value.strip())
        except ValueError:
            return None
    else:
        return None
    return None if math.isnan(number) or math.isinf(number) else number


def _text(value: object) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()


def _hours(value: object, default: float) -> float:
    h = _num(value)
    if not h:
        h = default
    return min(HOURS_MAX, max(HOURS_MIN, h))


def change_key(c: Change) -> str:
    """Canonical JSON of a change (used to drop duplicates)."""
    data: dict[str, object] = {f.name: getattr(c, f.name) for f in fields(c)}
    return json.dumps(data, sort_keys=True, default=str)


def _one(item: Mapping[str, object], state: ValidationState) -> Change | str:
    """The typed change, or the reason it is dropped."""
    kind = item.get("type")
    if not isinstance(kind, str) or not kind:
        return "no type"
    if kind not in KNOWN_TYPES:
        return f"unknown type {kind!r}"
    if kind == "bau_done":
        rid = item.get("routine_id")
        if not isinstance(rid, str) or rid not in state.routines:
            return "unknown routine"
        if rid not in state.routines_today:
            return "routine does not run today"
        return BauDone(rid)
    pid = item.get("project_id")
    if not isinstance(pid, str) or pid not in state.project_confidence:
        return "unknown project"
    if kind == "task_done":
        tid = item.get("task_id")
        if not isinstance(tid, str) or state.open_tasks.get(tid) != pid:
            return "task is not an open task of this project"
        return TaskDone(pid, tid)
    if kind in ("task_add", "scope_add"):
        text = _text(item.get("text"))
        if text is None:
            return "no text"
        if kind == "task_add":
            return TaskAdd(pid, text[:TASK_TEXT_MAX], _hours(item.get("hours"), 1.0))
        return ScopeAdd(pid, text[:TASK_TEXT_MAX], _hours(item.get("hours"), 0.0))
    if kind in ("blocker", "note"):
        text = _text(item.get("text"))
        if text is None:
            return "no text"
        if kind == "blocker":
            return Blocker(pid, text[:NOTE_TEXT_MAX])
        return Note(pid, text[:NOTE_TEXT_MAX])
    if kind == "confidence":
        v = _num(item.get("value"))
        if v is None:
            return "confidence is not a number"
        value = int(round_half_up(v))
        if not 1 <= value <= 5:
            return "confidence outside 1..5"
        if value == state.project_confidence[pid]:
            return "confidence unchanged"
        return Confidence(pid, value)
    if kind == "target_move":
        raw_date = item.get("date")
        if not is_iso_date(raw_date):
            return "date is not YYYY-MM-DD"
        day = date.fromisoformat(cast("str", raw_date))
        try:
            snapped = state.cal.next_bd(day)
        except OutOfCalendar:
            return "date outside the calendar"
        return TargetMove(pid, snapped)
    # hours_per_day
    v = _num(item.get("value"))
    if v is None or not 0 < v <= state.capacity:
        return "hours a day outside 0..capacity"
    if v < MIN_HOURS:
        return f"hours a day below {MIN_HOURS:g}h"
    plan = state.plans.get(pid)
    if plan is not None and v != plan.rate and plan_hours_problem(rescale(plan, v)) is not None:
        return f"hours a day would plan some days outside {MIN_HOURS:g}..{MAX_HOURS:g}h"
    return HoursPerDay(pid, v)


def validate(raw: RawProposal | Mapping[str, object], state: ValidationState) -> ValidatedProposal:
    """Apply every rule in the module docstring."""
    if isinstance(raw, RawProposal):
        summary_raw, changes_raw, unplaced_raw = raw.summary, raw.changes, raw.unplaced
    else:
        summary_raw = raw.get("summary")
        changes_raw = raw.get("changes")
        unplaced_raw = raw.get("unplaced")
    items: list[object] = (
        list(cast("list[object]", changes_raw)) if isinstance(changes_raw, list) else []
    )
    out: list[Change] = []
    dropped: list[Dropped] = []
    seen: set[str] = set()
    noted: set[str] = set()
    for i, original in enumerate(items):
        if not isinstance(original, Mapping):
            dropped.append(Dropped(i, "not an object", original))
            continue
        result = _one(cast("Mapping[str, object]", original), state)
        if isinstance(result, str):
            dropped.append(Dropped(i, result, items[i]))
            continue
        if isinstance(result, Note):
            if result.project_id in noted:
                dropped.append(Dropped(i, "only one note per project", items[i]))
                continue
            noted.add(result.project_id)
        key = change_key(result)
        if key in seen:
            dropped.append(Dropped(i, "duplicate", items[i]))
            continue
        seen.add(key)
        out.append(result)
    unplaced: list[str] = []
    if isinstance(unplaced_raw, list):
        unplaced = [str(x) for x in cast("list[object]", unplaced_raw) if x][:UNPLACED_MAX]
    summary = str(summary_raw) if summary_raw else ""
    return ValidatedProposal(summary, tuple(out), tuple(unplaced), tuple(dropped))
