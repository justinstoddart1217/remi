import pytest

from remi.services.engine.calendar import OutOfCalendar
from remi.services.engine.model import SegmentDef
from remi.services.engine.rotation import current, layout, segment_on
from tests.engine import seed as S

d = S.d


def test_layout_skips_weekends_and_holidays() -> None:
    cal = S.calendar()
    plan = layout(
        (SegmentDef("A", "AA", 3), SegmentDef("B", "BB", 2, "Refresh", id="seg-b")),
        d("2026-12-23"),
        4,
        cal,
    )
    a, b = plan.segments
    assert (a.start, a.end) == (d("2026-12-23"), d("2026-12-29"))
    assert (b.start, b.end) == (d("2026-12-30"), d("2026-12-31"))
    assert (a.id, b.id) == ("rot-0", "seg-b")
    assert (a.loop, b.loop) == (1, 2)
    assert (plan.loop_bd, plan.loop_end, plan.total_bd) == (3, d("2026-12-29"), 5)
    assert (plan.refresh_start, plan.refresh_end, plan.end) == (
        d("2026-12-30"),
        d("2026-12-31"),
        d("2026-12-31"),
    )


def test_layout_starts_on_the_next_business_day() -> None:
    plan = layout((SegmentDef("A", "AA", 1),), d("2026-10-03"), 4, S.calendar())
    assert plan.start == d("2026-10-05")


def test_empty_layout() -> None:
    plan = layout((), S.MOVE, 4, S.calendar())
    assert plan.segments == ()
    assert (plan.total_bd, plan.loop_end, plan.end) == (0, None, None)
    assert current(plan, S.TODAY, S.calendar()).status == "none"
    assert current(None, S.TODAY, S.calendar()).status == "none"


def test_layout_rejects_empty_segments_and_never_clamps() -> None:
    cal = S.calendar()
    with pytest.raises(ValueError, match="at least 1"):
        layout((SegmentDef("A", "AA", 0),), S.MOVE, 4, cal)
    with pytest.raises(OutOfCalendar):
        layout((SegmentDef("A", "AA", 2000),), S.MOVE, 4, cal)


def test_current_segment() -> None:
    c = S.ctx()
    plan = c.rotation_plan
    assert plan is not None
    waiting = current(plan, S.TODAY, c.cal)
    assert (waiting.status, waiting.bd_to_start, waiting.order) == ("waiting", 61, None)
    active = current(plan, d("2027-01-13"), c.cal)
    assert (active.status, active.order, active.segment_id) == ("active", 1, "rot-1")
    weekend = current(plan, d("2027-01-16"), c.cal)
    assert (weekend.status, weekend.order) == ("active", 1)
    between = current(plan, d("2027-02-13"), c.cal)
    assert (between.status, between.order) == ("active", 6)
    assert current(plan, d("2027-03-12"), c.cal).status == "done"
    assert segment_on(plan, d("2027-03-10")) is plan.segments[-1]
    assert segment_on(plan, d("2027-03-12")) is None


def test_loop_one_is_the_first_build_pass_only() -> None:
    """A Build pass after the refresh is loop 3: loop 1 stays the prototype's 10 countries,
    46 BD ending Mon 8 Mar (``Routines.dc.html`` sums ``ROT.slice(0, 10)``), and the refresh
    stays Germany's 9-11 Mar."""
    cal = S.calendar()
    extra = SegmentDef("Greece", "GR", 3, "Build")
    plan = layout((*S.ROTATION.segments, extra), S.MOVE, 4, cal)
    assert [g.loop for g in plan.segments] == [1] * 10 + [2, 3]
    assert (plan.loop_bd, plan.loop_end) == (46, d("2027-03-08"))
    assert (plan.refresh_start, plan.refresh_end) == (d("2027-03-09"), d("2027-03-11"))
    assert (plan.total_bd, plan.end) == (52, d("2027-03-16"))

    # A second refresh after that build is not part of the first refresh.
    again = SegmentDef("Germany", "DE", 2, "Refresh")
    plan = layout((*S.ROTATION.segments, extra, again), S.MOVE, 4, cal)
    assert (plan.loop_bd, plan.loop_end) == (46, d("2027-03-08"))
    assert (plan.refresh_start, plan.refresh_end) == (d("2027-03-09"), d("2027-03-11"))

    # Opening with a refresh leaves no loop 1 of builds.
    plan = layout((again, extra), S.MOVE, 4, cal)
    assert (plan.loop_bd, plan.loop_end) == (0, None)
    assert (plan.refresh_start, plan.refresh_end) == (d("2027-01-04"), d("2027-01-05"))
