"""Projects: CRUD, the forecast refit (replan), history, and data-only hour rules."""

from fastapi import APIRouter, status

from remi.api.deps import WiringDep
from remi.api.endpoints._params import IsoDate, ProjectId
from remi.api.errors import error_responses
from remi.schemas.mutation import MutationOut, ProjectMutationOut
from remi.schemas.project import (
    BauDayHoursPut,
    HourOverridePut,
    ProjectCreate,
    ProjectOut,
    ProjectPatch,
    ProjectSnapshotOut,
    ReplanIn,
    ReplanPreviewOut,
)
from remi.services import projects as service

router = APIRouter(tags=["projects"])


@router.get("/projects", summary="All projects with derived fields", responses=error_responses(409))
def list_projects(wiring: WiringDep) -> list[ProjectOut]:
    return service.list_projects(wiring.uow_factory, wiring.clock)


@router.post(
    "/projects",
    status_code=status.HTTP_201_CREATED,
    summary="Create a project in Define",
    responses=error_responses(409, 422),
)
def create_project(body: ProjectCreate, wiring: WiringDep) -> ProjectMutationOut:
    """Defaults: name "Untitled project", start today, target today + the new-project horizon,
    no forecast. The client then opens the workspace and focuses the goal."""
    return service.create_project(wiring.uow_factory, wiring.clock, body)


@router.get(
    "/projects/{projectId}",
    summary="One project",
    responses=error_responses(404, 409, 422),
)
def get_project(project_id: ProjectId, wiring: WiringDep) -> ProjectOut:
    return service.get_project(wiring.uow_factory, wiring.clock, project_id)


@router.patch(
    "/projects/{projectId}",
    summary="Edit a project's text, target or data-only fields",
    responses=error_responses(404, 409, 422),
)
def update_project(
    project_id: ProjectId, body: ProjectPatch, wiring: WiringDep
) -> ProjectMutationOut:
    """``targetDate`` snaps forward to a business day; a real move clears ``targetLabel`` and
    logs "Target moved A → B." in the feed. ``null`` clears a nullable field."""
    return service.update_project(wiring.uow_factory, wiring.clock, project_id, body)


@router.delete(
    "/projects/{projectId}",
    summary="Delete a project and its history",
    responses=error_responses(404, 409, 422),
)
def delete_project(project_id: ProjectId, wiring: WiringDep) -> MutationOut:
    """Cascades to every child. Clears the key project and routine links. Deleting the last
    project is allowed."""
    return service.delete_project(wiring.uow_factory, wiring.clock, project_id)


@router.post(
    "/projects/{projectId}/replan",
    summary="Refit the forecast after a rate, work-left or start edit",
    responses=error_responses(404, 409, 422),
)
def replan_project(project_id: ProjectId, body: ReplanIn, wiring: WiringDep) -> ProjectMutationOut:
    """Hours a day must be 0 or at least 0.05. A zero rate on a project with a forecast, or a
    rescale that would leave a day below 0.05h, is 422 ``VALIDATION_FAILED``."""
    return service.replan(wiring.uow_factory, wiring.clock, project_id, body)


@router.post(
    "/projects/{projectId}/replan/preview",
    summary="What a replan would do, without saving",
    responses=error_responses(404, 409, 422),
)
def preview_replan(project_id: ProjectId, body: ReplanIn, wiring: WiringDep) -> ReplanPreviewOut:
    return service.preview_replan(wiring.uow_factory, wiring.clock, project_id, body)


@router.get(
    "/projects/{projectId}/snapshots",
    summary="Check-in snapshots for the history scrubber, oldest first",
    responses=error_responses(404, 409, 422),
)
def list_project_snapshots(project_id: ProjectId, wiring: WiringDep) -> list[ProjectSnapshotOut]:
    return service.project_snapshots(wiring.uow_factory, project_id)


@router.put(
    "/projects/{projectId}/bau-day-hours",
    summary="Replace the project's hours on routine days (data only)",
    responses=error_responses(404, 409, 422),
)
def put_bau_day_hours(
    project_id: ProjectId, body: BauDayHoursPut, wiring: WiringDep
) -> ProjectMutationOut:
    """Hours must be 0 or at least 0.05; each routine once. The forecast is not refitted."""
    return service.put_bau_day_hours(wiring.uow_factory, wiring.clock, project_id, body)


@router.put(
    "/projects/{projectId}/overrides/{iso}",
    summary="Set the project's hours on one day (data only)",
    responses=error_responses(404, 409, 422),
)
def put_hour_override(
    project_id: ProjectId, iso: IsoDate, body: HourOverridePut, wiring: WiringDep
) -> ProjectMutationOut:
    """Hours must be 0 or at least 0.05. The forecast is not refitted."""
    return service.put_override(wiring.uow_factory, wiring.clock, project_id, iso, body.hours)


@router.delete(
    "/projects/{projectId}/overrides/{iso}",
    summary="Clear the project's hours override on one day (data only)",
    responses=error_responses(404, 409, 422),
)
def delete_hour_override(
    project_id: ProjectId, iso: IsoDate, wiring: WiringDep
) -> ProjectMutationOut:
    """Idempotent: clearing a day without an override still answers 200."""
    return service.delete_override(wiring.uow_factory, wiring.clock, project_id, iso)
