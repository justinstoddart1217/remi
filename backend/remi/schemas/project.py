"""Projects and their children: charter, milestones, tasks, readiness items, hour rules.

``ProjectOut`` carries the stored fields plus ``derived``, which the engine computes on every
read. The client formats copy from these numbers; it never recomputes forecasts.
"""

import datetime as dt
from typing import Annotated, Literal, Self

from pydantic import AwareDatetime, Field, model_validator

from remi.schemas.base import CamelIn, CamelModel, DateIn, Domain, EntityId, HoursPerDay, NotBool

CharterList = Literal["success", "inScope", "outScope", "constraints"]
CheckInSource = Literal["ai", "simple", "form", "system"]
"""Where a check-in came from: an AI or simple-reading proposal, a form edit, or Remi itself."""

MilestoneHorizon = Literal["now", "next", "explicit"]
"""``now``: the two-week column with tasks. ``next``: the following milestones. ``explicit``:
data-only milestones kept for the timeline."""

ProjectStatus = Literal["define", "risk", "on"]
"""``define``: no forecast yet. ``risk``: forecast after target. ``on``: on or before target."""

ExitRoute = Literal["Finish", "Automate", "Hand over", "Stop"]
Phase = Annotated[Literal[0, 1, 2, 3], NotBool]
"""Define, Plan, Run, Close. Data only (decision 8)."""

NeedState = Literal["ok", "no_estimate", "target_passed", "no_capacity", "over_capacity"]
"""Result of the need solver: the hours a day that land the work on the target.

- ``ok``: ``need.rate`` is set.
- ``no_estimate``: no work-left estimate ("needs a work estimate").
- ``target_passed``: the target is before the planning start ("target has passed").
- ``no_capacity``: extra hours a day cannot help (every day is pinned by rules).
- ``over_capacity``: the rate would exceed capacity (data only).
"""

SentenceCase = Literal["no_plan", "after_move", "late", "no_buffer", "buffer"]
"""Which Workspace verdict sentence applies (first match wins):

- ``no_plan``: no forecast.
- ``after_move``: a PC project that lands on or after the move.
- ``late``: lands ``lateBd`` business days after the target.
- ``no_buffer``: lands on the target day.
- ``buffer``: ``bufferBd`` days to spare, ``scopeH`` hours of new scope absorbable.
"""


# ---------------------------------------------------------------- stored children
class CharterItemOut(CamelModel):
    id: str
    project_id: str
    list: CharterList
    text: str
    sort_order: int


class CharterOut(CamelModel):
    """The four ordered charter lists. ``whyNow`` lives on the project."""

    success: list[CharterItemOut]
    in_scope: list[CharterItemOut]
    out_scope: list[CharterItemOut]
    constraints: list[CharterItemOut]


class TaskOut(CamelModel):
    id: str
    project_id: str
    milestone_id: str
    text: str
    hours: float
    due_date: dt.date | None
    """Optional; falls back to the milestone's due date."""
    sort_order: int
    done: bool
    done_on: dt.date | None
    """The business date it was ticked."""


class MilestoneOut(CamelModel):
    id: str
    project_id: str
    horizon: MilestoneHorizon
    name: str
    due_date: dt.date | None
    sort_order: int
    done: bool
    done_on: dt.date | None
    tasks: list[TaskOut]
    """Only ``now`` milestones carry tasks."""


class ReadinessItemOut(CamelModel):
    """An onboarding item (Transition's FI readiness list)."""

    id: str
    project_id: str
    text: str
    done: bool
    due_date: dt.date | None
    done_on: dt.date | None
    sort_order: int


class ScopeChangeOut(CamelModel):
    """Scope added since the charter (data only; drives ``addedH`` and ``growthPct``)."""

    id: str
    project_id: str
    checkin_id: str | None
    date: dt.date
    what: str
    hours: float
    slip_bd: int
    from_forecast: dt.date | None
    to_forecast: dt.date | None


class RiskOut(CamelModel):
    """Premortem risk (data only)."""

    id: str
    risk: str
    mitigation: str
    sort_order: int


class ChecklistItemOut(CamelModel):
    id: str
    text: str
    done: bool
    done_on: dt.date | None
    sort_order: int


class ChecklistOut(CamelModel):
    """Project checklist (data only)."""

    id: str
    title: str
    sort_order: int
    items: list[ChecklistItemOut]


# ---------------------------------------------------------------- derived
class DerivedMilestoneOut(CamelModel):
    """A milestone on the timeline: Now/Next milestones with a due date, plus explicit ones."""

    milestone_id: str | None
    name: str
    date: dt.date
    horizon: MilestoneHorizon
    done: bool
    passed: bool
    """``date < today``."""


class NeedOut(CamelModel):
    rate: float | None
    """Hours a day to land on the target, rounded up to 0.1 (so applying it always makes it)."""
    state: NeedState


class SentenceParamsOut(CamelModel):
    """Numbers for the Workspace verdict sentence. Keys irrelevant to the case are ``null``."""

    rate: float | None
    """Current hours a day."""
    work_left_h: float | None
    cut_h: float | None
    """``late``: hours to cut to make the target. ``after_move``: hours to cut to land before
    the move."""
    late_bd: int | None
    need_rate: float | None
    buffer_bd: int | None
    scope_h: float | None
    """``buffer``: new scope absorbable before the target moves."""
    target_date: dt.date | None
    move_date: dt.date | None
    over_day_count: int
    """Overloaded days the project sits on (appended clause when > 0)."""
    first_over_day: dt.date | None
    stale_days: int | None
    """Set when the project is stale (appended "Not checked in for N days")."""
    starts_in_bd: int | None
    """Set when the project has not started and has a forecast (appended "Starts in N BD")."""


class SentenceOut(CamelModel):
    case: SentenceCase
    params: SentenceParamsOut


class ProjectDerivedOut(CamelModel):
    """Everything the engine derives for a project on ``today``."""

    status: ProjectStatus
    delta_bd: int | None
    """``bd_diff(target, forecast)``; positive = late. ``null`` without a forecast."""
    plan_from: dt.date
    """``max(today, start)``: where remaining work is planned from."""
    started: bool
    since_days: int | None
    """Calendar days since the last check-in; ``null`` if never checked in."""
    stale: bool
    added_h: float
    """Scope hours added since the charter."""
    growth_pct: int | None
    """``round(added / baseline * 100)``; ``null`` without a baseline."""
    work_left: float | None
    """Unrounded hours between ``planFrom`` and the forecast, plus unplaced hours."""
    work_left_display: float | None
    """``workLeft`` rounded to 0.5 for display."""
    bd_left: int | None
    bd_to_target: int
    total_bd: int
    done_bd: int
    progress_pct: float
    """0 to 100, elapsed business days over the whole span."""
    need: NeedOut
    avg_plan: float | None
    buffer_bd: int | None
    """``bd_diff(forecast, target)``; negative = late."""
    absorb_h: float | None
    cut_h: float | None
    cut_before_move_h: float | None
    lands_after_move: bool
    """Forecast on or after the move, or hours left unplaced (PC projects)."""
    starts_in_bd: int | None
    over_days: list[dt.date]
    """Overloaded business days between ``planFrom`` and the forecast that include this project."""
    now_estimate_h: float
    """Open task hours in Now ("{est}h estimated in Now")."""
    readiness_pct: float | None
    """The stored readiness x 100 when set, otherwise done task hours over all task hours."""
    sentence: SentenceOut
    milestones: list[DerivedMilestoneOut]
    """Sorted by date."""
    next_milestone: DerivedMilestoneOut | None
    """First not-done milestone on or after today."""
    day_hours: dict[dt.date, float]
    """Planned hours per business day from ``planFrom`` to the forecast (``day_hours(p, d)``)."""


class ProjectOut(CamelModel):
    """A project: stored fields, children and ``derived``. Used in ``PlanOut.projects``."""

    id: str
    domain: Domain
    name: str
    short: str
    goal: str
    why_now: str
    later_intent: str
    end_name: str
    """Label for the forecast end, e.g. "Handover-ready" or "Done"."""

    start_date: dt.date
    target_date: dt.date
    target_label: str | None
    """A fuzzy display override such as "Late Mar 2027"; cleared when the target moves."""
    forecast_date: dt.date | None
    """``null`` while the project is in Define."""
    prev_forecast_date: dt.date | None
    """The forecast before the last move (the timeline's ghost bar)."""

    rate: float
    """Planned focus hours on an ordinary business day."""
    rate_after_move: float
    baseline_hours: float
    unplaced_h: float
    """Hours that did not fit before the calendar ran out of capacity (counts as after the move)."""

    confidence: int | None = Field(ge=1, le=5)
    last_checkin_date: dt.date | None
    blocker: str | None
    readiness: float | None = Field(ge=0, le=1)
    after_day_one_note: str | None

    phase: Phase
    exit_routes: list[ExitRoute] | None
    """PC only (``null`` for FI). Data only."""
    sort_order: int
    created_at: AwareDatetime
    updated_at: AwareDatetime

    charter: CharterOut
    milestones: list[MilestoneOut]
    readiness_items: list[ReadinessItemOut]
    scope_changes: list[ScopeChangeOut]
    risks: list[RiskOut]
    checklists: list[ChecklistOut]
    bau_day_hours: dict[str, float]
    """Routine id -> the project's hours on days that routine counts (replaces BD3/BD8)."""
    overrides: dict[dt.date, float]
    """Per-day hour overrides; an explicit 0 counts."""

    derived: ProjectDerivedOut


class SnapshotMilestoneOut(CamelModel):
    milestone_id: str | None
    name: str
    date: dt.date


class ProjectSnapshotOut(CamelModel):
    """``GET /projects/{id}/snapshots``: one stop on the Workspace history scrubber."""

    checkin_id: str
    date: dt.date
    forecast_date: dt.date | None
    target_date: dt.date | None
    confidence: int | None
    note: str
    source: CheckInSource
    milestones: list[SnapshotMilestoneOut]


class ReplanPreviewOut(CamelModel):
    """``POST /projects/{id}/replan/preview``: what ``replan`` would do, without saving."""

    project_id: str
    from_forecast: dt.date | None
    to_forecast: dt.date | None
    delta_bd: int
    rate: float
    work_left: float | None
    unplaced_h: float
    derived: ProjectDerivedOut


# ---------------------------------------------------------------- request bodies
class ProjectCreate(CamelIn):
    """``POST /projects``: a new project in Define (no forecast) with default dates."""

    domain: Domain
    name: str | None = Field(default=None, min_length=1, max_length=200)


class ProjectPatch(CamelIn):
    """``PATCH /projects/{id}``. Absent = unchanged, ``null`` = clear.

    ``name`` also sets ``short`` unless ``short`` is sent. ``targetDate`` snaps forward to a
    business day and clears ``targetLabel``. Forecast inputs (rate, work left, start) go
    through ``POST /projects/{id}/replan`` instead.
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    short: str | None = Field(default=None, min_length=1, max_length=80)
    goal: str | None = Field(default=None, max_length=2000)
    why_now: str | None = Field(default=None, max_length=2000)
    later_intent: str | None = Field(default=None, max_length=2000)
    end_name: str | None = Field(default=None, min_length=1, max_length=80)
    target_date: DateIn | None = None
    target_label: str | None = Field(default=None, max_length=80)
    confidence: int | None = Field(default=None, ge=1, le=5)
    readiness: float | None = Field(default=None, ge=0, le=1)
    blocker: str | None = Field(default=None, max_length=500)
    after_day_one_note: str | None = Field(default=None, max_length=500)
    baseline_hours: float | None = Field(default=None, ge=0, le=9999)
    rate_after_move: HoursPerDay | None = None
    phase: Phase | None = None
    exit_routes: list[ExitRoute] | None = Field(default=None, max_length=2)
    sort_order: int | None = Field(default=None, ge=0)


class ReplanIn(CamelIn):
    """``POST /projects/{id}/replan``: exactly one of ``rate``, ``workLeft``, ``startDate``.

    - ``rate``: keeps the work left; rescales the after-move rate, BAU-day hours and overrides.
    - ``workLeft``: refits at the current rate (a rate of 0 becomes 1).
    - ``startDate``: snaps to a business day and keeps the work left.
    """

    rate: HoursPerDay | None = None
    work_left: float | None = Field(default=None, ge=0, le=999)
    start_date: DateIn | None = None

    @model_validator(mode="after")
    def _exactly_one(self) -> Self:
        given = [k for k in ("rate", "work_left", "start_date") if getattr(self, k) is not None]
        if len(given) != 1:
            msg = "send exactly one of rate, workLeft or startDate"
            raise ValueError(msg)
        return self


class CharterItemCreate(CamelIn):
    """``POST /projects/{id}/charter/{list}``: appends an item (blank is allowed while editing)."""

    text: str = Field(default="", max_length=1000)


class CharterItemPatch(CamelIn):
    """A blank (empty or all-space) text removes the item, like ``DELETE``; the response's
    ``entity`` is then the item as it was."""

    text: str = Field(max_length=1000)


class MilestoneCreate(CamelIn):
    """``POST /projects/{id}/milestones``. ``dueDate`` defaults to today + 9 BD (now) or
    today + 20 BD (next), from settings."""

    horizon: Literal["now", "next"]
    name: str = Field(default="", max_length=300)
    due_date: DateIn | None = None


class MilestonePatch(CamelIn):
    """A blank ``name`` removes the milestone and its tasks, like ``DELETE``; the response's
    ``entity`` is then the milestone as it was."""

    name: str | None = Field(default=None, max_length=300)
    due_date: DateIn | None = None
    """Snaps forward to a business day. ``null`` clears it."""
    done: bool | None = None


class TaskCreate(CamelIn):
    """``POST /milestones/{id}/tasks`` (Now milestones only)."""

    text: str = Field(default="", max_length=500)
    hours: HoursPerDay = 1
    due_date: DateIn | None = None


class TaskPatch(CamelIn):
    """``done`` sets or clears ``doneOn`` (today). A blank ``text`` removes the task, like
    ``DELETE``; the response's ``entity`` is then the task as it was."""

    text: str | None = Field(default=None, max_length=500)
    hours: HoursPerDay | None = None
    done: bool | None = None
    due_date: DateIn | None = None


class ReadinessItemCreate(CamelIn):
    """``POST /projects/{id}/readiness-items``: the Transition onboarding list."""

    text: str = Field(default="", max_length=300)
    due_date: DateIn | None = None


class ReadinessItemPatch(CamelIn):
    """``done`` sets or clears ``doneOn`` (today). A blank ``text`` removes the item, like
    ``DELETE``; the response's ``entity`` is then the item as it was."""

    text: str | None = Field(default=None, max_length=300)
    done: bool | None = None
    due_date: DateIn | None = None


class BauDayHoursRule(CamelIn):
    routine_id: EntityId
    hours: HoursPerDay


class BauDayHoursPut(CamelIn):
    """``PUT /projects/{id}/bau-day-hours``: replaces every rule for the project (data only)."""

    rules: list[BauDayHoursRule] = Field(max_length=100)


class HourOverridePut(CamelIn):
    """``PUT /projects/{id}/overrides/{iso}``: the project's hours on that day (data only)."""

    hours: HoursPerDay
