"""First-run setup. These work before setup; everything plan-shaped needs it done."""

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Query, status

from remi.api.deps import ClockDep, ConfigDep, UowFactoryDep
from remi.api.errors import error_responses
from remi.schemas.mutation import SettingsMutationOut
from remi.schemas.settings import HolidayRegion
from remi.schemas.setup import CountdownOut, SetupIn, SetupStatusOut
from remi.services import setup as setup_service

router = APIRouter(tags=["setup"])


@router.get("/setup", summary="Does Remi need first-run setup?")
def get_setup_status(
    uow_factory: UowFactoryDep, clock: ClockDep, config: ConfigDep
) -> SetupStatusOut:
    """``defaults.timezone`` is the machine's zone (``REMI_DEFAULT_TIMEZONE`` in dev and test
    runs), and ``defaults.holidayRegion`` follows it."""
    return setup_service.setup_status(uow_factory, clock, default_timezone=config.default_timezone)


@router.get(
    "/setup/countdown",
    summary="Business days to a candidate move date (the wizard's live countdown)",
    responses=error_responses(422),
)
def get_setup_countdown(
    uow_factory: UowFactoryDep,
    clock: ClockDep,
    move_date: Annotated[dt.date, Query(alias="moveDate")],
    holiday_region: Annotated[HolidayRegion | None, Query(alias="holidayRegion")] = None,
) -> CountdownOut:
    return setup_service.countdown(uow_factory, clock, move_date, holiday_region)


@router.post(
    "/setup",
    status_code=status.HTTP_201_CREATED,
    summary="Complete first-run setup in one transaction",
    responses=error_responses(409, 422),
)
def complete_setup(
    body: SetupIn, uow_factory: UowFactoryDep, clock: ClockDep
) -> SettingsMutationOut:
    """409 ``SETUP_ALREADY_DONE`` once setup is complete (use ``PATCH /settings``)."""
    return setup_service.complete_setup(uow_factory, clock, body)
