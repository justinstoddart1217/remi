"""The Fixed Income rotation (Settings' rotation editor and the setup wizard)."""

from fastapi import APIRouter

from remi.api.deps import ClockDep, UowFactoryDep
from remi.api.errors import error_responses
from remi.schemas.mutation import RotationMutationOut
from remi.schemas.rotation import RotationOut, RotationPatch, RotationSegmentsPut
from remi.services import rotation as service

router = APIRouter(tags=["rotation"])


@router.get(
    "/rotation", summary="The rotation and its derived schedule", responses=error_responses(409)
)
def get_rotation(uow_factory: UowFactoryDep, clock: ClockDep) -> RotationOut:
    return service.get_rotation(uow_factory, clock)


@router.patch(
    "/rotation",
    summary="Change the rotation's title, hours a day or start",
    responses=error_responses(409, 422),
)
def update_rotation(
    body: RotationPatch, uow_factory: UowFactoryDep, clock: ClockDep
) -> RotationMutationOut:
    """``startDate: null`` follows the move date again; a start on a weekend or holiday rolls
    forward to the next business day. 422 ``OUT_OF_RANGE`` when the rotation would run past
    Remi's calendar."""
    return service.update_rotation(uow_factory, clock, body)


@router.put(
    "/rotation/segments",
    summary="Replace the ordered segment list",
    responses=error_responses(409, 422),
)
def put_rotation_segments(
    body: RotationSegmentsPut, uow_factory: UowFactoryDep, clock: ClockDep
) -> RotationMutationOut:
    """Send an existing segment's ``id`` to keep it (an unknown or repeated id is a 422);
    leave it out for a new one. Loops are renumbered from the pass kinds."""
    return service.put_segments(uow_factory, clock, body)
