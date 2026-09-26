"""The business-day calendar, day loads, holidays and leave."""

from typing import Annotated

from fastapi import APIRouter, Query, status

from app.api.deps import ClockDep, UowFactoryDep
from app.api.endpoints._params import FromQuery, IsoDate, ToQuery
from app.api.errors import error_responses
from app.schemas.calendar import (
    CalendarOut,
    HolidayCreate,
    HolidayOut,
    LeaveDayOut,
    LeavePut,
    LoadsOut,
)
from app.schemas.mutation import HolidayMutationOut, LeaveMutationOut, MutationOut
from app.schemas.settings import HolidayRegion
from app.services import settings as settings_service
from app.services import views

router = APIRouter(tags=["calendar"])


@router.get(
    "/calendar",
    summary="Calendar days for any range (extends holidays on demand)",
    responses=error_responses(422),
)
def get_calendar(
    uow_factory: UowFactoryDep,
    clock: ClockDep,
    from_: FromQuery = None,
    to: ToQuery = None,
    holiday_region: Annotated[
        HolidayRegion | None,
        Query(alias="holidayRegion", description="Defaults to the settings' region."),
    ] = None,
) -> CalendarOut:
    """Defaults to the plan window. Works before setup, so the wizard's date picker can pass
    the region being chosen. Ranges outside 1990-2100 are 422 ``OUT_OF_RANGE``."""
    return views.calendar_view(uow_factory, clock, from_, to, holiday_region)


@router.get(
    "/loads",
    summary="Business-day loads for any range",
    responses=error_responses(409, 422),
)
def get_loads(
    uow_factory: UowFactoryDep, clock: ClockDep, from_: FromQuery = None, to: ToQuery = None
) -> LoadsOut:
    """For calendar months outside ``PlanOut.calendar``. Defaults to the plan window."""
    return views.loads_view(uow_factory, clock, from_, to)


@router.get(
    "/holidays",
    summary="Holidays in the current region, including suppressed ones",
    responses=error_responses(422),
)
def list_holidays(
    uow_factory: UowFactoryDep, clock: ClockDep, from_: FromQuery = None, to: ToQuery = None
) -> list[HolidayOut]:
    return views.holidays_view(uow_factory, clock, from_, to)


@router.post(
    "/holidays",
    status_code=status.HTTP_201_CREATED,
    summary="Add a manual holiday",
    responses=error_responses(409, 422),
)
def create_holiday(
    body: HolidayCreate, uow_factory: UowFactoryDep, clock: ClockDep
) -> HolidayMutationOut:
    return settings_service.add_holiday(uow_factory, clock, body.date, body.name)


@router.delete(
    "/holidays/{iso}",
    summary="Remove a holiday (generated ones are suppressed, manual ones deleted)",
    responses=error_responses(404, 409, 422),
)
def delete_holiday(iso: IsoDate, uow_factory: UowFactoryDep, clock: ClockDep) -> MutationOut:
    return settings_service.remove_holiday(uow_factory, clock, iso)


@router.get("/leave", summary="Personal leave days (data only)", responses=error_responses(422))
def list_leave(
    uow_factory: UowFactoryDep, from_: FromQuery = None, to: ToQuery = None
) -> list[LeaveDayOut]:
    return views.leave_view(uow_factory, from_, to)


@router.put(
    "/leave/{iso}",
    summary="Set a leave day (data only)",
    responses=error_responses(409, 422),
)
def put_leave(
    iso: IsoDate, body: LeavePut, uow_factory: UowFactoryDep, clock: ClockDep
) -> LeaveMutationOut:
    return settings_service.put_leave(uow_factory, clock, iso, body.hours, body.note)


@router.delete(
    "/leave/{iso}",
    summary="Clear a leave day (data only)",
    responses=error_responses(404, 409, 422),
)
def delete_leave(iso: IsoDate, uow_factory: UowFactoryDep, clock: ClockDep) -> MutationOut:
    return settings_service.delete_leave(uow_factory, clock, iso)
