"""Tell Remi: parse an update into proposed changes, preview them, apply them.

A ``Change`` is one of nine types, discriminated by ``type`` (snake_case values). The same
models are the AI proposal, the preview request and the apply request, so what the user
reviews is exactly what is applied. ``/checkins/preview`` and ``/checkins/apply`` run the same
engine function, so the preview always equals the applied result.
"""

import datetime as dt
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AliasChoices, Field

from app.schemas.base import CamelIn, CamelModel, DateIn, EntityId, UuidIn
from app.schemas.settings import AiProvider

ChangeText = Annotated[str, Field(min_length=1, max_length=120)]
NoteText = Annotated[str, Field(min_length=1, max_length=160)]
ChangeHours = Annotated[float, Field(ge=0.25, le=80)]


class TaskDoneChange(CamelIn):
    """Tick off an open task of the project ("Tick off")."""

    type: Literal["task_done"]
    project_id: EntityId
    task_id: EntityId


class TaskAddChange(CamelIn):
    """Add a task to the project's first Now milestone ("New task"). Never moves the forecast."""

    type: Literal["task_add"]
    project_id: EntityId
    text: ChangeText
    hours: ChangeHours


class ScopeAddChange(CamelIn):
    """New scope: the forecast slips by the business days the hours need ("New scope")."""

    type: Literal["scope_add"]
    project_id: EntityId
    text: ChangeText
    hours: ChangeHours


class BlockerChange(CamelIn):
    type: Literal["blocker"]
    project_id: EntityId
    text: NoteText


class ConfidenceChange(CamelIn):
    type: Literal["confidence"]
    project_id: EntityId
    value: int = Field(ge=1, le=5)


class TargetMoveChange(CamelIn):
    """Move the target; snapped forward to a business day."""

    type: Literal["target_move"]
    project_id: EntityId
    date: DateIn


class HoursPerDayChange(CamelIn):
    """New hours a day: the same refit as a Workspace rate edit."""

    type: Literal["hours_per_day"]
    project_id: EntityId
    value: float = Field(gt=0, le=24)


class NoteChange(CamelIn):
    type: Literal["note"]
    project_id: EntityId
    text: NoteText


class BauDoneChange(CamelIn):
    """Close today's run of a routine (ticks every checklist item)."""

    type: Literal["bau_done"]
    routine_id: EntityId


Change = Annotated[
    TaskDoneChange
    | TaskAddChange
    | ScopeAddChange
    | BlockerChange
    | ConfidenceChange
    | TargetMoveChange
    | HoursPerDayChange
    | NoteChange
    | BauDoneChange,
    Field(discriminator="type"),
]
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
ProposalSource = Literal["ai", "simple"]


class ParseRequest(CamelIn):
    """``POST /checkins/parse`` and ``/checkins/parse-simple``.

    ``parseId`` is generated per drawer session; ``DELETE /checkins/parse/{parseId}`` cancels it
    and the client ignores replies whose ``parseId`` is not current.
    """

    text: str = Field(min_length=1, max_length=8000)
    focus_project_id: EntityId | None = None
    parse_id: UuidIn


class ProposalOut(CamelModel):
    """A validated proposal. Nothing is applied until ``/checkins/apply``."""

    summary: str
    changes: list[Change]
    unplaced: list[str] = Field(max_length=4)
    """Phrases Remi could not tie to a project (at most 4)."""
    source: ProposalSource
    """``simple`` for the offline reading (the ``none`` provider or a fallback)."""
    parse_id: UUID
    provider: AiProvider
    model: str | None


class PreviewRequest(CamelIn):
    """``POST /checkins/preview``: the currently ticked changes."""

    changes: list[Change] = Field(max_length=100)


class ProjectPreviewOut(CamelModel):
    """The effect on one project (the review's EffectChip)."""

    project_id: str
    from_: dt.date | None = Field(
        validation_alias=AliasChoices("from", "from_"), serialization_alias="from"
    )
    """Forecast now."""
    to: dt.date | None
    """Forecast after applying."""
    delta_bd: int
    late: bool
    """``to`` is after the target (after any target move)."""
    label: str
    """``"+3 BD"``, ``"±0 BD"``, or a U+2212 minus sign for earlier (e.g. minus 2 BD)."""
    target_after: dt.date
    new_over: list[dt.date]
    """Business days that become overloaded (data only)."""
    misses_key_run: bool
    """The key project now lands on or after the key run (data only)."""
    past_target_bd: int | None = None
    """When ``late``: business days from ``targetAfter`` to ``to`` (the review's "now N BD
    past target"), else ``null``."""


class PreviewOut(CamelModel):
    projects: list[ProjectPreviewOut]
    """Only projects whose forecast or target the changes touch."""


class ApplyRequest(CamelIn):
    """``POST /checkins/apply``: one transaction, one check-in row per touched project."""

    changes: list[Change] = Field(min_length=1, max_length=100)
    raw_text: str = Field(default="", max_length=8000)
    focus_project_id: EntityId | None = None
    source: ProposalSource
    parse_id: UuidIn | None = None


class CheckinAppliedOut(CamelModel):
    """``MutationOut.entity`` for an apply."""

    batch_id: str
    checkin_ids: list[str]
    project_ids: list[str]
    routine_ids: list[str]
    """Routines whose run was closed (``bau_done``)."""
