"""BAU routines, their runs and checklist ticks, and their checklist items."""

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Query, status

from app.api.deps import ClockDep, UowFactoryDep
from app.api.endpoints._params import (
    FromQuery,
    IsoDate,
    RoutineChecklistItemId,
    RoutineId,
    ToQuery,
)
from app.api.errors import error_responses
from app.schemas.base import OrderPut
from app.schemas.mutation import (
    MutationOut,
    RoutineChecklistItemMutationOut,
    RoutineMutationOut,
    RoutineRunMutationOut,
)
from app.schemas.routine import (
    OccurrenceOut,
    RoutineChecklistItemCreate,
    RoutineChecklistItemPatch,
    RoutineCreate,
    RoutineOut,
    RoutinePatch,
    RunPut,
    TickPut,
)
from app.services import routines as service

router = APIRouter(tags=["routines"])


@router.get("/routines", summary="All routines with derived fields", responses=error_responses(409))
def list_routines(uow_factory: UowFactoryDep, clock: ClockDep) -> list[RoutineOut]:
    return service.list_routines(uow_factory, clock)


@router.post(
    "/routines",
    status_code=status.HTTP_201_CREATED,
    summary="Create a routine (monthly, BD5, 1h, Manual, blank name)",
    responses=error_responses(409, 422),
)
def create_routine(
    body: RoutineCreate, uow_factory: UowFactoryDep, clock: ClockDep
) -> RoutineMutationOut:
    return service.create_routine(uow_factory, clock, body)


@router.get(
    "/routines/{routineId}",
    summary="One routine",
    responses=error_responses(404, 409, 422),
)
def get_routine(routine_id: RoutineId, uow_factory: UowFactoryDep, clock: ClockDep) -> RoutineOut:
    return service.get_routine(uow_factory, clock, routine_id)


@router.patch(
    "/routines/{routineId}",
    summary="Edit a routine's name, rule, hours or handover stage",
    responses=error_responses(404, 409, 422),
)
def update_routine(
    routine_id: RoutineId, body: RoutinePatch, uow_factory: UowFactoryDep, clock: ClockDep
) -> RoutineMutationOut:
    """Only the sent fields change; ``null`` clears ``transitionNote`` or ``projectId``.
    Renaming keeps a curated ``short``; a blank short, or one that mirrored the old name,
    follows the new name. ``hours`` is clamped to the capacity. A stage change logs a feed
    item (data only)."""
    return service.update_routine(uow_factory, clock, routine_id, body)


@router.delete(
    "/routines/{routineId}",
    summary="Remove a routine",
    responses=error_responses(404, 409, 422),
)
def delete_routine(
    routine_id: RoutineId, uow_factory: UowFactoryDep, clock: ClockDep
) -> MutationOut:
    return service.delete_routine(uow_factory, clock, routine_id)


@router.get(
    "/routines/{routineId}/occurrences",
    summary="Occurrences in a range, or the next few after a date",
    responses=error_responses(404, 409, 422),
)
def list_routine_occurrences(
    routine_id: RoutineId,
    from_: FromQuery = None,
    to: ToQuery = None,
    after: Annotated[dt.date | None, Query(description="List occurrences after this day.")] = None,
    limit: Annotated[int, Query(ge=1, le=366)] = 3,
    *,
    uow_factory: UowFactoryDep,
    clock: ClockDep,
) -> list[OccurrenceOut]:
    """``from``/``to`` (both, at most three years) lists every occurrence in the range;
    otherwise the next ``limit`` occurrences on or after ``after`` (default today)."""
    return service.list_occurrences(
        uow_factory, clock, routine_id, frm=from_, to=to, after=after, limit=limit
    )


@router.put(
    "/routines/{routineId}/runs/{iso}",
    summary="Mark one occurrence complete or not",
    responses=error_responses(404, 409, 422),
)
def put_routine_run(
    routine_id: RoutineId,
    iso: IsoDate,
    body: RunPut,
    uow_factory: UowFactoryDep,
    clock: ClockDep,
) -> RoutineRunMutationOut:
    """Any occurrence may be marked (recorded as completed today). 422 ``NOT_AN_OCCURRENCE``
    when the routine does not run on ``iso``."""
    return service.put_run(uow_factory, clock, routine_id, iso, body.completed)


@router.put(
    "/routines/{routineId}/runs/{iso}/items",
    summary="Tick or untick every checklist item of one run",
    responses=error_responses(404, 409, 422),
)
def put_run_ticks(
    routine_id: RoutineId,
    iso: IsoDate,
    body: TickPut,
    uow_factory: UowFactoryDep,
    clock: ClockDep,
) -> RoutineRunMutationOut:
    """Today's run only (409 ``RUN_NOT_EDITABLE`` otherwise; 422 ``NOT_AN_OCCURRENCE``)."""
    return service.put_all_ticks(uow_factory, clock, routine_id, iso, body.done)


@router.put(
    "/routines/{routineId}/runs/{iso}/items/{itemId}",
    summary="Tick or untick one checklist item of one run",
    responses=error_responses(404, 409, 422),
)
def put_run_tick(
    routine_id: RoutineId,
    iso: IsoDate,
    item_id: RoutineChecklistItemId,
    body: TickPut,
    uow_factory: UowFactoryDep,
    clock: ClockDep,
) -> RoutineRunMutationOut:
    """Today's run only (409 ``RUN_NOT_EDITABLE`` otherwise; 422 ``NOT_AN_OCCURRENCE``)."""
    return service.put_tick(uow_factory, clock, routine_id, iso, item_id, body.done)


@router.post(
    "/routines/{routineId}/checklist-items",
    status_code=status.HTTP_201_CREATED,
    summary="Add a checklist item to a routine",
    responses=error_responses(404, 409, 422),
)
def create_routine_checklist_item(
    routine_id: RoutineId,
    body: RoutineChecklistItemCreate,
    uow_factory: UowFactoryDep,
    clock: ClockDep,
) -> RoutineChecklistItemMutationOut:
    return service.create_checklist_item(uow_factory, clock, routine_id, body)


@router.put(
    "/routines/{routineId}/checklist-items/order",
    summary="Reorder a routine's checklist",
    responses=error_responses(404, 409, 422),
)
def reorder_routine_checklist_items(
    routine_id: RoutineId, body: OrderPut, uow_factory: UowFactoryDep, clock: ClockDep
) -> RoutineMutationOut:
    """``ids`` must be every item id of the routine, each once (422 otherwise)."""
    return service.reorder_checklist_items(uow_factory, clock, routine_id, body)


@router.patch(
    "/routine-checklist-items/{itemId}",
    summary="Rename a routine checklist item",
    responses=error_responses(404, 409, 422),
)
def update_routine_checklist_item(
    item_id: RoutineChecklistItemId,
    body: RoutineChecklistItemPatch,
    uow_factory: UowFactoryDep,
    clock: ClockDep,
) -> RoutineChecklistItemMutationOut:
    return service.update_checklist_item(uow_factory, clock, item_id, body)


@router.delete(
    "/routine-checklist-items/{itemId}",
    summary="Remove a routine checklist item (and its ticks)",
    responses=error_responses(404, 409, 422),
)
def delete_routine_checklist_item(
    item_id: RoutineChecklistItemId, uow_factory: UowFactoryDep, clock: ClockDep
) -> MutationOut:
    return service.delete_checklist_item(uow_factory, clock, item_id)
