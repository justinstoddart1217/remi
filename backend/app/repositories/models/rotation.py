"""The FI country rotation: an ordered list of segments measured in business days."""

import datetime as dt
from typing import Final, Literal, get_args

from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.repositories.models.base import (
    DOMAINS,
    Base,
    Domain,
    Timestamps,
    UUIDPk,
    check_in,
    check_range,
)

RotationPass = Literal["Build", "Refresh"]
ROTATION_PASSES: Final = get_args(RotationPass)


class Rotation(UUIDPk, Timestamps, Base):
    """``start_date`` NULL means "starts on the move date" (``settings.move_date``)."""

    __tablename__ = "rotations"
    __table_args__ = (
        check_in("domain", DOMAINS),
        check_range("hours_per_day", 0, 24),
    )

    domain: Mapped[Domain] = mapped_column(String(2), default="fi")
    title: Mapped[str] = mapped_column(String(200), default="")
    start_date: Mapped[dt.date | None]
    hours_per_day: Mapped[float] = mapped_column(Float, default=4.0)

    segments: Mapped[list["RotationSegment"]] = relationship(
        back_populates="rotation",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="RotationSegment.sort_order",
    )


class RotationSegment(UUIDPk, Base):
    """One country block. The Python attribute is ``pass_kind`` (column ``pass``)."""

    __tablename__ = "rotation_segments"
    __table_args__ = (
        check_in("pass", ROTATION_PASSES),
        check_range("length_bd", 1, None),
        check_range("loop", 1, None),
    )

    rotation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("rotations.id", ondelete="CASCADE"), index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    country: Mapped[str] = mapped_column(String(80))
    code: Mapped[str] = mapped_column(String(8))
    length_bd: Mapped[int] = mapped_column(Integer)
    pass_kind: Mapped[RotationPass] = mapped_column("pass", String(8), default="Build")
    loop: Mapped[int] = mapped_column(Integer, default=1)

    rotation: Mapped[Rotation] = relationship(back_populates="segments")
