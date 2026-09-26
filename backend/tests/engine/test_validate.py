from dataclasses import replace
from datetime import date

import pytest

from remi.services.engine.model import (
    BauDone,
    Blocker,
    Confidence,
    HoursPerDay,
    Note,
    ScopeAdd,
    TargetMove,
    TaskAdd,
    TaskDone,
)
from remi.services.engine.validate import (
    RawProposal,
    ValidatedProposal,
    ValidationState,
    change_key,
    validate,
    validation_state,
)
from tests.engine import seed as S

d = S.d


def state(today: date = S.TODAY) -> ValidationState:
    return validation_state(S.projects(), S.ctx(today))


def run(*changes: object) -> ValidatedProposal:
    return validate({"summary": "s", "changes": list(changes), "unplaced": []}, state())


def test_validation_state() -> None:
    st = state()
    assert st.project_confidence["alpha"] is None
    assert st.open_tasks["ret-2"] == "ret"
    assert "ret-1" not in st.open_tasks
    assert st.routines_today == frozenset({"r-ret"})
    assert st.capacity == 8


def test_type_and_project_checks() -> None:
    out = run(
        None,
        "text",
        {},
        {"type": ""},
        {"type": "explode", "project_id": "ret"},
        {"type": "note", "project_id": "ghost", "text": "x"},
        {"type": "note", "text": "x"},
    )
    assert out.changes == ()
    assert [x.reason for x in out.dropped] == [
        "not an object",
        "not an object",
        "no type",
        "no type",
        "unknown type 'explode'",
        "unknown project",
        "unknown project",
    ]


def test_bau_done_needs_a_routine_that_runs_today() -> None:
    assert run({"type": "bau_done", "routine_id": "r-ret"}).changes == (BauDone("r-ret"),)
    assert run({"type": "bau_done", "routine_id": "r-man"}).dropped[0].reason == (
        "routine does not run today"
    )
    assert run({"type": "bau_done", "routine_id": "nope"}).dropped[0].reason == "unknown routine"


def test_task_done_needs_an_open_task_of_that_project() -> None:
    out = run(
        {"type": "task_done", "project_id": "ret", "task_id": "ret-2"},
        {"type": "task_done", "project_id": "ret", "task_id": "ret-1"},
        {"type": "task_done", "project_id": "manco", "task_id": "ret-3"},
        {"type": "task_done", "project_id": "ret", "task_id": 3},
    )
    assert out.changes == (TaskDone("ret", "ret-2"),)
    assert len(out.dropped) == 3


def test_task_and_scope_text_and_hours() -> None:
    long = "x" * 200
    out = run(
        {"type": "task_add", "project_id": "ret", "text": long},
        {"type": "task_add", "project_id": "ret", "text": "Two", "hours": "2.5"},
        {"type": "scope_add", "project_id": "ret", "text": "Scope"},
        {"type": "scope_add", "project_id": "ret", "text": "Big", "hours": 500},
        {"type": "scope_add", "project_id": "ret", "text": "Neg", "hours": -3},
        {"type": "scope_add", "project_id": "ret", "text": "   "},
        {"type": "task_add", "project_id": "ret", "text": 7},
        {"type": "task_add", "project_id": "ret", "text": "Bool", "hours": True},
    )
    assert out.changes == (
        TaskAdd("ret", "x" * 120, 1),
        TaskAdd("ret", "Two", 2.5),
        ScopeAdd("ret", "Scope", 0.25),
        ScopeAdd("ret", "Big", 80),
        ScopeAdd("ret", "Neg", 0.25),
        TaskAdd("ret", "Bool", 1),
    )
    assert [x.reason for x in out.dropped] == ["no text", "no text"]


def test_blockers_and_one_note_per_project() -> None:
    out = run(
        {"type": "blocker", "project_id": "ret", "text": "y" * 300},
        {"type": "note", "project_id": "ret", "text": "first"},
        {"type": "note", "project_id": "ret", "text": "second"},
        {"type": "note", "project_id": "manco", "text": "other"},
        {"type": "blocker", "project_id": "ret"},
    )
    assert out.changes == (
        Blocker("ret", "y" * 160),
        Note("ret", "first"),
        Note("manco", "other"),
    )
    assert [x.reason for x in out.dropped] == ["only one note per project", "no text"]


def test_confidence() -> None:
    out = run(
        {"type": "confidence", "project_id": "ret", "value": 3},
        {"type": "confidence", "project_id": "ret", "value": 4.5},
        {"type": "confidence", "project_id": "manco", "value": 6},
        {"type": "confidence", "project_id": "manco", "value": 0.4},
        {"type": "confidence", "project_id": "alpha", "value": "2"},
        {"type": "confidence", "project_id": "play", "value": "high"},
    )
    assert out.changes == (Confidence("ret", 5), Confidence("alpha", 2))
    assert [x.reason for x in out.dropped] == [
        "confidence unchanged",
        "confidence outside 1..5",
        "confidence outside 1..5",
        "confidence is not a number",
    ]


def test_target_move() -> None:
    out = run(
        {"type": "target_move", "project_id": "ret", "date": "2026-12-05"},
        {"type": "target_move", "project_id": "play", "date": "2026-12-25"},
        {"type": "target_move", "project_id": "ret", "date": "8 Jan"},
        {"type": "target_move", "project_id": "ret", "date": "2026-02-30"},
        {"type": "target_move", "project_id": "ret", "date": "2031-01-06"},
    )
    assert out.changes == (
        TargetMove("ret", d("2026-12-07")),
        TargetMove("play", d("2026-12-29")),
    )
    assert [x.reason for x in out.dropped] == [
        "date is not YYYY-MM-DD",
        "date is not YYYY-MM-DD",
        "date outside the calendar",
    ]


def test_hours_per_day() -> None:
    out = run(
        {"type": "hours_per_day", "project_id": "ret", "value": 4},
        {"type": "hours_per_day", "project_id": "manco", "value": 8},
        {"type": "hours_per_day", "project_id": "play", "value": 0},
        {"type": "hours_per_day", "project_id": "play", "value": 9},
        {"type": "hours_per_day", "project_id": "play", "value": "NaN"},
    )
    assert out.changes == (HoursPerDay("ret", 4), HoursPerDay("manco", 8))
    assert len(out.dropped) == 3


def test_hours_per_day_the_preview_would_refuse_is_dropped() -> None:
    # The services take 0 or 0.05h..24h for every figure a rate change rescales, so validate()
    # never passes on a proposal that would fail the whole preview.
    out = run(
        {"type": "hours_per_day", "project_id": "manco", "value": 0.01},
        {"type": "hours_per_day", "project_id": "play", "value": 0.06},
        {"type": "hours_per_day", "project_id": "play", "value": 0.1},
    )
    assert out.changes == (HoursPerDay("play", 0.1),)
    assert [x.reason for x in out.dropped] == [
        "hours a day below 0.05h",
        "hours a day would plan some days outside 0.05..24h",
    ]
    wide = replace(state(), capacity=24.0)
    far = validate(
        {"changes": [{"type": "hours_per_day", "project_id": "alpha", "value": 17}]}, wide
    )
    assert far.changes == ()
    assert far.dropped[0].reason == "hours a day would plan some days outside 0.05..24h"


def test_duplicates_are_removed() -> None:
    note = {"type": "blocker", "project_id": "ret", "text": "same"}
    out = run(note, dict(note), {"type": "blocker", "project_id": "ret", "text": " same "})
    assert out.changes == (Blocker("ret", "same"),)
    assert [x.reason for x in out.dropped] == ["duplicate", "duplicate"]
    assert change_key(Blocker("ret", "same")) == (
        '{"project_id": "ret", "text": "same", "type": "blocker"}'
    )


@pytest.mark.parametrize(
    ("raw_unplaced", "expected"),
    [
        (["a", "", None, 3, "b", "c", "d"], ("a", "3", "b", "c")),
        ("not a list", ()),
        (None, ()),
    ],
)
def test_unplaced(raw_unplaced: object, expected: tuple[str, ...]) -> None:
    out = validate({"changes": [], "unplaced": raw_unplaced}, state())
    assert out.unplaced == expected


def test_summary_and_raw_proposal() -> None:
    assert validate({}, state()).summary == ""
    assert validate({"summary": None}, state()).summary == ""
    out = validate(RawProposal(summary="Hi", changes="nope", unplaced=["x"]), state())
    assert (out.summary, out.changes, out.unplaced) == ("Hi", (), ("x",))
