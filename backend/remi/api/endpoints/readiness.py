"""Readiness items: the FI onboarding list on Transition (decision 10's inline list)."""

from fastapi import APIRouter, status

from remi.api.deps import WiringDep
from remi.api.endpoints._params import ProjectId, ReadinessItemId
from remi.api.errors import error_responses
from remi.schemas.base import OrderPut
from remi.schemas.mutation import MutationOut, ProjectMutationOut, ReadinessItemMutationOut
from remi.schemas.project import ReadinessItemCreate, ReadinessItemPatch
from remi.services import project_items as service

router = APIRouter(tags=["readiness"])


@router.post(
    "/projects/{projectId}/readiness-items",
    status_code=status.HTTP_201_CREATED,
    summary="Add an onboarding readiness item",
    responses=error_responses(404, 409, 422),
)
def create_readiness_item(
    project_id: ProjectId, body: ReadinessItemCreate, wiring: WiringDep
) -> ReadinessItemMutationOut:
    return service.create_readiness_item(wiring.uow_factory, wiring.clock, project_id, body)


@router.put(
    "/projects/{projectId}/readiness-items/order",
    summary="Reorder a project's readiness items",
    responses=error_responses(404, 409, 422),
)
def reorder_readiness_items(
    project_id: ProjectId, body: OrderPut, wiring: WiringDep
) -> ProjectMutationOut:
    return service.reorder_readiness_items(wiring.uow_factory, wiring.clock, project_id, body)


@router.patch(
    "/readiness-items/{itemId}",
    summary="Edit, tick or re-date a readiness item",
    responses=error_responses(404, 409, 422),
)
def update_readiness_item(
    item_id: ReadinessItemId, body: ReadinessItemPatch, wiring: WiringDep
) -> ReadinessItemMutationOut:
    """A blank text removes the item; ``entity`` is then the item as it was."""
    return service.update_readiness_item(wiring.uow_factory, wiring.clock, item_id, body)


@router.delete(
    "/readiness-items/{itemId}",
    summary="Remove a readiness item",
    responses=error_responses(404, 409, 422),
)
def delete_readiness_item(item_id: ReadinessItemId, wiring: WiringDep) -> MutationOut:
    return service.delete_readiness_item(wiring.uow_factory, wiring.clock, item_id)
