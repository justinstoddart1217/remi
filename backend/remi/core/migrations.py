"""Schema migrations (Alembic), run in-process on startup with a backup first.

* :func:`upgrade_to_head` backs the database up with the sqlite3 backup API into
  ``backups/remi-<current-rev>-<timestamp>.db`` whenever an existing database is behind head,
  then upgrades inside one ``BEGIN IMMEDIATE`` transaction on a connection with
  ``foreign_keys=OFF`` (so batch table rebuilds cannot fire cascades), and checks
  ``PRAGMA foreign_key_check`` before committing. A database at a revision this code does not
  know (written by a newer Remi) is refused with :class:`DatabaseTooNew` before any backup.
* Backups are pruned per pool: the newest 10 pre-migration backups (any revision label) and,
  separately, the newest 10 ``remi db backup`` copies (label ``manual``), so manual backups
  never push out the pre-migration safety copy.
* :func:`prepare_database` is the startup entry point: private data dir, engine, migrations.
  A file that is not a readable SQLite database is :class:`DatabaseUnreadable`.
  Both errors carry a plain message for the ``remi`` command to print (no traceback).
"""

import sqlite3
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Final

import sqlalchemy.exc
from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from alembic.script.revision import RevisionError
from alembic.util import CommandError
from sqlalchemy import Engine

from remi.core.db import WRITE_OPTIONS, Database, database_path, make_engine, open_database
from remi.core.paths import (
    alembic_dir,
    backups_dir,
    db_path,
    ensure_private_dir,
    make_private_file,
)

BACKUP_KEEP: Final = 10
BACKUP_PREFIX: Final = "remi-"
BACKUP_SUFFIX: Final = ".db"
MANUAL_LABEL: Final = "manual"
"""The label of ``remi db backup`` copies; every other label is a pre-migration revision."""
_TS_FORMAT: Final = "%Y%m%dT%H%M%S%fZ"


class MigrationError(RuntimeError):
    """The schema could not be brought to head (the transaction was rolled back)."""


class DatabaseProblem(MigrationError):
    """``remi.db`` cannot be used as it is. ``str(error)`` is a plain message for the user."""


class DatabaseTooNew(DatabaseProblem):
    """``remi.db`` is at a schema revision this code does not know (a newer Remi wrote it)."""


class DatabaseUnreadable(DatabaseProblem):
    """``remi.db`` is not a SQLite database Remi can read (damaged, or not a database)."""


def alembic_config() -> Config:
    """An in-memory Alembic config pointing at ``backend/alembic`` (no logging setup)."""
    cfg = Config()
    cfg.set_main_option("script_location", str(alembic_dir()))
    cfg.attributes["configure_logger"] = False
    return cfg


def head_revision() -> str:
    head = ScriptDirectory.from_config(alembic_config()).get_current_head()
    if head is None:  # pragma: no cover - the repo always ships 0001
        msg = "no Alembic revisions found"
        raise MigrationError(msg)
    return head


def current_revision(engine: Engine) -> str | None:
    """The database's revision, or ``None`` for a database Alembic has never touched."""
    with engine.connect() as conn:
        revision = MigrationContext.configure(conn).get_current_revision()
        conn.rollback()
    return revision


def migration_pending(engine: Engine) -> bool:
    return current_revision(engine) != head_revision()


def known_revision(revision: str) -> bool:
    """``revision`` is one of this code's migrations (a newer Remi's revision is not)."""
    try:
        ScriptDirectory.from_config(alembic_config()).get_revision(revision)
    except (CommandError, RevisionError):
        return False
    return True


# ------------------------------------------------------------------ backups


def _backup_sort_key(path: Path) -> str:
    # remi-<rev>-<timestamp>.db: the timestamp is the last dash-separated field.
    return path.stem.rsplit("-", 1)[-1]


def backup_label(path: Path) -> str:
    """The label of ``remi-<label>-<timestamp>.db`` (a revision, or ``manual``)."""
    return path.stem.removeprefix(BACKUP_PREFIX).rsplit("-", 1)[0]


def _pool(path: Path) -> str:
    return MANUAL_LABEL if backup_label(path) == MANUAL_LABEL else "pre-migration"


def list_backups(directory: Path) -> list[Path]:
    """Backups in ``directory``, oldest first."""
    if not directory.is_dir():
        return []
    found = [
        p
        for p in directory.iterdir()
        if p.is_file() and p.name.startswith(BACKUP_PREFIX) and p.suffix == BACKUP_SUFFIX
    ]
    return sorted(found, key=_backup_sort_key)


def prune_backups(directory: Path, keep: int = BACKUP_KEEP) -> list[Path]:
    """Delete all but the newest ``keep`` backups of each pool (pre-migration backups, and
    ``manual`` ones); returns the deleted paths, oldest first."""
    pools: dict[str, list[Path]] = {}
    for path in list_backups(directory):
        pools.setdefault(_pool(path), []).append(path)
    doomed = sorted(
        (p for backups in pools.values() for p in backups[: max(len(backups) - keep, 0)]),
        key=_backup_sort_key,
    )
    for path in doomed:
        path.unlink(missing_ok=True)
    return doomed


def backup_database(
    source: Path,
    directory: Path,
    *,
    label: str,
    keep: int = BACKUP_KEEP,
    now: datetime | None = None,
) -> Path:
    """Copy ``source`` with the sqlite3 online-backup API (WAL-safe) and prune old copies."""
    ensure_private_dir(directory)
    stamp = (now if now is not None else datetime.now(UTC)).astimezone(UTC).strftime(_TS_FORMAT)
    safe_label = "".join(c if c.isalnum() or c == "_" else "_" for c in label) or "db"
    target = directory / f"{BACKUP_PREFIX}{safe_label}-{stamp}{BACKUP_SUFFIX}"
    src = sqlite3.connect(source)
    try:
        dst = sqlite3.connect(target)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    make_private_file(target)
    prune_backups(directory, keep)
    return target


# ------------------------------------------------------------------ upgrade / downgrade


def _migrate(engine: Engine, action: Callable[[Config], None]) -> None:
    file_backed = database_path(engine) is not None
    migration_engine = make_engine(engine.url, foreign_keys=False) if file_backed else engine
    try:
        conn = migration_engine.connect().execution_options(**WRITE_OPTIONS)
        with conn, conn.begin():
            cfg = alembic_config()
            cfg.attributes["connection"] = conn
            action(cfg)
            problems = conn.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
            if problems:
                msg = f"foreign key violations after migrating: {problems[:5]!r}"
                raise MigrationError(msg)
    finally:
        if migration_engine is not engine:
            migration_engine.dispose()


def upgrade_to_head(
    engine: Engine,
    *,
    backup_dir: Path | None = None,
    keep: int = BACKUP_KEEP,
) -> Path | None:
    """Bring the schema to head. Returns the backup written first, if any.

    A backup is taken only when an existing database is behind head (a brand-new database
    has nothing worth keeping). ``backup_dir`` defaults to ``backups/`` next to the file.
    """
    head = head_revision()
    current = current_revision(engine)
    if current == head:
        return None
    path = database_path(engine)
    directory = (
        backup_dir
        if backup_dir is not None
        else (path.parent / "backups" if path is not None else None)
    )
    if current is not None and not known_revision(current):
        # Checked before the backup: every failed start would otherwise add a copy of a
        # database this code cannot use, and push out the older, usable backups.
        where = f" in {directory}" if directory is not None else ""
        msg = (
            f"This database was written by a newer version of Remi (schema {current}; this "
            f"version knows up to {head}). Update Remi, or restore a backup{where}."
        )
        raise DatabaseTooNew(msg)
    backup: Path | None = None
    if path is not None and current is not None and directory is not None:
        backup = backup_database(path, directory, label=current, keep=keep)

    def upgrade(cfg: Config) -> None:
        command.upgrade(cfg, head)

    _migrate(engine, upgrade)
    return backup


def downgrade(engine: Engine, revision: str = "base") -> None:
    """Downgrade to ``revision`` (``"base"`` drops everything). For tests and recovery."""

    def run(cfg: Config) -> None:
        command.downgrade(cfg, revision)

    _migrate(engine, run)


def _unreadable(error: BaseException) -> bool:
    """SQLite says the file is not a (healthy) database: "file is not a database", "database
    disk image is malformed". A locked or busy database (``OperationalError``) is not."""
    orig = error.orig if isinstance(error, sqlalchemy.exc.DBAPIError) else error
    return isinstance(orig, sqlite3.DatabaseError) and not isinstance(
        orig, sqlite3.OperationalError
    )


def prepare_database(data_dir: Path, *, keep_backups: int = BACKUP_KEEP) -> Database:
    """Startup: make the data dir private, open ``remi.db`` and migrate it to head.

    Raises ``DatabaseTooNew`` or ``DatabaseUnreadable`` (plain messages) when ``remi.db``
    cannot be used as it is."""
    ensure_private_dir(data_dir)
    path = db_path(data_dir)
    backups = backups_dir(data_dir)
    database: Database | None = None
    try:
        database = open_database(path)
        upgrade_to_head(database.engine, backup_dir=backups, keep=keep_backups)
    except (sqlalchemy.exc.DBAPIError, sqlite3.DatabaseError) as error:
        if database is not None:
            database.engine.dispose()
        if not _unreadable(error):
            raise
        detail = error.orig if isinstance(error, sqlalchemy.exc.DBAPIError) else error
        msg = (
            f"{path} is not a database Remi can read ({detail}). It may be damaged. Move it "
            f"aside and start Remi again for a fresh one, or copy a backup from {backups} "
            "over it (`remi db path` prints where it lives)."
        )
        raise DatabaseUnreadable(msg) from error
    except BaseException:
        if database is not None:
            database.engine.dispose()
        raise
    for file in (path, path.with_name(path.name + "-wal"), path.with_name(path.name + "-shm")):
        make_private_file(file)
    return database
