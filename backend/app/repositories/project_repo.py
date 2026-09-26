"""``ProjectRepository``: projects as aggregate roots, loaded with every child.

``get``/``list`` eager-load the children with ``selectinload`` (``full=True``), so read models
and services can walk a project without lazy loads. Children are reached through the project
(``project.milestones``, ``project.tasks`` ...) or the ``get_*`` lookups below.
"""

import builtins
import datetime as dt
from collections.abc import Mapping
from typing import Final

from sqlalchemy import case, delete, func, select
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.orm.interfaces import LoaderOption

from app.core.errors import NotFound
from app.repositories.models import (
    CharterItem,
    CheckIn,
    Checklist,
    ChecklistItem,
    Domain,
    HourOverride,
    Milestone,
    Project,
    ProjectBauDayHours,
    ReadinessItem,
    Risk,
    ScopeChange,
    Task,
)

FULL_PROJECT: Final[tuple[LoaderOption, ...]] = (
    selectinload(Project.charter_items),
    selectinload(Project.milestones).selectinload(Milestone.tasks),
    selectinload(Project.tasks),
    selectinload(Project.hour_overrides),
    selectinload(Project.bau_day_hours),
    selectinload(Project.scope_changes),
    selectinload(Project.checkins),
    selectinload(Project.readiness_items),
    selectinload(Project.risks),
    selectinload(Project.checklists).selectinload(Checklist.items),
)
"""Loader options that fetch a project with all of its children."""

_DOMAIN_ORDER = case((Project.domain == "pc", 0), else_=1)


def _after(current: object) -> int:
    """The next ``sort_order`` after the current maximum (0 for an empty collection)."""
    return int(current) + 1 if isinstance(current, int) else 0


class ProjectRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    # ------------------------------------------------------------------ projects
    def get(self, project_id: str, *, full: bool = True) -> Project | None:
        if not full:
            return self.session.get(Project, project_id)
        stmt = select(Project).where(Project.id == project_id).options(*FULL_PROJECT)
        return self.session.scalars(stmt).first()

    def require(self, project_id: str, *, full: bool = True) -> Project:
        """The project, or ``NotFound`` (404)."""
        project = self.get(project_id, full=full)
        if project is None:
            raise NotFound("No project with that id.")
        return project

    def list(self, domain: Domain | None = None, *, full: bool = True) -> builtins.list[Project]:
        """PC first, then FI; each domain by ``sort_order`` then creation."""
        stmt = select(Project)
        if domain is not None:
            stmt = stmt.where(Project.domain == domain)
        stmt = stmt.order_by(_DOMAIN_ORDER, Project.sort_order, Project.created_at, Project.id)
        if full:
            stmt = stmt.options(*FULL_PROJECT)
        return list(self.session.scalars(stmt))

    def ids(self) -> set[str]:
        return set(self.session.scalars(select(Project.id)))

    def exists(self, project_id: str) -> bool:
        return self.session.get(Project, project_id) is not None

    def count(self, domain: Domain | None = None) -> int:
        stmt = select(func.count()).select_from(Project)
        if domain is not None:
            stmt = stmt.where(Project.domain == domain)
        return int(self.session.scalar(stmt) or 0)

    def add(self, project: Project) -> Project:
        self.session.add(project)
        return project

    def delete(self, project: Project) -> None:
        """Delete a project; the database cascades its children (and clears references)."""
        self.session.delete(project)

    def next_sort_order(self, domain: Domain) -> int:
        stmt = select(func.max(Project.sort_order)).where(Project.domain == domain)
        current = self.session.scalar(stmt)
        return 0 if current is None else int(current) + 1

    # ------------------------------------------------------------------ children
    def get_task(self, task_id: str) -> Task | None:
        return self.session.get(Task, task_id)

    def get_milestone(self, milestone_id: str) -> Milestone | None:
        stmt = (
            select(Milestone)
            .where(Milestone.id == milestone_id)
            .options(selectinload(Milestone.tasks))
        )
        return self.session.scalars(stmt).first()

    def explicit_milestones_named(self, project_id: str, name: str) -> builtins.list[Milestone]:
        """The project's explicit (data-only) milestones called ``name``."""
        stmt = (
            select(Milestone)
            .where(
                Milestone.project_id == project_id,
                Milestone.horizon == "explicit",
                Milestone.name == name,
            )
            .order_by(Milestone.sort_order, Milestone.id)
        )
        return builtins.list(self.session.scalars(stmt))

    def get_charter_item(self, item_id: str) -> CharterItem | None:
        return self.session.get(CharterItem, item_id)

    def get_readiness_item(self, item_id: str) -> ReadinessItem | None:
        return self.session.get(ReadinessItem, item_id)

    def get_checkin(self, checkin_id: str) -> CheckIn | None:
        return self.session.get(CheckIn, checkin_id)

    def get_scope_change(self, scope_id: str) -> ScopeChange | None:
        return self.session.get(ScopeChange, scope_id)

    def get_risk(self, risk_id: str) -> Risk | None:
        return self.session.get(Risk, risk_id)

    def get_checklist_item(self, item_id: str) -> ChecklistItem | None:
        return self.session.get(ChecklistItem, item_id)

    def next_charter_order(self, project_id: str, list_name: str) -> int:
        """The ``sort_order`` for a new item at the end of one charter list."""
        stmt = select(func.max(CharterItem.sort_order)).where(
            CharterItem.project_id == project_id, CharterItem.list_name == list_name
        )
        return _after(self.session.scalar(stmt))

    def next_milestone_order(self, project_id: str, horizon: str) -> int:
        """The ``sort_order`` for a new milestone at the end of its horizon."""
        stmt = select(func.max(Milestone.sort_order)).where(
            Milestone.project_id == project_id, Milestone.horizon == horizon
        )
        return _after(self.session.scalar(stmt))

    def next_task_order(self, milestone_id: str) -> int:
        """The ``sort_order`` for a new task at the end of a milestone."""
        stmt = select(func.max(Task.sort_order)).where(Task.milestone_id == milestone_id)
        return _after(self.session.scalar(stmt))

    def next_readiness_order(self, project_id: str) -> int:
        """The ``sort_order`` for a new readiness item at the end of the project's list."""
        stmt = select(func.max(ReadinessItem.sort_order)).where(
            ReadinessItem.project_id == project_id
        )
        return _after(self.session.scalar(stmt))

    def tasks_by_id(self, task_ids: builtins.list[str]) -> dict[str, Task]:
        if not task_ids:
            return {}
        rows = self.session.scalars(select(Task).where(Task.id.in_(task_ids)))
        return {t.id: t for t in rows}

    # ------------------------------------------------------------------ hour rules
    def set_override(self, project_id: str, day: dt.date, hours: float) -> HourOverride:
        row = self.session.get(HourOverride, (project_id, day))
        if row is None:
            row = HourOverride(project_id=project_id, date=day, hours=hours)
            self.session.add(row)
        else:
            row.hours = hours
        return row

    def clear_override(self, project_id: str, day: dt.date) -> bool:
        """Remove the override; ``False`` if there was none."""
        row = self.session.get(HourOverride, (project_id, day))
        if row is None:
            return False
        self.session.delete(row)
        self.session.flush()
        return True

    def set_bau_day_hours(self, project_id: str, rules: Mapping[str, float]) -> None:
        """Replace every BAU-day rule of the project with ``{routine_id: hours}``."""
        self.session.execute(
            delete(ProjectBauDayHours).where(ProjectBauDayHours.project_id == project_id)
        )
        for routine_id, hours in rules.items():
            self.session.add(
                ProjectBauDayHours(project_id=project_id, routine_id=routine_id, hours=hours)
            )

    # ------------------------------------------------------------------ history
    def snapshots(self, project_id: str) -> builtins.list[CheckIn]:
        """The project's check-ins, oldest first (the Workspace history scrubber)."""
        stmt = (
            select(CheckIn)
            .where(CheckIn.project_id == project_id)
            .order_by(CheckIn.date, CheckIn.created_at, CheckIn.id)
        )
        return list(self.session.scalars(stmt))
