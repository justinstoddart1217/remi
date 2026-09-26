"""Charter list items (success measures, in scope, out of scope, constraints)."""

from typing import Annotated

from fastapi import APIRouter, Path, status

from remi.api.deps import WiringDep
from remi.api.endpoints._params import CharterItemId, ProjectId
from remi.api.errors import error_responses
from remi.schemas.base import OrderPut
from remi.schemas.mutation import CharterItemMutationOut, MutationOut, ProjectMutationOut
from remi.schemas.project import CharterItemCreate, CharterItemPatch, CharterList
from remi.services import project_items as service

router = APIRouter(tags=["charter"])

CharterListPath = Annotated[CharterList, Path(alias="list", description="Which charter list.")]


@router.post(
    "/projects/{projectId}/charter/{list}",
    status_code=status.HTTP_201_CREATED,
    summary="Append a charter item",
    responses=error_responses(404, 409, 422),
)
def create_charter_item(
    project_id: ProjectId,
    charter_list: CharterListPath,
    body: CharterItemCreate,
    wiring: WiringDep,
) -> CharterItemMutationOut:
    return service.create_charter_item(
        wiring.uow_factory, wiring.clock, project_id, charter_list, body
    )


@router.put(
    "/projects/{projectId}/charter/{list}/order",
    summary="Reorder one charter list",
    responses=error_responses(404, 409, 422),
)
def reorder_charter_items(
    project_id: ProjectId, charter_list: CharterListPath, body: OrderPut, wiring: WiringDep
) -> ProjectMutationOut:
    """``ids`` must name every item of the list exactly once (422 otherwise)."""
    return service.reorder_charter_items(
        wiring.uow_factory, wiring.clock, project_id, charter_list, body
    )


@router.patch(
    "/charter-items/{itemId}",
    summary="Edit a charter item's text",
    responses=error_responses(404, 409, 422),
)
def update_charter_item(
    item_id: CharterItemId, body: CharterItemPatch, wiring: WiringDep
) -> CharterItemMutationOut:
    """A blank text removes the item; ``entity`` is then the item as it was."""
    return service.update_charter_item(wiring.uow_factory, wiring.clock, item_id, body)


@router.delete(
    "/charter-items/{itemId}",
    summary="Remove a charter item",
    responses=error_responses(404, 409, 422),
)
def delete_charter_item(item_id: CharterItemId, wiring: WiringDep) -> MutationOut:
    return service.delete_charter_item(wiring.uow_factory, wiring.clock, item_id)
