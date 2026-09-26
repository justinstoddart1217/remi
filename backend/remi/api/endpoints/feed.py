"""The activity feed (data only)."""

from fastapi import APIRouter

from remi.api.deps import UowFactoryDep
from remi.api.endpoints._params import BeforeQuery, LimitQuery
from remi.api.errors import error_responses
from remi.schemas.feed import FeedPageOut
from remi.services import feed as service

router = APIRouter(tags=["feed"])


@router.get("/feed", summary="Activity, newest first (data only)", responses=error_responses(422))
def list_feed(
    uow_factory: UowFactoryDep, limit: LimitQuery = 50, before: BeforeQuery = None
) -> FeedPageOut:
    return service.list_feed(uow_factory, limit, before)
