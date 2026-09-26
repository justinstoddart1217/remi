"""Tasks under Now milestones."""

from fastapi import APIRouter, status

from remi.api.deps import WiringDep
from remi.api.endpoints._params import MilestoneId, TaskId
from remi.api.errors import error_responses
from remi.schemas.base import OrderPut
from remi.schemas.mutation import MilestoneMutationOut, MutationOut, TaskMutationOut
from remi.schemas.project import TaskCreate, TaskPatch
from remi.services import project_items as service

router = APIRouter(tags=["tasks"])


@router.post(
    "/milestones/{milestoneId}/tasks",
    status_code=status.HTTP_201_CREATED,
    summary="Add a task to a Now milestone",
    responses=error_responses(404, 409, 422),
)
def create_task(milestone_id: MilestoneId, body: TaskCreate, wiring: WiringDep) -> TaskMutationOut:
    """409 ``CONFLICT`` under a Next milestone: only Now milestones carry tasks."""
    return service.create_task(wiring.uow_factory, wiring.clock, milestone_id, body)


@router.put(
    "/milestones/{milestoneId}/tasks/order",
    summary="Reorder a milestone's tasks",
    responses=error_responses(404, 409, 422),
)
def reorder_tasks(
    milestone_id: MilestoneId, body: OrderPut, wiring: WiringDep
) -> MilestoneMutationOut:
    return service.reorder_tasks(wiring.uow_factory, wiring.clock, milestone_id, body)


@router.patch(
    "/tasks/{taskId}",
    summary="Edit or tick a task",
    responses=error_responses(404, 409, 422),
)
def update_task(task_id: TaskId, body: TaskPatch, wiring: WiringDep) -> TaskMutationOut:
    """A blank text removes the task; ``entity`` is then the task as it was."""
    return service.update_task(wiring.uow_factory, wiring.clock, task_id, body)


@router.delete(
    "/tasks/{taskId}",
    summary="Remove a task",
    responses=error_responses(404, 409, 422),
)
def delete_task(task_id: TaskId, wiring: WiringDep) -> MutationOut:
    return service.delete_task(wiring.uow_factory, wiring.clock, task_id)
