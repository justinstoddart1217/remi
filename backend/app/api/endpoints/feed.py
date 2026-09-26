"""The activity feed (data only)."""

from fastapi import APIRouter

from app.api.deps import UowFactoryDep
from app.api.endpoints._params import BeforeQuery, LimitQuery
from app.api.errors import error_responses
from app.schemas.feed import FeedPageOut
from app.services import feed as service

router = APIRouter(tags=["feed"])


@router.get("/feed", summary="Activity, newest first (data only)", responses=error_responses(422))
def list_feed(
    uow_factory: UowFactoryDep, limit: LimitQuery = 50, before: BeforeQuery = None
) -> FeedPageOut:
    return service.list_feed(uow_factory, limit, before)
