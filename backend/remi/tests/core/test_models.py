"""Schema behaviour: the settings singleton, CHECK constraints and FK delete rules."""

from collections.abc import Iterator
from datetime import UTC, date, datetime
from typing import Any

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from remi.core.db import begin_write
from remi.repositories.models import (
    Base,
    ChartAsset,
    CharterItem,
    CheckIn,
    Checklist,
    ChecklistItem,
    EntityAlias,
    FeedEvent,
    HourOverride,
    Milestone,
    Project,
    ProjectBauDayHours,
    ReadinessItem,
    RemiEvent,
    Risk,
    Routine,
    RoutineChecklistItem,
    RoutineRun,
    RoutineRunTick,
    ScopeChange,
    Settings,
    Task,
    TextbookBlock,
    TextbookPage,
    TextbookSection,
)
from remi.tests.core.factories import make_project

NOW = datetime(2026, 10, 5, 8, tzinfo=UTC)
TODAY = date(2026, 10, 5)

EXPECTED_TABLES = {
    "settings", "holidays", "holiday_years", "leave_days", "projects", "charter_items",
    "milestones", "tasks", "hour_overrides", "project_bau_day_hours", "scope_changes",
    "checkins", "readiness_items", "risks", "checklists", "checklist_items", "routines",
    "routine_checklist_items", "routine_runs", "routine_run_ticks", "rotations",
    "rotation_segments", "notes", "entity_aliases", "feed_events", "remi_events", "ai_audit",
    "textbook_sections", "textbook_pages", "textbook_blocks", "chart_assets",
}  # fmt: skip


@pytest.fixture
def session(session_factory: sessionmaker[Session]) -> Iterator[Session]:
    with session_factory() as session:
        begin_write(session)
        yield session
        session.rollback()


def count(session: Session, model: type[Base]) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0


def test_every_table_is_mapped() -> None:
    assert set(Base.metadata.tables) == EXPECTED_TABLES


def test_fresh_database_has_default_settings_and_needs_setup(session: Session) -> None:
    rows = session.scalars(select(Settings)).all()
    assert len(rows) == 1
    settings = rows[0]
    assert settings.id == 1
    assert settings.ai_provider == "none"
    assert settings.setup_completed_at is None
    assert settings.move_date is None
    assert settings.timezone == "Europe/London"
    assert settings.holiday_region == "GB-ENG"
    assert settings.capacity_hours_per_day == 8
    assert (settings.stale_threshold_days, settings.overload_lookahead_bd) == (7, 10)
    assert (settings.new_project_horizon_bd, settings.now_ms_offset_bd) == (30, 9)
    assert settings.next_ms_offset_bd == 20
    assert settings.key_project_id is None
    assert settings.key_routine_id is None
    assert settings.motion_preference == "system"
    assert (settings.accent_pc, settings.accent_fi) == ("#009D80", "#2F6B9A")
    assert settings.serif_display is True
    assert settings.ai_send_recent_notes is False
    assert settings.ollama_base_url == "http://127.0.0.1:11434"
    assert settings.ui_prefs == {}
    assert settings.created_at.tzinfo == UTC
    assert count(session, Project) == 0


def test_settings_is_a_singleton(session: Session) -> None:
    with pytest.raises(IntegrityError, match="singleton"):
        session.execute(
            text("INSERT INTO settings (id, created_at, updated_at) VALUES (2, 'x', 'x')")
        )


def test_settings_never_has_a_column_for_keys() -> None:
    columns = set(Settings.__table__.columns.keys())
    assert not {
        c
        for c in columns
        if "key" in c and c not in {"key_project_id", "key_routine_id", "key_run_date_override"}
    }


@pytest.mark.parametrize(
    ("statement", "constraint"),
    [
        ("UPDATE settings SET ai_provider = 'openai'", "ai_provider_valid"),
        ("UPDATE settings SET capacity_hours_per_day = 25", "capacity_hours_per_day_range"),
        ("UPDATE settings SET capacity_hours_per_day = 0.5", "capacity_hours_per_day_range"),
        ("UPDATE settings SET holiday_region = 'US'", "holiday_region_valid"),
        ("UPDATE settings SET motion_preference = 'fast'", "motion_preference_valid"),
    ],
)
def test_settings_checks(session: Session, statement: str, constraint: str) -> None:
    with pytest.raises(IntegrityError, match=constraint):
        session.execute(text(statement))


@pytest.mark.parametrize(
    ("fields", "constraint"),
    [
        ({"domain": "xx"}, "domain_valid"),
        ({"confidence": 6}, "confidence_range"),
        ({"readiness": 1.5}, "readiness_range"),
        ({"rate_hours_per_day": 25}, "rate_hours_per_day_range"),
        ({"phase": 4}, "phase_range"),
    ],
)
def test_project_checks(session: Session, fields: dict[str, Any], constraint: str) -> None:
    session.add(make_project(**fields))
    with pytest.raises(IntegrityError, match=constraint):
        session.flush()


def test_child_checks(session: Session) -> None:
    project = make_project()
    session.add(project)
    session.flush()
    for row, constraint in [
        (CharterItem(project_id=project.id, list_name="nope", text="x"), "list_valid"),
        (Milestone(project_id=project.id, name="m", horizon="later"), "horizon_valid"),
        (HourOverride(project_id=project.id, date=TODAY, hours=30), "hours_range"),
        (Task(project_id=project.id, text="t", hours=-1), "hours_range"),
        (CheckIn(project_id=project.id, date=TODAY, source="email"), "source_valid"),
        (Routine(name="r", bd=21), "bd_range"),
        (Routine(name="r", weekday=6), "weekday_range"),
        (Routine(name="r", stage=4), "stage_range"),
        (TextbookBlock(page_id="p", type="table"), "type_valid"),
        (EntityAlias(project_id=project.id, alias="Upper"), "alias_lower"),
        (EntityAlias(alias="orphan"), "one_entity"),
    ]:
        with session.begin_nested():
            session.add(row)
            with pytest.raises(IntegrityError, match=constraint):
                session.flush()


def test_alias_is_unique_per_entity(session: Session) -> None:
    project = make_project()
    other = make_project("ManCo pack")
    session.add_all([project, other])
    session.flush()
    session.add_all(
        [
            EntityAlias(project_id=project.id, alias="pipeline"),
            EntityAlias(project_id=other.id, alias="pipeline"),  # same alias, other entity: ok
        ]
    )
    session.flush()
    session.add(EntityAlias(project_id=project.id, alias="pipeline"))
    with pytest.raises(IntegrityError, match="UNIQUE"):
        session.flush()


def _project_with_everything(session: Session) -> tuple[Project, Routine]:
    project = make_project()
    routine = Routine(name="Returns run")
    session.add_all([project, routine])
    session.flush()
    routine.project_id = project.id
    milestone = Milestone(project=project, name="Pipeline live", horizon="now", due_date=TODAY)
    checkin = CheckIn(project=project, date=TODAY, source="simple")
    checklist = Checklist(project=project, title="Handover checklist")
    session.add_all(
        [
            CharterItem(project=project, list_name="success", text="Runs unattended"),
            milestone,
            Task(project=project, milestone=milestone, text="Map feeds", hours=2),
            Task(project=project, text="Loose task", hours=1),
            HourOverride(project=project, date=TODAY, hours=3.5),
            ProjectBauDayHours(project=project, routine_id=routine.id, hours=0),
            checkin,
            ReadinessItem(project=project, text="Entitlements"),
            Risk(project=project, risk="Data late", mitigation="Chase"),
            checklist,
            ChecklistItem(checklist=checklist, text="Runbook"),
            FeedEvent(project_id=project.id, kind="scope", title="t"),
            EntityAlias(project_id=project.id, alias="pipeline"),
        ]
    )
    session.flush()
    session.add(ScopeChange(project=project, checkin_id=checkin.id, date=TODAY, what="x", hours=6))
    settings = session.get_one(Settings, 1)
    settings.key_project_id = project.id
    settings.key_routine_id = routine.id
    session.flush()
    return project, routine


PROJECT_CHILDREN: list[type[Base]] = [
    CharterItem, Milestone, Task, HourOverride, ProjectBauDayHours, ScopeChange, CheckIn,
    ReadinessItem, Risk, Checklist, ChecklistItem, FeedEvent, EntityAlias,
]  # fmt: skip


def test_deleting_a_project_cascades_in_the_database(session: Session) -> None:
    project, routine = _project_with_everything(session)
    assert all(count(session, model) >= 1 for model in PROJECT_CHILDREN)

    # Raw SQL: the database alone must do the cascading.
    session.execute(text("DELETE FROM projects WHERE id = :id"), {"id": project.id})
    session.expire_all()

    assert {model.__tablename__: count(session, model) for model in PROJECT_CHILDREN} == {
        model.__tablename__: 0 for model in PROJECT_CHILDREN
    }
    assert session.get_one(Routine, routine.id).project_id is None  # SET NULL
    settings = session.get_one(Settings, 1)
    assert settings.key_project_id is None
    assert settings.key_routine_id == routine.id


def test_deleting_a_project_through_the_orm(session: Session) -> None:
    project, _ = _project_with_everything(session)
    session.delete(project)
    session.flush()
    session.expire_all()
    assert all(count(session, model) == 0 for model in PROJECT_CHILDREN)


def test_deleting_a_milestone_deletes_its_tasks_only(session: Session) -> None:
    project, _ = _project_with_everything(session)
    milestone = project.milestones[0]
    session.execute(text("DELETE FROM milestones WHERE id = :id"), {"id": milestone.id})
    session.expire_all()
    assert [t.text for t in session.scalars(select(Task))] == ["Loose task"]


def test_deleting_a_routine(session: Session) -> None:
    project, routine = _project_with_everything(session)
    item = RoutineChecklistItem(routine=routine, label="Fund I")
    session.add_all(
        [
            item,
            RoutineRun(
                routine=routine, occurrence_date=TODAY, completed_on=TODAY, completed_at=NOW
            ),
            EntityAlias(routine_id=routine.id, alias="returns"),
            FeedEvent(routine_id=routine.id, kind="routine", title="Routine removed"),
        ]
    )
    session.flush()
    session.add(
        RoutineRunTick(routine=routine, occurrence_date=TODAY, item_id=item.id, done_at=NOW)
    )
    session.flush()

    session.execute(text("DELETE FROM routines WHERE id = :id"), {"id": routine.id})
    session.expire_all()

    for model in (RoutineChecklistItem, RoutineRun, RoutineRunTick, ProjectBauDayHours):
        assert count(session, model) == 0, model.__tablename__
    assert session.scalars(select(EntityAlias.routine_id)).all() == [None]  # the project alias
    feed = session.scalars(select(FeedEvent).where(FeedEvent.kind == "routine")).one()
    assert feed.routine_id is None  # SET NULL keeps "Routine removed"
    assert session.get_one(Settings, 1).key_routine_id is None
    assert session.get(Project, project.id) is not None


def test_deleting_a_checklist_item_removes_its_ticks(session: Session) -> None:
    routine = Routine(name="Returns run")
    item = RoutineChecklistItem(routine=routine, label="Fund I")
    session.add_all([routine, item])
    session.flush()
    session.add(
        RoutineRunTick(routine_id=routine.id, occurrence_date=TODAY, item_id=item.id, done_at=NOW)
    )
    session.flush()
    session.execute(text("DELETE FROM routine_checklist_items"))
    assert count(session, RoutineRunTick) == 0


def test_deleting_a_checkin_keeps_its_scope_change(session: Session) -> None:
    _project_with_everything(session)
    session.execute(text("DELETE FROM checkins"))
    session.expire_all()
    assert session.scalars(select(ScopeChange.checkin_id)).all() == [None]


def test_textbook_delete_rules(session: Session) -> None:
    section = TextbookSection(label="Fixed Income")
    session.add(section)
    session.flush()
    parent = TextbookPage(section_id=section.id, title="Rates primer")
    session.add(parent)
    session.flush()
    child = TextbookPage(section_id=section.id, parent_id=parent.id, title="Duration")
    other = TextbookPage(section_id=section.id, title="Rotation")
    asset = ChartAsset(
        content_hash="a" * 64,
        filename="price-yield.html",
        size_bytes=10,
        storage_relpath="charts/aa/aaaa.html",
        uploaded_at=NOW,
    )
    session.add_all([child, other, asset])
    session.flush()
    session.add_all(
        [
            TextbookBlock(page_id=child.id, type="p", text="Hello"),
            TextbookBlock(page_id=other.id, type="page", target_page_id=parent.id),
            TextbookBlock(page_id=other.id, type="chart", chart_asset_id=asset.id),
        ]
    )
    session.flush()

    with session.begin_nested(), pytest.raises(IntegrityError, match="FOREIGN KEY"):
        session.execute(text("DELETE FROM textbook_sections"))  # RESTRICT: it has pages
    with session.begin_nested(), pytest.raises(IntegrityError, match="FOREIGN KEY"):
        session.execute(text("DELETE FROM chart_assets"))  # RESTRICT: a block uses it

    session.execute(text("DELETE FROM textbook_pages WHERE id = :id"), {"id": parent.id})
    session.expire_all()
    assert session.scalars(select(TextbookPage.title)).all() == ["Rotation"]  # child cascaded
    blocks = session.scalars(select(TextbookBlock).order_by(TextbookBlock.type)).all()
    assert [(b.type, b.target_page_id) for b in blocks] == [("chart", None), ("page", None)]


def test_block_height_defaults_and_range(session: Session) -> None:
    section = TextbookSection(label="General")
    session.add(section)
    session.flush()
    page = TextbookPage(section_id=section.id, title="p")
    session.add(page)
    session.flush()
    block = TextbookBlock(page_id=page.id, type="chart")
    session.add(block)
    session.flush()
    assert block.height == 380
    assert page.version == 1
    block.height = 901
    with pytest.raises(IntegrityError, match="height_range"):
        session.flush()


def test_remi_events_are_append_only(session: Session) -> None:
    session.add(RemiEvent(at=NOW, business_date=TODAY, type="test", actor="system"))
    session.flush()
    with session.begin_nested(), pytest.raises(IntegrityError, match="append-only"):
        session.execute(text("UPDATE remi_events SET type = 'changed'"))
    with session.begin_nested(), pytest.raises(IntegrityError, match="append-only"):
        session.execute(text("DELETE FROM remi_events"))
    seq = session.scalar(select(RemiEvent.seq))
    assert seq == 1
