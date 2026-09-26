"""Reusable path and query parameters. Every name on the wire is camelCase."""

import datetime as dt
from typing import Annotated
from uuid import UUID

from fastapi import Path, Query

MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"


def _id_path(alias: str, what: str) -> object:
    return Path(alias=alias, min_length=1, max_length=64, description=f"The {what} id.")


ProjectId = Annotated[str, _id_path("projectId", "project")]
MilestoneId = Annotated[str, _id_path("milestoneId", "milestone")]
TaskId = Annotated[str, _id_path("taskId", "task")]
CharterItemId = Annotated[str, _id_path("itemId", "charter item")]
ReadinessItemId = Annotated[str, _id_path("itemId", "readiness item")]
RoutineId = Annotated[str, _id_path("routineId", "routine")]
RoutineChecklistItemId = Annotated[str, _id_path("itemId", "routine checklist item")]
NoteId = Annotated[str, _id_path("noteId", "note")]
SectionId = Annotated[str, _id_path("sectionId", "textbook section")]
PageId = Annotated[str, _id_path("pageId", "textbook page")]
AssetId = Annotated[str, _id_path("assetId", "chart asset")]
AliasId = Annotated[str, _id_path("aliasId", "alias")]
ParseId = Annotated[UUID, Path(alias="parseId", description="The drawer session's parse id.")]

IsoDate = Annotated[dt.date, Path(description="An ISO date, YYYY-MM-DD.")]
"""The ``{iso}`` path segment."""

FromQuery = Annotated[
    dt.date | None, Query(alias="from", description="First day, inclusive (ISO date).")
]
ToQuery = Annotated[dt.date | None, Query(description="Last day, inclusive (ISO date).")]
DayQuery = Annotated[dt.date, Query(description="The notebook day (ISO date).")]
MonthQuery = Annotated[
    str | None,
    Query(pattern=MONTH_PATTERN, description="YYYY-MM. Defaults to the current month."),
]
LimitQuery = Annotated[int, Query(ge=1, le=500, description="Page size.")]
BeforeQuery = Annotated[
    str | None, Query(max_length=64, description="Cursor from the previous page's nextBefore.")
]
