from dataclasses import replace
from datetime import date

import pytest

from remi.services.engine.derive import DerivedProject, derive_project
from remi.services.engine.flags import attention, checkin_prompt, upcoming_overloads
from remi.services.engine.loads import DayLoad, build_loads
from tests.engine import seed as S

d = S.d


@pytest.fixture(scope="module")
def loads() -> dict[date, DayLoad]:
    return build_loads(d("2026-09-01"), d("2027-04-30"), S.plans(), S.ctx())


def derived(loads: dict[date, DayLoad]) -> list[DerivedProject]:
    return [derive_project(p, S.ctx(), loads) for p in S.projects()]


def test_upcoming_overloads_window(loads: dict[date, DayLoad]) -> None:
    c = S.ctx()
    assert [o.day for o in upcoming_overloads(loads, c)] == [d("2026-11-04")]
    after = S.ctx(d("2026-11-05"))
    assert upcoming_overloads(loads, after) == []
    short = replace(c, move=d("2026-11-02"), lookahead_bd=1)
    assert upcoming_overloads(loads, short) == []
    reach = replace(c, move=d("2026-11-02"), lookahead_bd=2)
    (over,) = upcoming_overloads(loads, reach)
    assert (over.day, over.bdm, over.total, over.over_by) == (d("2026-11-04"), 3, 9.5, 1.5)
    past_window = S.ctx(d("2027-02-01"))
    assert upcoming_overloads(loads, past_window) == []


def test_attention_order_and_chips(loads: dict[date, DayLoad]) -> None:
    items = attention(derived(loads), upcoming_overloads(loads, S.ctx()))
    assert [a.kind for a in items] == ["at_risk", "overload", "stale"]
    risk, over, stale = items
    assert (risk.project_id, risk.delta_bd, risk.chip) == ("ret", 3, "+3 BD")
    assert (over.day, over.over_by, over.chip) == (d("2026-11-04"), 1.5, "+1.5h")
    assert (stale.project_id, stale.since_days, stale.chip) == ("manco", 9, "9d")


def test_prompt_only_when_the_longest_unchecked_is_stale(loads: dict[date, DayLoad]) -> None:
    fresh = [p for p in derived(loads) if not p.stale]
    prompt = checkin_prompt(fresh)
    assert prompt.prompt_project_id is None
    assert prompt.next_due_project_id == "fion"
    assert checkin_prompt([]).next_due_project_id is None
    alpha_only = [p for p in derived(loads) if p.id == "alpha"]
    assert checkin_prompt(alpha_only).next_due_project_id is None
