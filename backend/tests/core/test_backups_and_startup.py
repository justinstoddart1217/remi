"""Backups before migrations, startup preparation and the app lifespan."""

import os
import sqlite3
import stat
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine

from remi import main
from remi.core import migrations
from remi.core.config import RemiConfig
from remi.core.db import Database, make_engine
from remi.core.migrations import (
    DatabaseTooNew,
    DatabaseUnreadable,
    backup_database,
    current_revision,
    head_revision,
    list_backups,
    migration_pending,
    prepare_database,
    prune_backups,
    upgrade_to_head,
)
from remi.core.paths import ensure_private_dir
from remi.core.uow import UnitOfWorkFactory

NEWER = "9999"
"""A revision newer than any this code ships (the tests pretend one exists)."""


def _mode(path: Path) -> int:
    return stat.S_IMODE(path.stat().st_mode)


def test_backup_uses_the_sqlite_backup_api_and_keeps_the_newest(
    db_path: Path, tmp_path: Path
) -> None:
    folder = tmp_path / "backups"
    start = datetime(2026, 10, 5, 8, tzinfo=UTC)
    made = [
        backup_database(db_path, folder, label="0001", keep=3, now=start + timedelta(minutes=i))
        for i in range(5)
    ]
    kept = list_backups(folder)
    assert kept == made[-3:]
    assert kept[0].name == "remi-0001-20261005T080200000000Z.db"
    copy = sqlite3.connect(kept[-1])
    try:
        assert copy.execute("SELECT id, ai_provider FROM settings").fetchall() == [(1, "none")]
    finally:
        copy.close()
    if os.name == "posix":
        assert _mode(folder) == 0o700
        assert _mode(kept[-1]) == 0o600
    assert prune_backups(folder, keep=1) == kept[:2]
    assert list_backups(tmp_path / "missing") == []


def test_up_to_date_databases_are_not_backed_up(engine: Engine, tmp_path: Path) -> None:
    assert not migration_pending(engine)
    assert upgrade_to_head(engine, backup_dir=tmp_path / "b") is None
    assert not (tmp_path / "b").exists()


def test_a_pending_migration_backs_up_first(
    engine: Engine, db_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ran: list[str] = []

    def fake_migrate(_engine: Engine, action: object) -> None:
        ran.append("migrated")

    # Pretend a newer revision exists: the database (at the real head) is now behind head.
    head = current_revision(engine)
    monkeypatch.setattr(migrations, "head_revision", lambda: NEWER)
    monkeypatch.setattr(migrations, "_migrate", fake_migrate)

    backup = upgrade_to_head(engine)

    assert backup is not None
    assert backup.parent == db_path.parent / "backups"
    assert backup.name.startswith(f"remi-{head}-")
    assert ran == ["migrated"]


def test_a_brand_new_database_is_not_backed_up(tmp_path: Path) -> None:
    database = prepare_database(tmp_path / "data")
    try:
        assert current_revision(database.engine) == head_revision()
        assert not (tmp_path / "data" / "backups").exists()
    finally:
        database.close()


def test_prepare_database_makes_private_files_and_is_idempotent(tmp_path: Path) -> None:
    data = tmp_path / "Remi"
    first = prepare_database(data)
    first.close()
    second = prepare_database(data)  # already at head: nothing to do, no backup
    try:
        assert isinstance(second, Database)
        assert second.path == data / "remi.db"
        assert not migration_pending(second.engine)
        assert list_backups(data / "backups") == []
    finally:
        second.close()
    if os.name == "posix":
        assert _mode(data) == 0o700
        assert _mode(data / "remi.db") == 0o600


def test_failed_migrations_roll_back(engine: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(_cfg: Config, _revision: str) -> None:
        raise RuntimeError("migration failed")

    head = current_revision(engine)
    monkeypatch.setattr(migrations, "head_revision", lambda: NEWER)
    monkeypatch.setattr(migrations.command, "upgrade", boom)
    with pytest.raises(RuntimeError, match="migration failed"):
        upgrade_to_head(engine)
    assert current_revision(engine) == head


def test_partial_ddl_of_a_failed_migration_is_rolled_back(
    engine: Engine, db_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def half_done(cfg: Config, _revision: str) -> None:
        conn = cfg.attributes["connection"]
        conn.exec_driver_sql("CREATE TABLE half_done (id INTEGER PRIMARY KEY)")
        conn.exec_driver_sql("ALTER TABLE settings ADD COLUMN half_done TEXT")
        conn.exec_driver_sql("DROP INDEX ix_tasks_project_id")
        conn.exec_driver_sql("UPDATE alembic_version SET version_num = ?", (NEWER,))
        raise RuntimeError("migration failed half way")

    head = current_revision(engine)
    monkeypatch.setattr(migrations, "head_revision", lambda: NEWER)
    monkeypatch.setattr(migrations.command, "upgrade", half_done)
    with pytest.raises(RuntimeError, match="half way"):
        upgrade_to_head(engine)

    assert current_revision(engine) == head
    check = sqlite3.connect(db_path)
    try:
        tables = {r[0] for r in check.execute("SELECT name FROM sqlite_master")}
        columns = {r[1] for r in check.execute("PRAGMA table_info(settings)")}
    finally:
        check.close()
    assert "half_done" not in tables
    assert "ix_tasks_project_id" in tables
    assert "half_done" not in columns


def test_the_app_lifespan_opens_and_closes_the_database(app: FastAPI, tmp_path: Path) -> None:
    assert getattr(app.state, "db", None) is None
    with TestClient(app, base_url="http://127.0.0.1:8765"):
        database = app.state.db
        assert isinstance(database, Database)
        assert database.path == tmp_path / "remi.db"
        assert isinstance(app.state.uow_factory, UnitOfWorkFactory)
        assert app.state.uow_factory.clock is app.state.clock
        assert not migration_pending(database.engine)
    assert getattr(app.state, "db", None) is None
    assert getattr(app.state, "uow_factory", None) is None


def test_the_lifespan_keeps_a_database_a_test_injected(app: FastAPI, tmp_path: Path) -> None:
    injected = prepare_database(tmp_path / "injected")
    app.state.db = injected
    try:
        with TestClient(app, base_url="http://127.0.0.1:8765"):
            assert app.state.db is injected
        assert not (tmp_path / "remi.db").exists()
    finally:
        injected.close()


# ------------------------------------------------------------------ backup pools
def test_manual_backups_never_push_out_the_pre_migration_backup(
    db_path: Path, tmp_path: Path
) -> None:
    folder = tmp_path / "backups"
    start = datetime(2026, 10, 5, 8, tzinfo=UTC)
    safety = backup_database(db_path, folder, label="0002", keep=3, now=start)
    manual = [
        backup_database(
            db_path, folder, label="manual", keep=3, now=start + timedelta(minutes=i + 1)
        )
        for i in range(5)
    ]
    assert list_backups(folder) == [safety, *manual[-3:]]
    # The pre-migration pool keeps its own newest ``keep`` too.
    later = [
        backup_database(db_path, folder, label=rev, keep=3, now=start + timedelta(hours=i + 1))
        for i, rev in enumerate(("0003", "0004", "0005"))
    ]
    assert list_backups(folder) == [*manual[-3:], *later]


# ------------------------------------------------------------------ databases Remi cannot use
def _set_revision(engine: Engine, revision: str) -> None:
    with engine.begin() as conn:
        conn.exec_driver_sql("UPDATE alembic_version SET version_num = ?", (revision,))


def test_a_database_from_a_newer_remi_is_refused_before_any_backup(
    engine: Engine, db_path: Path
) -> None:
    _set_revision(engine, "0099")
    with pytest.raises(DatabaseTooNew, match="newer version of Remi") as error:
        upgrade_to_head(engine)
    assert "0099" in str(error.value)
    assert "backups" in str(error.value)
    assert not (db_path.parent / "backups").exists()


def test_a_file_that_is_not_a_database_is_unreadable(tmp_path: Path) -> None:
    data = tmp_path / "data"
    data.mkdir()
    (data / "remi.db").write_bytes(os.urandom(5000))
    with pytest.raises(DatabaseUnreadable, match="not a database Remi can read"):
        prepare_database(data)
    assert not (data / "backups").exists()


def _config(data: Path) -> RemiConfig:
    return RemiConfig(data_dir=data, env="test", open_browser=False)


def test_the_cli_prints_a_plain_message_for_a_database_it_cannot_use(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    data = tmp_path / "data"
    prepare_database(data).close()
    engine = make_engine(data / "remi.db")
    try:
        _set_revision(engine, "0099")
    finally:
        engine.dispose()
    assert main.db_command("upgrade", _config(data)) == 1
    err = capsys.readouterr().err
    assert "newer version of Remi" in err
    assert "Traceback" not in err
    for _ in range(3):  # failed starts add no backups
        with pytest.raises(SystemExit) as exit_info:
            main.check_database(_config(data))
        assert exit_info.value.code == 1
    assert "Remi cannot start" in capsys.readouterr().err
    assert list_backups(data / "backups") == []

    broken = tmp_path / "broken"
    broken.mkdir()
    (broken / "remi.db").write_bytes(os.urandom(5000))
    assert main.db_command("upgrade", _config(broken)) == 1
    assert main.db_command("backup", _config(broken)) == 1
    err = capsys.readouterr().err
    assert "not a database Remi can read" in err
    assert "Could not back up" in err
    assert "Traceback" not in err
    monkeypatch.setattr(main, "RemiConfig", lambda: _config(broken))
    with pytest.raises(SystemExit) as exit_info:
        main.cli(["--no-browser"])
    assert exit_info.value.code == 1


# ------------------------------------------------------------------ private directories
@pytest.mark.skipif(os.name != "posix", reason="POSIX modes")
def test_every_directory_ensure_private_dir_creates_is_private(tmp_path: Path) -> None:
    old = os.umask(0o022)
    try:
        leaf = ensure_private_dir(tmp_path / "data" / "charts" / "f7")
    finally:
        os.umask(old)
    assert _mode(tmp_path / "data") == 0o700
    assert _mode(tmp_path / "data" / "charts") == 0o700
    assert _mode(leaf) == 0o700
    loose = tmp_path / "loose"  # an existing ancestor is left alone
    loose.mkdir(mode=0o755)
    loose.chmod(0o755)
    ensure_private_dir(loose / "inner")
    assert _mode(loose) == 0o755
    assert _mode(loose / "inner") == 0o700
