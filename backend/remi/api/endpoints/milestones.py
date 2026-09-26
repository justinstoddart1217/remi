"""Now and Next milestones."""

from fastapi import APIRouter, status

from remi.api.deps import WiringDep
from remi.api.endpoints._params import MilestoneId, ProjectId
from remi.api.errors import error_responses
from remi.schemas.base import OrderPut
from remi.schemas.mutation import MilestoneMutationOut, MutationOut, ProjectMutationOut
from remi.schemas.project import MilestoneCreate, MilestonePatch
from remi.services import project_items as service

router = APIRouter(tags=["milestones"])


@router.post(
    "/projects/{projectId}/milestones",
    status_code=status.HTTP_201_CREATED,
    summary="Add a Now or Next milestone",
    responses=error_responses(404, 409, 422),
)
def create_milestone(
    project_id: ProjectId, body: MilestoneCreate, wiring: WiringDep
) -> MilestoneMutationOut:
    return service.create_milestone(wiring.uow_factory, wiring.clock, project_id, body)


@router.put(
    "/projects/{projectId}/milestones/order",
    summary="Reorder a project's milestones",
    responses=error_responses(404, 409, 422),
)
def reorder_milestones(
    project_id: ProjectId, body: OrderPut, wiring: WiringDep
) -> ProjectMutationOut:
    """``ids`` must name every milestone of each horizon they touch (Now, Next or both)
    exactly once; each horizon is numbered on its own."""
    return service.reorder_milestones(wiring.uow_factory, wiring.clock, project_id, body)


@router.patch(
    "/milestones/{milestoneId}",
    summary="Rename, re-date or tick a milestone",
    responses=error_responses(404, 409, 422),
)
def update_milestone(
    milestone_id: MilestoneId, body: MilestonePatch, wiring: WiringDep
) -> MilestoneMutationOut:
    """A blank name removes the milestone and its tasks; ``entity`` is then the milestone as
    it was. ``dueDate`` snaps forward to a business day; ``done`` sets ``doneOn`` to today."""
    return service.update_milestone(wiring.uow_factory, wiring.clock, milestone_id, body)


@router.delete(
    "/milestones/{milestoneId}",
    summary="Remove a milestone and its tasks",
    responses=error_responses(404, 409, 422),
)
def delete_milestone(milestone_id: MilestoneId, wiring: WiringDep) -> MutationOut:
    return service.delete_milestone(wiring.uow_factory, wiring.clock, milestone_id)
