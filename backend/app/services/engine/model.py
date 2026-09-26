"""Engine inputs: frozen dataclasses that the service adapters build from the database.

The engine never reads the database or the clock. Everything it needs arrives here:

- ``ProjectPlan``: the forecast inputs of one project (dates, rates, BAU-day hours,
  overrides). ``forecast``, ``loads`` and ``verdict`` work on plans only.
- ``Project``: a plan plus what the read model derives from (name, confidence, check-in date,
  scope growth, milestones and their tasks).
- ``RoutineDef`` and ``RotationDef``: recurring BAU and the Fixed Income rotation.
- ``EngineCtx``: today, the move, capacity, the calendar and the settings-driven keys.
- The nine check-in ``Change`` types, already validated (see ``validate``).

Mappings inside frozen dataclasses must be treated as read-only.
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date
from typing import Literal

from app.services.engine.calendar import BusinessCalendar

Domain = Literal["pc", "fi"]
"""``pc`` = Private Credit (before the move), ``fi`` = Fixed Income (from the move)."""

RoutineKind = Literal["monthly", "weekly", "daily"]
Horizon = Literal["now", "next", "explicit"]
PassKind = Literal["Build", "Refresh"]

HANDED_OVER = 3
"""Routine stage 3 (``Handed over``): it no longer takes the user's time."""

ROTATION_REF_ID = "rot"
"""Load-item id for rotation segments that have no id of their own."""


# ---------------------------------------------------------------------------- projects
@dataclass(frozen=True, slots=True)
class ProjectPlan:
    """The forecast inputs of one project.

    ``forecast`` is ``None`` for a project still in Define. ``bau_day_hours`` maps a routine id
    to the project's hours on days that routine counts (``project_bau_day_hours``; it replaces
    the prototype's ``bd3``/``bd8``). ``overrides`` are explicit hours for single days (an
    explicit 0 counts). ``unplaced_h`` is work that could not be placed before the hours ran
    out (see ``forecast.finish_for``); it counts as landing after the move.
    """

    id: str
    domain: Domain
    start: date
    target: date
    forecast: date | None = None
    prev: date | None = None
    rate: float = 0.0
    rate_after: float = 0.0
    bau_day_hours: Mapping[str, float] = field(default_factory=dict[str, float])
    overrides: Mapping[date, float] = field(default_factory=dict[date, float])
    unplaced_h: float = 0.0
    short: str = ""
    """Display name for load items (``Returns pipeline``)."""


@dataclass(frozen=True, slots=True)
class Task:
    id: str
    text: str
    hours: float
    done: bool = False
    done_on: date | None = None
    due: date | None = None
    """Own due date; falls back to its milestone's."""


@dataclass(frozen=True, slots=True)
class Milestone:
    """A Now or Next plan item, or an explicit milestone. Only Now items carry tasks."""

    id: str
    name: str
    due: date | None
    horizon: Horizon
    tasks: tuple[Task, ...] = ()
    done: bool = False
    done_on: date | None = None


@dataclass(frozen=True, slots=True)
class Project:
    """A plan plus the stored fields the read model derives from.

    ``milestones`` are in plan order (Now items, then Next items, then explicit ones).
    """

    plan: ProjectPlan
    name: str = ""
    confidence: int | None = None
    last_checkin: date | None = None
    baseline_h: float = 0.0
    scope_added_h: float = 0.0
    milestones: tuple[Milestone, ...] = ()
    target_label: str | None = None

    @property
    def id(self) -> str:
        return self.plan.id

    @property
    def domain(self) -> Domain:
        return self.plan.domain

    @property
    def short(self) -> str:
        return self.plan.short

    def now_tasks(self) -> list[Task]:
        """Every Now task in plan order, done or not."""
        return [t for m in self.milestones if m.horizon == "now" for t in m.tasks]

    def open_now_tasks(self) -> list[Task]:
        """Now tasks that are not done (the ones a check-in can tick off)."""
        return [t for t in self.now_tasks() if not t.done]


# ---------------------------------------------------------------------------- routines
@dataclass(frozen=True, slots=True)
class RoutineDef:
    """A recurring BAU routine.

    ``kind`` monthly runs on business day ``bd`` of each month (no run in a month with fewer
    business days); weekly runs on ``weekday`` (1 = Monday ... 5 = Friday); daily runs on every
    business day. ``stage`` 3 means handed over.
    """

    id: str
    domain: Domain
    kind: RoutineKind
    hours: float
    stage: int = 0
    bd: int = 1
    weekday: int = 1
    project_id: str | None = None
    name: str = ""
    short: str = ""
    checklist_size: int = 0
    """Number of run-checklist items (0 = no checklist)."""
    co_tag: bool = False
    """Tag this routine in notes even when its project is tagged too."""
    starts_on: date | None = None
    """The first day the routine runs (the day it was created); ``None`` = it always has.
    Runs before it do not take time, so they are never due or overdue (``counts_on``)."""

    @property
    def has_checklist(self) -> bool:
        return self.checklist_size > 0


# ---------------------------------------------------------------------------- rotation
@dataclass(frozen=True, slots=True)
class SegmentDef:
    """One country in the rotation, as the user configures it."""

    country: str
    code: str
    length_bd: int
    kind: PassKind = "Build"
    id: str = ""


@dataclass(frozen=True, slots=True)
class RotationDef:
    """The Fixed Income rotation. ``start`` ``None`` means it starts on the move date."""

    segments: tuple[SegmentDef, ...]
    hours_per_day: float
    start: date | None = None


@dataclass(frozen=True, slots=True)
class Segment:
    """A laid-out segment: ``length_bd`` business days from ``start`` to ``end``."""

    order: int
    id: str
    country: str
    code: str
    length_bd: int
    kind: PassKind
    loop: int
    start: date
    end: date


@dataclass(frozen=True, slots=True)
class RotationPlan:
    start: date
    hours_per_day: float
    segments: tuple[Segment, ...]
    total_bd: int
    loop_bd: int
    """Business days in loop 1: the Build segments before the first Refresh."""
    loop_end: date | None
    """End of loop 1's last Build segment (``None`` when the rotation opens with a Refresh)."""
    refresh_start: date | None
    refresh_end: date | None
    """The first Refresh pass (consecutive Refresh segments), if any."""
    end: date | None


# ---------------------------------------------------------------------------- context
@dataclass(frozen=True, slots=True)
class EngineCtx:
    """Everything that is not a project: today, the move, capacity, calendar and settings.

    ``leave`` maps a day to hours off (``None`` = the whole day); it lowers that day's capacity
    and never changes business-day numbering. ``key_run_override`` replaces the key routine's
    last run before the move when set.
    """

    today: date
    move: date
    capacity: float
    cal: BusinessCalendar
    routines: tuple[RoutineDef, ...] = ()
    rotation: RotationDef | None = None
    key_project_id: str | None = None
    key_routine_id: str | None = None
    key_run_override: date | None = None
    stale_days: int = 7
    lookahead_bd: int = 10
    eps: float = 0.01
    leave: Mapping[date, float | None] = field(default_factory=dict[date, float | None])
    rotation_plan: RotationPlan | None = field(init=False, compare=False, repr=False)
    _routine_index: Mapping[str, RoutineDef] = field(init=False, compare=False, repr=False)
    _rotation_days: Mapping[date, Segment] = field(init=False, compare=False, repr=False)

    def __post_init__(self) -> None:
        from app.services.engine.rotation import layout  # local import: avoids a cycle

        object.__setattr__(self, "routines", tuple(self.routines))
        object.__setattr__(self, "_routine_index", {r.id: r for r in self.routines})
        plan: RotationPlan | None = None
        days: dict[date, Segment] = {}
        if self.rotation is not None and self.rotation.segments:
            start = self.rotation.start if self.rotation.start is not None else self.move
            plan = layout(self.rotation.segments, start, self.rotation.hours_per_day, self.cal)
            for seg in plan.segments:
                for d in self.cal.bds(seg.start, seg.end):
                    days[d] = seg
        object.__setattr__(self, "rotation_plan", plan)
        object.__setattr__(self, "_rotation_days", days)

    def routine(self, routine_id: str | None) -> RoutineDef | None:
        """The routine with this id, or ``None``."""
        return self._routine_index.get(routine_id) if routine_id is not None else None

    def rotation_segment_on(self, d: date) -> Segment | None:
        """The rotation segment that covers business day ``d``, if any."""
        return self._rotation_days.get(d)

    def capacity_on(self, d: date) -> float:
        """Capacity on ``d`` after leave."""
        if d not in self.leave:
            return self.capacity
        off = self.leave[d]
        return 0.0 if off is None else max(0.0, self.capacity - off)


# ---------------------------------------------------------------------------- check-in changes
@dataclass(frozen=True, slots=True)
class TaskDone:
    project_id: str
    task_id: str
    type: Literal["task_done"] = "task_done"


@dataclass(frozen=True, slots=True)
class TaskAdd:
    project_id: str
    text: str
    hours: float
    type: Literal["task_add"] = "task_add"


@dataclass(frozen=True, slots=True)
class ScopeAdd:
    project_id: str
    text: str
    hours: float
    type: Literal["scope_add"] = "scope_add"


@dataclass(frozen=True, slots=True)
class Blocker:
    project_id: str
    text: str
    type: Literal["blocker"] = "blocker"


@dataclass(frozen=True, slots=True)
class Confidence:
    project_id: str
    value: int
    type: Literal["confidence"] = "confidence"


@dataclass(frozen=True, slots=True)
class TargetMove:
    project_id: str
    date: date
    type: Literal["target_move"] = "target_move"


@dataclass(frozen=True, slots=True)
class HoursPerDay:
    project_id: str
    value: float
    type: Literal["hours_per_day"] = "hours_per_day"


@dataclass(frozen=True, slots=True)
class Note:
    project_id: str
    text: str
    type: Literal["note"] = "note"


@dataclass(frozen=True, slots=True)
class BauDone:
    routine_id: str
    type: Literal["bau_done"] = "bau_done"


ProjectChange = (
    TaskDone | TaskAdd | ScopeAdd | Blocker | Confidence | TargetMove | HoursPerDay | Note
)
Change = ProjectChange | BauDone
ChangeType = Literal[
    "task_done",
    "task_add",
    "scope_add",
    "blocker",
    "confidence",
    "target_move",
    "hours_per_day",
    "note",
    "bau_done",
]
