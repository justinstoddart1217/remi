"""``remi_events``: the append-only log. One row per committed mutation (see ``core/uow.py``).

``seq`` is the cursor (``AUTOINCREMENT``, so values are never reused). The table has no foreign
keys, so history survives deletes, and triggers refuse ``UPDATE`` and ``DELETE``.
"""

import datetime as dt
from typing import Final, Literal, get_args

from sqlalchemy import DDL, Integer, String, event
from sqlalchemy.orm import Mapped, mapped_column

from app.repositories.models.base import Base, JSONDict, JSONList, UTCDateTime, check_in, new_pk

Actor = Literal[
    "user",
    "ai-proposal-accepted",
    "simple-proposal-accepted",
    "setup",
    "system",
    "import",
]
ACTORS: Final = get_args(Actor)
EVENT_SCHEMA_VERSION: Final = 1

PLAN_NEUTRAL_EVENTS: Final = frozenset(
    {
        "note.updated",
        "textbook.blocks_saved",
        "textbook.chart_deleted",
        "textbook.chart_uploaded",
        "textbook.charts_collected",
        "textbook.page_created",
        "textbook.page_renamed",
        "textbook.section_created",
        "textbook.section_deleted",
        "textbook.section_updated",
        "textbook.sections_reordered",
    }
)
"""Event types that cannot change the ``GET /plan`` bundle, so they do not move the plan
revision (its ``ETag``). The Textbook is served by its own reads, and the plan counts notes but
never shows their text. Autosave records one ``textbook.blocks_saved`` every few hundred
milliseconds while someone types; without this set each one would make the next ``GET /plan``
rebuild the plan and answer 200 instead of 304. ``textbook.page_deleted`` is not in the set:
it can change ``settings.uiPrefs``, which the plan carries. ``tests/read/test_plan_revision.py``
checks every member against a freshly built plan."""

APPEND_ONLY_TRIGGERS: Final = (
    "CREATE TRIGGER remi_events_no_update BEFORE UPDATE ON remi_events "
    "BEGIN SELECT RAISE(ABORT, 'remi_events is append-only'); END",
    "CREATE TRIGGER remi_events_no_delete BEFORE DELETE ON remi_events "
    "BEGIN SELECT RAISE(ABORT, 'remi_events is append-only'); END",
)
"""Created by migration 0001 (and by ``metadata.create_all`` through the hook below)."""


class RemiEvent(Base):
    """``refs`` is ``[{"type", "id"}]``; ``payload`` is ``{"input", "effects", "diff"?}``."""

    __tablename__ = "remi_events"
    __table_args__ = (check_in("actor", ACTORS), {"sqlite_autoincrement": True})

    seq: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id: Mapped[str] = mapped_column(String(36), unique=True, default=new_pk)
    at: Mapped[dt.datetime] = mapped_column(UTCDateTime())
    business_date: Mapped[dt.date]
    type: Mapped[str] = mapped_column(String(64), index=True)
    actor: Mapped[Actor] = mapped_column(String(32), default="user")
    refs: Mapped[JSONList] = mapped_column(default=list)
    payload: Mapped[JSONDict] = mapped_column(default=dict)
    schema_version: Mapped[int] = mapped_column(Integer, default=EVENT_SCHEMA_VERSION)


for _statement in APPEND_ONLY_TRIGGERS:
    event.listen(RemiEvent.__table__, "after_create", DDL(_statement))
