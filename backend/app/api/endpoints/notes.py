"""Notes: daily jots, tagged with the projects and routines they mention."""

from typing import Annotated

from fastapi import APIRouter, Query, status

from app.api.deps import ClockDep, UowFactoryDep
from app.api.endpoints._params import DayQuery, FromQuery, NoteId, ToQuery
from app.api.errors import error_responses
from app.schemas.mutation import MutationOut, NoteMutationOut
from app.schemas.note import (
    DayTextOut,
    NoteCreate,
    NoteDaysOut,
    NoteListOut,
    NotePatch,
    RecentNotesOut,
    TagPreviewIn,
    TagPreviewOut,
)
from app.services import notes as service

router = APIRouter(tags=["notes"])

_NEEDS_PLAN = "Returns the plan, so it answers 409 `SETUP_REQUIRED` before setup (nothing saved)."


@router.get(
    "/notes/days",
    summary="Days that have notes, with counts and previews",
    responses=error_responses(422),
)
def list_note_days(
    uow_factory: UowFactoryDep, clock: ClockDep, from_: FromQuery = None, to: ToQuery = None
) -> NoteDaysOut:
    """``days``: days with notes in the range (every one without a range). ``rail``: the
    Notes rail, with business-day and week facts for each row."""
    return service.list_note_days(uow_factory, clock, from_, to)


@router.get("/notes", summary="One day's notes and mentions", responses=error_responses(422))
def list_notes(day: DayQuery, uow_factory: UowFactoryDep) -> NoteListOut:
    return service.list_notes(uow_factory, day)


@router.get(
    "/notes/recent",
    summary="Notes from the last N business days (what Tell Remi may send)",
    responses=error_responses(409, 422),
)
def get_recent_notes(
    uow_factory: UowFactoryDep,
    clock: ClockDep,
    business_days: Annotated[int, Query(alias="businessDays", ge=1, le=20)] = 5,
) -> RecentNotesOut:
    return service.recent_notes(uow_factory, clock, business_days)


@router.get(
    "/notes/day-text",
    summary="A day's notes as update text (prefill for Tell Remi)",
    responses=error_responses(422),
)
def get_note_day_text(day: DayQuery, uow_factory: UowFactoryDep, clock: ClockDep) -> DayTextOut:
    return service.day_text(uow_factory, clock, day)


@router.post(
    "/notes/tags",
    summary="Tags for an unsaved draft (the composer's live chips)",
    responses=error_responses(422),
)
def preview_note_tags(body: TagPreviewIn, uow_factory: UowFactoryDep) -> TagPreviewOut:
    return service.tag_preview(uow_factory, body.text)


@router.post(
    "/notes",
    status_code=status.HTTP_201_CREATED,
    summary="Jot a note on a day",
    description=_NEEDS_PLAN,
    responses=error_responses(409, 422),
)
def create_note(body: NoteCreate, uow_factory: UowFactoryDep, clock: ClockDep) -> NoteMutationOut:
    return service.create_note(uow_factory, clock, body)


@router.patch(
    "/notes/{noteId}",
    summary="Edit a note's text",
    description=_NEEDS_PLAN,
    responses=error_responses(404, 409, 422),
)
def update_note(
    note_id: NoteId, body: NotePatch, uow_factory: UowFactoryDep, clock: ClockDep
) -> NoteMutationOut:
    return service.update_note(uow_factory, clock, note_id, body)


@router.delete(
    "/notes/{noteId}",
    summary="Remove a note",
    description=_NEEDS_PLAN,
    responses=error_responses(404, 409, 422),
)
def delete_note(note_id: NoteId, uow_factory: UowFactoryDep, clock: ClockDep) -> MutationOut:
    return service.delete_note(uow_factory, clock, note_id)
