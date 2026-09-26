from dataclasses import replace

from app.services.engine.checkin import (
    apply_changes,
    diff_movements,
    plan_project_changes,
    preview,
    summarise_checkin,
)
from app.services.engine.derive import derive_project
from app.services.engine.forecast import RateEdit, apply_scope, refit
from app.services.engine.loads import build_loads
from app.services.engine.model import (
    BauDone,
    Blocker,
    Change,
    Confidence,
    HoursPerDay,
    Note,
    ScopeAdd,
    TargetMove,
    TaskAdd,
    TaskDone,
)
from tests.engine import seed as S

d = S.d
RET = S.PLANS["ret"]


def test_changes_that_never_move_the_forecast() -> None:
    changes: list[Change] = [
        TaskDone("ret", "ret-2"),
        TaskAdd("ret", "More", 2),
        Note("ret", "Progress."),
        Blocker("ret", "the admin"),
        Confidence("ret", 4),
        BauDone("r-ret"),
    ]
    out = plan_project_changes(RET, changes, S.ctx())
    assert out.after == RET
    assert (out.delta_bd, out.label, out.causes, out.moved) == (0, "\u00b10 BD", (), False)
    assert out.late


def test_last_target_move_wins_and_snaps() -> None:
    changes: list[Change] = [
        TargetMove("ret", d("2026-12-31")),
        TargetMove("ret", d("2026-12-05")),
    ]
    out = plan_project_changes(RET, changes, S.ctx())
    assert out.target_after == d("2026-12-07")
    assert out.after.forecast == RET.forecast
    assert (out.late, out.past_target_bd, out.causes) == (False, None, ("target",))
    same = plan_project_changes(RET, [TargetMove("ret", RET.target)], S.ctx())
    assert same.causes == ()


def test_target_move_can_make_a_project_late() -> None:
    out = plan_project_changes(RET, [TargetMove("ret", d("2026-11-20"))], S.ctx())
    assert (out.delta_bd, out.late, out.past_target_bd) == (0, True, 8)


def test_first_positive_hours_a_day_is_a_rate_refit() -> None:
    c = S.ctx()
    changes: list[Change] = [HoursPerDay("ret", 0), HoursPerDay("ret", 4), HoursPerDay("ret", 2)]
    out = plan_project_changes(RET, changes, c)
    assert out.after == refit(RET, RateEdit(4), c).plan
    assert out.causes == ("rate",)
    assert plan_project_changes(RET, [HoursPerDay("ret", 3.5)], c).causes == ()


def test_scope_is_summed_and_slips_the_plan_after_the_rate_change() -> None:
    c = S.ctx()
    changes: list[Change] = [
        ScopeAdd("ret", "A", 2),
        HoursPerDay("ret", 4),
        ScopeAdd("ret", "B", 4),
    ]
    out = plan_project_changes(RET, changes, c)
    expected = apply_scope(refit(RET, RateEdit(4), c).plan, 6, c)
    assert out.after.forecast == expected.forecast
    assert out.after.prev == RET.forecast
    assert out.scope_h == 6
    assert (out.scope_from, out.scope_to) == (d("2026-11-25"), expected.forecast)
    assert out.causes == ("rate", "scope")
    assert out.to_forecast == expected.forecast


def test_a_forecast_that_holds_keeps_prev() -> None:
    out = plan_project_changes(RET, [ScopeAdd("ret", "tiny", 0.005)], S.ctx())
    assert out.after.forecast == RET.forecast
    assert out.after.prev == RET.prev
    assert out.scope_slip_bd == 0


def test_define_project() -> None:
    alpha = S.PLANS["alpha"]
    out = plan_project_changes(alpha, [ScopeAdd("alpha", "x", 5), HoursPerDay("alpha", 4)], S.ctx())
    assert out.after.forecast is None
    assert out.after.rate == 4
    assert (out.delta_bd, out.label, out.late, out.scope_slip_bd) == (None, "", False, 0)
    assert out.causes == ("rate",)


def test_preview_orders_projects_and_skips_unknown_ids() -> None:
    changes: list[Change] = [
        Note("manco", "x"),
        ScopeAdd("ghost", "x", 3),
        BauDone("r-ret"),
        ScopeAdd("ret", "x", 6),
        Note("manco", "y"),
    ]
    outs = preview(changes, S.plans(), S.ctx())
    assert [o.project_id for o in outs] == ["manco", "ret"]
    manco, ret = outs
    assert (manco.new_over, manco.misses_key_run, manco.crosses_move) == ((), False, False)
    assert ret.misses_key_run
    assert not ret.crosses_move
    assert preview([BauDone("r-ret")], S.plans(), S.ctx()) == []


def test_preview_flags_crossing_the_move() -> None:
    (out,) = preview([ScopeAdd("play", "big", 40)], S.plans(), S.ctx())
    assert out.to_forecast is not None
    assert out.to_forecast >= S.MOVE
    assert out.crosses_move
    assert out.after.unplaced_h > 0


def test_preview_new_overloads_from_a_rate_increase() -> None:
    (out,) = preview([HoursPerDay("manco", 2)], S.plans(), S.ctx())
    assert [o.day for o in out.new_over] == [d("2026-10-05"), d("2026-10-12"), d("2026-11-11")]


def test_apply_returns_updated_plans_in_order() -> None:
    plans, outs = apply_changes([ScopeAdd("ret", "x", 6)], S.plans(), S.ctx())
    assert [p.id for p in plans] == list(S.ORDER)
    assert plans[0] == outs[0].after
    assert plans[1:] == S.plans()[1:]


def test_diff_movements() -> None:
    c = S.ctx()
    before = S.plans()
    after_ret = replace(RET, forecast=d("2026-12-07"))
    after_play = replace(S.PLANS["play"], target=d("2026-12-22"))
    after_alpha = replace(S.PLANS["alpha"], forecast=d("2027-03-01"))
    after = [after_ret, S.PLANS["manco"], after_play, S.PLANS["fion"], after_alpha]
    moves = diff_movements(before, after, {"ret": "scope"}, c.cal)
    assert [(m.project_id, m.cause, m.delta_bd, m.label, m.flash, m.moved) for m in moves] == [
        ("ret", "scope", 3, "+3 BD", True, True),
        ("play", "checkin", 0, "\u00b10 BD", False, False),
        ("alpha", "checkin", None, "", True, False),
    ]
    assert moves[1].to_target == d("2026-12-22")
    new = replace(RET, id="new")
    assert diff_movements(before, [new], {}, c.cal) == []


def test_summarise_checkin() -> None:
    changes: list[Change] = [
        Note("ret", "Engine runs for 8 funds."),
        Note("ret", "Admin slow"),
        ScopeAdd("ret", "FX attribution", 6),
        ScopeAdd("ret", "Extra checks", 1.5),
        Blocker("ret", "the admin extract"),
        Blocker("ret", "second"),
        Confidence("ret", 2),
        TaskDone("ret", "ret-2"),
        TaskAdd("ret", "Chase", 1),
        Note("manco", "other project"),
    ]
    s = summarise_checkin("ret", changes)
    assert s.changed == "Engine runs for 8 funds. Admin slow"
    assert s.scope_what == "FX attribution, Extra checks"
    assert s.scope_h == 7.5
    assert (s.blocker, s.confidence) == ("the admin extract", 2)
    assert s.done_task_ids == ("ret-2",)
    assert [t.text for t in s.task_adds] == ["Chase"]
    assert s.record_note == (
        "Engine runs for 8 funds. Admin slow. FX attribution, Extra checks added, +7.5h. "
        "Blocked: the admin extract"
    )
    empty = summarise_checkin("ret", [TargetMove("ret", d("2026-12-04"))])
    assert (empty.record_note, empty.scope_what, empty.blocker) == (
        "Plan confirmed.",
        "New scope",
        None,
    )


def test_late_matches_the_project_status_when_the_target_is_not_a_business_day() -> None:
    # A holiday added on the target leaves it on a day off. Landing on the next business day is
    # on target for the status (bd_diff), so the preview does not call it late either.
    c = S.ctx()
    ret = replace(S.PLANS["ret"], target=d("2026-12-05"))  # a Saturday
    out = plan_project_changes(ret, [ScopeAdd("ret", "x", 6)], c)
    assert out.to_forecast == d("2026-12-07")
    assert (out.late, out.past_target_bd) == (False, None)
    loads = build_loads(c.today, c.today, [out.after], c)
    assert derive_project(S.project("ret", out.after), c, loads).status == "on"
    later = plan_project_changes(ret, [ScopeAdd("ret", "x", 10)], c)
    assert (later.late, later.past_target_bd) == (True, 1)
