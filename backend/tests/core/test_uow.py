"""UnitOfWork: one event per commit, none on rollback, the missing-event guard, diffs, hooks."""

from collections.abc import Callable, Iterator
from datetime import UTC, date, datetime
from typing import Any

import pytest
from sqlalchemy import func, insert, select, text, update
from sqlalchemy.orm import Session, sessionmaker

from app.core import ids
from app.core.clock import FixedClock
from app.core.uow import (
    MissingEventError,
    ReadOnlyViolation,
    UnitOfWork,
    UnitOfWorkError,
    UnitOfWorkFactory,
    ref,
    register_repository,
    unregister_repository,
    written_table,
)
from app.repositories.models import (
    AiAudit,
    HourOverride,
    Milestone,
    Note,
    Project,
    RemiEvent,
    Settings,
    Task,
)
from tests.core.factories import make_project

CLOCK_NOW = datetime(2026, 10, 5, 8, tzinfo=UTC)
NOTE_ROW: dict[str, Any] = {
    "id": "n1",
    "day": date(2026, 10, 5),
    "text": "x",
    "seq": 0,
    "created_at": CLOCK_NOW,
    "updated_at": CLOCK_NOW,
}


def events(session_factory: sessionmaker[Session]) -> list[RemiEvent]:
    with session_factory() as session:
        return list(session.scalars(select(RemiEvent).order_by(RemiEvent.seq)))


def count(session_factory: sessionmaker[Session], model: type[Any]) -> int:
    with session_factory() as session:
        return session.scalar(select(func.count()).select_from(model)) or 0


def create_project(uow_factory: UnitOfWorkFactory, name: str = "Returns pipeline") -> str:
    with uow_factory() as uow:
        project = make_project(name)
        uow.session.add(project)
        uow.record("project.created", [ref("project", project.id)], {"name": name})
        return project.id


# ------------------------------------------------------------------ one event per commit


def test_a_commit_writes_exactly_one_event(
    uow_factory: UnitOfWorkFactory, session_factory: sessionmaker[Session], clock: FixedClock
) -> None:
    with uow_factory() as uow:
        project = make_project()
        uow.session.add(project)
        uow.session.add(Task(project=project, text="Map feeds", hours=2))
        uow.session.flush()  # several flushes still make one event
        uow.session.add(Note(day=date(2026, 10, 5), text="Kicked off"))
        event_id = uow.record("project.created", [("project", project.id)], {"name": "Returns"})

    assert uow.committed_seq == 1
    [event] = events(session_factory)
    assert event.id == event_id == uow.event_id
    assert event.seq == 1
    assert event.type == "project.created"
    assert event.actor == "user"
    assert event.at == clock.now()
    assert event.business_date == clock.today()
    assert event.refs == [{"type": "project", "id": project.id}]
    assert event.payload["input"] == {"name": "Returns"}
    assert event.payload["effects"] == {}
    assert [(d["table"], d["op"]) for d in event.payload["diff"]] == [
        ("projects", "insert"),
        ("tasks", "insert"),
        ("notes", "insert"),
    ]
    assert event.schema_version == 1


def test_every_commit_gets_its_own_event(
    uow_factory: UnitOfWorkFactory, session_factory: sessionmaker[Session]
) -> None:
    create_project(uow_factory, "One")
    create_project(uow_factory, "Two")
    create_project(uow_factory, "Three")
    assert [e.seq for e in events(session_factory)] == [1, 2, 3]
    assert count(session_factory, Project) == 3


def test_a_recorded_command_without_changes_still_writes_its_event(
    uow_factory: UnitOfWorkFactory, session_factory: sessionmaker[Session]
) -> None:
    with uow_factory() as uow:
        uow.record("task.toggled", [], {"taskId": "t1", "done": True})
    [event] = events(session_factory)
    assert event.payload["diff"] == []


def test_a_unit_of_work_without_changes_writes_nothing(
    uow_factory: UnitOfWorkFactory, session_factory: sessionmaker[Session]
) -> None:
    with uow_factory() as uow:
        uow.session.get(Settings, 1)
    assert events(session_factory) == []
    assert uow.committed_seq is None


# ------------------------------------------------------------------ rollback


def test_an_exception_rolls_back_and_writes_no_event(
    uow_factory: UnitOfWorkFactory, session_factory: sessionmaker[Session]
) -> None:
    rolled_back: list[str] = []
    committed: list[str] = []
    with pytest.raises(RuntimeError, match="boom"), uow_factory() as uow:
        uow.session.add(make_project())
        uow.record("project.created", [], {})
        uow.after_rollback(lambda: rolled_back.append("cleanup"))
        uow.after_commit(lambda: committed.append("gc"))
        uow.session.flush()
        raise RuntimeError("boom")

    assert events(session_factory) == []
    assert count(session_factory, Project) == 0
    assert rolled_back == ["cleanup"]
    assert committed == []


def test_a_failing_flush_at_commit_rolls_back(
    uow_factory: UnitOfWorkFactory, session_factory: sessionmaker[Session]
) -> None:
    rolled_back: list[bool] = []
    with pytest.raises(Exception, match="CHECK constraint"), uow_factory() as uow:
        uow.session.add(make_project(confidence=9))
        uow.record("project.created", [], {})
        uow.after_rollback(lambda: rolled_back.append(True))
    assert events(session_factory) == []
    assert rolled_back == [True]


def test_after_commit_hooks_run_after_the_commit_and_errors_are_contained(
    uow_factory: UnitOfWorkFactory,
    session_factory: sessionmaker[Session],
    caplog: pytest.LogCaptureFixture,
) -> None:
    seen: list[int] = []

    def broken() -> None:
        raise OSError("disk")

    with uow_factory() as uow:
        uow.session.add(make_project())
        uow.record("project.created", [], {})
        uow.after_commit(broken)
        uow.after_commit(lambda: seen.append(count(session_factory, Project)))
    assert seen == [1]  # visible to other connections: the commit had happened
    assert "after_commit hook" in caplog.text


def test_an_after_commit_hook_can_open_and_commit_its_own_unit_of_work(
    uow_factory: UnitOfWorkFactory,
    session_factory: sessionmaker[Session],
    caplog: pytest.LogCaptureFixture,
) -> None:
    seen: list[object] = []

    def collect_garbage() -> None:  # e.g. arch §7: GC unreferenced chart assets
        seen.append(uow.active)
        with uow_factory("system") as follow_up:
            follow_up.session.add(Note(day=date(2026, 10, 5), text="gc ran"))
            follow_up.record("chart_assets.collected", [], {})
        seen.append(follow_up.committed_seq)

    with uow_factory() as uow:
        uow.session.add(make_project())
        uow.record("project.created", [], {})
        uow.after_commit(collect_garbage)

    assert seen == [False, 2]  # the first unit was closed before its hook ran
    assert [(e.type, e.actor) for e in events(session_factory)] == [
        ("project.created", "user"),
        ("chart_assets.collected", "system"),
    ]
    assert count(session_factory, Note) == 1
    assert "hook" not in caplog.text


def test_an_after_rollback_hook_can_open_and_commit_its_own_unit_of_work(
    uow_factory: UnitOfWorkFactory,
    session_factory: sessionmaker[Session],
    caplog: pytest.LogCaptureFixture,
) -> None:
    def note_failure() -> None:
        with uow_factory("system") as follow_up:
            follow_up.session.add(Note(day=date(2026, 10, 5), text="import failed"))
            follow_up.record("import.failed", [], {})

    with pytest.raises(RuntimeError, match="boom"), uow_factory() as uow:
        uow.session.add(make_project())
        uow.record("project.created", [], {})
        uow.after_rollback(note_failure)
        raise RuntimeError("boom")

    assert [e.type for e in events(session_factory)] == ["import.failed"]
    assert count(session_factory, Project) == 0
    assert count(session_factory, Note) == 1
    assert "hook" not in caplog.text


# ------------------------------------------------------------------ the guard


def test_state_changes_without_record_raise_missing_event(
    uow_factory: UnitOfWorkFactory, session_factory: sessionmaker[Session]
) -> None:
    with pytest.raises(MissingEventError, match="projects"), uow_factory() as uow:
        uow.session.add(make_project())
    assert count(session_factory, Project) == 0
    assert events(session_factory) == []


def _core_update(session: Session) -> object:
    return session.execute(update(Settings).values(capacity_hours_per_day=7))


def _text_update(session: Session) -> object:
    return session.execute(text("UPDATE settings SET capacity_hours_per_day = 7"))


def _driver_sql(session: Session) -> object:
    return session.connection().exec_driver_sql("UPDATE settings SET capacity_hours_per_day = 7")


def _bulk_insert(session: Session) -> object:
    return session.execute(insert(Note), [NOTE_ROW])


@pytest.mark.parametrize(
    "write",
    [
        pytest.param(_core_update, id="core-update"),
        pytest.param(_text_update, id="text"),
        pytest.param(_driver_sql, id="driver-sql"),
        pytest.param(_bulk_insert, id="bulk-insert"),
    ],
)
def test_the_guard_sees_every_kind_of_write(
    uow_factory: UnitOfWorkFactory,
    session_factory: sessionmaker[Session],
    write: Callable[[Session], object],
) -> None:
    with pytest.raises(MissingEventError), uow_factory() as uow:
        write(uow.session)
    with session_factory() as session:
        assert session.get_one(Settings, 1).capacity_hours_per_day == 8
    assert count(session_factory, Note) == 0


def test_audit_log_writes_need_no_event(
    uow_factory: UnitOfWorkFactory, session_factory: sessionmaker[Session]
) -> None:
    with uow_factory("system") as uow:
        uow.session.add(AiAudit(parse_id="p1", provider="none", status="ok"))
    assert count(session_factory, AiAudit) == 1
    assert events(session_factory) == []


def test_written_table() -> None:
    assert written_table('INSERT INTO "projects" (id) VALUES (?)') == "projects"
    assert written_table("insert or ignore into holidays values (?)") == "holidays"
    assert written_table("UPDATE settings SET x=1") == "settings"
    assert written_table("DELETE FROM tasks WHERE id=?") == "tasks"
    assert written_table("REPLACE INTO notes VALUES (1)") == "notes"
    assert written_table("WITH x AS (SELECT 1) DELETE FROM tasks") == "?"
    assert written_table("CREATE TABLE t (x)") == "?"
    assert written_table("SELECT * FROM projects") is None
    assert written_table("PRAGMA foreign_keys") is None
    assert written_table("SAVEPOINT sa_savepoint_1") is None
    assert written_table("") is None


# ------------------------------------------------------------------ diff capture


def test_diff_captures_updates_and_deletes_with_before_and_after(
    uow_factory: UnitOfWorkFactory, session_factory: sessionmaker[Session]
) -> None:
    project_id = create_project(uow_factory)
    with uow_factory() as uow:
        uow.session.add(HourOverride(project_id=project_id, date=date(2026, 11, 4), hours=3.5))
        uow.record("override.set", [ref("project", project_id)], {})

    later = FixedClock(date(2026, 10, 6), datetime(2026, 10, 6, 9, tzinfo=UTC))
    with UnitOfWork(session_factory, later) as uow:
        project = uow.session.get_one(Project, project_id)
        project.name = "Returns automation"
        project.rate_hours_per_day = 4.0
        override = uow.session.get_one(HourOverride, (project_id, date(2026, 11, 4)))
        uow.session.delete(override)
        uow.record("project.edited", [ref("project", project_id)], {"name": project.name})

    diff = events(session_factory)[-1].payload["diff"]
    assert diff == [
        {
            "table": "projects",
            "id": project_id,
            "op": "update",
            "before": {
                "name": "Returns pipeline",
                "rate_hours_per_day": 3.5,
                "updated_at": "2026-10-05T08:00:00+00:00",
            },
            "after": {
                "name": "Returns automation",
                "rate_hours_per_day": 4.0,
                "updated_at": "2026-10-06T09:00:00+00:00",
            },
        },
        {
            "table": "hour_overrides",
            "id": {"project_id": project_id, "date": "2026-11-04"},
            "op": "delete",
            "before": {"project_id": project_id, "date": "2026-11-04", "hours": 3.5},
            "after": None,
        },
    ]


def test_insert_diff_includes_defaults_and_merges_later_changes(
    uow_factory: UnitOfWorkFactory, session_factory: sessionmaker[Session]
) -> None:
    with ids.id_factory(ids.sequential_ids("x")), uow_factory() as uow:
        project = make_project()
        uow.session.add(project)
        uow.session.flush()
        project.goal = "Automate the returns run"  # a second flush on the same row
        uow.session.flush()
        scratch = Note(day=date(2026, 10, 5), text="temp")
        uow.session.add(scratch)
        uow.session.flush()
        uow.session.delete(scratch)  # inserted then deleted: no net change
        uow.record("project.created", [ref("project", project.id)], {})

    [entry] = events(session_factory)[0].payload["diff"]
    assert entry["op"] == "insert"
    assert entry["id"] == "x-0001"
    after = entry["after"]
    assert after["goal"] == "Automate the returns run"
    assert after["end_name"] == "Done"  # scalar default filled in
    assert after["sort_order"] == 0
    assert after["created_at"] == after["updated_at"] == "2026-10-05T08:00:00+00:00"


def test_insert_diff_includes_foreign_keys_set_through_relationships(
    uow_factory: UnitOfWorkFactory, session_factory: sessionmaker[Session]
) -> None:
    with uow_factory() as uow:
        project = make_project()
        milestone = Milestone(project=project, name="Build")
        task = Task(project=project, milestone=milestone, text="Map feeds", hours=2)
        override = HourOverride(project=project, date=date(2026, 11, 4), hours=3.5)
        uow.session.add(project)  # the rest arrive by cascade
        uow.session.flush()
        uow.record("project.created", [ref("project", project.id)], {})

    diff = {d["table"]: d for d in events(session_factory)[0].payload["diff"]}
    assert set(diff) == {"projects", "milestones", "tasks", "hour_overrides"}
    assert diff["milestones"]["after"]["project_id"] == project.id
    task_after = diff["tasks"]["after"]
    assert diff["tasks"]["id"] == task.id
    assert task_after["project_id"] == project.id
    assert task_after["milestone_id"] == milestone.id
    assert task_after["text"] == "Map feeds"
    # a composite key whose parts come from a relationship is complete too
    assert diff["hour_overrides"]["id"] == {"project_id": project.id, "date": "2026-11-04"}
    assert diff["hour_overrides"]["after"]["project_id"] == override.project_id == project.id


def _project_with_two_milestones(uow_factory: UnitOfWorkFactory) -> tuple[str, str, str, str]:
    with uow_factory() as uow:
        project = make_project()
        first = Milestone(project=project, name="Build", sort_order=0)
        second = Milestone(project=project, name="Ship", sort_order=1)
        task = Task(project=project, milestone=first, text="Map feeds", hours=2)
        uow.session.add(project)
        uow.session.flush()
        uow.record("project.created", [ref("project", project.id)], {})
        return project.id, first.id, second.id, task.id


@pytest.mark.parametrize("side", ["scalar", "collection"])
def test_moving_a_row_through_a_relationship_records_the_foreign_key_update(
    uow_factory: UnitOfWorkFactory, session_factory: sessionmaker[Session], side: str
) -> None:
    _, first_id, second_id, task_id = _project_with_two_milestones(uow_factory)
    with uow_factory() as uow:
        task = uow.session.get_one(Task, task_id)
        second = uow.session.get_one(Milestone, second_id)
        if side == "scalar":
            task.milestone = second
        else:
            second.tasks.append(task)
        uow.record("task.moved", [ref("task", task_id)], {"milestoneId": second_id})

    assert events(session_factory)[-1].payload["diff"] == [
        {
            "table": "tasks",
            "id": task_id,
            "op": "update",
            "before": {"milestone_id": first_id},
            "after": {"milestone_id": second_id},
        }
    ]
    with session_factory() as session:
        assert session.get_one(Task, task_id).milestone_id == second_id


def test_removing_a_child_from_a_delete_orphan_collection_records_the_delete(
    uow_factory: UnitOfWorkFactory, session_factory: sessionmaker[Session]
) -> None:
    project_id, first_id, _, task_id = _project_with_two_milestones(uow_factory)
    with uow_factory() as uow:
        project = uow.session.get_one(Project, project_id)
        [task] = project.tasks
        project.tasks.remove(task)
        uow.record("task.deleted", [ref("task", task_id)], {})

    assert events(session_factory)[-1].payload["diff"] == [
        {
            "table": "tasks",
            "id": task_id,
            "op": "delete",
            "before": {
                "id": task_id,
                "project_id": project_id,
                "milestone_id": first_id,
                "text": "Map feeds",
                "hours": 2.0,
                "due_date": None,
                "sort_order": 0,
                "done": False,
                "done_on": None,
            },
            "after": None,
        }
    ]
    assert count(session_factory, Task) == 0


def test_capture_diff_false_keeps_only_the_input(
    uow_factory: UnitOfWorkFactory, session_factory: sessionmaker[Session]
) -> None:
    with uow_factory() as uow:
        uow.session.add(Note(day=date(2026, 10, 5), text="x"))
        uow.record(
            "textbook.blocks.saved",
            [],
            {"pageId": "p", "version": 3, "blockCount": 1},
            capture_diff=False,
        )
        uow.add_effects({"movements": []})
    payload = events(session_factory)[0].payload
    assert payload == {
        "input": {"pageId": "p", "version": 3, "blockCount": 1},
        "effects": {"movements": []},
    }


def test_bulk_statements_are_noted_in_the_diff(
    uow_factory: UnitOfWorkFactory, session_factory: sessionmaker[Session]
) -> None:
    with uow_factory() as uow:
        uow.session.execute(update(Settings).values(capacity_hours_per_day=7.5))
        uow.record("settings.updated", [], {"capacityHoursPerDay": 7.5})
    diff = events(session_factory)[0].payload["diff"]
    assert diff == [
        {"table": "settings", "id": None, "op": "bulk_update", "before": None, "after": None}
    ]


def test_timestamps_come_from_the_clock(
    uow_factory: UnitOfWorkFactory, session_factory: sessionmaker[Session]
) -> None:
    project_id = create_project(uow_factory)
    later = FixedClock(date(2026, 10, 6), datetime(2026, 10, 6, 9, tzinfo=UTC))
    with UnitOfWork(session_factory, later) as uow:
        uow.session.get_one(Project, project_id).goal = "New goal"
        uow.record("project.edited", [], {})
    with session_factory() as session:
        project = session.get_one(Project, project_id)
        assert project.created_at == CLOCK_NOW
        assert project.updated_at == later.now()


def test_values_in_the_payload_are_made_json_safe(
    uow_factory: UnitOfWorkFactory, session_factory: sessionmaker[Session]
) -> None:
    with uow_factory("ai-proposal-accepted") as uow:
        uow.record(
            "checkin.applied",
            [],
            {"target": date(2027, 1, 4), "ids": {"b", "a"}},
            effects={"at": CLOCK_NOW},
        )
    event = events(session_factory)[0]
    assert event.actor == "ai-proposal-accepted"
    assert event.payload["input"] == {"target": "2027-01-04", "ids": ["a", "b"]}
    assert event.payload["effects"] == {"at": "2026-10-05T08:00:00+00:00"}


# ------------------------------------------------------------------ misuse


def test_record_twice_is_refused(uow_factory: UnitOfWorkFactory) -> None:
    with pytest.raises(UnitOfWorkError, match="already called"), uow_factory() as uow:
        uow.record("a", [], {})
        uow.record("b", [], {})


def test_nested_writing_units_are_refused(uow_factory: UnitOfWorkFactory) -> None:
    with uow_factory() as outer:
        with pytest.raises(UnitOfWorkError, match="nested"), uow_factory():
            pass
        with uow_factory.read() as reader:  # reads may nest
            assert reader.session.get(Settings, 1) is not None
        outer.record("noop", [], {})
    with uow_factory() as again:  # the slot is released afterwards
        again.record("noop", [], {})


def test_a_unit_of_work_is_single_use(uow_factory: UnitOfWorkFactory) -> None:
    uow = uow_factory()
    with pytest.raises(UnitOfWorkError, match="not active"):
        _ = uow.session
    with uow:
        uow.record("noop", [], {})
    with pytest.raises(UnitOfWorkError, match="once"), uow:
        pass
    with pytest.raises(UnitOfWorkError, match="not active"):
        uow.record("late", [], {})


def test_services_cannot_commit_the_session_themselves(
    uow_factory: UnitOfWorkFactory, session_factory: sessionmaker[Session]
) -> None:
    with pytest.raises(UnitOfWorkError, match="commits on exit"), uow_factory() as uow:
        uow.session.add(make_project())
        uow.session.commit()
    assert count(session_factory, Project) == 0


def test_continuing_after_an_early_rollback_is_refused(
    uow_factory: UnitOfWorkFactory, session_factory: sessionmaker[Session]
) -> None:
    with pytest.raises(UnitOfWorkError, match="ended early"), uow_factory() as uow:
        uow.session.add(make_project(confidence=9))
        with pytest.raises(Exception, match="CHECK constraint"):
            uow.session.flush()
        uow.session.rollback()
        uow.session.add(make_project())  # would run outside BEGIN IMMEDIATE
        uow.record("project.created", [], {})
    assert count(session_factory, Project) == 0
    assert events(session_factory) == []


def test_savepoints_inside_a_unit_of_work_are_fine(
    uow_factory: UnitOfWorkFactory, session_factory: sessionmaker[Session]
) -> None:
    with uow_factory() as uow:
        with pytest.raises(Exception, match="CHECK constraint"), uow.session.begin_nested():
            uow.session.add(make_project(confidence=9))
        uow.session.add(make_project())
        uow.record("project.created", [], {})
    assert count(session_factory, Project) == 1
    assert len(events(session_factory)) == 1


# ------------------------------------------------------------------ modes


def test_read_mode_refuses_writes(
    uow_factory: UnitOfWorkFactory, session_factory: sessionmaker[Session]
) -> None:
    with uow_factory.read() as uow:
        assert uow.session.get_one(Settings, 1).ai_provider == "none"
        with pytest.raises(UnitOfWorkError, match="read-only"):
            uow.record("x", [], {})
        uow.session.add(make_project())
        with pytest.raises(ReadOnlyViolation):
            uow.session.flush()
        uow.session.rollback()
        with pytest.raises(ReadOnlyViolation):
            uow.session.execute(text("UPDATE settings SET capacity_hours_per_day = 7"))
    assert count(session_factory, Project) == 0


def test_dry_run_always_rolls_back_and_writes_no_event(
    uow_factory: UnitOfWorkFactory, session_factory: sessionmaker[Session]
) -> None:
    project_id = create_project(uow_factory)
    cleaned: list[bool] = []
    with uow_factory.dry_run() as uow:
        project = uow.session.get_one(Project, project_id)
        project.forecast_date = date(2026, 12, 7)
        uow.session.flush()
        assert uow.session.get_one(Project, project_id).forecast_date == date(2026, 12, 7)
        uow.record("checkin.previewed", [], {})
        uow.after_rollback(lambda: cleaned.append(True))
    with session_factory() as session:
        assert session.get_one(Project, project_id).forecast_date == date(2026, 12, 2)
    assert [e.type for e in events(session_factory)] == ["project.created"]
    assert cleaned == [True]


# ------------------------------------------------------------------ repositories


class ProjectRepo:
    def __init__(self, session: Session) -> None:
        self.session = session

    def names(self) -> list[str]:
        return list(self.session.scalars(select(Project.name).order_by(Project.name)))


@pytest.fixture
def projects_key() -> Iterator[Any]:
    key = register_repository("test_projects", ProjectRepo)
    yield key
    unregister_repository("test_projects")


def test_repositories_attach_lazily_and_are_typed(
    uow_factory: UnitOfWorkFactory, projects_key: Any
) -> None:
    create_project(uow_factory, "Alpha")
    with uow_factory.read() as uow:
        repo = uow.repo(projects_key)
        assert isinstance(repo, ProjectRepo)
        assert repo.session is uow.session
        assert uow.repo("test_projects") is repo  # one instance per unit of work
        assert uow.test_projects is repo  # attribute access by registered name
        assert repo.names() == ["Alpha"]
        with pytest.raises(AttributeError):
            _ = uow.not_a_repository
        with pytest.raises(KeyError):
            uow.repo("not_a_repository")


def test_repository_registration_rules(projects_key: Any) -> None:
    assert register_repository("test_projects", ProjectRepo).name == "test_projects"  # idempotent
    with pytest.raises(ValueError, match="already registered"):
        register_repository("test_projects", lambda s: ProjectRepo(s))
    with pytest.raises(ValueError, match="clashes"):
        register_repository("session", ProjectRepo)
    with pytest.raises(ValueError, match="identifier"):
        register_repository("_private", ProjectRepo)
    replaced = register_repository("test_projects", lambda s: ProjectRepo(s), replace=True)
    assert replaced.name == "test_projects"


def test_event_id_is_stable_and_usable_before_commit(
    uow_factory: UnitOfWorkFactory, session_factory: sessionmaker[Session]
) -> None:
    with uow_factory() as uow:
        batch_id = uow.event_id  # e.g. the check-in batch_id
        assert uow.record("checkin.applied", [], {"batch": batch_id}) == batch_id
    assert events(session_factory)[0].id == batch_id
