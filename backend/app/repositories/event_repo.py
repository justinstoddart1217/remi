"""``EventRepository``: reads of the append-only ``remi_events`` log.

The unit of work writes the events (one per mutation); this repository only reads them. The
latest ``seq`` of an event that can change the plan is the plan revision (the ``GET /plan``
ETag; see ``PLAN_NEUTRAL_EVENTS``).
"""

import builtins
from typing import Any, cast

from sqlalchemy import String, func, select
from sqlalchemy.orm import Session

from app.repositories.models import RemiEvent
from app.repositories.models.events import PLAN_NEUTRAL_EVENTS


class EventRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def latest_seq(self) -> int:
        """The newest event's ``seq`` (0 when there are none)."""
        return int(self.session.scalar(select(func.max(RemiEvent.seq))) or 0)

    def latest_plan_seq(self) -> int:
        """The newest ``seq`` of an event that can change ``GET /plan`` (0 when there are none):
        the plan revision. Types in ``PLAN_NEUTRAL_EVENTS`` are skipped. SQLite walks the log
        back from the newest row and stops at the first match, so the cost is the run of
        neutral events at the end of the log (a Textbook session), not the whole log."""
        stmt = (
            select(RemiEvent.seq)
            .where(RemiEvent.type.not_in(PLAN_NEUTRAL_EVENTS))
            .order_by(RemiEvent.seq.desc())
            .limit(1)
        )
        return int(self.session.scalar(stmt) or 0)

    def count(self) -> int:
        return int(self.session.scalar(select(func.count()).select_from(RemiEvent)) or 0)

    def get(self, seq: int) -> RemiEvent | None:
        return self.session.get(RemiEvent, seq)

    def list(self, since_seq: int = 0, limit: int = 100) -> builtins.list[RemiEvent]:
        """Events after ``since_seq``, oldest first."""
        stmt = (
            select(RemiEvent).where(RemiEvent.seq > since_seq).order_by(RemiEvent.seq).limit(limit)
        )
        return list(self.session.scalars(stmt))

    def latest(self, event_type: str | None = None) -> RemiEvent | None:
        stmt = select(RemiEvent)
        if event_type is not None:
            stmt = stmt.where(RemiEvent.type == event_type)
        return self.session.scalars(stmt.order_by(RemiEvent.seq.desc()).limit(1)).first()

    def for_ref(self, ref_type: str, ref_id: str, limit: int = 100) -> builtins.list[RemiEvent]:
        """Events that reference the entity, oldest first."""
        needle = f"%{ref_id}%"
        stmt = (
            select(RemiEvent)
            .where(RemiEvent.refs.cast(String).like(needle))
            .order_by(RemiEvent.seq)
        )
        out: builtins.list[RemiEvent] = []
        for event in self.session.scalars(stmt):
            refs = cast(builtins.list[dict[str, Any]], event.refs)
            if any(r.get("type") == ref_type and r.get("id") == ref_id for r in refs):
                out.append(event)
                if len(out) >= limit:
                    break
        return out
