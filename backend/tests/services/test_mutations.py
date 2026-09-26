"""``run_mutation``: one event per change, the plan after, movements with causes."""

from dataclasses import replace
from datetime import date

import pytest
from sqlalchemy import select

from app.core.clock import FixedClock
from app.core.errors import SetupRequired, ValidationFailed
from app.core.uow import MissingEventError, UnitOfWorkFactory, ref
from app.repositories import models as orm
from app.repositories.registry import PROJECTS
from app.schemas.mutation import ProjectMutationOut
from app.services.adapters import save_plan
from app.services.calendar import YearSpan, build_calendar
from app.services.dev_fixtures import SeedIds
from app.services.engine.calendar import OutOfCalendar
from app.services.engine.checkin import preview
from app.services.engine.forecast import RateEdit, refit
from app.services.engine.model import ScopeAdd
from app.services.mutations import MutationScope, movements_between, plan_movements, run_mutation
from app.services.views import get_plan_state


def _events(uow_factory: UnitOfWorkFactory) -> list[str]:
    with uow_factory.read() as uow:
        return [
            e.type for e in uow.session.scalars(select(orm.RemiEvent).order_by(orm.RemiEvent.seq))
        ]


def test_scope_slip_moves_ret_with_the_given_cause(
    uow_factory: UnitOfWorkFactory, clock: FixedClock, seeded: SeedIds
) -> None:
    def add_scope(m: MutationScope) -> str:
        before = m.require_before()
        (outcome,) = preview([ScopeAdd("ret", "FX attribution", 6)], before.plans, before.ctx)
        project = m.uow.repo(PROJECTS).require("ret")
        save_plan(project, outcome.after)
        m.cause("ret", "scope")
        m.uow.record("test.scope", [ref("project", "ret")], {"hours": 6})
        return "ret"

    result = run_mutation(uow_factory, clock, add_scope)
    (movement,) = result.movements
    assert movement.project_id == "ret"
    assert (movement.from_forecast, movement.to_forecast) == (date(2026, 12, 2), date(2026, 12, 7))
    assert (movement.delta_bd, movement.label, movement.cause) == (3, "+3 BD", "scope")
    assert movement.flash and movement.moved
    plan = result.require_plan()
    assert plan.verdict.state == "at_risk"
    ret = result.project("ret")
    assert ret.forecast_date == date(2026, 12, 7)
    assert ret.prev_forecast_date == date(2026, 12, 2)
    typed = result.with_entity(ProjectMutationOut, ret)
    assert typed.entity.id == "ret"
    assert _events(uow_factory)[-1] == "test.scope"


def test_rate_refit_through_the_before_state(
    uow_factory: UnitOfWorkFactory, clock: FixedClock, seeded: SeedIds
) -> None:
    def replan(m: MutationScope) -> None:
        before = m.require_before()
        plan = before.plan("ret")
        assert plan is not None
        new = refit(plan, RateEdit(3.8), before.ctx).plan
        save_plan(m.uow.repo(PROJECTS).require("ret"), new)
        m.uow.record("test.replan", [ref("project", "ret")], {"rate": 3.8})

    result = run_mutation(uow_factory, clock, replan, "rate")
    (movement,) = result.movements
    assert (movement.to_forecast, movement.cause, movement.delta_bd) == (
        date(2026, 11, 27),
        "rate",
        -3,
    )
    assert movement.label == "\u22123 BD"
    with uow_factory.read() as uow:
        ret = uow.repo(PROJECTS).require("ret")
        assert ret.hour_overrides[0].hours == pytest.approx(3.8)
        assert {r.routine_id: r.hours for r in ret.bau_day_hours}["r-man"] == pytest.approx(
            2 * 3.8 / 3.5
        )


def test_invalid_edit_is_a_422(
    uow_factory: UnitOfWorkFactory, clock: FixedClock, seeded: SeedIds
) -> None:
    def zero_rate(m: MutationScope) -> None:
        before = m.require_before()
        plan = before.plan("ret")
        assert plan is not None
        refit(plan, RateEdit(0), before.ctx)

    with pytest.raises(ValidationFailed):
        run_mutation(uow_factory, clock, zero_rate)


def test_a_change_without_an_event_is_refused(
    uow_factory: UnitOfWorkFactory, clock: FixedClock, seeded: SeedIds
) -> None:
    def forgetful(m: MutationScope) -> None:
        m.uow.repo(PROJECTS).require("ret").name = "Renamed"

    with pytest.raises(MissingEventError):
        run_mutation(uow_factory, clock, forgetful)
    with uow_factory.read() as uow:
        assert uow.repo(PROJECTS).require("ret").name == "Returns pipeline automation"


def test_mutations_need_setup_unless_told_otherwise(
    uow_factory: UnitOfWorkFactory, clock: FixedClock
) -> None:
    with pytest.raises(SetupRequired):
        run_mutation(uow_factory, clock, lambda m: None)

    def note(m: MutationScope) -> None:
        assert m.before is None
        m.uow.session.add(orm.Note(day=date(2026, 10, 5), text="Before setup", seq=0))
        m.uow.record("note.created", [])

    result = run_mutation(uow_factory, clock, note, require_setup=False)
    assert result.plan is None
    assert result.movements == []
    with pytest.raises(SetupRequired):
        result.out()


def test_out_of_calendar_inside_fn_widens_and_retries(
    uow_factory: UnitOfWorkFactory, clock: FixedClock, seeded: SeedIds
) -> None:
    spans: list[int] = []

    def far(m: MutationScope) -> date:
        before = m.require_before()
        spans.append(before.span.last)
        landed = before.ctx.cal.add_bd(date(2026, 10, 5), 1200)  # beyond the default years
        m.uow.record("test.far", [])
        return landed

    result = run_mutation(uow_factory, clock, far)
    assert result.value.year >= 2031
    assert len(spans) >= 2 and spans[-1] > spans[0]
    assert _events(uow_factory).count("test.far") == 1


def test_the_plan_cache_follows_the_revision(
    uow_factory: UnitOfWorkFactory, clock: FixedClock, seeded: SeedIds
) -> None:
    first = get_plan_state(uow_factory, clock)
    assert get_plan_state(uow_factory, clock) is first

    def rename(m: MutationScope) -> None:
        m.uow.repo(PROJECTS).require("ret").name = "Returns engine"
        m.uow.record("test.rename", [ref("project", "ret")])

    result = run_mutation(uow_factory, clock, rename, "target")
    assert result.movements == []
    second = get_plan_state(uow_factory, clock)
    assert second is not first
    assert second.revision == first.revision + 1
    assert result.project("ret").name == "Returns engine"
    later = FixedClock(date(2026, 10, 6))
    moved_on = get_plan_state(uow_factory, later)
    assert moved_on.today == date(2026, 10, 6)
    assert moved_on.out.move.countdown_bd == 60


def test_movements_are_diffed_on_a_calendar_covering_both_plans(
    uow_factory: UnitOfWorkFactory, clock: FixedClock, seeded: SeedIds
) -> None:
    state = get_plan_state(uow_factory, clock)
    far = date(2031, 6, 2)
    # Before: ret's forecast lies in 2031, beyond the calendar of the plan after.
    before = replace(
        state,
        span=state.span.union(YearSpan(2031, 2032)),
        plans=tuple(replace(p, forecast=far) if p.id == "ret" else p for p in state.plans),
    )
    narrow = YearSpan(2025, 2028)
    after = replace(state, span=narrow, ctx=replace(state.ctx, cal=build_calendar({}, narrow)))
    with pytest.raises(OutOfCalendar):
        plan_movements(before.plans, after.plans, after.cal, {})
    events = _events(uow_factory)
    moved = movements_between(uow_factory, clock, before, after, {"ret": "scope"})
    assert [(m.project_id, m.from_forecast, m.to_forecast, m.cause) for m in moved] == [
        ("ret", far, date(2026, 12, 2), "scope")
    ]
    assert moved[0].delta_bd < -1000 and moved[0].moved
    assert _events(uow_factory) == events  # the wider calendar is built in memory
