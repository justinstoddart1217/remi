from dataclasses import replace
from datetime import date

import pytest

from remi.services.engine.derive import derive_project, derived_milestones
from remi.services.engine.forecast import apply_scope
from remi.services.engine.loads import DayLoad, build_loads
from remi.services.engine.model import Milestone, Project, ProjectPlan
from remi.tests.engine import seed as S

d = S.d


@pytest.fixture(scope="module")
def loads() -> dict[date, DayLoad]:
    return build_loads(d("2026-09-01"), d("2027-04-30"), S.plans(), S.ctx())


def test_status_delta_and_labels(loads: dict[date, DayLoad]) -> None:
    c = S.ctx()
    manco = derive_project(S.project("manco"), c, loads)
    assert (manco.status, manco.delta_bd, manco.delta_label) == ("on", 0, "On target")
    assert (manco.since_days, manco.since_label, manco.stale) == (9, "9 days ago", True)
    alpha = derive_project(S.project("alpha"), c, loads)
    assert (alpha.status, alpha.delta_bd, alpha.delta_label) == ("define", None, "No forecast")
    assert (alpha.since_days, alpha.since_label, alpha.stale) == (None, "Not yet", False)
    early = S.project("play", replace(S.PLANS["play"], target=d("2026-12-22")))
    dp = derive_project(early, c, loads)
    assert (dp.status, dp.delta_label) == ("on", "\u22122 BD")


def test_growth(loads: dict[date, DayLoad]) -> None:
    c = S.ctx()
    assert derive_project(S.project("ret"), c, loads).growth_pct == 17
    assert derive_project(S.project("manco"), c, loads).growth_pct == 0
    assert derive_project(S.project("alpha"), c, loads).growth_pct is None


def test_workspace_metrics_for_ret(loads: dict[date, DayLoad]) -> None:
    dp = derive_project(S.project("ret"), S.ctx(), loads)
    assert dp.work_left == pytest.approx(144)
    assert dp.bd_left == 43
    assert dp.bd_to_target == 40
    assert dp.buffer_bd == -3
    assert dp.avg_plan == pytest.approx(144 / 43)
    assert not dp.avg_differs
    assert dp.started
    assert dp.starts_in_bd is None
    assert dp.progress_pct == pytest.approx(15 / 58 * 100)
    assert dp.over_days == (d("2026-11-04"),)
    assert dp.now_estimate_h == 14
    assert dp.day_hours[d("2026-10-06")] == 3.5
    assert d("2026-10-05") not in dp.day_hours
    assert dp.next_milestone is not None
    assert dp.next_milestone.name == "Security-level data feed connected"


def test_avg_differs_when_bau_days_pull_the_average_down(loads: dict[date, DayLoad]) -> None:
    plan = replace(S.PLANS["manco"], rate=3.0, bau_day_hours={"r-ret": 0, "r-man": 0})
    p = S.project("manco", plan)
    dp = derive_project(p, S.ctx(), loads)
    assert dp.avg_differs


def test_sentence_cases(loads: dict[date, DayLoad]) -> None:
    c = S.ctx()
    no_plan = derive_project(S.project("alpha"), c, loads).sentence
    assert (no_plan.case, no_plan.dot, no_plan.late, no_plan.starts_in_bd) == (
        "no_plan",
        "ink_faint",
        False,
        None,
    )
    late = derive_project(S.project("ret"), c, loads).sentence
    assert (late.case, late.dot, late.late, late.late_bd) == ("late", "risk", True, 3)
    assert (late.need_rate, late.need_state, late.cut_h, late.rate) == (3.8, "ok", 10.5, 3.5)
    assert (late.over_days, late.first_over_day, late.stale_days) == (1, d("2026-11-04"), None)
    no_buffer = derive_project(S.project("manco"), c, loads).sentence
    assert (no_buffer.case, no_buffer.dot, no_buffer.buffer_bd) == ("no_buffer", "risk", 0)
    assert no_buffer.stale_days == 9
    early = S.project("play", replace(S.PLANS["play"], target=d("2026-12-22")))
    buffer = derive_project(early, c, loads).sentence
    assert (buffer.case, buffer.dot, buffer.buffer_bd, buffer.absorb_h) == ("buffer", "ink", 2, 2)


def test_sentence_after_the_move(loads: dict[date, DayLoad]) -> None:
    c = S.ctx()
    late_plan = apply_scope(S.PLANS["ret"], 200, c)
    dp = derive_project(S.project("ret", late_plan), c, loads)
    assert dp.sentence.case == "after_move"
    assert dp.sentence.dot == "overload"
    assert dp.sentence.cut_h == pytest.approx(round(late_plan.unplaced_h, 1))


def test_not_started_project(loads: dict[date, DayLoad]) -> None:
    c = S.ctx()
    future = ProjectPlan(
        "f", "fi", d("2026-10-12"), d("2026-10-30"), d("2026-10-16"), rate=2, short="F"
    )
    dp = derive_project(Project(future), c, loads)
    assert not dp.started
    assert dp.starts_in_bd == 5
    assert dp.sentence.starts_in_bd == 5
    assert dp.progress_pct == 0
    assert dp.work_left == 10
    assert dp.bd_left == 5


def test_target_passed(loads: dict[date, DayLoad]) -> None:
    passed = replace(S.PLANS["ret"], target=d("2026-10-01"))
    dp = derive_project(S.project("ret", passed), S.ctx(), loads)
    assert dp.bd_to_target == 0
    assert dp.need.state == "target_passed"
    assert dp.sentence.need_rate is None


def test_derived_milestones_are_keyed_by_id_and_deduplicated() -> None:
    ms = derived_milestones(S.project("ret"), S.TODAY)
    assert [(m.id, m.day) for m in ms] == [
        ("ret-now-0", d("2026-10-15")),
        ("ret-now-1", d("2026-10-16")),
        ("ret-next-0", d("2026-11-04")),
        ("ret-next-1", d("2026-11-20")),
        ("ret-next-2", d("2026-11-27")),
    ]
    fion = derived_milestones(S.project("fion"), S.TODAY)
    assert [m.name for m in fion] == [
        "Data entitlements requested",
        "Curve & auction data feeds",
        "Sovereign model walkthrough",
        "Day-one dry run",
    ]
    assert fion[-1].horizon == "explicit"


def test_later_plan_item_with_the_same_name_wins() -> None:
    p = Project(
        S.PLANS["ret"],
        milestones=(
            Milestone("a", "Same", d("2026-10-01"), "now"),
            Milestone("b", "Same", d("2026-11-01"), "next"),
            Milestone("c", "", d("2026-11-02"), "next"),
            Milestone("e", "Undated", None, "next"),
        ),
    )
    ms = derived_milestones(p, S.TODAY)
    assert [(m.id, m.passed) for m in ms] == [("b", False)]
    past = derived_milestones(p, d("2026-11-05"))
    assert past[0].passed


def test_milestones_with_a_repeated_name_keep_their_first_position() -> None:
    p = Project(
        S.PLANS["ret"],
        milestones=(
            Milestone("a", "First", d("2026-11-01"), "now"),
            Milestone("b", "Second", d("2026-11-01"), "now"),
            Milestone("c", "First", d("2026-11-01"), "next"),
        ),
    )
    assert [m.id for m in derived_milestones(p, S.TODAY)] == ["c", "b"]


def test_unplaced_hours_count_as_landing_after_the_move() -> None:
    c = S.ctx()
    play = replace(S.PLANS["play"], overrides={d("2026-12-31"): 0})
    slipped = apply_scope(play, 16, c)
    assert slipped.unplaced_h > 0
    loads = build_loads(d("2026-09-01"), d("2027-04-30"), S.plans(), c)
    dp = derive_project(S.project("play", slipped), c, loads)
    assert (dp.sentence.case, dp.status) == ("after_move", "risk")
    # A stored plan whose forecast predates the stall rule still reads as after the move.
    legacy = replace(slipped, forecast=d("2026-12-31"))
    assert derive_project(S.project("play", legacy), c, loads).sentence.case == "after_move"


def test_unplaced_fixed_income_hours_are_not_on_track() -> None:
    # Fixed Income work stalls only with an explicit 0h after the move; its unplaced hours
    # count like Private Credit ones, whatever the target says.
    c = S.ctx()
    fion = replace(S.PLANS["fion"], rate_after=0.0, target=d("2027-03-01"))
    slipped = apply_scope(fion, 40, c)
    assert (slipped.forecast, slipped.unplaced_h > 0) == (S.MOVE, True)
    loads = build_loads(d("2026-09-01"), d("2027-04-30"), S.plans(), c)
    dp = derive_project(S.project("fion", slipped), c, loads)
    assert (dp.status, dp.sentence.case, dp.sentence.late) == ("risk", "after_move", True)
    assert dp.sentence.cut_h == pytest.approx(slipped.unplaced_h)
