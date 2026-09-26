"""Property tests for the unified forecast maths (ADR-0007).

- preview == apply: the plan a check-in saves is exactly what its preview showed, and the read
  model re-derives the same forecast from it;
- the ``finish_for`` invariant: ``finish_for(from, work_left(p)) == p.forecast``;
- refit idempotence: repeating a rate, work-left or start edit changes nothing;
- work conservation: rescaling is linear, and a rate refit keeps the work left.

Values are multiples of 0.25h, so every positive day exceeds ``eps`` (the invariant's
precondition); after a rescale the precondition is checked with ``assume``.
"""

from dataclasses import replace
from datetime import date

import pytest
from hypothesis import HealthCheck, assume, given, reject, settings
from hypothesis import strategies as st

from app.services.engine.calendar import OutOfCalendar
from app.services.engine.checkin import apply_changes, preview
from app.services.engine.derive import derive_project
from app.services.engine.forecast import (
    Edit,
    RateEdit,
    Refit,
    StartEdit,
    WorkLeftEdit,
    day_hours,
    finish_for,
    plan_from,
    refit,
    rescale,
    with_finish,
    work_between,
    work_left,
)
from app.services.engine.loads import build_loads
from app.services.engine.model import (
    BauDone,
    Blocker,
    Change,
    Confidence,
    HoursPerDay,
    Note,
    ProjectPlan,
    ScopeAdd,
    TargetMove,
    TaskAdd,
)
from tests.engine import seed as S

C = S.ctx()
EPS = C.eps
BDS = C.cal.bds(date(2026, 9, 1), date(2027, 6, 30))
STARTS = BDS[:130]
PIDS = list(S.ORDER)

PROPS = settings(
    max_examples=120,
    deadline=None,
    database=None,
    suppress_health_check=[HealthCheck.too_slow],
)

quarter = st.integers(min_value=0, max_value=32).map(lambda n: n / 4)
pos_quarter = st.integers(min_value=1, max_value=32).map(lambda n: n / 4)
work_hours = st.integers(min_value=1, max_value=600).map(lambda n: n / 4)


@st.composite
def plans(draw: st.DrawFn) -> ProjectPlan:
    start = draw(st.sampled_from(STARTS))
    target = draw(st.sampled_from([x for x in BDS if x >= start]))
    routines = draw(st.sets(st.sampled_from(["r-ret", "r-man"])))
    overrides = draw(st.dictionaries(st.sampled_from(BDS), quarter, max_size=4))
    return ProjectPlan(
        id="p",
        domain=draw(st.sampled_from(["pc", "fi"])),
        start=start,
        target=target,
        rate=draw(pos_quarter),
        rate_after=draw(quarter),
        bau_day_hours={r: draw(quarter) for r in sorted(routines)},
        overrides=overrides,
        short="P",
    )


def min_positive(p: ProjectPlan) -> float:
    values = [p.rate, p.rate_after, *p.bau_day_hours.values(), *p.overrides.values()]
    return min((v for v in values if v > 0), default=1.0)


def planned(p: ProjectPlan, hours: float) -> ProjectPlan:
    return with_finish(p, finish_for(p, plan_from(p, C), hours, C))


def refit_or_reject(p: ProjectPlan, edit: Edit) -> Refit:
    """A refit; tiny rescaled rates can outrun the calendar, which the service extends."""
    try:
        return refit(p, edit, C)
    except OutOfCalendar:
        reject()


# ---------------------------------------------------------------- finish_for invariant
@PROPS
@given(plan=plans(), hours=work_hours)
def test_finish_for_invariant(plan: ProjectPlan, hours: float) -> None:
    placed = planned(plan, hours)
    left = work_left(placed, C)
    assert left is not None
    again = finish_for(placed, plan_from(placed, C), left, C)
    assert again.day == placed.forecast
    assert again.short_h == pytest.approx(placed.unplaced_h, abs=1e-9)
    assert left == pytest.approx(hours, abs=1e-9) if placed.unplaced_h > 0 else left >= hours - EPS


@PROPS
@given(plan=plans(), hours=work_hours)
def test_the_forecast_is_the_first_day_that_covers_the_work(
    plan: ProjectPlan, hours: float
) -> None:
    placed = planned(plan, hours)
    assert placed.forecast is not None
    if placed.unplaced_h > 0:
        return
    frm = plan_from(placed, C)
    assert day_hours(placed, placed.forecast, C) > 0
    before = work_between(placed, frm, placed.forecast, C) - day_hours(placed, placed.forecast, C)
    assert before < hours - EPS


# ---------------------------------------------------------------- refit idempotence
@PROPS
@given(plan=plans(), hours=work_hours, rate=pos_quarter)
def test_rate_refit_is_idempotent(plan: ProjectPlan, hours: float, rate: float) -> None:
    base = planned(plan, hours)
    once = refit_or_reject(base, RateEdit(rate)).plan
    assume(min_positive(once) > EPS)
    twice = refit(once, RateEdit(rate), C)
    assert twice.plan.forecast == once.forecast
    assert twice.plan.unplaced_h == pytest.approx(once.unplaced_h, abs=1e-9)
    assert not twice.moved
    left = work_left(once, C)
    assert left is not None
    assert refit(once, WorkLeftEdit(left), C).plan.forecast == once.forecast


@PROPS
@given(plan=plans(), hours=work_hours, start=st.sampled_from(STARTS))
def test_start_refit_is_idempotent(plan: ProjectPlan, hours: float, start: date) -> None:
    base = planned(plan, hours)
    once = refit(base, StartEdit(start), C).plan
    twice = refit(once, StartEdit(start), C).plan
    assert twice.forecast == once.forecast
    assert twice.start == once.start == C.cal.next_bd(start)


# ---------------------------------------------------------------- work conservation
@PROPS
@given(plan=plans(), rate=pos_quarter, a=st.sampled_from(BDS), b=st.sampled_from(BDS))
def test_rescale_is_linear(plan: ProjectPlan, rate: float, a: date, b: date) -> None:
    k = rate / plan.rate
    scaled = work_between(rescale(plan, rate), a, b, C)
    assert scaled == pytest.approx(k * work_between(plan, a, b, C), abs=1e-6)


@PROPS
@given(plan=plans(), hours=work_hours, rate=pos_quarter)
def test_rate_refit_conserves_work(plan: ProjectPlan, hours: float, rate: float) -> None:
    base = planned(plan, hours)
    left = work_left(base, C)
    assert left is not None
    new = refit_or_reject(base, RateEdit(rate)).plan
    assume(min_positive(new) > EPS)
    new_left = work_left(new, C)
    assert new_left is not None
    assert new.forecast is not None
    if new.unplaced_h > 0:
        assert new_left == pytest.approx(left, abs=1e-6)
    else:
        assert new_left >= left - EPS - 1e-9
        assert new_left - day_hours(new, new.forecast, C) < left - EPS + 1e-9


# ---------------------------------------------------------------- preview == apply
changes_st: st.SearchStrategy[Change] = st.one_of(
    st.builds(
        ScopeAdd,
        st.sampled_from(PIDS),
        st.just("scope"),
        st.integers(min_value=1, max_value=160).map(lambda n: n / 4),
    ),
    st.builds(HoursPerDay, st.sampled_from(PIDS), pos_quarter),
    st.builds(TargetMove, st.sampled_from(PIDS), st.sampled_from(BDS)),
    st.builds(TaskAdd, st.sampled_from(PIDS), st.just("task"), pos_quarter),
    st.builds(Note, st.sampled_from(PIDS), st.just("note")),
    st.builds(Blocker, st.sampled_from(PIDS), st.just("blocker")),
    st.builds(Confidence, st.sampled_from(PIDS), st.integers(min_value=1, max_value=5)),
    st.just(BauDone("r-ret")),
)


@PROPS
@given(changes=st.lists(changes_st, max_size=6))
def test_preview_equals_apply(changes: list[Change]) -> None:
    plans_before = S.plans()
    shown = preview(changes, plans_before, C)
    saved, applied = apply_changes(changes, plans_before, C)
    assert shown == applied
    stored = {p.id: p for p in saved}
    for out in shown:
        plan = stored[out.project_id]
        assert plan == out.after
        assert plan.forecast == out.to_forecast
        assert plan.target == out.target_after
        if plan.forecast is None:
            continue
        # The read model re-derives the same forecast from what apply saved.
        left = work_left(plan, C)
        assert left is not None
        assert finish_for(plan, plan_from(plan, C), left, C).day == plan.forecast
    # Previewing nothing on the saved plans moves nothing.
    again, _ = apply_changes([], saved, C)
    assert again == saved


@PROPS
@given(changes=st.lists(changes_st, min_size=1, max_size=4))
def test_derived_projects_match_the_preview(changes: list[Change]) -> None:
    saved, outcomes = apply_changes(changes, S.plans(), C)
    by_id = {p.id: p for p in saved}
    loads = build_loads(C.today, C.today, saved, C)
    for out in outcomes:
        project = S.project(out.project_id, by_id[out.project_id])
        derived = derive_project(project, C, loads)
        expected = (
            C.cal.bd_diff(out.target_after, out.to_forecast)
            if out.to_forecast is not None
            else None
        )
        assert derived.delta_bd == expected
        # At risk: the forecast is after the target, or hours are unplaced (they never land,
        # so a stall on the target day is not on track either).
        assert (derived.status == "risk") == (out.late or out.after.unplaced_h > 0)


def test_the_seed_satisfies_the_invariant() -> None:
    for p in S.plans():
        if p.forecast is None:
            continue
        left = work_left(p, C)
        assert left is not None
        assert finish_for(p, plan_from(p, C), left, C).day == p.forecast
        assert refit(p, RateEdit(p.rate), C).plan == replace(p)
