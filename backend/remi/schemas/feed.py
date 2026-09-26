"""The activity feed (data only: decision 8 renders no feed)."""

import datetime as dt
from typing import Literal

from pydantic import AwareDatetime

from remi.schemas.base import CamelModel

FeedKind = Literal["scope", "checkin", "edit", "routine", "stale", "overload"]
"""``stale`` and ``overload`` items are computed; the rest are stored ``feed_events`` rows."""
FeedTone = Literal["risk", "quiet", "overload"]


class FeedEventOut(CamelModel):
    id: str
    project_id: str | None
    routine_id: str | None
    day: dt.date | None
    kind: FeedKind
    title: str
    body: str
    delta: str
    """Chip text, e.g. "+3 BD", "Target", "BAU"."""
    tone: FeedTone
    created_at: AwareDatetime


class FeedPageOut(CamelModel):
    """``GET /feed``: newest first. Pass ``nextBefore`` as ``before`` for older items."""

    items: list[FeedEventOut]
    next_before: str | None
