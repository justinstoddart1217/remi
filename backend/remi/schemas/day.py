"""``DayOut``: one day's plan for Today and the Calendar day panel (``GET /day/{iso}``)."""

import datetime as dt
from typing import Literal

from pydantic import AliasChoices, Field

from remi.schemas.base import CamelModel, Domain
from remi.schemas.calendar import DayLoadOut
from remi.schemas.rotation import RotationPass
from remi.schemas.routine import RoutineRunOut, Stage

FocusEmptyReason = Literal["no_tasks", "used_up"]
"""``no_tasks``: "No tasks planned in Now yet. Add them in the workspace."
``used_up``: "The tasks in Now are used up before this day. Plan the next ones in the workspace."
"""


class FocusTaskOut(CamelModel):
    id: str
    milestone_id: str
    text: str
    hours: float
    done: bool
    done_on: dt.date | None
    due_date: dt.date | None


class FocusMilestoneOut(CamelModel):
    milestone_id: str
    name: str
    date: dt.date
    due_this_day: bool
    """"Milestone due this day: …" rather than "Next milestone: …"."""


class FocusBlockOut(CamelModel):
    """One project's planned hours on the day, with the slice of Now tasks they cover."""

    project_id: str
    hours: float
    offset_h: float
    """Hours of this project already planned on business days from today up to this day."""
    tasks: list[FocusTaskOut]
    """Tasks whose cumulative span overlaps ``(offsetH, offsetH + hours)``. Today keeps tasks
    done today; other days drop done tasks."""
    empty_reason: FocusEmptyReason | None
    next_milestone: FocusMilestoneOut | None


class BauChecklistItemOut(CamelModel):
    id: str
    label: str
    done: bool


class BauRotationOut(CamelModel):
    segment_id: str
    country: str
    code: str
    pass_: RotationPass = Field(
        validation_alias=AliasChoices("pass", "pass_"), serialization_alias="pass"
    )


class BauRowOut(CamelModel):
    """A BAU item on the day: a routine run or the FI rotation (after the move)."""

    kind: Literal["routine", "rotation"]
    routine_id: str | None
    rotation: BauRotationOut | None
    name: str
    short: str
    domain: Domain
    hours: float
    stage: Stage | None
    run: RoutineRunOut | None
    """The occurrence's run state (routines only)."""
    checklist: list[BauChecklistItemOut]
    """Empty when the routine has no checklist."""
    editable: bool
    """Checklist ticks are editable only on today's run."""
    done: bool


class NextRunOut(CamelModel):
    """For "No BAU on this day. The next run is …"."""

    routine_id: str | None
    date: dt.date | None
    after_move: bool
    """``true`` when the next run falls after the move ("after the move")."""


class DayOut(CamelModel):
    """``GET /day/{iso}``. Non-business days return empty rows (the client falls back)."""

    day: dt.date
    is_today: bool
    ahead_bd: int
    """``bd_diff(today, day)``: 1 = tomorrow, negative = past."""
    w: int
    bdm: int | None
    month_bds: int
    holiday: str | None
    load: DayLoadOut | None
    bau_rows: list[BauRowOut]
    focus_blocks: list[FocusBlockOut]
    """In plan order (PC projects first, then FI, each by ``sortOrder``), as the design lists
    them."""
    next_run_after: NextRunOut | None
    """Only when the day has no BAU and some routine runs later."""
