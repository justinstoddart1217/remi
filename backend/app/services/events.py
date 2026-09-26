"""The append-only ``remi_events`` log (history and audit; data only).

Every mutation writes exactly one row (``core/uow.py``). ``GET /events?since=`` pages through
them oldest first by ``seq``. The plan revision is the latest *plan-affecting* ``seq``
(``EventRepository.latest_plan_seq``, which skips ``PLAN_NEUTRAL_EVENTS`` such as note and
textbook edits), so those writes do not change the plan's ETag.
"""

from typing import Any, cast, get_args

from app.core.uow import UnitOfWorkFactory
from app.repositories import models as orm
from app.repositories.registry import EVENTS
from app.schemas.events import EventActor, EventPageOut, EventRefOut, RemiEventOut

_ACTORS = frozenset(get_args(EventActor))


def event_out(row: orm.RemiEvent) -> RemiEventOut:
    refs = cast(list[dict[str, Any]], row.refs or [])
    actor: EventActor = row.actor if row.actor in _ACTORS else "system"
    return RemiEventOut(
        seq=row.seq,
        id=row.id,
        at=row.at,
        business_date=row.business_date,
        type=row.type,
        actor=actor,
        refs=[EventRefOut(type=str(r.get("type", "")), id=str(r.get("id", ""))) for r in refs],
        payload=dict(row.payload or {}),
        schema_version=row.schema_version,
    )


def list_events(uow_factory: UnitOfWorkFactory, since: int, limit: int) -> EventPageOut:
    """``GET /events``: events with ``seq > since``, oldest first. ``nextSince`` is the last
    ``seq`` when the page is full (there may be more)."""
    with uow_factory.read() as uow:
        items = [event_out(e) for e in uow.repo(EVENTS).list(since_seq=since, limit=limit)]
    return EventPageOut(items=items, next_since=items[-1].seq if len(items) == limit else None)
