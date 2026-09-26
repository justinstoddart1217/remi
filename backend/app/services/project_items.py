"""A project's inline lists: charter items, milestones, tasks and readiness items.

Each change is one ``run_mutation`` and returns the new plan plus the entity as the plan shows
it. The Workspace commits a field on Enter or blur, so the same rules as the prototype apply:

- **Blank text deletes** (``PATCH`` with an empty or all-space ``text``/``name``): the item is
  removed (a milestone with its tasks) and the response's ``entity`` is the item as it was.
  ``DELETE`` does the same without a body.
- **Adds append**: a new item goes to the end of its list (a blank text is fine while editing).
  Milestones default to today + 9 business days (Now) or + 20 (Next), from Settings; tasks to
  1h and only under a Now milestone (409 otherwise).
- **Dates snap forward** to a business day; ``null`` clears an optional due date.
- **Done** sets ``doneOn`` to today's business date; un-ticking clears it.
- **Milestone sync** (the prototype's ``msSync``): renaming, re-dating or removing a Now/Next
  milestone does the same to the project's explicit milestones with its old name, so no
  phantom twin is left in ``derived.milestones`` or the next milestone.
- **Reorder** takes every id of the list exactly once (422 otherwise).

None of these move a forecast, so ``movements`` is empty.
"""

import datetime as dt
from collections.abc import Callable, Sequence
from typing import Final

from app.core import ids
from app.core.clock import Clock
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.uow import UnitOfWorkFactory, ref
from app.repositories import models as orm
from app.repositories.project_repo import ProjectRepository
from app.repositories.registry import PROJECTS, SETTINGS
from app.schemas.base import OrderPut
from app.schemas.mutation import (
    CharterItemMutationOut,
    MilestoneMutationOut,
    MutationOut,
    ProjectMutationOut,
    ReadinessItemMutationOut,
    TaskMutationOut,
)
from app.schemas.project import (
    CharterItemCreate,
    CharterItemOut,
    CharterItemPatch,
    CharterList,
    MilestoneCreate,
    MilestoneOut,
    MilestonePatch,
    ProjectOut,
    ReadinessItemCreate,
    ReadinessItemOut,
    ReadinessItemPatch,
    TaskCreate,
    TaskOut,
    TaskPatch,
)
from app.services.mutations import Mutation, MutationScope, run_mutation
from app.services.projects import check_day, clean

NEW_NOW_NAME: Final = "Added from an update"
"""A Now milestone created because a check-in added a task to a project with none."""


type _Ordered = orm.CharterItem | orm.Milestone | orm.Task | orm.ReadinessItem


def _reorder(rows: Sequence[_Ordered], order: OrderPut) -> None:
    """``sort_order`` from ``order.ids``, which must name every row exactly once."""
    by_id = {r.id: r for r in rows}
    if len(order.ids) != len(set(order.ids)) or set(order.ids) != set(by_id):
        msg = "Send every id of the list exactly once."
        raise ValidationFailed(msg, field="ids")
    for i, item_id in enumerate(order.ids):
        by_id[item_id].sort_order = i


def _snap(m: MutationScope, day: dt.date, field: str) -> dt.date:
    """``day`` rolled forward to a business day (the calendar widens if it has to)."""
    check_day(day, field)
    return m.require_before().cal.next_bd(day)


def _set_done(
    row: orm.Task | orm.Milestone | orm.ReadinessItem, done: bool, today: dt.date
) -> None:
    if done and not row.done:
        row.done = True
        row.done_on = today
    elif not done:
        row.done = False
        row.done_on = None


def _repo(m: MutationScope) -> ProjectRepository:
    return m.uow.repo(PROJECTS)


def _mutate[T](
    uow_factory: UnitOfWorkFactory, clock: Clock, fn: Callable[[MutationScope], T]
) -> Mutation[T]:
    return run_mutation(uow_factory, clock, fn, "checkin")


# ---------------------------------------------------------------------------- lookups in the plan
def _charter_of(project: ProjectOut) -> list[CharterItemOut]:
    c = project.charter
    return [*c.success, *c.in_scope, *c.out_scope, *c.constraints]


def charter_item_out(project: ProjectOut, item_id: str) -> CharterItemOut:
    found = next((c for c in _charter_of(project) if c.id == item_id), None)
    if found is None:
        raise NotFound("No charter item with that id.")
    return found


def milestone_out(project: ProjectOut, milestone_id: str) -> MilestoneOut:
    found = next((ms for ms in project.milestones if ms.id == milestone_id), None)
    if found is None:
        raise NotFound("No milestone with that id.")
    return found


def task_out(project: ProjectOut, task_id: str) -> TaskOut:
    tasks = [t for ms in project.milestones for t in ms.tasks]
    found = next((t for t in tasks if t.id == task_id), None)
    if found is None:
        raise NotFound("No task with that id.")
    return found


def readiness_out(project: ProjectOut, item_id: str) -> ReadinessItemOut:
    found = next((r for r in project.readiness_items if r.id == item_id), None)
    if found is None:
        raise NotFound("No readiness item with that id.")
    return found


def _charter_row_out(row: orm.CharterItem) -> CharterItemOut:
    return CharterItemOut(
        id=row.id,
        project_id=row.project_id,
        list=row.list_name,
        text=row.text,
        sort_order=row.sort_order,
    )


def _task_row_out(row: orm.Task) -> TaskOut:
    return TaskOut(
        id=row.id,
        project_id=row.project_id,
        milestone_id=row.milestone_id or "",
        text=row.text,
        hours=row.hours,
        due_date=row.due_date,
        sort_order=row.sort_order,
        done=row.done,
        done_on=row.done_on,
    )


def _milestone_row_out(row: orm.Milestone) -> MilestoneOut:
    tasks = sorted(row.tasks, key=lambda t: t.sort_order) if row.horizon == "now" else []
    return MilestoneOut(
        id=row.id,
        project_id=row.project_id,
        horizon=row.horizon,
        name=row.name,
        due_date=row.due_date,
        sort_order=row.sort_order,
        done=row.done,
        done_on=row.done_on,
        tasks=[_task_row_out(t) for t in tasks],
    )


def _readiness_row_out(row: orm.ReadinessItem) -> ReadinessItemOut:
    return ReadinessItemOut(
        id=row.id,
        project_id=row.project_id,
        text=row.text,
        done=row.done,
        due_date=row.due_date,
        done_on=row.done_on,
        sort_order=row.sort_order,
    )


# ---------------------------------------------------------------------------- charter
def create_charter_item(
    uow_factory: UnitOfWorkFactory,
    clock: Clock,
    project_id: str,
    charter_list: CharterList,
    body: CharterItemCreate,
) -> CharterItemMutationOut:
    def change(m: MutationScope) -> str:
        repo = _repo(m)
        repo.require(project_id, full=False)
        row = orm.CharterItem(
            id=ids.new_id(),
            project_id=project_id,
            list_name=charter_list,
            text=clean(body.text),
            sort_order=repo.next_charter_order(project_id, charter_list),
        )
        m.uow.session.add(row)
        m.uow.record(
            "charter_item.created",
            [ref("project", project_id), ref("charter_item", row.id)],
            {"list": charter_list, "text": row.text},
        )
        return row.id

    result = _mutate(uow_factory, clock, change)
    entity = charter_item_out(result.project(project_id), result.value)
    return result.with_entity(CharterItemMutationOut, entity)


def reorder_charter_items(
    uow_factory: UnitOfWorkFactory,
    clock: Clock,
    project_id: str,
    charter_list: CharterList,
    body: OrderPut,
) -> ProjectMutationOut:
    def change(m: MutationScope) -> None:
        project = _repo(m).require(project_id)
        _reorder([c for c in project.charter_items if c.list_name == charter_list], body)
        m.uow.record(
            "charter.reordered",
            [ref("project", project_id)],
            {"list": charter_list, "ids": body.ids},
        )

    result = _mutate(uow_factory, clock, change)
    return result.with_entity(ProjectMutationOut, result.project(project_id))


def _require_charter_item(m: MutationScope, item_id: str) -> orm.CharterItem:
    row = _repo(m).get_charter_item(item_id)
    if row is None:
        raise NotFound("No charter item with that id.")
    return row


def update_charter_item(
    uow_factory: UnitOfWorkFactory, clock: Clock, item_id: str, body: CharterItemPatch
) -> CharterItemMutationOut:
    text = clean(body.text)

    def change(m: MutationScope) -> tuple[str, CharterItemOut | None]:
        row = _require_charter_item(m, item_id)
        refs = [ref("project", row.project_id), ref("charter_item", item_id)]
        if not text:
            removed = _charter_row_out(row)
            m.uow.session.delete(row)
            m.uow.record("charter_item.deleted", refs, {"blank": True})
            return row.project_id, removed
        row.text = text
        m.uow.record("charter_item.updated", refs, {"text": text})
        return row.project_id, None

    result = _mutate(uow_factory, clock, change)
    project_id, removed = result.value
    entity = removed or charter_item_out(result.project(project_id), item_id)
    return result.with_entity(CharterItemMutationOut, entity)


def delete_charter_item(uow_factory: UnitOfWorkFactory, clock: Clock, item_id: str) -> MutationOut:
    def change(m: MutationScope) -> None:
        row = _require_charter_item(m, item_id)
        refs = [ref("project", row.project_id), ref("charter_item", item_id)]
        m.uow.session.delete(row)
        m.uow.record("charter_item.deleted", refs, {})

    return _mutate(uow_factory, clock, change).out()


# ---------------------------------------------------------------------------- milestones
def create_milestone(
    uow_factory: UnitOfWorkFactory, clock: Clock, project_id: str, body: MilestoneCreate
) -> MilestoneMutationOut:
    def change(m: MutationScope) -> str:
        repo = _repo(m)
        repo.require(project_id, full=False)
        if body.due_date is not None:
            due = _snap(m, body.due_date, "dueDate")
        else:
            settings = m.uow.repo(SETTINGS).get()
            offset = (
                settings.now_ms_offset_bd if body.horizon == "now" else settings.next_ms_offset_bd
            )
            due = m.require_before().cal.add_bd(m.today, offset)
        row = orm.Milestone(
            id=ids.new_id(),
            project_id=project_id,
            horizon=body.horizon,
            name=clean(body.name),
            due_date=due,
            sort_order=repo.next_milestone_order(project_id, body.horizon),
            done=False,
            done_on=None,
        )
        m.uow.session.add(row)
        m.uow.record(
            "milestone.created",
            [ref("project", project_id), ref("milestone", row.id)],
            {"horizon": body.horizon, "name": row.name, "dueDate": due.isoformat()},
        )
        return row.id

    result = _mutate(uow_factory, clock, change)
    entity = milestone_out(result.project(project_id), result.value)
    return result.with_entity(MilestoneMutationOut, entity)


def reorder_milestones(
    uow_factory: UnitOfWorkFactory, clock: Clock, project_id: str, body: OrderPut
) -> ProjectMutationOut:
    """``ids`` name every milestone of the horizons they touch (Now, Next or both), each
    exactly once; each horizon is numbered on its own."""

    def change(m: MutationScope) -> None:
        project = _repo(m).require(project_id)
        by_id = {ms.id: ms for ms in project.milestones}
        unknown = [i for i in body.ids if i not in by_id]
        if unknown or len(body.ids) != len(set(body.ids)):
            msg = "Send every id of the list exactly once."
            raise ValidationFailed(msg, field="ids")
        horizons = {by_id[i].horizon for i in body.ids}
        for horizon in sorted(horizons):
            group = [ms for ms in project.milestones if ms.horizon == horizon]
            order = OrderPut(ids=[i for i in body.ids if by_id[i].horizon == horizon])
            _reorder(group, order)
        m.uow.record("milestones.reordered", [ref("project", project_id)], {"ids": body.ids})

    result = _mutate(uow_factory, clock, change)
    return result.with_entity(ProjectMutationOut, result.project(project_id))


def _require_milestone(m: MutationScope, milestone_id: str) -> orm.Milestone:
    row = _repo(m).get_milestone(milestone_id)
    if row is None:
        raise NotFound("No milestone with that id.")
    return row


def _twins(m: MutationScope, row: orm.Milestone) -> list[orm.Milestone]:
    """The explicit milestones a Now/Next milestone's rename, re-date or removal carries to:
    the project's explicit milestones with its current (old) name (the prototype's ``msSync``,
    which matches by name). An explicit or unnamed milestone has none."""
    if row.horizon == "explicit" or not row.name:
        return []
    return _repo(m).explicit_milestones_named(row.project_id, row.name)


def _synced(twins: Sequence[orm.Milestone]) -> dict[str, list[str]] | None:
    """The event's effects: the twins a change carried to (none when there are none)."""
    return {"syncedIds": [t.id for t in twins]} if twins else None


def _delete_milestone(m: MutationScope, row: orm.Milestone, payload: dict[str, object]) -> None:
    """Remove a milestone (its tasks go with it) and its explicit twins, in one event."""
    twins = _twins(m, row)
    refs = [ref("project", row.project_id), ref("milestone", row.id)]
    refs += [ref("milestone", t.id) for t in twins]
    for twin in twins:
        m.uow.session.delete(twin)
    m.uow.session.delete(row)
    m.uow.record("milestone.deleted", refs, payload, effects=_synced(twins))


def update_milestone(
    uow_factory: UnitOfWorkFactory, clock: Clock, milestone_id: str, body: MilestonePatch
) -> MilestoneMutationOut:
    sent = body.model_fields_set
    if body.due_date is not None:
        check_day(body.due_date, "dueDate")

    def change(m: MutationScope) -> tuple[str, MilestoneOut | None]:
        row = _require_milestone(m, milestone_id)
        if "name" in sent and not clean(body.name or ""):
            removed = _milestone_row_out(row)
            _delete_milestone(m, row, {"blank": True})
            return row.project_id, removed
        synced = "name" in sent or "due_date" in sent
        twins = _twins(m, row) if synced else []
        if "name" in sent:
            row.name = clean(body.name or "")
            for twin in twins:
                twin.name = row.name
        if "due_date" in sent:
            row.due_date = _snap(m, body.due_date, "dueDate") if body.due_date is not None else None
            for twin in twins:
                twin.due_date = row.due_date
        if "done" in sent and body.done is not None:
            _set_done(row, body.done, m.today)
        refs = [ref("project", row.project_id), ref("milestone", milestone_id)]
        refs += [ref("milestone", t.id) for t in twins]
        payload = body.model_dump(mode="json", exclude_unset=True)
        m.uow.record("milestone.updated", refs, payload, effects=_synced(twins))
        return row.project_id, None

    result = _mutate(uow_factory, clock, change)
    project_id, removed = result.value
    entity = removed or milestone_out(result.project(project_id), milestone_id)
    return result.with_entity(MilestoneMutationOut, entity)


def delete_milestone(
    uow_factory: UnitOfWorkFactory, clock: Clock, milestone_id: str
) -> MutationOut:
    def change(m: MutationScope) -> None:
        _delete_milestone(m, _require_milestone(m, milestone_id), {})

    return _mutate(uow_factory, clock, change).out()


def now_milestone_for(m: MutationScope, project: orm.Project, today: dt.date) -> orm.Milestone:
    """The project's first Now milestone; one named "Added from an update" (due today + the
    Now offset) is created when it has none (the prototype's check-in rule)."""
    nows = sorted(
        (ms for ms in project.milestones if ms.horizon == "now"), key=lambda x: x.sort_order
    )
    if nows:
        return nows[0]
    settings = m.uow.repo(SETTINGS).get()
    row = orm.Milestone(
        id=ids.new_id(),
        project_id=project.id,
        horizon="now",
        name=NEW_NOW_NAME,
        due_date=m.require_before().cal.add_bd(today, settings.now_ms_offset_bd),
        sort_order=_repo(m).next_milestone_order(project.id, "now"),
        done=False,
        done_on=None,
    )
    project.milestones.append(row)
    return row


# ---------------------------------------------------------------------------- tasks
def add_task(
    m: MutationScope,
    milestone: orm.Milestone,
    text: str,
    hours: float,
    due: dt.date | None = None,
) -> orm.Task:
    """Append a task to a Now milestone (the row is added to the session)."""
    order = max((t.sort_order for t in milestone.tasks), default=-1) + 1
    task = orm.Task(
        id=ids.new_id(),
        project_id=milestone.project_id,
        text=text,
        hours=hours,
        due_date=due,
        sort_order=order,
        done=False,
        done_on=None,
    )
    milestone.tasks.append(task)
    m.uow.session.add(task)
    return task


def create_task(
    uow_factory: UnitOfWorkFactory, clock: Clock, milestone_id: str, body: TaskCreate
) -> TaskMutationOut:
    def change(m: MutationScope) -> tuple[str, str]:
        milestone = _require_milestone(m, milestone_id)
        if milestone.horizon != "now":
            msg = "Tasks can only be added to a Now milestone."
            raise Conflict(msg)
        due = _snap(m, body.due_date, "dueDate") if body.due_date is not None else None
        task = add_task(m, milestone, clean(body.text), body.hours, due)
        m.uow.record(
            "task.created",
            [
                ref("project", milestone.project_id),
                ref("milestone", milestone_id),
                ref("task", task.id),
            ],
            {"text": task.text, "hours": task.hours},
        )
        return milestone.project_id, task.id

    result = _mutate(uow_factory, clock, change)
    project_id, task_id = result.value
    return result.with_entity(TaskMutationOut, task_out(result.project(project_id), task_id))


def reorder_tasks(
    uow_factory: UnitOfWorkFactory, clock: Clock, milestone_id: str, body: OrderPut
) -> MilestoneMutationOut:
    def change(m: MutationScope) -> str:
        milestone = _require_milestone(m, milestone_id)
        _reorder(milestone.tasks, body)
        m.uow.record(
            "tasks.reordered",
            [ref("project", milestone.project_id), ref("milestone", milestone_id)],
            {"ids": body.ids},
        )
        return milestone.project_id

    result = _mutate(uow_factory, clock, change)
    entity = milestone_out(result.project(result.value), milestone_id)
    return result.with_entity(MilestoneMutationOut, entity)


def _require_task(m: MutationScope, task_id: str) -> orm.Task:
    row = _repo(m).get_task(task_id)
    if row is None:
        raise NotFound("No task with that id.")
    return row


def update_task(
    uow_factory: UnitOfWorkFactory, clock: Clock, task_id: str, body: TaskPatch
) -> TaskMutationOut:
    sent = body.model_fields_set
    for name, value in (("hours", body.hours), ("done", body.done)):
        if name in sent and value is None:
            msg = "This cannot be cleared."
            raise ValidationFailed(msg, field=name)
    if body.due_date is not None:
        check_day(body.due_date, "dueDate")

    def change(m: MutationScope) -> tuple[str, TaskOut | None]:
        row = _require_task(m, task_id)
        refs = [ref("project", row.project_id), ref("task", task_id)]
        if "text" in sent and not clean(body.text or ""):
            removed = _task_row_out(row)
            m.uow.session.delete(row)
            m.uow.record("task.deleted", refs, {"blank": True})
            return row.project_id, removed
        if "text" in sent:
            row.text = clean(body.text or "")
        if body.hours is not None:
            row.hours = body.hours
        if body.done is not None:
            _set_done(row, body.done, m.today)
        if "due_date" in sent:
            row.due_date = _snap(m, body.due_date, "dueDate") if body.due_date is not None else None
        m.uow.record("task.updated", refs, body.model_dump(mode="json", exclude_unset=True))
        return row.project_id, None

    result = _mutate(uow_factory, clock, change)
    project_id, removed = result.value
    entity = removed or task_out(result.project(project_id), task_id)
    return result.with_entity(TaskMutationOut, entity)


def delete_task(uow_factory: UnitOfWorkFactory, clock: Clock, task_id: str) -> MutationOut:
    def change(m: MutationScope) -> None:
        row = _require_task(m, task_id)
        refs = [ref("project", row.project_id), ref("task", task_id)]
        m.uow.session.delete(row)
        m.uow.record("task.deleted", refs, {})

    return _mutate(uow_factory, clock, change).out()


# ---------------------------------------------------------------------------- readiness items
def create_readiness_item(
    uow_factory: UnitOfWorkFactory, clock: Clock, project_id: str, body: ReadinessItemCreate
) -> ReadinessItemMutationOut:
    def change(m: MutationScope) -> str:
        repo = _repo(m)
        repo.require(project_id, full=False)
        due = _snap(m, body.due_date, "dueDate") if body.due_date is not None else None
        row = orm.ReadinessItem(
            id=ids.new_id(),
            project_id=project_id,
            text=clean(body.text),
            done=False,
            due_date=due,
            done_on=None,
            sort_order=repo.next_readiness_order(project_id),
        )
        m.uow.session.add(row)
        m.uow.record(
            "readiness_item.created",
            [ref("project", project_id), ref("readiness_item", row.id)],
            {"text": row.text},
        )
        return row.id

    result = _mutate(uow_factory, clock, change)
    entity = readiness_out(result.project(project_id), result.value)
    return result.with_entity(ReadinessItemMutationOut, entity)


def reorder_readiness_items(
    uow_factory: UnitOfWorkFactory, clock: Clock, project_id: str, body: OrderPut
) -> ProjectMutationOut:
    def change(m: MutationScope) -> None:
        project = _repo(m).require(project_id)
        _reorder(project.readiness_items, body)
        m.uow.record("readiness_items.reordered", [ref("project", project_id)], {"ids": body.ids})

    result = _mutate(uow_factory, clock, change)
    return result.with_entity(ProjectMutationOut, result.project(project_id))


def _require_readiness(m: MutationScope, item_id: str) -> orm.ReadinessItem:
    row = _repo(m).get_readiness_item(item_id)
    if row is None:
        raise NotFound("No readiness item with that id.")
    return row


def update_readiness_item(
    uow_factory: UnitOfWorkFactory, clock: Clock, item_id: str, body: ReadinessItemPatch
) -> ReadinessItemMutationOut:
    sent = body.model_fields_set
    if "done" in sent and body.done is None:
        msg = "This cannot be cleared."
        raise ValidationFailed(msg, field="done")
    if body.due_date is not None:
        check_day(body.due_date, "dueDate")

    def change(m: MutationScope) -> tuple[str, ReadinessItemOut | None]:
        row = _require_readiness(m, item_id)
        refs = [ref("project", row.project_id), ref("readiness_item", item_id)]
        if "text" in sent and not clean(body.text or ""):
            removed = _readiness_row_out(row)
            m.uow.session.delete(row)
            m.uow.record("readiness_item.deleted", refs, {"blank": True})
            return row.project_id, removed
        if "text" in sent:
            row.text = clean(body.text or "")
        if body.done is not None:
            _set_done(row, body.done, m.today)
        if "due_date" in sent:
            row.due_date = _snap(m, body.due_date, "dueDate") if body.due_date is not None else None
        m.uow.record(
            "readiness_item.updated", refs, body.model_dump(mode="json", exclude_unset=True)
        )
        return row.project_id, None

    result = _mutate(uow_factory, clock, change)
    project_id, removed = result.value
    entity = removed or readiness_out(result.project(project_id), item_id)
    return result.with_entity(ReadinessItemMutationOut, entity)


def delete_readiness_item(
    uow_factory: UnitOfWorkFactory, clock: Clock, item_id: str
) -> MutationOut:
    def change(m: MutationScope) -> None:
        row = _require_readiness(m, item_id)
        refs = [ref("project", row.project_id), ref("readiness_item", item_id)]
        m.uow.session.delete(row)
        m.uow.record("readiness_item.deleted", refs, {})

    return _mutate(uow_factory, clock, change).out()
