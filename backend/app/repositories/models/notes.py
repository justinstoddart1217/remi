"""Notes (one notebook per day) and entity aliases used for tagging and the simple reader."""

import datetime as dt

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.repositories.models.base import Base, Timestamps, UUIDPk


class Note(UUIDPk, Timestamps, Base):
    """A note on notebook day ``day`` (may differ from ``created_at`` when backfilling).

    ``seq`` orders notes within a day. Tags are computed on read, never stored.
    """

    __tablename__ = "notes"
    __table_args__ = (Index("ix_notes_day_seq", "day", "seq"),)

    day: Mapped[dt.date]
    text: Mapped[str] = mapped_column(Text)
    seq: Mapped[int] = mapped_column(Integer, default=0)


class EntityAlias(UUIDPk, Base):
    """A lower-case alias of exactly one project or routine (name and short are implicit)."""

    __tablename__ = "entity_aliases"
    __table_args__ = (
        CheckConstraint("(project_id IS NULL) <> (routine_id IS NULL)", name="one_entity"),
        CheckConstraint("alias = lower(alias) AND length(trim(alias)) > 0", name="alias_lower"),
        UniqueConstraint("project_id", "alias"),
        UniqueConstraint("routine_id", "alias"),
    )

    project_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    routine_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("routines.id", ondelete="CASCADE"), index=True
    )
    alias: Mapped[str] = mapped_column(String(120))
