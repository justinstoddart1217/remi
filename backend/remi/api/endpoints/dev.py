"""Development and test helpers. Mounted only when ``REMI_ENV`` is ``dev`` or ``test``."""

from fastapi import APIRouter, Response, status

from remi.api.deps import ClockDep, ConfigDep, UowFactoryDep
from remi.api.errors import error_responses
from remi.schemas.dev import DevFixturesIn
from remi.schemas.mutation import MutationOut
from remi.services import dev_fixtures

router = APIRouter(tags=["dev"])


@router.post(
    "/dev/fixtures",
    summary="Reset the database to a named fixture (dev and test only)",
    response_model=MutationOut,
    responses=error_responses(422),
)
def load_dev_fixtures(
    body: DevFixturesIn, uow_factory: UowFactoryDep, clock: ClockDep, config: ConfigDep
) -> MutationOut | Response:
    """``design`` loads the prototype's sample data (setup done, today 2026-10-05 in tests) and
    returns the new plan. ``empty`` resets to a fresh database that needs setup; there is no
    plan before setup, so it answers 204 with no body."""
    out = dev_fixtures.load_fixture(uow_factory, clock, config, body.fixture)
    if out is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return out
