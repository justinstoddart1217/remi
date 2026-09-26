"""SQLite engine, sessions and transactions (sync SQLAlchemy 2.x).

* Every connection runs ``journal_mode=WAL``, ``synchronous=NORMAL``, ``foreign_keys=ON``,
  ``busy_timeout=5000`` and ``temp_store=MEMORY``.
* pysqlite's own transaction handling is switched off (``isolation_level=None``) and the
  engine's ``begin`` event emits ``BEGIN`` itself: ``BEGIN IMMEDIATE`` when the connection
  carries the execution option ``sqlite_begin="IMMEDIATE"`` (writers take the write lock up
  front, so two writers never deadlock on a lock upgrade), a plain deferred ``BEGIN`` otherwise.
* JSON columns serialise dates, datetimes, Decimals and sets (see :func:`to_jsonable`).
"""

import json
import sqlite3
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from functools import partial
from pathlib import Path
from typing import Any, Final, cast

from sqlalchemy import URL, Connection, Engine, create_engine, event, make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import ConnectionPoolEntry

SQLITE_BEGIN: Final = "sqlite_begin"
"""Execution option read by the ``begin`` hook."""
IMMEDIATE: Final = "IMMEDIATE"
WRITE_OPTIONS: Final[Mapping[str, Any]] = {SQLITE_BEGIN: IMMEDIATE}
"""Pass as ``execution_options`` to get a ``BEGIN IMMEDIATE`` transaction."""

BUSY_TIMEOUT_MS: Final = 5000


def to_jsonable(value: Any) -> Any:
    """Recursively convert ``value`` into plain JSON types.

    Dates and datetimes become ISO-8601 strings, Decimals floats, Enums their value, sets
    sorted lists, tuples lists, and Pydantic models ``model_dump(mode="json")``.
    """
    if value is None or isinstance(value, bool | int | float | str):
        return value
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, Enum):
        return to_jsonable(value.value)
    if isinstance(value, Mapping):
        items = cast(Mapping[Any, Any], value)
        return {str(k): to_jsonable(v) for k, v in items.items()}
    if isinstance(value, set | frozenset):
        members = cast(set[Any] | frozenset[Any], value)
        return sorted((to_jsonable(v) for v in members), key=repr)
    if isinstance(value, list | tuple):
        seq = cast(list[Any] | tuple[Any, ...], value)
        return [to_jsonable(v) for v in seq]
    dump = getattr(value, "model_dump", None)
    if callable(dump):
        return dump(mode="json")
    msg = f"{type(value).__name__} is not JSON serialisable"
    raise TypeError(msg)


def _json_default(value: Any) -> Any:
    return to_jsonable(value)


json_dumps = partial(json.dumps, default=_json_default, ensure_ascii=False, separators=(",", ":"))
"""The serializer used for every JSON column."""


def sqlite_url(path: Path) -> URL:
    """A ``sqlite:///`` URL for a database file."""
    return URL.create("sqlite", database=str(path))


def database_path(url: URL | Engine) -> Path | None:
    """The database file behind a SQLite URL or engine; ``None`` for in-memory databases."""
    target = url.url if isinstance(url, Engine) else url
    name = target.database
    if not name or name == ":memory:" or name.startswith("file::memory:"):
        return None
    return Path(name)


def make_engine(
    url: str | URL | Path,
    *,
    foreign_keys: bool = True,
    echo: bool = False,
) -> Engine:
    """A SQLite engine configured for Remi (see the module docstring).

    ``foreign_keys=False`` is only for migrations: SQLite ignores ``PRAGMA foreign_keys``
    inside a transaction, and batch table rebuilds must not fire ``ON DELETE`` actions.
    """
    target = sqlite_url(url) if isinstance(url, Path) else make_url(url)
    if target.get_backend_name() != "sqlite":
        msg = f"Remi only supports SQLite, not {target.get_backend_name()!r}"
        raise ValueError(msg)
    engine = create_engine(
        target,
        echo=echo,
        connect_args={"check_same_thread": False},
        json_serializer=json_dumps,
    )
    _install_sqlite_hooks(engine, foreign_keys=foreign_keys)
    return engine


def _install_sqlite_hooks(engine: Engine, *, foreign_keys: bool) -> None:
    fk = "ON" if foreign_keys else "OFF"

    @event.listens_for(engine, "connect")
    def _on_connect(  # pyright: ignore[reportUnusedFunction]
        dbapi_connection: sqlite3.Connection, _record: ConnectionPoolEntry
    ) -> None:
        # Take transaction control away from pysqlite; the "begin" hook emits BEGIN.
        dbapi_connection.isolation_level = None
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.execute(f"PRAGMA foreign_keys={fk}")
            cursor.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
            cursor.execute("PRAGMA temp_store=MEMORY")
        finally:
            cursor.close()

    @event.listens_for(engine, "begin")
    def _on_begin(conn: Connection) -> None:  # pyright: ignore[reportUnusedFunction]
        mode = conn.get_execution_options().get(SQLITE_BEGIN)
        conn.exec_driver_sql("BEGIN IMMEDIATE" if mode == IMMEDIATE else "BEGIN")


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    """Sessions for the unit of work and read models.

    ``expire_on_commit=False`` so a service can hand committed entities to the response
    after its unit of work has closed.
    """
    return sessionmaker(bind=engine, expire_on_commit=False, autoflush=True)


def begin_write(session: Session) -> Connection:
    """Start ``session``'s transaction with ``BEGIN IMMEDIATE`` and return its connection.

    Must be the first thing the session does; execution options only apply to a connection
    when the session first procures it.
    """
    if session.in_transaction():
        msg = "begin_write() must be called before the session has begun a transaction"
        raise RuntimeError(msg)
    return session.connection(execution_options=dict(WRITE_OPTIONS))


def checkpoint(engine: Engine) -> None:
    """Fold the WAL back into the database file (``wal_checkpoint(TRUNCATE)``)."""
    if database_path(engine) is None:
        return
    # Outside any transaction: the raw DBAPI connection runs in autocommit (isolation_level=None).
    raw = engine.raw_connection()
    try:
        cursor = raw.cursor()
        try:
            cursor.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        finally:
            cursor.close()
    finally:
        raw.close()


@dataclass(frozen=True, slots=True)
class Database:
    """The open database of one process: engine plus session factory."""

    engine: Engine
    session_factory: sessionmaker[Session]

    @property
    def path(self) -> Path | None:
        return database_path(self.engine)

    def close(self) -> None:
        """Checkpoint the WAL and close every pooled connection."""
        try:
            checkpoint(self.engine)
        finally:
            self.engine.dispose()


def open_database(url: str | URL | Path) -> Database:
    """Engine and session factory for ``url``. Does not create tables or migrate."""
    engine = make_engine(url)
    return Database(engine=engine, session_factory=make_session_factory(engine))
