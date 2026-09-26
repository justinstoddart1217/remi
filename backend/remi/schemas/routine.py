"""BAU routines, their occurrences, runs and checklist ticks, and checklist items."""

import datetime as dt
from typing import Annotated, Literal

from pydantic import AwareDatetime, Field

from remi.schemas.base import CamelIn, CamelModel, Domain, EntityId, NotBool

RoutineKind = Literal["monthly", "weekly", "daily"]
Stage = Annotated[Literal[0, 1, 2, 3], NotBool]
"""Handover stage: 0 Manual, 1 Automating, 2 Shadowed, 3 Handed over (drops off the plan)."""


class RoutineRuleOut(CamelModel):
    """When the routine runs. Only the field for ``kind`` matters; both are always stored."""

    kind: RoutineKind
    bd: int = Field(ge=1, le=20)
    """``monthly``: business day of the month (a month with fewer BDs has no run)."""
    weekday: int = Field(ge=1, le=5)
    """``weekly``: 1 = Monday ... 5 = Friday."""


class RoutineChecklistItemOut(CamelModel):
    """One checklist line, e.g. a fund in the returns run."""

    id: str
    routine_id: str
    label: str
    sort_order: int


class RoutineRunOut(CamelModel):
    """One occurrence's completion state, keyed by (routine, occurrence date)."""

    routine_id: str
    occurrence_date: dt.date
    completed: bool
    """Explicitly marked complete (month snapshot toggle or ``bau_done``)."""
    completed_on: dt.date | None
    """The business date it was completed (may differ from the occurrence)."""
    completed_at: AwareDatetime | None
    ticked_item_ids: list[str]
    item_count: int
    done: bool
    """``completed``, or every checklist item ticked when the routine has a checklist."""


class OccurrenceOut(CamelModel):
    iso: dt.date
    bdm: int
    today: bool
    after_move: bool
    bd_away: int
    """``bd_diff(today, iso)``: 0 today, 1 tomorrow."""


class RoutineDerivedOut(CamelModel):
    next: list[OccurrenceOut]
    """The next three occurrences on or after today (stage is ignored)."""
    occurrences: list[dt.date]
    """Every occurrence inside ``PlanOut.calendar`` (for timeline and calendar ticks)."""
    monthly_effort_h: float
    monthly_effort_approx: bool
    """``true`` for daily/weekly (shown with "≈"), ``false`` for monthly."""
    runs_today: bool
    """It occurs today."""
    counts_today: bool
    """It occurs today and still takes time (stage < 3, in its domain's window)."""
    today_run: RoutineRunOut | None
    """Today's run state when it occurs today."""
    last_before_move: dt.date | None
    """The last occurrence before the move (the key run for the key routine)."""
    handed_over: bool


class RoutineOut(CamelModel):
    """A routine: stored fields, checklist items and ``derived``."""

    id: str
    domain: Domain
    name: str
    short: str
    label: str | None
    """The curated row label on the Timeline (the design's "Fund & security returns" for
    "Fund & security-level returns"); ``null`` means show ``name``. A rename clears it."""
    detail: str
    """e.g. "12 funds"."""
    rule: RoutineRuleOut
    hours: float
    """Hours per run."""
    stage: Stage
    status_note: str
    """The handover note on the Routines row and the timeline tooltip."""
    transition_note: str | None
    """Transition's note; falls back to ``statusNote``, then the rule text, in the client."""
    project_id: str | None
    """The linked automation project."""
    co_tag_with_project: bool
    """Notes tag this routine even when its project is also named."""
    sort_order: int
    created_at: AwareDatetime
    updated_at: AwareDatetime
    checklist_items: list[RoutineChecklistItemOut]
    derived: RoutineDerivedOut


class RoutineCreate(CamelIn):
    """``POST /routines``. Defaults: monthly on BD5, Tuesday, 1h, Manual, blank name."""

    domain: Domain = "pc"
    name: str = Field(default="", max_length=200)


RoutineHours = Annotated[float, Field(ge=0, allow_inf_nan=False)]
"""Hours per run as the Routines field sends them: any number from 0. The service clamps it to
the settings capacity (the prototype's field clamps into 0..8 on blur), so 99 saves as 8."""


class RoutinePatch(CamelIn):
    """``PATCH /routines/{id}``. ``hours`` (any value from 0) is clamped to the settings
    capacity, as the prototype's field does. A stage change logs a feed item. ``name`` may be
    blank (a new routine starts blank). A rename keeps a curated ``short``; a short that is
    blank or mirrored the old name follows the new name, and a blank ``short`` falls back to
    the name. A rename clears ``label`` unless the same patch sets one; a blank or ``null``
    ``label`` clears it (the row shows the name)."""

    name: str | None = Field(default=None, max_length=200)
    short: str | None = Field(default=None, max_length=80)
    label: str | None = Field(default=None, max_length=200)
    detail: str | None = Field(default=None, max_length=200)
    domain: Domain | None = None
    kind: RoutineKind | None = None
    bd: int | None = Field(default=None, ge=1, le=20)
    weekday: int | None = Field(default=None, ge=1, le=5)
    hours: RoutineHours | None = None
    stage: Stage | None = None
    status_note: str | None = Field(default=None, max_length=1000)
    transition_note: str | None = Field(default=None, max_length=1000)
    project_id: EntityId | None = None
    co_tag_with_project: bool | None = None
    sort_order: int | None = Field(default=None, ge=0)


class RunPut(CamelIn):
    """``PUT /routines/{id}/runs/{iso}``: mark an occurrence complete or not."""

    completed: bool


class TickPut(CamelIn):
    """``PUT /routines/{id}/runs/{iso}/items[/{itemId}]``: tick one item, or all of them."""

    done: bool


class RoutineChecklistItemCreate(CamelIn):
    label: str = Field(default="", max_length=200)


class RoutineChecklistItemPatch(CamelIn):
    """A blank label is not allowed: the client deletes blank items with ``DELETE``."""

    label: str = Field(min_length=1, max_length=200)
