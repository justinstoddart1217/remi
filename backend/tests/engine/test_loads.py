from dataclasses import replace

from remi.services.engine.loads import build_loads, day_load, loads_for, plan_window, project_end
from remi.services.engine.model import ProjectPlan, RoutineDef
from tests.engine import seed as S

d = S.d


def test_not_a_business_day_has_no_load() -> None:
    assert day_load(d("2026-10-10"), S.plans(), S.ctx()) is None
    assert day_load(d("2026-12-25"), S.plans(), S.ctx()) is None


def test_bau_comes_before_projects_and_uses_routine_domains() -> None:
    fi_daily = RoutineDef("fi-d", "fi", "daily", 0.5, name="Desk call", short="")
    c = replace(S.ctx(), routines=(*S.ROUTINES, fi_daily))
    before = day_load(d("2026-10-05"), S.plans(), c)
    assert before is not None
    assert [i.ref_id for i in before.items] == ["r-ret", "manco"]
    after = day_load(d("2027-01-05"), S.plans(), c)
    assert after is not None
    assert [(i.ref_type, i.ref_id, i.domain, i.name) for i in after.items] == [
        ("routine", "fi-d", "fi", "Desk call"),
        ("rotation", "rot-0", "fi", "Germany · Build"),
        ("project", "alpha", "fi", "Alpha engine"),
    ]
    assert after.bau == 4.5


def test_untitled_routine_name() -> None:
    blank = RoutineDef("b", "pc", "daily", 1)
    c = replace(S.ctx(), routines=(blank,))
    load = day_load(d("2026-10-06"), [], c)
    assert load is not None
    assert load.items[0].name == "Untitled routine"


def test_rotation_hours_and_capacity_come_from_the_context() -> None:
    assert S.ROTATION.hours_per_day == 4
    c = replace(S.ctx(), rotation=replace(S.ROTATION, hours_per_day=6), capacity=10)
    load = day_load(d("2027-01-04"), S.plans(), c)
    assert load is not None
    assert load.items[0].hours == 6
    assert (load.total, load.capacity, load.free, load.over) == (10, 10, 0, False)


def test_over_is_strictly_greater_than_capacity() -> None:
    c = S.ctx()
    exact = day_load(d("2026-10-05"), S.plans(), c)
    assert exact is not None
    assert (exact.total, exact.over, exact.over_by) == (8, False, 0)
    over = day_load(d("2026-11-04"), S.plans(), c)
    assert over is not None
    assert (over.over, over.over_by, over.free) == (True, 1.5, 0)


def test_leave_lowers_capacity() -> None:
    c = replace(S.ctx(), leave={d("2026-10-06"): 2.0, d("2026-10-07"): None})
    half = day_load(d("2026-10-06"), S.plans(), c)
    off = day_load(d("2026-10-07"), S.plans(), c)
    assert half is not None
    assert off is not None
    assert (half.capacity, half.over) == (6, True)
    assert (off.capacity, off.free, off.over) == (0, 0, True)


def test_project_window_and_zero_hours() -> None:
    c = S.ctx()
    load = day_load(d("2026-12-03"), S.plans(), c)
    assert load is not None
    assert [i.ref_id for i in load.items] == ["r-ret", "manco"]
    define = day_load(d("2027-03-25"), S.plans(), c)
    assert define is not None
    assert [i.ref_id for i in define.items] == ["alpha"]
    gone = day_load(d("2027-03-26"), S.plans(), c)
    assert gone is None
    assert day_load(d("2027-03-29"), S.plans(), c) is None
    later = day_load(d("2027-03-30"), S.plans(), c)
    assert later is not None
    assert later.items == ()


def test_project_helpers() -> None:
    load = day_load(d("2026-10-06"), S.plans(), S.ctx())
    assert load is not None
    assert load.project_hours("ret") == 3.5
    assert load.project_hours("alpha") == 0
    assert load.has_project("play")
    assert not load.has_project("alpha")
    assert project_end(S.PLANS["alpha"]) == d("2027-03-25")
    assert project_end(S.PLANS["ret"]) == d("2026-12-02")


def test_build_loads_only_has_business_days() -> None:
    loads = build_loads(d("2026-10-01"), d("2026-10-31"), S.plans(), S.ctx())
    assert len(loads) == 22
    assert d("2026-10-10") not in loads


def test_plan_window() -> None:
    c = S.ctx()
    a, b = plan_window(c, S.plans())
    assert a == d("2026-09-28")
    assert b == d("2027-03-25")
    no_projects = plan_window(c, [])
    assert no_projects == (d("2026-09-28"), d("2027-03-11"))
    bare = replace(c, rotation=None)
    assert plan_window(bare, [])[1] == d("2027-02-28")
    far = ProjectPlan("x", "fi", S.TODAY, d("2028-01-03"))
    assert plan_window(bare, [far])[1] == d("2028-01-03")
    assert len(loads_for(S.plans(), c)) == len(c.cal.bds(a, b))
