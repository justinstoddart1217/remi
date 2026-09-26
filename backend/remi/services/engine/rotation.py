"""Fixed Income rotation: lay the segments out on business days, and where today falls."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from typing import Literal

from remi.services.engine.calendar import BusinessCalendar
from remi.services.engine.model import (
    ROTATION_REF_ID,
    PassKind,
    RotationPlan,
    Segment,
    SegmentDef,
)

RotationState = Literal["none", "waiting", "active", "done"]


def layout(
    segments: Sequence[SegmentDef], start: date, hours_per_day: float, cal: BusinessCalendar
) -> RotationPlan:
    """Segments back to back on business days, skipping holidays.

    The first segment starts on ``next_bd(start)``; each runs ``length_bd`` business days and
    the next starts on the following business day. ``loop`` is 1 for the opening Build passes
    and goes up by one each time the pass kind changes. Raises ``OutOfCalendar`` rather than
    clamping when the calendar is too short.
    """
    laid: list[Segment] = []
    s = cal.next_bd(start)
    loop = 1
    previous: str | None = None
    for i, sd in enumerate(segments):
        if sd.length_bd < 1:
            msg = f"segment {i} ({sd.country}) must last at least 1 business day"
            raise ValueError(msg)
        if previous is not None and sd.kind != previous:
            loop += 1
        previous = sd.kind
        e = cal.add_bd(s, sd.length_bd - 1)
        laid.append(
            Segment(
                order=i,
                id=sd.id or f"{ROTATION_REF_ID}-{i}",
                country=sd.country,
                code=sd.code,
                length_bd=sd.length_bd,
                kind=sd.kind,
                loop=loop,
                start=s,
                end=e,
            )
        )
        s = cal.add_bd(e, 1)
    first_pass = _first_run(laid, "Build")
    refresh = _first_run(laid, "Refresh")
    return RotationPlan(
        start=laid[0].start if laid else start,
        hours_per_day=hours_per_day,
        segments=tuple(laid),
        total_bd=sum(g.length_bd for g in laid),
        loop_bd=sum(g.length_bd for g in first_pass),
        loop_end=first_pass[-1].end if first_pass else None,
        refresh_start=refresh[0].start if refresh else None,
        refresh_end=refresh[-1].end if refresh else None,
        end=laid[-1].end if laid else None,
    )


def _first_run(laid: Sequence[Segment], kind: PassKind) -> list[Segment]:
    """The first pass of ``kind``: its first segment and those after it until the kind changes.

    Loop 1 is the Build segments before the first Refresh (none when the rotation opens with a
    Refresh), so a Build pass added after the refresh (loop 3) never moves loop 1's business
    days or end. The refresh is the Refresh pass that follows it, as the prototype shows
    ``ROT[10]``."""
    if kind == "Build":
        return [g for g in laid if g.loop == 1 and g.kind == "Build"]
    start = next((i for i, g in enumerate(laid) if g.kind == kind), None)
    if start is None:
        return []
    loop = laid[start].loop
    return [g for g in laid[start:] if g.loop == loop]


@dataclass(frozen=True, slots=True)
class RotationStatus:
    status: RotationState
    order: int | None = None
    segment_id: str | None = None
    bd_to_start: int | None = None
    """Business days strictly between today and the start (``waiting`` only)."""


def segment_on(plan: RotationPlan, d: date) -> Segment | None:
    """The segment whose business-day span contains ``d``."""
    for seg in plan.segments:
        if seg.start <= d <= seg.end:
            return seg
    return None


def current(plan: RotationPlan | None, today: date, cal: BusinessCalendar) -> RotationStatus:
    """Waiting (with the count to the start), active (with the segment) or done."""
    if plan is None or not plan.segments:
        return RotationStatus("none")
    first = plan.segments[0]
    if today < first.start:
        return RotationStatus("waiting", bd_to_start=cal.bd_between(today, first.start))
    seg = segment_on(plan, today)
    if seg is not None:
        return RotationStatus("active", order=seg.order, segment_id=seg.id)
    if plan.end is not None and today > plan.end:
        return RotationStatus("done")
    # Between segments only happens on non-business days inside the span.
    nxt = next((g for g in plan.segments if g.start > today), None)
    if nxt is None:
        return RotationStatus("done")
    return RotationStatus("active", order=nxt.order, segment_id=nxt.id)
