"""Alembic: upgrade to head matches the ORM exactly, and downgrade to base removes everything."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, inspect

from app.core.db import make_engine
from app.core.migrations import (
    _migrate,  # pyright: ignore[reportPrivateUsage]
    alembic_config,
    current_revision,
    downgrade,
    head_revision,
    upgrade_to_head,
)
from app.repositories.models import Base


@pytest.fixture
def fresh_engine(tmp_path: Path) -> Iterator[Engine]:
    engine = make_engine(tmp_path / "remi.db")
    yield engine
    engine.dispose()


def _schema_diff(engine: Engine) -> list[object]:
    with engine.connect() as conn:
        context = MigrationContext.configure(
            conn, opts={"compare_type": True, "render_as_batch": True}
        )
        diff: list[object] = list(compare_metadata(context, Base.metadata))
        conn.rollback()
    return diff


def _tables(engine: Engine) -> set[str]:
    return set(inspect(engine).get_table_names()) - {"alembic_version", "sqlite_sequence"}


def _triggers(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        rows = conn.exec_driver_sql("SELECT name FROM sqlite_master WHERE type = 'trigger'")
        names = {str(row[0]) for row in rows}
        conn.rollback()
    return names


def test_there_is_one_linear_history_ending_at_0004() -> None:
    script = ScriptDirectory.from_config(alembic_config())
    assert script.get_heads() == ["0004"]
    assert head_revision() == "0004"
    assert [r.revision for r in script.walk_revisions()] == ["0004", "0003", "0002", "0001"]


def test_upgrade_matches_the_models_then_downgrade_removes_everything(
    fresh_engine: Engine,
) -> None:
    assert current_revision(fresh_engine) is None

    upgrade_to_head(fresh_engine)

    assert current_revision(fresh_engine) == "0004"
    assert _schema_diff(fresh_engine) == []
    assert _tables(fresh_engine) == set(Base.metadata.tables)
    assert _triggers(fresh_engine) == {"remi_events_no_update", "remi_events_no_delete"}
    with fresh_engine.connect() as conn:
        assert conn.exec_driver_sql("SELECT id, ai_provider FROM settings").fetchall() == [
            (1, "none")
        ]
        conn.rollback()

    downgrade(fresh_engine, "base")

    assert current_revision(fresh_engine) is None
    assert _tables(fresh_engine) == set()
    assert _triggers(fresh_engine) == set()

    upgrade_to_head(fresh_engine)  # and back up again
    assert _schema_diff(fresh_engine) == []


def test_0002_keeps_rows_and_dates_saved_blocks_from_updated_at(fresh_engine: Engine) -> None:
    """``0001`` to ``0002``: routines gain an empty ``label``; pages take ``blocks_saved_at``
    from ``updated_at``; downgrading drops both columns again."""

    def run(cfg: Config, target: str) -> None:
        command.upgrade(cfg, target)

    _migrate(fresh_engine, lambda cfg: run(cfg, "0001"))
    stamp = "2026-10-01T08:00:00.000000Z"
    with fresh_engine.begin() as conn:
        conn.exec_driver_sql(
            "INSERT INTO textbook_sections (id, label, accent, sort_order, collapsed) "
            "VALUES ('s', 'S', '', 0, 0)"
        )
        conn.exec_driver_sql(
            "INSERT INTO textbook_pages (id, section_id, parent_id, title, sort_order, version, "
            "created_at, updated_at) VALUES ('p', 's', NULL, 'P', 0, 1, ?, ?)",
            (stamp, stamp),
        )
        conn.exec_driver_sql(
            "INSERT INTO routines (id, domain, name, short, detail, kind, bd, weekday, hours, "
            "stage, status_note, co_tag_with_project, sort_order, created_at, updated_at) "
            "VALUES ('r', 'pc', 'R', 'R', '', 'monthly', 3, 2, 1.0, 0, '', 0, 0, ?, ?)",
            (stamp, stamp),
        )

    _migrate(fresh_engine, lambda cfg: run(cfg, "0002"))

    assert current_revision(fresh_engine) == "0002"
    with fresh_engine.connect() as conn:
        assert conn.exec_driver_sql("SELECT blocks_saved_at FROM textbook_pages").fetchall() == [
            (stamp,)
        ]
        assert conn.exec_driver_sql("SELECT label FROM routines").fetchall() == [(None,)]
        conn.rollback()
    downgrade(fresh_engine, "0001")
    columns = {c["name"] for c in inspect(fresh_engine).get_columns("textbook_pages")}
    assert "blocks_saved_at" not in columns
    assert "label" not in {c["name"] for c in inspect(fresh_engine).get_columns("routines")}


def test_0003_dates_routines_from_their_create_event_and_repairs_fi_rates(
    fresh_engine: Engine,
) -> None:
    """``0002`` to ``0003``: a routine takes ``starts_on`` from its ``routine.created`` event
    (none: ``NULL``, it always ran); a Fixed Income project with a rate and 0h after the move
    takes its rate after the move (Private Credit keeps 0h); downgrading drops the column."""

    def run(cfg: Config, target: str) -> None:
        command.upgrade(cfg, target)

    _migrate(fresh_engine, lambda cfg: run(cfg, "0002"))
    stamp = "2026-10-01T08:00:00.000000Z"
    routine = (
        "INSERT INTO routines (id, domain, name, short, detail, kind, bd, weekday, hours, "
        "stage, status_note, co_tag_with_project, sort_order, created_at, updated_at) "
        "VALUES (?, 'pc', 'R', 'R', '', 'monthly', 3, 2, 1.0, 0, '', 0, 0, ?, ?)"
    )
    project = (
        "INSERT INTO projects (id, domain, name, short, goal, why_now, later_intent, end_name, "
        "start_date, target_date, rate_hours_per_day, rate_after_move, baseline_hours, "
        "unplaced_hours, phase, sort_order, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, '', '', '', 'Done', '2026-10-05', '2027-03-01', ?, ?, 0, 0, 0, 0, "
        "?, ?)"
    )
    event = (
        "INSERT INTO remi_events (id, at, business_date, type, actor, refs, payload, "
        "schema_version) VALUES (?, ?, ?, ?, 'user', ?, '{}', 1)"
    )
    with fresh_engine.begin() as conn:
        for rid in ("made", "seeded"):
            conn.exec_driver_sql(routine, (rid, stamp, stamp))
        conn.exec_driver_sql(
            event,
            ("e1", stamp, "2026-09-25", "routine.created", '[{"type": "routine", "id": "made"}]'),
        )
        conn.exec_driver_sql(
            event,
            ("e2", stamp, "2026-10-02", "routine.updated", '[{"type": "routine", "id": "made"}]'),
        )
        for pid, domain, rate, after in (
            ("fi-zero", "fi", 3.0, 0.0),
            ("fi-set", "fi", 3.0, 1.5),
            ("fi-define", "fi", 0.0, 0.0),
            ("pc-zero", "pc", 3.0, 0.0),
        ):
            conn.exec_driver_sql(project, (pid, domain, pid, pid, rate, after, stamp, stamp))

    _migrate(fresh_engine, lambda cfg: run(cfg, "0003"))

    assert current_revision(fresh_engine) == "0003"
    with fresh_engine.connect() as conn:
        starts = {r[0]: r[1] for r in conn.exec_driver_sql("SELECT id, starts_on FROM routines")}
        rates = {
            r[0]: r[1] for r in conn.exec_driver_sql("SELECT id, rate_after_move FROM projects")
        }
        conn.rollback()
    assert starts == {"made": "2026-09-25", "seeded": None}
    assert rates == {"fi-zero": 3.0, "fi-set": 1.5, "fi-define": 0.0, "pc-zero": 0.0}
    downgrade(fresh_engine, "0002")
    assert "starts_on" not in {c["name"] for c in inspect(fresh_engine).get_columns("routines")}


def _settings_ddl(engine: Engine) -> tuple[list[str], set[str]]:
    """The settings table's column lines (in order) and its constraint lines (any order: a batch
    rebuild may list them differently)."""
    with engine.connect() as conn:
        sql = str(
            conn.exec_driver_sql(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'settings'"
            ).scalar_one()
        )
        conn.rollback()
    lines = [line.strip().rstrip(",") for line in sql.splitlines()[1:-1]]
    return (
        [line for line in lines if not line.startswith("CONSTRAINT")],
        {line for line in lines if line.startswith("CONSTRAINT")},
    )


def _accents(engine: Engine) -> tuple[str, str]:
    with engine.connect() as conn:
        row = conn.exec_driver_sql("SELECT accent_pc, accent_fi FROM settings").one()
        conn.rollback()
    return (str(row[0]), str(row[1]))


def _new_row_accents(engine: Engine) -> tuple[str, str]:
    """What the server defaults give a fresh settings row (the singleton is swapped out)."""
    with engine.begin() as conn:
        conn.exec_driver_sql("DELETE FROM settings")
        conn.exec_driver_sql(
            "INSERT INTO settings (id, created_at, updated_at) VALUES (1, 'x', 'x')"
        )
        row = conn.exec_driver_sql("SELECT accent_pc, accent_fi FROM settings").one()
    return (str(row[0]), str(row[1]))


@pytest.mark.parametrize(
    ("saved", "migrated"),
    [
        (("#526e2a", "#47619c"), ("#009D80", "#2F6B9A")),  # the old default
        (("#526E2A", "#47619C"), ("#009D80", "#2F6B9A")),  # in any case
        (("#00737e", "#5e5a9a"), ("#009D80", "#2F6B9A")),  # the other stand-ins
        (("#1F744F", "#32669A"), ("#009D80", "#2F6B9A")),
        (("#884b75", "#007187"), ("#009D80", "#2F6B9A")),
        (("#112233", "#445566"), ("#112233", "#445566")),  # a pair set through the API
        (("#526e2a", "#445566"), ("#526e2a", "#445566")),  # half a stand-in is not one
        (("#026E62", "#5B7FA8"), ("#026E62", "#5B7FA8")),  # already a Ninety One pair
    ],
)
def test_0004_moves_the_accent_defaults_and_old_stand_ins_to_ninety_one_teal(
    fresh_engine: Engine, saved: tuple[str, str], migrated: tuple[str, str]
) -> None:
    """``0003`` to ``0004``: the server defaults become ``#009D80`` / ``#2F6B9A``, a stand-in pair
    (ignoring case) becomes the new default pair and any other pair stays; the rebuilt table
    keeps every column, CHECK constraint and foreign key. Downgrading restores the old defaults
    and moves the new default pair back to the old one."""

    def run(cfg: Config, target: str) -> None:
        command.upgrade(cfg, target)

    _migrate(fresh_engine, lambda cfg: run(cfg, "0003"))
    columns_0003, constraints_0003 = _settings_ddl(fresh_engine)
    with fresh_engine.begin() as conn:
        conn.exec_driver_sql("UPDATE settings SET accent_pc = ?, accent_fi = ?", saved)

    upgrade_to_head(fresh_engine)

    assert current_revision(fresh_engine) == "0004"
    assert _accents(fresh_engine) == migrated
    columns, constraints = _settings_ddl(fresh_engine)
    assert constraints == constraints_0003
    assert columns == [
        line.replace("DEFAULT '#526e2a'", "DEFAULT '#009D80'").replace(
            "DEFAULT '#47619c'", "DEFAULT '#2F6B9A'"
        )
        for line in columns_0003
    ]
    assert columns != columns_0003
    assert _schema_diff(fresh_engine) == []

    downgrade(fresh_engine, "0003")

    back = ("#526e2a", "#47619c") if migrated == ("#009D80", "#2F6B9A") else migrated
    assert _accents(fresh_engine) == back
    assert _settings_ddl(fresh_engine) == (columns_0003, constraints_0003)


def test_0004_gives_a_fresh_settings_row_the_ninety_one_pair(fresh_engine: Engine) -> None:
    upgrade_to_head(fresh_engine)
    assert _accents(fresh_engine) == ("#009D80", "#2F6B9A")
    assert _new_row_accents(fresh_engine) == ("#009D80", "#2F6B9A")
    downgrade(fresh_engine, "0003")
    assert _new_row_accents(fresh_engine) == ("#526e2a", "#47619c")


def test_foreign_keys_are_named_and_carry_their_delete_rules(fresh_engine: Engine) -> None:
    upgrade_to_head(fresh_engine)
    inspector = inspect(fresh_engine)
    rules = {
        (table, fk["name"]): (fk.get("options") or {}).get("ondelete")
        for table in inspector.get_table_names()
        for fk in inspector.get_foreign_keys(table)
    }
    assert all(name for _, name in rules)
    assert rules[("tasks", "fk_tasks_project_id_projects")] == "CASCADE"
    assert rules[("routines", "fk_routines_project_id_projects")] == "SET NULL"
    assert rules[("settings", "fk_settings_key_project_id_projects")] == "SET NULL"
    assert rules[("feed_events", "fk_feed_events_routine_id_routines")] == "SET NULL"
    assert rules[("textbook_pages", "fk_textbook_pages_section_id_textbook_sections")] == "RESTRICT"
    assert (
        rules[("textbook_blocks", "fk_textbook_blocks_chart_asset_id_chart_assets")] == "RESTRICT"
    )


def test_offline_sql_can_be_rendered(capsys: pytest.CaptureFixture[str]) -> None:
    cfg = alembic_config()
    cfg.set_main_option("sqlalchemy.url", "sqlite://")
    command.upgrade(cfg, "head", sql=True)
    sql = capsys.readouterr().out
    assert "CREATE TABLE projects" in sql
    assert "CREATE TRIGGER remi_events_no_update" in sql
    assert "INSERT INTO settings" in sql
