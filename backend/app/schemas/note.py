"""Notes: jots filed under a notebook day, tagged on read by the shared alias tagger."""

import datetime as dt
from typing import Literal

from pydantic import AliasChoices, AwareDatetime, Field

from app.schemas.base import CamelIn, CamelModel, DateIn, Domain

TagTargetType = Literal["project", "routine"]


class NoteTagOut(CamelModel):
    """A project or routine a note mentions."""

    target_type: TagTargetType
    target_id: str
    label: str
    """``"{short}"`` for a project, ``"{short} · BAU"`` for a routine."""
    domain: Domain


class NoteMentionOut(NoteTagOut):
    """A tag aggregated over a day's notes (the "Remi reads" panel)."""

    count: int
    """Notes that mention the target (each note counts once)."""


class NoteOut(CamelModel):
    id: str
    day: dt.date
    """The notebook day it is filed under (may differ from ``createdAt`` when backfilled)."""
    text: str
    seq: int
    """Insertion order within the day."""
    time_label: str
    """``"HH:MM"`` of ``createdAt`` in the business timezone."""
    created_at: AwareDatetime
    updated_at: AwareDatetime
    tags: list[NoteTagOut]
    """Projects first, then routines; computed on read."""


class NoteListOut(CamelModel):
    """``GET /notes?day=``: one day's notes, oldest first, with the day's mentions."""

    day: dt.date
    notes: list[NoteOut]
    mentions: list[NoteMentionOut]
    """Sorted by count, descending (stable)."""


class NoteDayOut(CamelModel):
    """One notebook day with its note count, preview and calendar facts (the Notes rail row)."""

    day: dt.date
    count: int
    latest_preview: str
    """Text of the most recently added note (``""`` when the day has none)."""
    w: int = Field(ge=0, le=6)
    """Weekday, 0 = Sunday ... 6 = Saturday (as ``CalendarDayOut.w``)."""
    bd: bool
    """Business day: Monday to Friday and not a holiday."""
    bdm: int | None
    """Business day of the month, or ``null`` on non-business days."""
    hol: str | None
    """Holiday name, or ``null``."""
    week_of: dt.date
    """Monday of the day's week: the rail groups rows under "This week" / "Week of D Mon"."""
    today: bool


class NoteDaysOut(CamelModel):
    """``GET /notes/days``: days that have notes, and the Notes rail."""

    from_: dt.date | None = Field(
        validation_alias=AliasChoices("from", "from_"), serialization_alias="from"
    )
    to: dt.date | None
    days: list[NoteDayOut]
    """Days that have notes within ``from``..``to`` (every day without a range), newest first."""
    rail: list[NoteDayOut]
    """The Notes rail, newest first (ignores ``from``/``to``): every business day from today
    back to 27 days ago, plus every day that has notes, at any date. Days without notes have
    ``count`` 0."""
    total: int
    """All notes, all days ("6 notes across 3 days")."""
    day_count: int


class RecentNotesOut(CamelModel):
    """``GET /notes/recent``: the notes that go with every Tell Remi update."""

    business_days: list[dt.date]
    """The last N business days up to and including today."""
    count: int
    notes: list[NoteOut]


class DayTextOut(CamelModel):
    """``GET /notes/day-text``: the prefill for "Turn this day into an update"."""

    day: dt.date
    text: str
    """``"HH:MM text"`` lines joined with newlines, oldest first. For a day other than today
    the first line is the date (``"Fri 2 Oct"``), so relative words resolve against that day.
    Empty when the day has no notes."""
    count: int


class TagPreviewOut(CamelModel):
    """``POST /notes/tags``: live tags for an unsaved draft."""

    tags: list[NoteTagOut]


class NoteCreate(CamelIn):
    day: DateIn
    text: str = Field(min_length=1, max_length=10000)
    """Trimmed by the server; blank text is a 422."""


class NotePatch(CamelIn):
    """A blank text is not allowed: the client deletes a blanked note with ``DELETE``."""

    text: str = Field(min_length=1, max_length=10000)


class TagPreviewIn(CamelIn):
    text: str = Field(max_length=10000)
