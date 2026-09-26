from dataclasses import replace

from remi.services.engine.aliases import build_index
from remi.services.engine.model import (
    BauDone,
    Blocker,
    EngineCtx,
    HoursPerDay,
    Note,
    ScopeAdd,
    TaskDone,
)
from remi.services.engine.simple_reading import SIMPLE_SUMMARY, parse_simple, split_sentences
from remi.services.engine.validate import ValidatedProposal, validate, validation_state
from tests.engine import seed as S

PLACEHOLDER = (
    "Finished mapping the last four funds and the FX share classes. The administrator now "
    "wants FX attribution too, probably 6h. Still waiting on the security-level extract, so "
    "confidence is a 3. ManCo: sent the NAV bridge spec to Finance. Returns BAU is done for "
    "today."
)


def read(text: str, focus: str | None = None, ctx: EngineCtx | None = None) -> ValidatedProposal:
    c = ctx if ctx is not None else S.ctx()
    projects = S.projects()
    idx = build_index(projects, c.routines, S.ALIASES)
    open_tasks = {p.id: p.open_now_tasks() for p in projects}
    raw = parse_simple(text, focus, c, idx, open_tasks)
    return validate(raw, validation_state(projects, c))


def test_split_sentences() -> None:
    assert split_sentences("One. Two!  Three?\nFour\n\nFive.") == [
        "One.",
        "Two!",
        "Three?",
        "Four",
        "Five.",
    ]
    assert split_sentences("  ") == []


def test_the_drawer_placeholder() -> None:
    out = read(PLACEHOLDER, focus="ret")
    assert out.summary == SIMPLE_SUMMARY
    assert out.changes == (
        TaskDone("ret", "ret-3"),
        TaskDone("ret", "ret-5"),
        ScopeAdd("ret", "FX attribution too", 6),
        Blocker("ret", "the security-level extract"),
        TaskDone("manco", "man-0"),
        TaskDone("manco", "man-1"),
        BauDone("r-ret"),
    )
    assert out.unplaced == ()
    assert [x.reason for x in out.dropped] == ["confidence unchanged"]


def test_without_a_focus_unnamed_sentences_are_unplaced() -> None:
    out = read("Finished mapping the last four funds. The playbook is coming along.")
    assert out.unplaced == ("Finished mapping the last four funds.",)
    assert out.changes == (Note("play", "The playbook is coming along."),)


def test_the_previous_project_carries_over() -> None:
    out = read("Playbook outline drafted. Still blocked by the successor naming.")
    assert out.changes == (
        Note("play", "Playbook outline drafted."),
        Blocker("play", "the successor naming"),
    )


def test_blocker_keeps_its_case() -> None:
    out = read("ManCo is stuck on Finance's sign-off, sadly.")
    assert Blocker("manco", "Finance's sign-off") in out.changes


def test_a_cleared_blocker_is_not_a_new_blocker() -> None:
    # "unblocked" is not "blocked", and a negated blocker word is news that it cleared: the
    # sentence stays a note instead of setting the blocker to "now" or "Finance".
    for text in (
        "ManCo pack unblocked now.",
        "ManCo is no longer blocked by Finance.",
        "ManCo: not stuck anymore.",
        "ManCo isn't waiting on Finance now.",
        "ManCo is not being blocked by the auditors.",
    ):
        out = read(text)
        assert not [c for c in out.changes if isinstance(c, Blocker)], text
        assert out.changes == (Note("manco", text),), text
    # A negated blocker does not hide a real one later in the sentence.
    out = read("ManCo is no longer blocked by Finance but waiting on legal.")
    assert Blocker("manco", "legal") in out.changes
    # Blocker words at the start of a sentence still count.
    assert Blocker("manco", "Finance") in read("ManCo pack. Waiting on Finance.").changes


def test_no_note_next_to_a_ticked_task() -> None:
    already_done = read("Wrapped the entitlement forms.")
    assert already_done.changes == (Note("fion", "Wrapped the entitlement forms."),)
    out = read("Onboarding: done with the curve data sources and the FI desk.")
    assert out.changes == (TaskDone("fion", "fi-2"),)


def test_one_hours_figure_is_not_both_rate_and_scope() -> None:
    out = read("I can give ManCo 2h a day now, new plan.")
    assert out.changes == (HoursPerDay("manco", 2),)
    both = read("ManCo also wants 6h of new tables and I can give it 2h a day.")
    assert HoursPerDay("manco", 2) in both.changes
    scope = [c for c in both.changes if isinstance(c, ScopeAdd)]
    assert [(c.hours, c.project_id) for c in scope] == [(6, "manco")]


def test_scope_text_cleanup() -> None:
    out = read("Returns pipeline: they asked for a security bridge (about 3 hours).")
    assert out.changes == (ScopeAdd("ret", "a security bridge", 3),)


def test_bau_done_needs_a_completion_after_the_routine() -> None:
    assert read("Returns are done for today.").changes == (BauDone("r-ret"),)
    assert read("Finished the returns.").changes == (BauDone("r-ret"),)
    assert read("Returns pipeline is done.", focus=None).changes == (
        Note("ret", "Returns pipeline is done."),
    )
    later = S.ctx(S.d("2026-10-06"))
    out = read("Returns are done for today.", ctx=later)
    assert BauDone("r-ret") not in out.changes


def test_handed_over_routine_is_not_closed() -> None:
    c = S.ctx()
    handed = replace(c, routines=(replace(S.ROUTINES[0], stage=3), S.ROUTINES[1]))
    out = read("Returns are done for today.", ctx=handed)
    assert out.changes == ()
    assert out.unplaced == ("Returns are done for today.",)


def test_nothing_found() -> None:
    out = read("")
    assert (out.summary, out.changes, out.unplaced) == ("", (), ())


def test_a_projects_note_sentences_become_one_note() -> None:
    out = read("Reconciled September to administrator NAVs. Everything ties out.", focus="ret")
    assert out.changes == (
        Note("ret", "Reconciled September to administrator NAVs. Everything ties out."),
    )
    assert out.unplaced == ()
    assert out.dropped == ()
