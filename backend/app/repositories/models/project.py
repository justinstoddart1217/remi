"""Projects and every child row. All children ``ON DELETE CASCADE`` from their project.

Deleting a project also clears ``routines.project_id`` and ``settings.key_project_id``
(``SET NULL``) and removes its feed items and aliases (``CASCADE``, defined on those tables).
Relationships use ``passive_deletes=True`` so SQLite's foreign keys do the deleting.
"""

import datetime as dt
from typing import Final, Literal, get_args

from sqlalchemy import Boolean, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.repositories.models.base import (
    DOMAINS,
    Base,
    CreatedAt,
    Domain,
    JSONDict,
    JSONList,
    Timestamps,
    UUIDPk,
    check_in,
    check_range,
)

CharterList = Literal["success", "inScope", "outScope", "constraints"]
MilestoneHorizon = Literal["now", "next", "explicit"]
CheckInSource = Literal["ai", "simple", "form", "system"]
CHARTER_LISTS: Final = get_args(CharterList)
MILESTONE_HORIZONS: Final = get_args(MilestoneHorizon)
CHECKIN_SOURCES: Final = get_args(CheckInSource)

PHASES: Final = ("Define", "Plan", "Run", "Close")
"""``projects.phase`` 0..3 (data only; the design has no phase stepper)."""

_OWNED: Final = "all, delete-orphan"


def _project_fk() -> Mapped[str]:
    return mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), index=True)


class Project(UUIDPk, Timestamps, Base):
    """A PC or FI project. ``forecast_date`` NULL means the project is still in Define.

    ``unplaced_hours`` is work that did not fit before the calendar ran out; it counts as
    landing after the move.
    """

    __tablename__ = "projects"
    __table_args__ = (
        check_in("domain", DOMAINS),
        check_range("rate_hours_per_day", 0, 24),
        check_range("rate_after_move", 0, 24),
        check_range("baseline_hours", 0, None),
        check_range("unplaced_hours", 0, None),
        check_range("confidence", 1, 5, nullable=True),
        check_range("readiness", 0, 1, nullable=True),
        check_range("phase", 0, 3),
        Index("ix_projects_domain_sort_order", "domain", "sort_order"),
    )

    domain: Mapped[Domain] = mapped_column(String(2))
    name: Mapped[str] = mapped_column(String(200))
    short: Mapped[str] = mapped_column(String(80), default="")
    goal: Mapped[str] = mapped_column(Text, default="")
    why_now: Mapped[str] = mapped_column(Text, default="")
    later_intent: Mapped[str] = mapped_column(Text, default="")
    end_name: Mapped[str] = mapped_column(String(80), default="Done")

    start_date: Mapped[dt.date]
    target_date: Mapped[dt.date]
    target_label: Mapped[str | None] = mapped_column(String(80))
    """Fuzzy display override (e.g. "Late Mar 2027"); cleared when the target moves."""
    forecast_date: Mapped[dt.date | None]
    prev_forecast_date: Mapped[dt.date | None]
    """The forecast before the last slip (drives the ghost bar)."""

    rate_hours_per_day: Mapped[float] = mapped_column(Float, default=0.0)
    rate_after_move: Mapped[float] = mapped_column(Float, default=0.0)
    baseline_hours: Mapped[float] = mapped_column(Float, default=0.0)
    unplaced_hours: Mapped[float] = mapped_column(Float, default=0.0)

    confidence: Mapped[int | None] = mapped_column(Integer)
    last_checkin_date: Mapped[dt.date | None]
    blocker: Mapped[str | None] = mapped_column(Text)
    readiness: Mapped[float | None] = mapped_column(Float)
    after_day_one_note: Mapped[str | None] = mapped_column(Text)

    # Data only (not rendered by the design)
    phase: Mapped[int] = mapped_column(Integer, default=0)
    exit_routes: Mapped[JSONList | None]
    """Ordered, at most 2 of "Finish" | "Automate" | "Hand over" | "Stop" (PC only)."""

    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    charter_items: Mapped[list["CharterItem"]] = relationship(
        back_populates="project",
        cascade=_OWNED,
        passive_deletes=True,
        order_by="CharterItem.sort_order",
    )
    milestones: Mapped[list["Milestone"]] = relationship(
        back_populates="project",
        cascade=_OWNED,
        passive_deletes=True,
        order_by="Milestone.sort_order",
    )
    tasks: Mapped[list["Task"]] = relationship(
        back_populates="project",
        cascade=_OWNED,
        passive_deletes=True,
        order_by="Task.sort_order",
    )
    hour_overrides: Mapped[list["HourOverride"]] = relationship(
        back_populates="project",
        cascade=_OWNED,
        passive_deletes=True,
        order_by="HourOverride.date",
    )
    bau_day_hours: Mapped[list["ProjectBauDayHours"]] = relationship(
        back_populates="project", cascade=_OWNED, passive_deletes=True
    )
    scope_changes: Mapped[list["ScopeChange"]] = relationship(
        back_populates="project",
        cascade=_OWNED,
        passive_deletes=True,
        order_by="[ScopeChange.date, ScopeChange.created_at]",
    )
    checkins: Mapped[list["CheckIn"]] = relationship(
        back_populates="project",
        cascade=_OWNED,
        passive_deletes=True,
        order_by="[CheckIn.date, CheckIn.created_at]",
    )
    readiness_items: Mapped[list["ReadinessItem"]] = relationship(
        back_populates="project",
        cascade=_OWNED,
        passive_deletes=True,
        order_by="ReadinessItem.sort_order",
    )
    risks: Mapped[list["Risk"]] = relationship(
        back_populates="project",
        cascade=_OWNED,
        passive_deletes=True,
        order_by="Risk.sort_order",
    )
    checklists: Mapped[list["Checklist"]] = relationship(
        back_populates="project",
        cascade=_OWNED,
        passive_deletes=True,
        order_by="Checklist.sort_order",
    )


class CharterItem(UUIDPk, Base):
    """One line of a charter list. The Python attribute is ``list_name`` (column ``list``)."""

    __tablename__ = "charter_items"
    __table_args__ = (check_in("list", CHARTER_LISTS),)

    project_id: Mapped[str] = _project_fk()
    list_name: Mapped[CharterList] = mapped_column("list", String(16))
    text: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    project: Mapped[Project] = relationship(back_populates="charter_items")


class Milestone(UUIDPk, Base):
    """A milestone. ``done_on`` is the business date it was marked done."""

    __tablename__ = "milestones"
    __table_args__ = (check_in("horizon", MILESTONE_HORIZONS),)

    project_id: Mapped[str] = _project_fk()
    horizon: Mapped[MilestoneHorizon] = mapped_column(String(8), default="explicit")
    name: Mapped[str] = mapped_column(String(200))
    due_date: Mapped[dt.date | None]
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    done_on: Mapped[dt.date | None]

    project: Mapped[Project] = relationship(back_populates="milestones")
    # Deleting a milestone deletes its tasks (DB CASCADE); a task may also have no milestone,
    # so this side is "all" without delete-orphan.
    tasks: Mapped[list["Task"]] = relationship(
        back_populates="milestone",
        cascade="all",
        passive_deletes=True,
        order_by="Task.sort_order",
    )


class Task(UUIDPk, Base):
    """A task. ``due_date`` NULL falls back to the milestone's due date."""

    __tablename__ = "tasks"
    __table_args__ = (check_range("hours", 0, None),)

    project_id: Mapped[str] = _project_fk()
    milestone_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("milestones.id", ondelete="CASCADE"), index=True
    )
    text: Mapped[str] = mapped_column(Text, default="")
    hours: Mapped[float] = mapped_column(Float, default=1.0)
    due_date: Mapped[dt.date | None]
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    done_on: Mapped[dt.date | None]

    project: Mapped[Project] = relationship(back_populates="tasks")
    milestone: Mapped[Milestone | None] = relationship(back_populates="tasks")


class HourOverride(Base):
    """Focus hours for one project on one day (0 is an explicit zero)."""

    __tablename__ = "hour_overrides"
    __table_args__ = (check_range("hours", 0, 24),)

    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
    )
    date: Mapped[dt.date] = mapped_column(primary_key=True)
    hours: Mapped[float] = mapped_column(Float)

    project: Mapped[Project] = relationship(back_populates="hour_overrides")


class ProjectBauDayHours(Base):
    """On days routine R counts, project P gets ``hours`` (generalises BD3/BD8 hours).

    Precedence in ``day_hours``: override > on/after the move -> ``rate_after_move`` >
    min over matching routine days > ``rate_hours_per_day``.
    """

    __tablename__ = "project_bau_day_hours"
    __table_args__ = (check_range("hours", 0, 24),)

    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
    )
    routine_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("routines.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    hours: Mapped[float] = mapped_column(Float)

    project: Mapped[Project] = relationship(back_populates="bau_day_hours")


class ScopeChange(UUIDPk, CreatedAt, Base):
    """Scope added to a project, with the forecast slip it caused."""

    __tablename__ = "scope_changes"

    project_id: Mapped[str] = _project_fk()
    checkin_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("checkins.id", ondelete="SET NULL"), index=True
    )
    date: Mapped[dt.date]
    what: Mapped[str] = mapped_column(Text, default="")
    hours: Mapped[float] = mapped_column(Float)
    slip_bd: Mapped[int] = mapped_column(Integer, default=0)
    from_forecast: Mapped[dt.date | None]
    to_forecast: Mapped[dt.date | None]

    project: Mapped[Project] = relationship(back_populates="scope_changes")


class CheckIn(UUIDPk, CreatedAt, Base):
    """One project's check-in: the accepted changes plus a snapshot of the plan at the time.

    ``forecast_date``/``target_date`` are the values after the check-in applied. ``snapshot``
    holds the rest of the plan state for the history scrubber, e.g.
    ``{"target": iso, "forecast": iso | None, "milestones": [{"milestoneId", "name", "date"}],
    "rateHoursPerDay": float, "rateAfterMove": float, "workLeft": float}``.
    Check-ins applied together share ``batch_id`` (the ``remi_events.id`` of the apply).
    """

    __tablename__ = "checkins"
    __table_args__ = (
        check_in("source", CHECKIN_SOURCES),
        check_range("confidence", 1, 5, nullable=True),
    )

    project_id: Mapped[str] = _project_fk()
    batch_id: Mapped[str | None] = mapped_column(String(36), index=True)
    parse_id: Mapped[str | None] = mapped_column(String(64))
    date: Mapped[dt.date]
    note: Mapped[str] = mapped_column(Text, default="")
    forecast_date: Mapped[dt.date | None]
    target_date: Mapped[dt.date | None]
    confidence: Mapped[int | None] = mapped_column(Integer)
    blockers: Mapped[str | None] = mapped_column(Text)
    raw_text: Mapped[str | None] = mapped_column(Text)
    source: Mapped[CheckInSource] = mapped_column(String(8), default="system")
    changes: Mapped[JSONList] = mapped_column(default=list)
    done_task_ids: Mapped[JSONList] = mapped_column(default=list)
    snapshot: Mapped[JSONDict] = mapped_column(default=dict)

    project: Mapped[Project] = relationship(back_populates="checkins")


class ReadinessItem(UUIDPk, Base):
    """An FI onboarding item (shown on Transition)."""

    __tablename__ = "readiness_items"

    project_id: Mapped[str] = _project_fk()
    text: Mapped[str] = mapped_column(Text, default="")
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    due_date: Mapped[dt.date | None]
    done_on: Mapped[dt.date | None]
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    project: Mapped[Project] = relationship(back_populates="readiness_items")


class Risk(UUIDPk, Base):
    """A premortem risk and its mitigation (data only)."""

    __tablename__ = "risks"

    project_id: Mapped[str] = _project_fk()
    risk: Mapped[str] = mapped_column(Text, default="")
    mitigation: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    project: Mapped[Project] = relationship(back_populates="risks")


class Checklist(UUIDPk, Base):
    """A project checklist such as "Handover checklist" (data only)."""

    __tablename__ = "checklists"

    project_id: Mapped[str] = _project_fk()
    title: Mapped[str] = mapped_column(String(200), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    project: Mapped[Project] = relationship(back_populates="checklists")
    items: Mapped[list["ChecklistItem"]] = relationship(
        back_populates="checklist",
        cascade=_OWNED,
        passive_deletes=True,
        order_by="ChecklistItem.sort_order",
    )


class ChecklistItem(UUIDPk, Base):
    __tablename__ = "checklist_items"

    checklist_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("checklists.id", ondelete="CASCADE"), index=True
    )
    text: Mapped[str] = mapped_column(Text, default="")
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    done_on: Mapped[dt.date | None]
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    checklist: Mapped[Checklist] = relationship(back_populates="items")
