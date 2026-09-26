import sqlite3
from datetime import UTC, date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import Engine, select, text
from sqlalchemy.orm import Session, sessionmaker

from remi.core.db import (
    begin_write,
    checkpoint,
    database_path,
    make_engine,
    open_database,
    sqlite_url,
    to_jsonable,
)
from remi.repositories.models import Note, format_utc, parse_utc


def test_every_connection_gets_the_pragmas(engine: Engine) -> None:
    with engine.connect() as conn:
        pragmas = {
            name: conn.exec_driver_sql(f"PRAGMA {name}").scalar()
            for name in (
                "journal_mode",
                "synchronous",
                "foreign_keys",
                "busy_timeout",
                "temp_store",
            )
        }
        conn.rollback()
    assert pragmas == {
        "journal_mode": "wal",
        "synchronous": 1,  # NORMAL
        "foreign_keys": 1,
        "busy_timeout": 5000,
        "temp_store": 2,  # MEMORY
    }


def test_migration_engines_can_turn_foreign_keys_off(db_path: Path) -> None:
    engine = make_engine(db_path, foreign_keys=False)
    try:
        with engine.connect() as conn:
            assert conn.exec_driver_sql("PRAGMA foreign_keys").scalar() == 0
            conn.rollback()
    finally:
        engine.dispose()


def test_only_sqlite_is_supported() -> None:
    with pytest.raises(ValueError, match="SQLite"):
        make_engine("postgresql://localhost/remi")


def test_write_sessions_take_the_write_lock_immediately(
    session_factory: sessionmaker[Session], db_path: Path
) -> None:
    with session_factory() as writer:
        begin_write(writer)  # BEGIN IMMEDIATE, no statement run yet
        other = sqlite3.connect(db_path, timeout=0.05, isolation_level=None)
        try:
            with pytest.raises(sqlite3.OperationalError, match="locked"):
                other.execute("BEGIN IMMEDIATE")
            # WAL: readers are not blocked by the writer.
            assert other.execute("SELECT count(*) FROM settings").fetchone() == (1,)
        finally:
            other.close()
        writer.rollback()


def test_read_sessions_use_a_deferred_begin(
    session_factory: sessionmaker[Session], db_path: Path
) -> None:
    with session_factory() as reader:
        reader.execute(text("SELECT 1"))
        other = sqlite3.connect(db_path, timeout=0.05, isolation_level=None)
        try:
            other.execute("BEGIN IMMEDIATE")  # a reader does not hold the write lock
            other.execute("ROLLBACK")
        finally:
            other.close()


def test_begin_write_must_come_first(session_factory: sessionmaker[Session]) -> None:
    with session_factory() as session:
        session.execute(text("SELECT 1"))
        with pytest.raises(RuntimeError, match="before the session has begun"):
            begin_write(session)


def test_utc_datetime_round_trips_as_sortable_text(session_factory: sessionmaker[Session]) -> None:
    moment = datetime(2026, 10, 5, 9, 41, 12, 5, tzinfo=timezone(timedelta(hours=1)))
    with session_factory() as session:
        begin_write(session)
        note = Note(day=date(2026, 10, 5), text="x", created_at=moment, updated_at=moment)
        session.add(note)
        session.flush()
        raw = session.execute(text("SELECT created_at FROM notes")).scalar_one()
        assert raw == "2026-10-05T08:41:12.000005Z"
        session.expire_all()
        loaded = session.scalars(select(Note)).one()
        assert loaded.created_at == moment
        assert loaded.created_at.tzinfo == UTC
        session.rollback()


def test_naive_datetimes_are_refused() -> None:
    with pytest.raises(ValueError, match="naive"):
        format_utc(datetime(2026, 10, 5, 9, 30))  # noqa: DTZ001
    assert parse_utc("2026-10-05T08:41:12.000005Z") == datetime(
        2026, 10, 5, 8, 41, 12, 5, tzinfo=UTC
    )


def test_json_columns_serialise_dates(session_factory: sessionmaker[Session]) -> None:
    from remi.repositories.models import Settings

    with session_factory() as session:
        begin_write(session)
        settings = session.get_one(Settings, 1)
        settings.ui_prefs = {"lastSeen": date(2026, 10, 5), "zoom": "3m"}
        session.flush()
        raw = session.execute(text("SELECT ui_prefs FROM settings")).scalar_one()
        assert raw == '{"lastSeen":"2026-10-05","zoom":"3m"}'
        session.rollback()


def test_to_jsonable() -> None:
    assert to_jsonable(
        {
            "d": date(2026, 10, 5),
            "t": datetime(2026, 10, 5, 8, tzinfo=UTC),
            "n": Decimal("1.5"),
            "s": {"b", "a"},
            "tuple": (1, 2),
            3: None,
        }
    ) == {
        "d": "2026-10-05",
        "t": "2026-10-05T08:00:00+00:00",
        "n": 1.5,
        "s": ["a", "b"],
        "tuple": [1, 2],
        "3": None,
    }
    with pytest.raises(TypeError):
        to_jsonable(object())


def test_paths_and_database(tmp_path: Path) -> None:
    path = tmp_path / "x.db"
    assert database_path(sqlite_url(path)) == path
    memory = make_engine("sqlite:///:memory:")
    assert database_path(memory) is None
    checkpoint(memory)  # no-op for in-memory databases
    memory.dispose()

    db = open_database(path)
    assert db.path == path
    with db.engine.connect() as conn:
        conn.exec_driver_sql("CREATE TABLE t (x)")
        conn.exec_driver_sql("INSERT INTO t VALUES (1)")
        conn.commit()
    db.close()  # checkpoints the WAL into the main file
    wal = path.with_name(path.name + "-wal")
    assert not wal.exists() or wal.stat().st_size == 0
    plain = sqlite3.connect(path)
    try:
        assert plain.execute("SELECT x FROM t").fetchall() == [(1,)]
    finally:
        plain.close()
