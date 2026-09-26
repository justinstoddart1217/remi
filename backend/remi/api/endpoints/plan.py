"""Read models: the plan bundle and the parameterised reads."""

from typing import Annotated

from fastapi import APIRouter, Header, Response, status

from remi.api.deps import ClockDep, UowFactoryDep, WiringDep
from remi.api.endpoints._params import IsoDate, MonthQuery
from remi.api.errors import error_responses
from remi.schemas.day import DayOut
from remi.schemas.home import HomeOut
from remi.schemas.month import MonthSnapshotOut
from remi.schemas.plan import PlanOut
from remi.services import views

router = APIRouter(tags=["plan"])


def _matches(if_none_match: str | None, etag: str) -> bool:
    if not if_none_match:
        return False
    candidates = [tag.strip().removeprefix("W/") for tag in if_none_match.split(",")]
    return "*" in candidates or etag in candidates


@router.get(
    "/plan",
    summary="The whole plan: every number the Control Panel renders",
    response_model=PlanOut,
    responses={
        200: {
            "description": "The plan.",
            "headers": {
                "ETag": {
                    "description": (
                        'The plan revision and business date, quoted (e.g. `"42-2026-10-05"`).'
                    ),
                    "schema": {"type": "string"},
                }
            },
        },
        304: {"description": "Not modified: If-None-Match equals the current ETag."},
        **error_responses(409, 422),
    },
)
def get_plan(
    uow_factory: UowFactoryDep,
    clock: ClockDep,
    response: Response,
    if_none_match: Annotated[str | None, Header(alias="If-None-Match")] = None,
) -> PlanOut | Response:
    """Served with an ``ETag`` of the revision (and today). 409 ``SETUP_REQUIRED`` before
    setup."""
    state = views.get_plan_state(uow_factory, clock)
    etag = views.plan_etag(state)
    if _matches(if_none_match, etag):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers={"ETag": etag})
    response.headers["ETag"] = etag
    return state.out


@router.get(
    "/day/{iso}",
    summary="One day's plan: BAU rows, checklist run, focus blocks",
    responses=error_responses(409, 422),
)
def get_day(iso: IsoDate, wiring: WiringDep) -> DayOut:
    return views.day_view(wiring.uow_factory, wiring.clock, iso)


@router.get(
    "/month-snapshot",
    summary="Today's month snapshot (BAU runs, tasks and milestones due)",
    responses=error_responses(409, 422),
)
def get_month_snapshot(wiring: WiringDep, month: MonthQuery = None) -> MonthSnapshotOut:
    return views.month_snapshot_view(wiring.uow_factory, wiring.clock, month)


@router.get("/home", summary="The launcher page (works before setup)")
def get_home(uow_factory: UowFactoryDep, clock: ClockDep) -> HomeOut:
    return views.home_view(uow_factory, clock)
