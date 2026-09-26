"""``RoutineRepository``: routines with their checklist items, runs and checklist ticks.

Runs and ticks are keyed by (routine, occurrence date). A tick row existing means the item is
ticked for that occurrence; a run row with ``completed_on`` means the occurrence was marked
complete.
"""

import builtins
import datetime as dt
from collections.abc import Iterable, Sequence

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, selectinload

from remi.core.errors import NotFound
from remi.repositories.models import Routine, RoutineChecklistItem, RoutineRun, RoutineRunTick


class RoutineRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    # ------------------------------------------------------------------ routines
    def list(self) -> builtins.list[Routine]:
        """Every routine with its checklist items, by ``sort_order`` then creation."""
        stmt = (
            select(Routine)
            .options(selectinload(Routine.checklist_items))
            .order_by(Routine.sort_order, Routine.created_at, Routine.id)
        )
        return list(self.session.scalars(stmt))

    def get(self, routine_id: str) -> Routine | None:
        stmt = (
            select(Routine)
            .where(Routine.id == routine_id)
            .options(selectinload(Routine.checklist_items))
        )
        return self.session.scalars(stmt).first()

    def require(self, routine_id: str) -> Routine:
        routine = self.get(routine_id)
        if routine is None:
            raise NotFound("No routine with that id.")
        return routine

    def exists(self, routine_id: str) -> bool:
        return self.session.get(Routine, routine_id) is not None

    def count(self) -> int:
        return int(self.session.scalar(select(func.count()).select_from(Routine)) or 0)

    def add(self, routine: Routine) -> Routine:
        self.session.add(routine)
        return routine

    def delete(self, routine: Routine) -> None:
        self.session.delete(routine)

    def next_sort_order(self) -> int:
        current = self.session.scalar(select(func.max(Routine.sort_order)))
        return 0 if current is None else int(current) + 1

    # ------------------------------------------------------------------ checklist items
    def get_checklist_item(self, item_id: str) -> RoutineChecklistItem | None:
        return self.session.get(RoutineChecklistItem, item_id)

    def next_item_sort_order(self, routine_id: str) -> int:
        stmt = select(func.max(RoutineChecklistItem.sort_order)).where(
            RoutineChecklistItem.routine_id == routine_id
        )
        current = self.session.scalar(stmt)
        return 0 if current is None else int(current) + 1

    def checklist_items(self, routine_id: str) -> builtins.list[RoutineChecklistItem]:
        """A routine's checklist items in checklist order."""
        stmt = (
            select(RoutineChecklistItem)
            .where(RoutineChecklistItem.routine_id == routine_id)
            .order_by(RoutineChecklistItem.sort_order, RoutineChecklistItem.id)
        )
        return list(self.session.scalars(stmt))

    def add_checklist_item(self, item: RoutineChecklistItem) -> RoutineChecklistItem:
        self.session.add(item)
        return item

    def delete_checklist_item(self, item: RoutineChecklistItem) -> None:
        """Remove an item; its ticks go with it (``ON DELETE CASCADE``)."""
        self.session.execute(delete(RoutineRunTick).where(RoutineRunTick.item_id == item.id))
        self.session.delete(item)

    # ------------------------------------------------------------------ runs and ticks
    def runs_between(
        self, frm: dt.date, to: dt.date, routine_id: str | None = None
    ) -> builtins.list[RoutineRun]:
        stmt = select(RoutineRun).where(
            RoutineRun.occurrence_date >= frm, RoutineRun.occurrence_date <= to
        )
        if routine_id is not None:
            stmt = stmt.where(RoutineRun.routine_id == routine_id)
        return list(
            self.session.scalars(stmt.order_by(RoutineRun.occurrence_date, RoutineRun.routine_id))
        )

    def ticks_between(
        self, frm: dt.date, to: dt.date, routine_id: str | None = None
    ) -> builtins.list[RoutineRunTick]:
        stmt = select(RoutineRunTick).where(
            RoutineRunTick.occurrence_date >= frm, RoutineRunTick.occurrence_date <= to
        )
        if routine_id is not None:
            stmt = stmt.where(RoutineRunTick.routine_id == routine_id)
        return list(
            self.session.scalars(
                stmt.order_by(RoutineRunTick.occurrence_date, RoutineRunTick.done_at)
            )
        )

    def get_run(self, routine_id: str, day: dt.date) -> RoutineRun | None:
        return self.session.get(RoutineRun, (routine_id, day))

    def upsert_run(
        self,
        routine_id: str,
        day: dt.date,
        completed_on: dt.date | None,
        completed_at: dt.datetime | None,
    ) -> RoutineRun:
        """Mark an occurrence complete (``completed_on`` set) or not (``None``)."""
        run = self.get_run(routine_id, day)
        if run is None:
            run = RoutineRun(
                routine_id=routine_id,
                occurrence_date=day,
                completed_on=completed_on,
                completed_at=completed_at,
            )
            self.session.add(run)
        else:
            run.completed_on = completed_on
            run.completed_at = completed_at
        return run

    def set_tick(
        self, routine_id: str, day: dt.date, item_id: str, done: bool, at: dt.datetime
    ) -> bool:
        """Tick or untick one item. Returns ``True`` when something changed."""
        tick = self.session.get(RoutineRunTick, (routine_id, day, item_id))
        if done and tick is None:
            self.session.add(
                RoutineRunTick(
                    routine_id=routine_id, occurrence_date=day, item_id=item_id, done_at=at
                )
            )
            return True
        if not done and tick is not None:
            self.session.delete(tick)
            return True
        return False

    def set_all_ticks(
        self, routine_id: str, day: dt.date, item_ids: Iterable[str], done: bool, at: dt.datetime
    ) -> int:
        """Tick or untick every listed item. Returns how many changed."""
        return sum(1 for item_id in item_ids if self.set_tick(routine_id, day, item_id, done, at))

    def ticked_item_ids(self, routine_id: str, day: dt.date) -> builtins.list[str]:
        stmt = select(RoutineRunTick.item_id).where(
            RoutineRunTick.routine_id == routine_id, RoutineRunTick.occurrence_date == day
        )
        return list(self.session.scalars(stmt))

    def delete_runs(self, routine_ids: Sequence[str]) -> None:
        if routine_ids:
            self.session.execute(delete(RoutineRun).where(RoutineRun.routine_id.in_(routine_ids)))
