"""Activity feed items (data only). Stale and overload items are computed, never stored."""

import datetime as dt

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from remi.repositories.models.base import Base, CreatedAt, UUIDPk


class FeedEvent(UUIDPk, CreatedAt, Base):
    """``kind`` e.g. scope | checkin | edit | routine; ``tone`` e.g. risk | quiet.

    Deleting the project deletes its items; deleting a routine keeps them (routine_id NULL).
    """

    __tablename__ = "feed_events"

    project_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    routine_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("routines.id", ondelete="SET NULL"), index=True
    )
    day: Mapped[dt.date | None]
    kind: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(Text, default="")
    body: Mapped[str] = mapped_column(Text, default="")
    delta: Mapped[str] = mapped_column(String(32), default="")
    tone: Mapped[str] = mapped_column(String(16), default="quiet")
