"""Routines (BAU work), their checklist items, and completions keyed by occurrence date.

Deleting a routine cascades its checklist, runs and ticks, its BAU-day-hour rules and aliases;
feed items keep their text (``routine_id`` SET NULL) and ``settings.key_routine_id`` clears.
"""

import datetime as dt
from typing import Final, Literal, get_args

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from remi.repositories.models.base import (
    DOMAINS,
    Base,
    Domain,
    Timestamps,
    UTCDateTime,
    UUIDPk,
    check_in,
    check_range,
)

RoutineKind = Literal["monthly", "weekly", "daily"]
ROUTINE_KINDS: Final = get_args(RoutineKind)

STAGES: Final = ("Manual", "Automating", "Shadowed", "Handed over")
"""``routines.stage`` 0..3."""

_OWNED: Final = "all, delete-orphan"


class Routine(UUIDPk, Timestamps, Base):
    """A recurring piece of BAU work.

    ``bd`` (business day of the month, 1..20) is used when ``kind`` is monthly and ``weekday``
    (1 = Monday .. 5 = Friday) when weekly; both keep their values when the kind changes.
    """

    __tablename__ = "routines"
    __table_args__ = (
        check_in("domain", DOMAINS),
        check_in("kind", ROUTINE_KINDS),
        check_range("bd", 1, 20),
        check_range("weekday", 1, 5),
        check_range("hours", 0, 24),
        check_range("stage", 0, 3),
    )

    domain: Mapped[Domain] = mapped_column(String(2), default="pc")
    name: Mapped[str] = mapped_column(String(200), default="")
    short: Mapped[str] = mapped_column(String(80), default="")
    detail: Mapped[str] = mapped_column(String(200), default="")
    label: Mapped[str | None] = mapped_column(String(200))
    """The curated row label on the Timeline; ``None`` shows ``name``."""

    kind: Mapped[RoutineKind] = mapped_column(String(8), default="monthly")
    bd: Mapped[int] = mapped_column(Integer, default=5)
    weekday: Mapped[int] = mapped_column(Integer, default=2)
    hours: Mapped[float] = mapped_column(Float, default=1.0)

    stage: Mapped[int] = mapped_column(Integer, default=0)
    status_note: Mapped[str] = mapped_column(Text, default="")
    transition_note: Mapped[str | None] = mapped_column(Text)

    project_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="SET NULL"), index=True
    )
    co_tag_with_project: Mapped[bool] = mapped_column(Boolean, default=False)

    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    starts_on: Mapped[dt.date | None] = mapped_column(default=None)
    """The first day the routine runs: the day it was created (``POST /routines``). Runs
    before it are not due, overdue or loaded. ``None``: it has always run (fixtures, and
    routines created before this column existed without a ``routine.created`` event)."""

    checklist_items: Mapped[list["RoutineChecklistItem"]] = relationship(
        back_populates="routine",
        cascade=_OWNED,
        passive_deletes=True,
        order_by="RoutineChecklistItem.sort_order",
    )
    runs: Mapped[list["RoutineRun"]] = relationship(
        back_populates="routine",
        cascade=_OWNED,
        passive_deletes=True,
        order_by="RoutineRun.occurrence_date",
    )
    ticks: Mapped[list["RoutineRunTick"]] = relationship(
        back_populates="routine", cascade=_OWNED, passive_deletes=True
    )


class RoutineChecklistItem(UUIDPk, Base):
    """An item ticked on every run (e.g. one fund of the returns run)."""

    __tablename__ = "routine_checklist_items"

    routine_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("routines.id", ondelete="CASCADE"), index=True
    )
    label: Mapped[str] = mapped_column(String(200), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    routine: Mapped[Routine] = relationship(back_populates="checklist_items")


class RoutineRun(Base):
    """Completion of one occurrence. ``completed_on`` is the business date it was done."""

    __tablename__ = "routine_runs"

    routine_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("routines.id", ondelete="CASCADE"), primary_key=True
    )
    occurrence_date: Mapped[dt.date] = mapped_column(primary_key=True)
    completed_on: Mapped[dt.date | None]
    completed_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime())

    routine: Mapped[Routine] = relationship(back_populates="runs")


class RoutineRunTick(Base):
    """A ticked checklist item for one occurrence. The row existing means "ticked"."""

    __tablename__ = "routine_run_ticks"

    routine_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("routines.id", ondelete="CASCADE"), primary_key=True
    )
    occurrence_date: Mapped[dt.date] = mapped_column(primary_key=True)
    item_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("routine_checklist_items.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    done_at: Mapped[dt.datetime] = mapped_column(UTCDateTime())

    routine: Mapped[Routine] = relationship(back_populates="ticks")
