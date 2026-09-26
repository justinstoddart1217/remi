"""The append-only ``remi_events`` log: one row per mutation (history and audit)."""

import datetime as dt
from typing import Any, Literal

from pydantic import AwareDatetime

from remi.schemas.base import CamelModel

EventActor = Literal[
    "user", "ai-proposal-accepted", "simple-proposal-accepted", "setup", "system", "import"
]
"""Who caused the event. Matches ``remi_events.actor`` (``import`` is a data import)."""


class EventRefOut(CamelModel):
    type: str
    """Entity kind, e.g. ``project``, ``routine``, ``note``."""
    id: str


class RemiEventOut(CamelModel):
    seq: int
    """Monotonic cursor."""
    id: str
    at: AwareDatetime
    business_date: dt.date | None
    type: str
    """e.g. ``project.created``, ``checkin.applied``, ``routine.stage_changed``."""
    actor: EventActor
    refs: list[EventRefOut]
    payload: dict[str, Any]
    """``{input, effects, diff}``; never contains secrets."""
    schema_version: int


class EventPageOut(CamelModel):
    """``GET /events?since=``: oldest first after ``since``. Pass ``nextSince`` to continue."""

    items: list[RemiEventOut]
    next_since: int | None
