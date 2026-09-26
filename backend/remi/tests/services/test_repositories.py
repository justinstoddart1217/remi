"""The repositories on a real database: aggregate loading, runs and ticks, the helpers."""

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy.orm import Session, sessionmaker

from remi.core.clock import FixedClock
from remi.core.errors import NotFound, VersionConflict
from remi.core.uow import UnitOfWorkFactory, ref
from remi.repositories import models as orm
from remi.repositories.registry import (
    AI_AUDIT,
    ALIASES,
    CHART_ASSETS,
    EVENTS,
    FEED,
    LEAVE,
    NOTES,
    PROJECTS,
    ROTATION,
    ROUTINES,
    SETTINGS,
    TEXTBOOK,
)
from remi.repositories.rotation_repo import SegmentSpec, loops_for
from remi.repositories.settings_repo import SettingsRepository
from remi.services.dev_fixtures import SeedIds

NOW = datetime(2026, 10, 5, 8, 0, tzinfo=UTC)


def test_registered_names_work_untyped(uow_factory: UnitOfWorkFactory, seeded: SeedIds) -> None:
    with uow_factory.read() as uow:
        assert uow.projects.count() == 5
        assert uow.routines.count() == 2
        assert uow.repo(EVENTS).latest_seq() == 1


def test_projects_load_as_whole_aggregates(uow_factory: UnitOfWorkFactory, seeded: SeedIds) -> None:
    with uow_factory.read() as uow:
        projects = uow.repo(PROJECTS)
        assert [p.id for p in projects.list()] == ["ret", "manco", "play", "fion", "alpha"]
        assert [p.id for p in projects.list("fi")] == ["fion", "alpha"]
        ret = projects.require("ret")
        assert len(ret.charter_items) == 11
        assert [m.horizon for m in ret.milestones].count("now") == 2
        assert len(ret.tasks) == 5
        assert [c.id for c in projects.snapshots("ret")] == ["ret-ci-0", "ret-ci-1", "ret-ci-2"]
        assert ret.scope_changes[0].checkin_id == "ret-ci-2"
        assert ret.scope_changes[0].from_forecast == date(2026, 11, 27)
        assert projects.get_task("man-0") is not None
        assert projects.get_milestone("ret-now-0") is not None
        assert projects.next_sort_order("pc") == 3
        with pytest.raises(NotFound):
            projects.require("missing")


def test_overrides_and_bau_day_hours(uow_factory: UnitOfWorkFactory, seeded: SeedIds) -> None:
    with uow_factory() as uow:
        projects = uow.repo(PROJECTS)
        projects.set_override("play", date(2026, 10, 7), 0)
        assert projects.clear_override("ret", date(2026, 11, 4)) is True
        assert projects.clear_override("ret", date(2026, 11, 4)) is False
        projects.set_bau_day_hours("fion", {"r-ret": 0.5})
        uow.record("test.rules", [ref("project", "play")])
    with uow_factory.read() as uow:
        play = uow.repo(PROJECTS).require("play")
        assert {o.date: o.hours for o in play.hour_overrides} == {date(2026, 10, 7): 0}
        fion = uow.repo(PROJECTS).require("fion")
        assert {r.routine_id: r.hours for r in fion.bau_day_hours} == {"r-ret": 0.5}


def test_routine_runs_and_ticks(uow_factory: UnitOfWorkFactory, seeded: SeedIds) -> None:
    day = date(2026, 10, 5)
    with uow_factory() as uow:
        routines = uow.repo(ROUTINES)
        ret = routines.require("r-ret")
        items = [i.id for i in ret.checklist_items]
        assert routines.set_tick("r-ret", day, items[5], True, NOW) is True
        assert routines.set_tick("r-ret", day, items[5], True, NOW) is False
        assert routines.set_all_ticks("r-ret", day, items, True, NOW) == 6
        routines.upsert_run("r-man", date(2026, 10, 12), date(2026, 10, 12), NOW)
        uow.record("test.ticks", [ref("routine", "r-ret")])
    with uow_factory.read() as uow:
        routines = uow.repo(ROUTINES)
        assert len(routines.ticks_between(day, day, "r-ret")) == 12
        run = routines.get_run("r-man", date(2026, 10, 12))
        assert run is not None and run.completed_on == date(2026, 10, 12)
        assert [r.routine_id for r in routines.runs_between(day, date(2026, 10, 31))] == ["r-man"]
        assert routines.next_sort_order() == 2


def test_rotation_replace_segments_keeps_ids_and_numbers_loops(
    uow_factory: UnitOfWorkFactory, seeded: SeedIds
) -> None:
    assert loops_for(["Build", "Build", "Refresh", "Build"]) == [1, 1, 2, 3]
    with uow_factory() as uow:
        repo = uow.repo(ROTATION)
        rotation = repo.get_active()
        assert rotation is not None
        assert [s.id for s in rotation.segments][:2] == ["rot-0", "rot-1"]
        repo.replace_segments(
            rotation,
            [
                SegmentSpec("France", "FR", 5, "Build", id="rot-1"),
                SegmentSpec("Greece", "GR", 3, "Refresh"),
            ],
        )
        uow.record("test.rotation", [ref("rotation", rotation.id)])
    with uow_factory.read() as uow:
        rotation = uow.repo(ROTATION).get_active()
        assert rotation is not None
        segments = rotation.segments
        first = segments[0]
        assert (first.id, first.code, first.loop, first.sort_order) == ("rot-1", "FR", 1, 0)
        assert (segments[1].code, segments[1].loop) == ("GR", 2)


def test_notes_aliases_feed_and_leave(uow_factory: UnitOfWorkFactory, seeded: SeedIds) -> None:
    with uow_factory.read() as uow:
        notes = uow.repo(NOTES)
        assert [n.id for n in notes.list_day(date(2026, 10, 5))] == ["n1", "n2", "n3"]
        assert notes.day_counts() == {
            date(2026, 10, 1): 1,
            date(2026, 10, 2): 2,
            date(2026, 10, 5): 3,
        }
        assert (notes.count_total(), notes.count_days(), notes.next_seq(date(2026, 10, 5))) == (
            6,
            3,
            3,
        )
        by_entity = uow.repo(ALIASES).by_entity()
        assert by_entity["ret"] == [
            "returns pipeline",
            "pipeline",
            "attribution",
            "returns automation",
        ]
        assert by_entity["r-man"] == ["manco pack", "bd8"]
        (item,) = uow.repo(FEED).list()
        assert (item.id, item.day, item.delta) == ("f1", date(2026, 10, 3), "+3 BD")
        assert uow.repo(LEAVE).as_mapping() == {}


def test_textbook_blocks_version_lock(uow_factory: UnitOfWorkFactory, seeded: SeedIds) -> None:
    with uow_factory() as uow:
        textbook = uow.repo(TEXTBOOK)
        assert [s.id for s in textbook.sections()] == ["fi", "pc", "gen"]
        assert textbook.count_pages() == 4
        assert textbook.count_chart_blocks() == 1
        assert [p.id for p in textbook.search("dietz")] == ["pc-ret"]
        page = textbook.get_page("gen-how")
        assert page is not None
        with pytest.raises(VersionConflict):
            textbook.replace_blocks(page, [], base_version=7)
        textbook.replace_blocks(
            page, [orm.TextbookBlock(id="gen-how-new", type="p", text="Hello")], base_version=1
        )
        uow.record("test.blocks", [ref("page", "gen-how")])
    with uow_factory.read() as uow:
        page = uow.repo(TEXTBOOK).get_page("gen-how")
        assert page is not None
        assert (page.version, [b.id for b in page.blocks]) == (2, ["gen-how-new"])
        charts = uow.repo(CHART_ASSETS)
        assert charts.get("chart-price-yield") is not None
        assert charts.unreferenced() == []


def test_ai_audit_is_a_log_without_events(
    uow_factory: UnitOfWorkFactory, clock: FixedClock, seeded: SeedIds
) -> None:
    with uow_factory() as uow:
        audit = uow.repo(AI_AUDIT)
        for i in range(3):
            audit.add(
                orm.AiAudit(
                    id=f"audit-{i}",
                    parse_id="p1",
                    provider="none",
                    status="ok",
                    created_at=NOW - timedelta(days=100 * i),
                )
            )
    with uow_factory() as uow:
        audit = uow.repo(AI_AUDIT)
        assert [a.id for a in audit.list(limit=2)] == ["audit-0", "audit-1"]
        assert [a.id for a in audit.list(before="audit-1")] == ["audit-2"]
        assert audit.purge_before(NOW - timedelta(days=90)) == 2
    with uow_factory.read() as uow:
        assert [a.id for a in uow.repo(AI_AUDIT).list()] == ["audit-0"]
        assert uow.repo(EVENTS).count() == 1


def test_settings_repository(session_factory: sessionmaker[Session]) -> None:
    with session_factory() as session:
        repo = SettingsRepository(session)
        row = repo.get()
        assert (row.move_date, repo.is_setup_complete()) == (None, False)
        repo.update(capacity_hours_per_day=7.5, ui_prefs={"timeline_zoom": "2w"})
        assert row.capacity_hours_per_day == 7.5
        with pytest.raises(ValueError, match="unknown settings"):
            repo.update(api_key="nope")
        repo.reset()
        assert (row.capacity_hours_per_day, row.ui_prefs, row.timezone) == (
            8.0,
            {},
            "Europe/London",
        )
        session.rollback()


def test_key_settings_after_the_seed(uow_factory: UnitOfWorkFactory, seeded: SeedIds) -> None:
    with uow_factory.read() as uow:
        settings = uow.repo(SETTINGS).get()
        assert (settings.key_project_id, settings.key_routine_id) == ("ret", "r-ret")
        assert settings.move_date == date(2027, 1, 4)
        assert uow.repo(SETTINGS).is_setup_complete()
