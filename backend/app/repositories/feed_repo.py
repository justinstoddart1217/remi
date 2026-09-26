"""``FeedRepository``: stored activity items (data only; stale/overload items are computed)."""

import builtins

from sqlalchemy import Integer, literal_column, or_, select
from sqlalchemy.orm import Session

from app.repositories.models import FeedEvent


class FeedRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, item: FeedEvent) -> FeedEvent:
        self.session.add(item)
        return item

    def get(self, item_id: str) -> FeedEvent | None:
        return self.session.get(FeedEvent, item_id)

    def list(self, limit: int = 50, before: str | None = None) -> builtins.list[FeedEvent]:
        """Newest first. ``before`` is the id of the last item of the previous page."""
        stmt = select(FeedEvent)
        if before is not None:
            anchor = self.get(before)
            if anchor is not None:
                stmt = stmt.where(
                    or_(
                        FeedEvent.created_at < anchor.created_at,
                        (FeedEvent.created_at == anchor.created_at) & (FeedEvent.id < anchor.id),
                    )
                )
        stmt = stmt.order_by(FeedEvent.created_at.desc(), FeedEvent.id.desc()).limit(limit)
        return list(self.session.scalars(stmt))

    def page(self, limit: int = 50, before: str | None = None) -> builtins.list[FeedEvent]:
        """Newest first, ties (items written in one transaction share a timestamp) broken by
        insertion order. ``before`` is the id of the last item of the previous page; an
        unknown id returns an empty page."""
        rowid = literal_column("feed_events.rowid", Integer)
        stmt = select(FeedEvent)
        if before is not None:
            anchor = self.session.execute(
                select(FeedEvent.created_at, rowid).where(FeedEvent.id == before)
            ).first()
            if anchor is None:
                return []
            at, position = anchor
            stmt = stmt.where(
                or_(
                    FeedEvent.created_at < at,
                    (FeedEvent.created_at == at) & (rowid < position),
                )
            )
        stmt = stmt.order_by(FeedEvent.created_at.desc(), rowid.desc()).limit(limit)
        return list(self.session.scalars(stmt))
