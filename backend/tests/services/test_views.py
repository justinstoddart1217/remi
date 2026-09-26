"""Read-model services: snapshots, lazy calendar extension, the setup gate."""

from datetime import date

import pytest
from sqlalchemy import select

from app.core.clock import FixedClock
from app.core.errors import NotFound, OutOfRange, SetupRequired
from app.core.uow import UnitOfWorkFactory
from app.repositories import models as orm
from app.repositories.registry import HOLIDAYS
from app.services import views
from app.services.dev_fixtures import SeedIds


def _event_types(uow_factory: UnitOfWorkFactory) -> list[str]:
    with uow_factory.read() as uow:
        rows = uow.session.scalars(select(orm.RemiEvent).order_by(orm.RemiEvent.seq))
        return [e.type for e in rows]


def test_project_snapshots_oldest_first(uow_factory: UnitOfWorkFactory, seeded: SeedIds) -> None:
    snaps = views.project_snapshots(uow_factory, "ret")
    assert [s.date for s in snaps] == [date(2026, 9, 8), date(2026, 9, 22), date(2026, 10, 3)]
    last = snaps[-1]
    assert (last.forecast_date, last.confidence, last.source) == (date(2026, 12, 2), 3, "form")
    assert [(m.name, m.date) for m in last.milestones][-1] == (
        "Security-level attribution",
        date(2026, 11, 20),
    )
    assert views.project_snapshots(uow_factory, "alpha") == []
    with pytest.raises(NotFound):
        views.project_snapshots(uow_factory, "nope")


def test_reads_extend_the_calendar_lazily(
    uow_factory: UnitOfWorkFactory, clock: FixedClock, seeded: SeedIds
) -> None:
    day = views.day_view(uow_factory, clock, date(2033, 3, 1))
    assert day.bdm is not None
    assert day.focus_blocks == []
    assert _event_types(uow_factory) == ["dev.fixture_loaded", "holidays.generated"]
    state = views.get_plan_state(uow_factory, clock)
    assert state.span.last >= 2033
    with pytest.raises(OutOfRange):
        views.day_view(uow_factory, clock, date(2101, 1, 3))


def _covered(uow_factory: UnitOfWorkFactory) -> list[int]:
    with uow_factory.read() as uow:
        return sorted(uow.repo(HOLIDAYS).covered_years("GB-ENG"))


def test_plan_reads_past_the_horizon_are_refused_and_write_nothing(
    uow_factory: UnitOfWorkFactory, clock: FixedClock, seeded: SeedIds
) -> None:
    events, covered = _event_types(uow_factory), _covered(uow_factory)
    for day in (date(2099, 6, 1), date(1990, 1, 2), date(2037, 1, 5), date(2015, 12, 31)):
        with pytest.raises(OutOfRange):
            views.day_view(uow_factory, clock, day)
    with pytest.raises(OutOfRange):
        views.month_snapshot_view(uow_factory, clock, "2099-06")
    with pytest.raises(OutOfRange):
        views.month_snapshot_view(uow_factory, clock, "2015-12")
    with pytest.raises(OutOfRange):
        views.loads_view(uow_factory, clock, date(2099, 1, 1), date(2099, 1, 31))
    assert _event_types(uow_factory) == events
    assert _covered(uow_factory) == covered


def test_plan_reads_reach_the_edges_of_the_horizon(
    uow_factory: UnitOfWorkFactory, clock: FixedClock, seeded: SeedIds
) -> None:
    # Ten years either side of 2026; walks past the edge may store one more year, no further.
    assert views.day_view(uow_factory, clock, date(2036, 12, 31)).bdm is not None
    assert views.day_view(uow_factory, clock, date(2016, 1, 4)).bdm == 1
    assert views.month_snapshot_view(uow_factory, clock, "2036-12").totals.total >= 0
    covered = _covered(uow_factory)
    assert covered[0] >= 2015 and covered[-1] <= 2037


def test_calendar_reads_past_the_horizon_are_served_from_memory(
    uow_factory: UnitOfWorkFactory, clock: FixedClock, seeded: SeedIds
) -> None:
    events, covered = _event_types(uow_factory), _covered(uow_factory)
    cal = views.calendar_view(uow_factory, clock, date(2099, 12, 21), date(2099, 12, 31), None)
    names = {d.iso: d.hol for d in cal.days}
    assert names[date(2099, 12, 25)] == "Christmas Day"
    assert names[date(2099, 12, 28)] == "Boxing Day (substitute)"
    listed = views.holidays_view(uow_factory, clock, date(2099, 1, 1), date(2099, 12, 31))
    assert {h.name for h in listed} >= {"Christmas Day", "Boxing Day (substitute)"}
    assert all(h.source == "generated" and not h.suppressed for h in listed)
    old = views.holidays_view(uow_factory, clock, date(1995, 1, 1), date(1995, 12, 31))
    assert old[0].date == date(1995, 1, 2)
    assert _event_types(uow_factory) == events
    assert _covered(uow_factory) == covered


def test_plan_reads_need_setup(uow_factory: UnitOfWorkFactory, clock: FixedClock) -> None:
    with pytest.raises(SetupRequired):
        views.get_plan_state(uow_factory, clock)
    with pytest.raises(SetupRequired):
        views.day_view(uow_factory, clock, date(2026, 10, 5))
    home = views.home_view(uow_factory, clock)
    assert (home.needs_setup, home.countdown_bd, home.project_count) == (True, None, 0)


def test_plan_after_setup_only(
    uow_factory: UnitOfWorkFactory, clock: FixedClock, set_up: None
) -> None:
    plan = views.build_plan(uow_factory, clock)
    assert plan.projects == [] and plan.routines == []
    assert plan.verdict.state == "no_pc"
    assert plan.move.countdown_bd == 61
    assert plan.rotation.segments == [] and plan.rotation.current.status == "none"
    assert plan.rotation.title == "Fixed Income rotation"
    assert plan.counts.projects == 0
    assert plan.flags.attention == []
    day = views.day_view(uow_factory, clock, date(2026, 10, 5))
    assert (day.bau_rows, day.focus_blocks, day.next_run_after) == ([], [], None)
    snap = views.month_snapshot_view(uow_factory, clock, None)
    assert (snap.totals.total, snap.rows) == (0, [])
