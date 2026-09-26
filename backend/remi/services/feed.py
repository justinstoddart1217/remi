"""The activity feed (data only: decision 8 renders no feed).

Stored ``feed_events`` rows, newest first: scope and check-in items, routine handover changes,
routine removals. The prototype's stale and overload items are computed (``PlanOut.flags``);
the design seed stores its sample ones.
"""

from typing import Final, cast, get_args

from remi.core.errors import ValidationFailed
from remi.core.uow import UnitOfWorkFactory
from remi.repositories import models as orm
from remi.repositories.registry import FEED
from remi.schemas.feed import FeedEventOut, FeedKind, FeedPageOut, FeedTone

_KINDS: Final = frozenset(get_args(FeedKind))
_TONES: Final = frozenset(get_args(FeedTone))


def feed_out(row: orm.FeedEvent) -> FeedEventOut:
    kind = cast(FeedKind, row.kind if row.kind in _KINDS else "edit")
    tone = cast(FeedTone, row.tone if row.tone in _TONES else "quiet")
    return FeedEventOut(
        id=row.id,
        project_id=row.project_id,
        routine_id=row.routine_id,
        day=row.day,
        kind=kind,
        title=row.title,
        body=row.body,
        delta=row.delta,
        tone=tone,
        created_at=row.created_at,
    )


def list_feed(uow_factory: UnitOfWorkFactory, limit: int, before: str | None) -> FeedPageOut:
    """``GET /feed``: a page of items, newest first. ``nextBefore`` is the last item's id when
    there may be more; an unknown ``before`` cursor is a 422."""
    with uow_factory.read() as uow:
        repo = uow.repo(FEED)
        if before is not None and repo.get(before) is None:
            raise ValidationFailed("That cursor is not known. Start again without it.", "before")
        items = [feed_out(r) for r in repo.page(limit=limit, before=before)]
    return FeedPageOut(items=items, next_before=items[-1].id if len(items) == limit else None)
