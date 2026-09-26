"""BAU routines: create, edit, remove; their runs and checklist ticks; their checklist items.

Every change goes through ``run_mutation`` (one unit of work, one ``remi_events`` row) and
returns the new plan. A change to a routine's rule, stage or domain (or removing it) changes
which days the projects' BAU-day hours apply on, so every forecast is placed again from the
work left it had before the change (``scope.refit_forecasts``): the work left stays and the
forecast follows the new days (ADR-0007, "Routine day moves"). A new routine starts on the day
it is created (``starts_on``): runs before it are not due, overdue or loaded.

Rules the Routines screen relies on (``Routines.dc.html`` and the critique):

- ``POST /routines`` creates a Private Credit routine: monthly on BD5 (Tuesday kept for a
  switch to weekly), 1h, Manual, blank name.
- A rename keeps a curated ``short`` ("Returns" for "Fund & security-level returns"); a short
  that is blank or mirrored the old name follows the new name. A rename clears the curated
  Timeline ``label`` (it shortened the old name) unless the same patch sends one.
- ``hours`` accepts any value from 0 and is clamped to the settings capacity, as the
  prototype's field does on blur (the client turns "1,5" into 1.5 before sending).
- A stage change logs a feed item ``Handover status X → Y.`` (plus `` It drops off your
  plan.`` at stage 3); removing a named routine logs ``Routine removed from the plan.``.
- A run can be marked on any occurrence; checklist ticks only on today's run
  (409 ``RUN_NOT_EDITABLE``). A date the routine does not run on is 422 ``NOT_AN_OCCURRENCE``.
"""

import datetime as dt
from collections.abc import Callable, Sequence
from typing import Any, Final

from app.core.clock import Clock
from app.core.errors import DomainError, NotFound, ValidationFailed
from app.core.uow import UnitOfWork, UnitOfWorkFactory, ref
from app.repositories import models as orm
from app.repositories.models.routine import STAGES
from app.repositories.registry import FEED, PROJECTS, ROUTINES, SETTINGS
from app.schemas.base import OrderPut
from app.schemas.mutation import (
    MovementCause,
    MutationOut,
    RoutineChecklistItemMutationOut,
    RoutineMutationOut,
    RoutineRunMutationOut,
)
from app.schemas.routine import (
    OccurrenceOut,
    RoutineChecklistItemCreate,
    RoutineChecklistItemOut,
    RoutineChecklistItemPatch,
    RoutineCreate,
    RoutineOut,
    RoutinePatch,
    RoutineRunOut,
)
from app.services.adapters import routine_of
from app.services.calendar import check_within_horizon, read_span
from app.services.engine.model import RoutineDef
from app.services.engine.routines import next_occurrences, occurs
from app.services.mutations import MutationScope, run_mutation
from app.services.views import (
    PlanState,
    check_range,
    get_plan_state,
    run_out,
    run_rows,
    with_plan_state,
)

CAUSE: Final[MovementCause] = "routine"
UNTITLED: Final = "Routine"
"""Feed title for a routine without a name (the prototype's ``r.name || 'Routine'``)."""

DEFAULTS: Final[dict[str, Any]] = {
    "kind": "monthly",
    "bd": 5,
    "weekday": 2,
    "hours": 1.0,
    "stage": 0,
}
"""A new routine: monthly on BD5 (Tuesday for weekly), 1h, Manual."""

NOT_NULLABLE: Final = frozenset(
    {
        "name",
        "short",
        "detail",
        "domain",
        "kind",
        "bd",
        "weekday",
        "hours",
        "stage",
        "status_note",
        "co_tag_with_project",
        "sort_order",
    }
)
"""``PATCH`` fields that may change but not be cleared (``null`` is a 422)."""

_CAMEL: Final = {name: (field.alias or name) for name, field in RoutinePatch.model_fields.items()}

_RESHAPES_DAYS: Final = frozenset({"domain", "kind", "bd", "weekday", "stage"})
"""Changed fields (as ``_apply_patch`` names them) that move the days a routine counts on."""


def _camel(name: str) -> str:
    return _CAMEL.get(name, name)


class NotAnOccurrence(DomainError):
    def __init__(self) -> None:
        super().__init__("NOT_AN_OCCURRENCE", "This routine does not run on that day.", "iso", 422)


class RunNotEditable(DomainError):
    def __init__(self) -> None:
        super().__init__("RUN_NOT_EDITABLE", "Only today's run can be ticked off.", "iso", 409)


# ---------------------------------------------------------------------------- reads
def list_routines(uow_factory: UnitOfWorkFactory, clock: Clock) -> list[RoutineOut]:
    """``GET /routines``: every routine as the plan shows it (409 before setup)."""
    return list(get_plan_state(uow_factory, clock).out.routines)


def get_routine(uow_factory: UnitOfWorkFactory, clock: Clock, routine_id: str) -> RoutineOut:
    """``GET /routines/{id}`` (404 for an unknown id, 409 before setup)."""
    found = get_plan_state(uow_factory, clock).routine_out(routine_id)
    if found is None:
        raise NotFound("No routine with that id.", "routineId")
    return found


def _occurrence_out(state: PlanState, day: dt.date) -> OccurrenceOut:
    ctx, cal = state.ctx, state.cal
    return OccurrenceOut(
        iso=day,
        bdm=cal.bdm(day) or 0,
        today=day == ctx.today,
        after_move=day >= ctx.move,
        bd_away=cal.bd_diff(ctx.today, day),
    )


def list_occurrences(
    uow_factory: UnitOfWorkFactory,
    clock: Clock,
    routine_id: str,
    *,
    frm: dt.date | None,
    to: dt.date | None,
    after: dt.date | None,
    limit: int,
) -> list[OccurrenceOut]:
    """``GET /routines/{id}/occurrences``.

    With ``from`` and ``to``: every occurrence in the range (at most three years). Otherwise
    the next ``limit`` occurrences on or after ``after`` (default today), stage ignored, like
    ``derived.next``. Days must be within ten years of today (422 ``OUT_OF_RANGE``)."""
    today = clock.today()
    if (frm is None) != (to is None):
        field = "to" if to is None else "from"
        raise ValidationFailed("Send both from and to, or neither.", field)

    def routine(state: PlanState) -> RoutineDef:
        rd = state.ctx.routine(routine_id)
        if rd is None:
            raise NotFound("No routine with that id.", "routineId")
        return rd

    if frm is not None and to is not None:
        check_range(frm, to)
        check_within_horizon(frm, today, "day", field="from")
        check_within_horizon(to, today, "day", field="to")

        def in_range(state: PlanState) -> list[OccurrenceOut]:
            rd = routine(state)
            return [
                _occurrence_out(state, d)
                for d in state.cal.bds(frm, to)
                if occurs(rd, d, state.cal)
            ]

        return with_plan_state(uow_factory, clock, in_range, days=[frm, to])

    start = after if after is not None else today
    check_within_horizon(start, today, "day", field="after")
    # Cover two years past the start (clipped to the read horizon) so a long list does not
    # stop short at the edge of the cached calendar.
    reach = min(start + dt.timedelta(days=2 * 366), read_span(today).end)

    def upcoming(state: PlanState) -> list[OccurrenceOut]:
        rd = routine(state)
        return [
            _occurrence_out(state, o.day) for o in next_occurrences(rd, state.ctx, start, limit)
        ]

    return with_plan_state(uow_factory, clock, upcoming, days=[start, reach])


# ---------------------------------------------------------------------------- helpers
def _feed(
    uow: UnitOfWork, today: dt.date, *, routine_id: str | None, title: str, body: str
) -> None:
    """A routine feed item (data only: decision 8 renders no feed)."""
    uow.repo(FEED).add(
        orm.FeedEvent(
            project_id=None,
            routine_id=routine_id,
            day=today,
            kind="edit",
            title=title,
            body=body,
            delta="BAU",
            tone="quiet",
        )
    )


def _capacity(uow: UnitOfWork) -> float:
    return float(uow.repo(SETTINGS).get().capacity_hours_per_day)


def _clamp_hours(hours: float, capacity: float) -> float:
    return max(0.0, min(float(hours), capacity))


def _item_out(item: orm.RoutineChecklistItem) -> RoutineChecklistItemOut:
    return RoutineChecklistItemOut(
        id=item.id, routine_id=item.routine_id, label=item.label, sort_order=item.sort_order
    )


def _require_item(uow: UnitOfWork, item_id: str) -> orm.RoutineChecklistItem:
    item = uow.repo(ROUTINES).get_checklist_item(item_id)
    if item is None:
        raise NotFound("No checklist item with that id.", "itemId")
    return item


def _routine_mutation(
    uow_factory: UnitOfWorkFactory,
    clock: Clock,
    routine_id: str,
    fn: Callable[[MutationScope], object],
) -> RoutineMutationOut:
    result = run_mutation(uow_factory, clock, fn, CAUSE)
    return result.with_entity(RoutineMutationOut, result.routine(routine_id))


# ---------------------------------------------------------------------------- routines
def create_routine(
    uow_factory: UnitOfWorkFactory, clock: Clock, body: RoutineCreate
) -> RoutineMutationOut:
    """``POST /routines``: a new routine with the defaults and a blank (or given) name."""
    name = body.name.strip()

    def change(m: MutationScope) -> str:
        m.require_before()
        repo = m.uow.repo(ROUTINES)
        row = repo.add(
            orm.Routine(
                domain=body.domain,
                name=name,
                short=name,
                detail="",
                kind=DEFAULTS["kind"],
                bd=DEFAULTS["bd"],
                weekday=DEFAULTS["weekday"],
                hours=_clamp_hours(DEFAULTS["hours"], _capacity(m.uow)),
                stage=DEFAULTS["stage"],
                status_note="",
                transition_note=None,
                project_id=None,
                co_tag_with_project=False,
                sort_order=repo.next_sort_order(),
                starts_on=m.today,
            )
        )
        m.uow.session.flush()
        m.uow.record(
            "routine.created",
            [ref("routine", row.id)],
            {"domain": body.domain, "name": name},
        )
        return row.id

    result = run_mutation(uow_factory, clock, change, CAUSE)
    return result.with_entity(RoutineMutationOut, result.routine(result.value))


def _apply_patch(uow: UnitOfWork, row: orm.Routine, body: RoutinePatch) -> dict[str, Any]:
    """Apply the sent fields to ``row``; returns ``{field: [before, after]}`` for changes."""
    fields = body.model_fields_set
    for name in fields & NOT_NULLABLE:
        if getattr(body, name) is None:
            raise ValidationFailed("This field cannot be cleared.", _camel(name))

    before: dict[str, Any] = {
        "name": row.name,
        "short": row.short,
        "label": row.label,
        "detail": row.detail,
        "domain": row.domain,
        "kind": row.kind,
        "bd": row.bd,
        "weekday": row.weekday,
        "hours": row.hours,
        "stage": row.stage,
        "status_note": row.status_note,
        "transition_note": row.transition_note,
        "project_id": row.project_id,
        "co_tag_with_project": row.co_tag_with_project,
        "sort_order": row.sort_order,
    }

    if "name" in fields and body.name is not None:
        new_name = body.name.strip()
        old_name, old_short = row.name, row.short
        row.name = new_name
        if "short" not in fields and (not old_short.strip() or old_short == old_name):
            row.short = new_name
        if new_name != old_name and "label" not in fields:
            row.label = None
    if "short" in fields and body.short is not None:
        short = body.short.strip()
        row.short = short if short else row.name
    if "label" in fields:
        row.label = (body.label or "").strip() or None
    if "detail" in fields and body.detail is not None:
        row.detail = body.detail.strip()
    if "domain" in fields and body.domain is not None:
        row.domain = body.domain
    if "kind" in fields and body.kind is not None:
        row.kind = body.kind
    if "bd" in fields and body.bd is not None:
        row.bd = body.bd
    if "weekday" in fields and body.weekday is not None:
        row.weekday = body.weekday
    if "hours" in fields and body.hours is not None:
        row.hours = _clamp_hours(body.hours, _capacity(uow))
    if "stage" in fields and body.stage is not None:
        row.stage = body.stage
    if "status_note" in fields and body.status_note is not None:
        row.status_note = body.status_note.strip()
    if "transition_note" in fields:
        note = (body.transition_note or "").strip()
        row.transition_note = note or None
    if "project_id" in fields:
        if body.project_id is not None and not uow.repo(PROJECTS).exists(body.project_id):
            raise ValidationFailed("No project with that id.", "projectId")
        row.project_id = body.project_id
    if "co_tag_with_project" in fields and body.co_tag_with_project is not None:
        row.co_tag_with_project = body.co_tag_with_project
    if "sort_order" in fields and body.sort_order is not None:
        row.sort_order = body.sort_order

    changed: dict[str, Any] = {}
    for key, old in before.items():
        new = getattr(row, key)
        if new != old:
            changed[_camel(key)] = [old, new]
    return changed


def update_routine(
    uow_factory: UnitOfWorkFactory, clock: Clock, routine_id: str, body: RoutinePatch
) -> RoutineMutationOut:
    """``PATCH /routines/{id}``: only the sent fields change (``null`` clears
    ``transitionNote`` and ``projectId``). One event; a stage change also logs a feed item."""

    def change(m: MutationScope) -> None:
        m.require_before()
        row = m.uow.repo(ROUTINES).require(routine_id)
        old_stage = row.stage
        changed = _apply_patch(m.uow, row, body)
        if _RESHAPES_DAYS & changed.keys():
            m.refit_forecasts()
        stage_moved = row.stage != old_stage
        if stage_moved:
            text = f"Handover status {STAGES[old_stage]} → {STAGES[row.stage]}."
            if row.stage == 3:
                text += " It drops off your plan."
            _feed(m.uow, m.today, routine_id=row.id, title=row.name or UNTITLED, body=text)
        m.uow.record(
            "routine.stage_changed" if stage_moved else "routine.updated",
            [ref("routine", routine_id)],
            body.model_dump(mode="json", exclude_unset=True, by_alias=True),
            effects={"changed": changed},
        )

    return _routine_mutation(uow_factory, clock, routine_id, change)


def delete_routine(uow_factory: UnitOfWorkFactory, clock: Clock, routine_id: str) -> MutationOut:
    """``DELETE /routines/{id}``: the routine, its checklist, runs, ticks, BAU-day hours and
    aliases go; a named routine leaves ``Routine removed from the plan.`` in the feed."""

    def change(m: MutationScope) -> None:
        m.require_before()
        repo = m.uow.repo(ROUTINES)
        row = repo.require(routine_id)
        name = row.name
        if name:
            _feed(
                m.uow,
                m.today,
                routine_id=None,
                title=name,
                body="Routine removed from the plan.",
            )
        repo.delete(row)
        m.refit_forecasts()
        m.uow.record("routine.deleted", [ref("routine", routine_id)], {"name": name})

    return run_mutation(uow_factory, clock, change, CAUSE).out()


# ---------------------------------------------------------------------------- runs and ticks
def _require_occurrence(m: MutationScope, row: orm.Routine, day: dt.date) -> None:
    before = m.require_before()
    if not occurs(routine_of(row), day, before.cal):
        raise NotAnOccurrence


def _run_out(uow: UnitOfWork, row: orm.Routine, day: dt.date) -> RoutineRunOut:
    repo = uow.repo(ROUTINES)
    uow.session.flush()
    items = repo.checklist_items(row.id)
    run = repo.get_run(row.id, day)
    runs = run_rows([run]) if run is not None else []
    return run_out(
        row.id,
        day,
        [i.id for i in items],
        runs[0] if runs else None,
        repo.ticked_item_ids(row.id, day),
    )


def _run_mutation(
    uow_factory: UnitOfWorkFactory,
    clock: Clock,
    day: dt.date,
    fn: Callable[[MutationScope], RoutineRunOut],
) -> RoutineRunMutationOut:
    check_within_horizon(day, clock.today(), "day", field="iso")
    result = run_mutation(uow_factory, clock, fn, CAUSE)
    return result.with_entity(RoutineRunMutationOut, result.value)


def put_run(
    uow_factory: UnitOfWorkFactory,
    clock: Clock,
    routine_id: str,
    day: dt.date,
    completed: bool,
) -> RoutineRunMutationOut:
    """``PUT /routines/{id}/runs/{iso}``: mark any occurrence complete (recorded as done
    today) or not. Ticks are left as they are."""

    def change(m: MutationScope) -> RoutineRunOut:
        repo = m.uow.repo(ROUTINES)
        row = repo.require(routine_id)
        _require_occurrence(m, row, day)
        run = repo.get_run(routine_id, day)
        was_completed = run is not None and run.completed_on is not None
        if completed and not was_completed:
            repo.upsert_run(routine_id, day, m.today, m.clock.now())
        elif not completed and was_completed:
            repo.upsert_run(routine_id, day, None, None)
        m.uow.record(
            "routine.run_completed" if completed else "routine.run_reopened",
            [ref("routine", routine_id)],
            {"iso": day.isoformat(), "completed": completed},
        )
        return _run_out(m.uow, row, day)

    return _run_mutation(uow_factory, clock, day, change)


def _require_today(m: MutationScope, day: dt.date) -> None:
    if day != m.today:
        raise RunNotEditable


def put_tick(
    uow_factory: UnitOfWorkFactory,
    clock: Clock,
    routine_id: str,
    day: dt.date,
    item_id: str,
    done: bool,
) -> RoutineRunMutationOut:
    """``PUT /routines/{id}/runs/{iso}/items/{itemId}``: tick or untick one item of today's
    run."""

    def change(m: MutationScope) -> RoutineRunOut:
        repo = m.uow.repo(ROUTINES)
        row = repo.require(routine_id)
        item = _require_item(m.uow, item_id)
        if item.routine_id != routine_id:
            raise NotFound("No checklist item with that id on this routine.", "itemId")
        _require_occurrence(m, row, day)
        _require_today(m, day)
        repo.set_tick(routine_id, day, item_id, done, m.clock.now())
        m.uow.record(
            "routine.tick_set",
            [ref("routine", routine_id), ref("routine_checklist_item", item_id)],
            {"iso": day.isoformat(), "itemId": item_id, "done": done},
        )
        return _run_out(m.uow, row, day)

    return _run_mutation(uow_factory, clock, day, change)


def put_all_ticks(
    uow_factory: UnitOfWorkFactory,
    clock: Clock,
    routine_id: str,
    day: dt.date,
    done: bool,
) -> RoutineRunMutationOut:
    """``PUT /routines/{id}/runs/{iso}/items``: tick or untick every item of today's run."""

    def change(m: MutationScope) -> RoutineRunOut:
        repo = m.uow.repo(ROUTINES)
        row = repo.require(routine_id)
        _require_occurrence(m, row, day)
        _require_today(m, day)
        ids = [i.id for i in repo.checklist_items(routine_id)]
        changed = repo.set_all_ticks(routine_id, day, ids, done, m.clock.now())
        m.uow.record(
            "routine.ticks_set",
            [ref("routine", routine_id)],
            {"iso": day.isoformat(), "done": done},
            effects={"changed": changed},
        )
        return _run_out(m.uow, row, day)

    return _run_mutation(uow_factory, clock, day, change)


# ---------------------------------------------------------------------------- checklist items
def create_checklist_item(
    uow_factory: UnitOfWorkFactory,
    clock: Clock,
    routine_id: str,
    body: RoutineChecklistItemCreate,
) -> RoutineChecklistItemMutationOut:
    """``POST /routines/{id}/checklist-items``: append an item (blank allowed: the inline list
    adds a blank row and focuses it)."""
    label = body.label.strip()

    def change(m: MutationScope) -> RoutineChecklistItemOut:
        m.require_before()
        repo = m.uow.repo(ROUTINES)
        repo.require(routine_id)
        item = repo.add_checklist_item(
            orm.RoutineChecklistItem(
                routine_id=routine_id, label=label, sort_order=repo.next_item_sort_order(routine_id)
            )
        )
        m.uow.session.flush()
        m.uow.record(
            "routine.checklist_item_added",
            [ref("routine", routine_id), ref("routine_checklist_item", item.id)],
            {"label": label},
        )
        return _item_out(item)

    result = run_mutation(uow_factory, clock, change, CAUSE)
    return result.with_entity(RoutineChecklistItemMutationOut, result.value)


def update_checklist_item(
    uow_factory: UnitOfWorkFactory,
    clock: Clock,
    item_id: str,
    body: RoutineChecklistItemPatch,
) -> RoutineChecklistItemMutationOut:
    """``PATCH /routine-checklist-items/{id}``: rename (a blank label is a 422; the client
    deletes blanked items)."""
    label = body.label.strip()
    if not label:
        raise ValidationFailed("A checklist item needs a label.", "label")

    def change(m: MutationScope) -> RoutineChecklistItemOut:
        m.require_before()
        item = _require_item(m.uow, item_id)
        item.label = label
        m.uow.session.flush()
        m.uow.record(
            "routine.checklist_item_renamed",
            [ref("routine", item.routine_id), ref("routine_checklist_item", item_id)],
            {"label": label},
        )
        return _item_out(item)

    result = run_mutation(uow_factory, clock, change, CAUSE)
    return result.with_entity(RoutineChecklistItemMutationOut, result.value)


def delete_checklist_item(
    uow_factory: UnitOfWorkFactory, clock: Clock, item_id: str
) -> MutationOut:
    """``DELETE /routine-checklist-items/{id}``: the item and its ticks."""

    def change(m: MutationScope) -> None:
        m.require_before()
        item = _require_item(m.uow, item_id)
        routine_id = item.routine_id
        m.uow.repo(ROUTINES).delete_checklist_item(item)
        m.uow.record(
            "routine.checklist_item_removed",
            [ref("routine", routine_id), ref("routine_checklist_item", item_id)],
            {},
        )

    return run_mutation(uow_factory, clock, change, CAUSE).out()


def _check_order(ids: Sequence[str], current: Sequence[str]) -> None:
    if len(set(ids)) != len(ids) or set(ids) != set(current):
        raise ValidationFailed("Send every checklist item id of this routine exactly once.", "ids")


def reorder_checklist_items(
    uow_factory: UnitOfWorkFactory, clock: Clock, routine_id: str, body: OrderPut
) -> RoutineMutationOut:
    """``PUT /routines/{id}/checklist-items/order``: every item id, in the new order."""

    def change(m: MutationScope) -> None:
        m.require_before()
        repo = m.uow.repo(ROUTINES)
        repo.require(routine_id)
        items = repo.checklist_items(routine_id)
        _check_order(body.ids, [i.id for i in items])
        by_id = {i.id: i for i in items}
        for order, item_id in enumerate(body.ids):
            by_id[item_id].sort_order = order
        m.uow.record(
            "routine.checklist_reordered", [ref("routine", routine_id)], {"ids": list(body.ids)}
        )

    return _routine_mutation(uow_factory, clock, routine_id, change)
