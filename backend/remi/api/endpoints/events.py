"""The append-only event log (history and audit; data only)."""

from typing import Annotated

from fastapi import APIRouter, Query

from remi.api.deps import UowFactoryDep
from remi.api.endpoints._params import LimitQuery
from remi.api.errors import error_responses
from remi.schemas.events import EventPageOut
from remi.services import events as service

router = APIRouter(tags=["events"])


@router.get(
    "/events", summary="Events after a cursor, oldest first", responses=error_responses(422)
)
def list_events(
    uow_factory: UowFactoryDep,
    since: Annotated[int, Query(ge=0, description="Return events with seq > since.")] = 0,
    limit: LimitQuery = 100,
) -> EventPageOut:
    return service.list_events(uow_factory, since, limit)
