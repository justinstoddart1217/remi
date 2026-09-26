"""First-run setup: the wizard's status and defaults, the live countdown, and the one commit.

``POST /setup`` runs in one ``setup`` unit of work and records one ``setup.completed`` event:
it stores the timezone, holiday region, capacity, AI provider and appearance, generates the
holidays, snaps the move date forward to a business day (422 before today, or more than ten
years out), creates the rotation (with any
segments given) and the three default Textbook sections (structure only, no sample pages), and
sets ``setup_completed_at``. ``apply_setup`` is the same work without the event, for callers
that record their own (the dev fixtures).
"""

import datetime as dt
from collections.abc import Sequence
from functools import cache
from pathlib import Path
from typing import Final
from zoneinfo import available_timezones

from app.core.clock import Clock
from app.core.errors import Conflict
from app.core.uow import UnitOfWork, UnitOfWorkFactory, ref
from app.repositories import models as orm
from app.repositories.registry import ROTATION, SETTINGS, TEXTBOOK
from app.repositories.rotation_repo import SegmentSpec
from app.schemas.mutation import SettingsMutationOut
from app.schemas.rotation import RotationSetupIn
from app.schemas.settings import HolidayRegion
from app.schemas.setup import (
    CountdownOut,
    HolidayRegionOut,
    SetupDefaultsOut,
    SetupIn,
    SetupStatusOut,
)
from app.services import holidays
from app.services import rotation as rotation_service
from app.services.calendar import (
    calendar_for,
    calendar_in,
    check_in_range,
    check_move_date,
    check_move_not_past,
    default_span,
    snap_to_bd,
    walk_span,
)
from app.services.mutations import MutationScope, run_mutation
from app.services.settings import timezone_changed
from app.services.settings_keys_bridge import ai_status
from app.services.views import settings_info, setup_complete

DEFAULT_TIMEZONE: Final = "Europe/London"
DEFAULT_CAPACITY: Final = 8.0
DEFAULT_ROTATION_HOURS: Final = 4.0
DEFAULT_ROTATION_TITLE: Final = "Fixed Income rotation"
LOCALTIME: Final = "/etc/localtime"

DEFAULT_SECTIONS: Final[tuple[tuple[str, str], ...]] = (
    ("Fixed Income", "var(--fi-accent)"),
    ("Private Credit", "var(--pc-accent)"),
    ("General", "var(--ink-faint)"),
)
"""The Textbook's default sections (structure only; no sample pages)."""

SETUP_ALREADY_DONE: Final = "SETUP_ALREADY_DONE"


@cache
def _zones() -> frozenset[str]:
    return frozenset(available_timezones())


def machine_timezone(localtime: str = LOCALTIME) -> str:
    """The machine's IANA timezone from the ``/etc/localtime`` symlink (Europe/London if
    unreadable)."""
    try:
        target = str(Path(localtime).readlink())
    except OSError:
        return DEFAULT_TIMEZONE
    marker = "zoneinfo/"
    index = target.find(marker)
    name = target[index + len(marker) :] if index >= 0 else ""
    return name if name in _zones() else DEFAULT_TIMEZONE


def default_region(timezone: str) -> HolidayRegion:
    return "ZA" if timezone == "Africa/Johannesburg" else "GB-ENG"


def regions() -> list[HolidayRegionOut]:
    return [
        HolidayRegionOut(code=code, label=label) for code, label in holidays.REGION_LABELS.items()
    ]


def setup_status(
    uow_factory: UnitOfWorkFactory, clock: Clock, *, default_timezone: str | None = None
) -> SetupStatusOut:
    """``GET /setup``: whether first-run setup is needed, and what the wizard pre-fills.

    The zone is ``default_timezone`` (``REMI_DEFAULT_TIMEZONE``, dev and test only) when given,
    else the machine's."""
    with uow_factory.read() as uow:
        settings = uow.repo(SETTINGS).get()
        needs = not setup_complete(settings)
        status = ai_status(settings)
        missing = ["moveDate"] if settings.move_date is None else []
    timezone = default_timezone if default_timezone is not None else machine_timezone()
    return SetupStatusOut(
        needs_setup=needs,
        missing=missing if needs else [],
        today=clock.today(),
        defaults=SetupDefaultsOut(
            timezone=timezone,
            holiday_region=default_region(timezone),
            capacity_hours_per_day=DEFAULT_CAPACITY,
            ai_provider="none",
            rotation_hours_per_day=DEFAULT_ROTATION_HOURS,
        ),
        regions=regions(),
        ai=status,
    )


def countdown(
    uow_factory: UnitOfWorkFactory,
    clock: Clock,
    move_date: dt.date,
    region: HolidayRegion | None,
) -> CountdownOut:
    """``GET /setup/countdown``: business days strictly between today and a candidate move.

    A preview: any date in 1990-2100 is answered. After setup, holiday years for the current
    region are stored only inside the read horizon plus a year of slack (``walk_span``, as for
    every other ``GET``); years past it (a move ``PATCH /settings`` would refuse) are generated
    in memory and never stored."""
    check_in_range(move_date, "move date")
    today = clock.today()
    info = settings_info(uow_factory)
    chosen: HolidayRegion = region if region is not None else info.region
    span = default_span(today, move_date)
    persist = info.complete and chosen == info.region and walk_span(today).contains(span)
    cal = calendar_for(uow_factory, clock, chosen, span, persist=persist)
    snapped = snap_to_bd(cal, move_date, "moveDate")
    return CountdownOut(
        today=today,
        move_date=snapped,
        snapped=snapped != move_date,
        countdown_bd=cal.bd_between(today, snapped) if snapped > today else 0,
    )


def segment_specs(
    rotation: RotationSetupIn | None, ids: Sequence[str] | None = None
) -> list[SegmentSpec]:
    if rotation is None:
        return []
    out: list[SegmentSpec] = []
    for index, seg in enumerate(rotation.segments):
        seg_id = seg.id if seg.id is not None else (ids[index] if ids is not None else None)
        out.append(
            SegmentSpec(
                country=seg.country,
                code=seg.code,
                length_bd=seg.length_bd,
                pass_kind=seg.pass_,
                id=seg_id,
            )
        )
    return out


def apply_setup(
    uow: UnitOfWork,
    body: SetupIn,
    *,
    today: dt.date,
    rotation_title: str = DEFAULT_ROTATION_TITLE,
) -> orm.Settings:
    """Everything ``POST /setup`` changes, inside ``uow`` (the caller records the event)."""
    check_move_date(body.move_date, today)
    settings = uow.repo(SETTINGS).get()
    settings.timezone = body.timezone
    settings.holiday_region = body.holiday_region
    settings.capacity_hours_per_day = body.capacity_hours_per_day
    settings.ai_provider = body.ai_provider
    settings.ai_model = body.ai_model
    settings.motion_preference = body.motion_preference

    span = default_span(today, body.move_date)
    cal = calendar_in(uow, body.holiday_region, span, today)
    settings.move_date = snap_to_bd(cal, body.move_date, "moveDate")

    rotation_repo = uow.repo(ROTATION)
    rotation = rotation_repo.get_active()
    hours = body.rotation.hours_per_day if body.rotation is not None else DEFAULT_ROTATION_HOURS
    if rotation is None:
        rotation = rotation_repo.add(
            orm.Rotation(domain="fi", title=rotation_title, start_date=None, hours_per_day=hours)
        )
        uow.session.flush()
    else:
        rotation.hours_per_day = hours
    if body.rotation is not None:
        rotation_repo.replace_segments(rotation, segment_specs(body.rotation))

    textbook = uow.repo(TEXTBOOK)
    if textbook.count_sections() == 0:
        for order, (label, accent) in enumerate(DEFAULT_SECTIONS):
            textbook.add_section(orm.TextbookSection(label=label, accent=accent, sort_order=order))

    settings.setup_completed_at = uow.clock.now()
    return settings


def _check_rotation_fits(uow_factory: UnitOfWorkFactory, clock: Clock, body: SetupIn) -> None:
    """``rotation.check_fits`` for the wizard's segments, starting on the move (only while
    setup is still open, after the move date's own checks, so their errors come first)."""
    if body.rotation is None or not body.rotation.segments:
        return
    with uow_factory.read() as uow:
        if setup_complete(uow.repo(SETTINGS).get()):
            return
    today = clock.today()
    check_move_date(body.move_date, today)
    check_move_not_past(body.move_date, today)
    rotation_service.check_fits(
        uow_factory,
        clock,
        body.holiday_region,
        rotation_service.segment_defs(body.rotation.segments),
        body.move_date,
        body.rotation.hours_per_day,
    )


def complete_setup(
    uow_factory: UnitOfWorkFactory, clock: Clock, body: SetupIn
) -> SettingsMutationOut:
    """``POST /setup`` (409 ``SETUP_ALREADY_DONE`` once setup is complete). A rotation that
    would run past the ten-year horizon is refused before anything is written."""
    _check_rotation_fits(uow_factory, clock, body)

    def change(m: MutationScope) -> None:
        settings = m.uow.repo(SETTINGS).get()
        if setup_complete(settings):
            raise Conflict(
                "Setup is already done. Change settings instead.", code=SETUP_ALREADY_DONE
            )
        check_move_not_past(body.move_date, m.today)
        apply_setup(m.uow, body, today=m.today)
        # The clock re-reads the timezone once this commits, so the plan built after the
        # change (and the response's ``today``) is in the new zone.
        m.uow.after_commit(timezone_changed)
        m.uow.record(
            "setup.completed",
            [ref("settings", str(orm.SETTINGS_ID))],
            body.model_dump(mode="json", by_alias=True),
        )

    result = run_mutation(
        uow_factory,
        clock,
        change,
        "settings",
        actor="setup",
        require_setup=False,
        track_movements=False,
    )
    return result.with_entity(SettingsMutationOut, result.require_plan().settings)
