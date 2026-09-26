"""The Fixed Income rotation: read it, change its title, hours a day or start, replace its
segments (the setup wizard's rotation step and the Settings rotation editor).

Setup creates the one rotation, so every route here answers 409 ``SETUP_REQUIRED`` before
setup. Each change is one event and returns the new plan (the rotation's load items and the
calendar window move with it).

A change is laid out before anything is written (``check_fits``): on the plan's calendar, or,
when that is too short, on the widest calendar a mutation may build (up to the ten-year
horizon), in memory. Either way its last day must fall within the horizon year, since the
plan's calendar can already reach past it. So a rotation that would run past Remi's calendar
is refused (422 ``OUT_OF_RANGE``) with no event at all, not even the ``holidays.generated``
of a widening, instead of breaking every later read. A change that fits is laid out again
inside the unit of work, which widens the stored calendar as far as it needs.
"""

import datetime as dt
from collections.abc import Callable, Sequence
from typing import Final

from app.core.clock import Clock
from app.core.errors import OutOfRange, SetupRequired, ValidationFailed
from app.core.uow import UnitOfWorkFactory, ref
from app.repositories import models as orm
from app.repositories.registry import ROTATION
from app.repositories.rotation_repo import SegmentSpec
from app.schemas.mutation import MovementCause, RotationMutationOut
from app.schemas.rotation import (
    RotationOut,
    RotationPatch,
    RotationSegmentIn,
    RotationSegmentsPut,
)
from app.schemas.settings import HolidayRegion
from app.services import holidays
from app.services.adapters import rotation_of
from app.services.calendar import (
    YearSpan,
    calendar_for,
    check_move_date,
    check_move_not_past,
    check_within_horizon,
    horizon_year,
)
from app.services.engine.calendar import BusinessCalendar, OutOfCalendar
from app.services.engine.model import RotationPlan, SegmentDef
from app.services.engine.rotation import layout
from app.services.mutations import MutationScope, run_mutation
from app.services.views import get_plan_state

CAUSE: Final[MovementCause] = "settings"


def get_rotation(uow_factory: UnitOfWorkFactory, clock: Clock) -> RotationOut:
    """``GET /rotation``: the rotation with its derived schedule (409 before setup)."""
    return get_plan_state(uow_factory, clock).out.rotation


TOO_LONG: Final = "That rotation runs past Remi's calendar, which reaches ten years ahead."


def check_fits(
    uow_factory: UnitOfWorkFactory,
    clock: Clock,
    region: HolidayRegion,
    segments: Sequence[SegmentDef],
    start: dt.date,
    hours_per_day: float,
    *,
    cal: BusinessCalendar | None = None,
) -> None:
    """422 ``OUT_OF_RANGE`` (field ``segments``) when the rotation would end past the horizon.

    Nothing is written: the layout runs on ``cal`` (the plan's calendar) when it is long
    enough, else on the calendar up to ``horizon_year`` built in memory (stored holidays where
    there are any, generated otherwise), the widest one ``run_mutation`` could build. Either
    way the rotation's last day must fall in ``horizon_year(today)`` or before: the plan's
    calendar can already reach past it (it runs to the year after the move), so a layout that
    fits there is not enough. Call it before ``run_mutation``, so a refused change records no
    event at all."""
    if not segments:
        return
    today = clock.today()
    plan: RotationPlan | None = None
    if cal is not None:
        try:
            plan = layout(segments, start, hours_per_day, cal)
        except OutOfCalendar:
            plan = None
    if plan is None:
        span = YearSpan(max(holidays.MIN_YEAR, min(today.year, start.year)), horizon_year(today))
        wide = calendar_for(uow_factory, clock, region, span, persist=False)
        try:
            plan = layout(segments, start, hours_per_day, wide)
        except OutOfCalendar as error:
            raise OutOfRange(TOO_LONG, field="segments") from error
    if plan.end is not None and plan.end.year > horizon_year(today):
        raise OutOfRange(TOO_LONG, field="segments")


def segment_defs(segments: Sequence[RotationSegmentIn]) -> list[SegmentDef]:
    """The engine's view of segments as a request sends them (for ``check_fits``)."""
    return [
        SegmentDef(country=s.country, code=s.code, length_bd=s.length_bd, kind=s.pass_)
        for s in segments
    ]


def _check_state_fits(
    uow_factory: UnitOfWorkFactory,
    clock: Clock,
    *,
    segments: Sequence[SegmentDef] | None = None,
    start: dt.date | None = None,
    start_sent: bool = False,
) -> None:
    """``check_fits`` for a change to the stored rotation: what is not sent stays as stored
    (a ``null`` start follows the move). Hours a day move no dates, so they are not needed."""
    state = get_plan_state(uow_factory, clock)
    stored = state.ctx.rotation
    if segments is None:
        segments = stored.segments if stored is not None else ()
    if not start_sent:
        start = stored.start if stored is not None else None
    hours = stored.hours_per_day if stored is not None else 0.0
    begins = start if start is not None else state.ctx.move
    check_fits(uow_factory, clock, state.region, segments, begins, hours, cal=state.cal)


MOVE_TOO_LATE: Final = (
    "With that move date the rotation runs past Remi's calendar, which reaches ten years ahead."
)


def check_settings_fit(
    uow_factory: UnitOfWorkFactory,
    clock: Clock,
    *,
    move: dt.date | None = None,
    region: HolidayRegion | None = None,
) -> None:
    """``check_fits`` for ``PATCH /settings``: a new move date moves a rotation that follows
    it, and a new holiday region moves any rotation's business days. 422 ``OUT_OF_RANGE``
    (field ``moveDate``, or ``holidayRegion``) when the rotation would then end past the
    horizon. Call it before ``run_mutation``, so a refused change records no event at all.
    ``None`` means "not sent" (keep the stored value)."""
    if move is None and region is None:
        return
    state = get_plan_state(uow_factory, clock)
    stored = state.ctx.rotation
    if move is not None:
        today = clock.today()
        check_move_date(move, today)
        check_move_not_past(move, today)
    if stored is None or not stored.segments:
        return
    if stored.start is not None and (region is None or region == state.region):
        return  # a pinned start does not follow the move
    begins = stored.start if stored.start is not None else (move or state.ctx.move)
    same_region = region is None or region == state.region
    try:
        check_fits(
            uow_factory,
            clock,
            region if region is not None else state.region,
            stored.segments,
            begins,
            stored.hours_per_day,
            cal=state.cal if same_region else None,
        )
    except OutOfRange as error:
        field = "moveDate" if move is not None and stored.start is None else "holidayRegion"
        raise OutOfRange(MOVE_TOO_LATE if field == "moveDate" else TOO_LONG, field=field) from error


def _require_rotation(m: MutationScope) -> orm.Rotation:
    m.require_before()
    rotation = m.uow.repo(ROTATION).get_active()
    if rotation is None:
        raise SetupRequired
    return rotation


def _check_layout(m: MutationScope, rotation: orm.Rotation) -> None:
    """Lay the changed rotation out on the calendar. ``OutOfCalendar`` makes ``run_mutation``
    widen the calendar and retry (``check_fits`` already made sure it fits the horizon)."""
    before = m.require_before()
    definition = rotation_of(rotation)
    if definition is None or not definition.segments:
        return
    start = definition.start if definition.start is not None else before.ctx.move
    layout(definition.segments, start, definition.hours_per_day, before.cal)


def _mutation_out(
    uow_factory: UnitOfWorkFactory, clock: Clock, change: Callable[[MutationScope], None]
) -> RotationMutationOut:
    result = run_mutation(uow_factory, clock, change, CAUSE)
    return result.with_entity(RotationMutationOut, result.require_plan().rotation)


def update_rotation(
    uow_factory: UnitOfWorkFactory, clock: Clock, body: RotationPatch
) -> RotationMutationOut:
    """``PATCH /rotation``: title, hours a day, or start (``startDate: null`` follows the move
    date again; a start on a weekend or holiday rolls forward to the next business day)."""
    fields = body.model_fields_set
    if "title" in fields and (body.title is None or not body.title.strip()):
        raise ValidationFailed("The rotation needs a title.", "title")
    if "hours_per_day" in fields and body.hours_per_day is None:
        raise ValidationFailed("This field cannot be cleared.", "hoursPerDay")
    if body.start_date is not None:
        check_within_horizon(body.start_date, clock.today(), "start date", field="startDate")
    if "start_date" in fields:
        _check_state_fits(uow_factory, clock, start=body.start_date, start_sent=True)

    def change(m: MutationScope) -> None:
        rotation = _require_rotation(m)
        if "title" in fields and body.title is not None:
            rotation.title = body.title.strip()
        if "hours_per_day" in fields and body.hours_per_day is not None:
            rotation.hours_per_day = body.hours_per_day
        if "start_date" in fields:
            # ``OutOfCalendar`` here widens the calendar (``check_fits`` passed, so it fits).
            rotation.start_date = (
                m.require_before().cal.next_bd(body.start_date)
                if body.start_date is not None
                else None
            )
        _check_layout(m, rotation)
        m.uow.record(
            "rotation.updated",
            [ref("rotation", rotation.id)],
            body.model_dump(mode="json", exclude_unset=True, by_alias=True),
        )

    return _mutation_out(uow_factory, clock, change)


def _segment_specs(segments: Sequence[RotationSegmentIn], existing: set[str]) -> list[SegmentSpec]:
    seen: set[str] = set()
    specs: list[SegmentSpec] = []
    for index, seg in enumerate(segments):
        if seg.id is not None:
            if seg.id in seen:
                raise ValidationFailed("Each segment id may appear once.", f"segments.{index}.id")
            if seg.id not in existing:
                raise ValidationFailed(
                    "No segment with that id: leave the id out for a new segment.",
                    f"segments.{index}.id",
                )
            seen.add(seg.id)
        country = seg.country.strip()
        if not country:
            raise ValidationFailed("A segment needs a country.", f"segments.{index}.country")
        specs.append(
            SegmentSpec(
                country=country,
                code=seg.code,
                length_bd=seg.length_bd,
                pass_kind=seg.pass_,
                id=seg.id,
            )
        )
    return specs


def put_segments(
    uow_factory: UnitOfWorkFactory, clock: Clock, body: RotationSegmentsPut
) -> RotationMutationOut:
    """``PUT /rotation/segments``: the whole ordered list. Send an existing ``id`` to keep a
    segment (its load items keep their ``refId``); leave it out for a new one. Loops are
    renumbered from the pass kinds. A list that would run past the ten-year horizon is refused
    before anything is written (``check_fits``)."""
    _check_state_fits(uow_factory, clock, segments=segment_defs(body.segments))

    def change(m: MutationScope) -> None:
        rotation = _require_rotation(m)
        specs = _segment_specs(body.segments, {s.id for s in rotation.segments})
        m.uow.repo(ROTATION).replace_segments(rotation, specs)
        m.uow.session.flush()
        _check_layout(m, rotation)
        m.uow.record(
            "rotation.segments_replaced",
            [ref("rotation", rotation.id)],
            body.model_dump(mode="json", by_alias=True),
            effects={"segments": len(specs)},
        )

    return _mutation_out(uow_factory, clock, change)
