"""``NoteRepository``: notes filed under a notebook day (``seq`` orders a day's notes)."""

import builtins
import datetime as dt
from collections.abc import Collection

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from remi.repositories.models import Note


class NoteRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get(self, note_id: str) -> Note | None:
        return self.session.get(Note, note_id)

    def list_day(self, day: dt.date) -> builtins.list[Note]:
        """One day's notes, oldest first."""
        stmt = select(Note).where(Note.day == day).order_by(Note.seq, Note.created_at, Note.id)
        return list(self.session.scalars(stmt))

    def list_between(
        self, frm: dt.date | None = None, to: dt.date | None = None
    ) -> builtins.list[Note]:
        stmt = select(Note)
        if frm is not None:
            stmt = stmt.where(Note.day >= frm)
        if to is not None:
            stmt = stmt.where(Note.day <= to)
        return list(self.session.scalars(stmt.order_by(Note.day, Note.seq, Note.created_at)))

    def list_days(self, days: Collection[dt.date]) -> builtins.list[Note]:
        """Notes on any of ``days``, by day then ``seq``."""
        if not days:
            return []
        stmt = select(Note).where(Note.day.in_(list(days)))
        return list(self.session.scalars(stmt.order_by(Note.day, Note.seq, Note.created_at)))

    def day_counts(
        self, frm: dt.date | None = None, to: dt.date | None = None
    ) -> dict[dt.date, int]:
        """``{day: number of notes}`` for days that have notes."""
        stmt = select(Note.day, func.count()).group_by(Note.day)
        if frm is not None:
            stmt = stmt.where(Note.day >= frm)
        if to is not None:
            stmt = stmt.where(Note.day <= to)
        return {day: int(n) for day, n in self.session.execute(stmt)}

    def count_total(self) -> int:
        return int(self.session.scalar(select(func.count()).select_from(Note)) or 0)

    def count_days(self) -> int:
        return int(self.session.scalar(select(func.count(func.distinct(Note.day)))) or 0)

    def count_on(self, day: dt.date) -> int:
        stmt = select(func.count()).select_from(Note).where(Note.day == day)
        return int(self.session.scalar(stmt) or 0)

    def count_in(self, days: Collection[dt.date]) -> int:
        if not days:
            return 0
        stmt = select(func.count()).select_from(Note).where(Note.day.in_(list(days)))
        return int(self.session.scalar(stmt) or 0)

    def latest_per_day(
        self, frm: dt.date | None = None, to: dt.date | None = None
    ) -> dict[dt.date, str]:
        """``{day: text of its most recently added note}`` for days that have notes."""
        latest = select(Note.day, func.max(Note.seq).label("seq")).group_by(Note.day)
        if frm is not None:
            latest = latest.where(Note.day >= frm)
        if to is not None:
            latest = latest.where(Note.day <= to)
        sub = latest.subquery()
        stmt = (
            select(Note.day, Note.text)
            .join(sub, (Note.day == sub.c.day) & (Note.seq == sub.c.seq))
            .order_by(Note.day, Note.created_at, Note.id)
        )
        # Equal seqs cannot happen through the API; if they do, the last row read wins.
        return {day: text for day, text in self.session.execute(stmt)}

    def next_seq(self, day: dt.date) -> int:
        current = self.session.scalar(select(func.max(Note.seq)).where(Note.day == day))
        return 0 if current is None else int(current) + 1

    def add(self, note: Note) -> Note:
        self.session.add(note)
        return note

    def delete(self, note: Note) -> None:
        self.session.delete(note)
