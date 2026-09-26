"""``MonthSnapshotOut``: Today's month snapshot (``GET /month-snapshot?month=YYYY-MM``)."""

import datetime as dt
from typing import Literal

from pydantic import AliasChoices, Field

from remi.schemas.base import CamelModel, Domain

SnapshotRowKind = Literal["bau", "task", "milestone"]


class MonthSnapshotRowOut(CamelModel):
    """A row to tick. Toggle a ``bau`` row with ``PUT /routines/{routineId}/runs/{occurrenceDate}``
    (or the items endpoint when ``hasChecklist``), a ``task`` with ``PATCH /tasks/{taskId}`` and
    a ``milestone`` with ``PATCH /milestones/{milestoneId}``."""

    key: str
    """Stable row key (``bau:<routineId>:<iso>``, ``task:<id>``, ``milestone:<id>``)."""
    kind: SnapshotRowKind
    text: str
    """Routine name (plus " · 5 Oct" for non-monthly), task text, or milestone name."""
    sub: str
    """``"BD3"`` for BAU, the project short name otherwise."""
    due: dt.date
    done: bool
    done_on: dt.date | None
    late: bool
    """Not done and due before today."""
    domain: Domain
    project_id: str | None
    routine_id: str | None
    occurrence_date: dt.date | None
    task_id: str | None
    milestone_id: str | None
    has_checklist: bool


class MonthSnapshotBarOut(CamelModel):
    """Cumulative counts at one business day of the month."""

    iso: dt.date
    plan: int
    """Rows due on or before this day."""
    done: int
    """Rows done on or before this day (past days only)."""
    late: int
    """Rows due before this day and not done by it (past days only)."""
    past: bool


class MonthSnapshotTotalsOut(CamelModel):
    total: int
    done: int
    late: int


class MonthSnapshotOut(CamelModel):
    month: str
    """``YYYY-MM``."""
    from_: dt.date = Field(
        validation_alias=AliasChoices("from", "from_"), serialization_alias="from"
    )
    """First business day of the month."""
    to: dt.date
    """Last business day of the month."""
    today: dt.date
    rows: list[MonthSnapshotRowOut]
    bars: list[MonthSnapshotBarOut]
    totals: MonthSnapshotTotalsOut
    """The fixture gives "2 of 17 done · 1 overdue"."""
