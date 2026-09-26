"""ORM rows <-> engine dataclasses."""

from dataclasses import replace
from datetime import date

from app.core.clock import FixedClock
from app.core.uow import UnitOfWorkFactory, ref
from app.repositories.registry import PROJECTS, ROTATION, ROUTINES, SETTINGS
from app.services.adapters import (
    engine_ctx,
    plan_of,
    project_of,
    rotation_of,
    routine_of,
    save_plan,
)
from app.services.calendar import YearSpan, calendar_for
from app.services.dev_fixtures import SeedIds
from app.services.engine.forecast import finish_for, plan_from, work_left
from tests.engine import seed as engine_seed


def test_the_design_seed_adapts_to_the_engine_seed(
    uow_factory: UnitOfWorkFactory, clock: FixedClock, seeded: SeedIds
) -> None:
    """The fixture in the database is exactly the engine's own test seed."""
    with uow_factory.read() as uow:
        projects = uow.repo(PROJECTS).list()
        plans = {p.id: plan_of(p) for p in projects}
        for pid, expected in engine_seed.PLANS.items():
            assert plans[pid] == expected, pid
        routines = [routine_of(r) for r in uow.repo(ROUTINES).list()]
        # The engine seed leaves the (unused) weekday of these monthly routines at 1; the
        # prototype stores 2 (Tuesday).
        assert [replace(r, weekday=1) for r in routines] == list(engine_seed.ROUTINES)
        rotation = rotation_of(uow.repo(ROTATION).get_active())
        assert rotation is not None
        assert [(s.country, s.code, s.length_bd, s.kind) for s in rotation.segments] == [
            (s.country, s.code, s.length_bd, s.kind) for s in engine_seed.ROTATION.segments
        ]
        assert rotation.hours_per_day == 4
        ret = project_of(next(p for p in projects if p.id == "ret"))
        expected = engine_seed.project("ret")
        assert ret.milestones == expected.milestones
        assert (ret.name, ret.confidence, ret.last_checkin) == (
            expected.name,
            expected.confidence,
            expected.last_checkin,
        )
        assert (ret.baseline_h, ret.scope_added_h) == (60, 10)
        settings = uow.repo(SETTINGS).get()
        cal = calendar_for(uow_factory, clock, "GB-ENG", YearSpan(2026, 2029), persist=True)
        ctx = engine_ctx(settings, cal, today=clock.today(), routines=routines, rotation=rotation)
        assert (ctx.move, ctx.capacity, ctx.key_project_id, ctx.key_routine_id) == (
            date(2027, 1, 4),
            8,
            "ret",
            "r-ret",
        )
        plan = plans["ret"]
        left = work_left(plan, ctx)
        assert left == 144
        assert finish_for(plan, plan_from(plan, ctx), left, ctx).day == plan.forecast


def test_save_plan_round_trips(uow_factory: UnitOfWorkFactory, seeded: SeedIds) -> None:
    with uow_factory() as uow:
        project = uow.repo(PROJECTS).require("manco")
        plan = plan_of(project)
        changed = replace(
            plan,
            forecast=date(2026, 12, 14),
            prev=date(2026, 12, 11),
            rate=2.0,
            overrides={date(2026, 11, 5): 1.0},
            bau_day_hours={"r-ret": 2.5},
            unplaced_h=0.5,
        )
        save_plan(project, changed)
        uow.record("test.save", [ref("project", "manco")])
    with uow_factory.read() as uow:
        assert plan_of(uow.repo(PROJECTS).require("manco")) == changed
