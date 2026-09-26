"""Alembic environment for Remi (SQLite, batch mode, type comparison).

``remi.core.migrations`` runs this with ``config.attributes["connection"]`` set to an open
connection inside a ``BEGIN IMMEDIATE`` transaction; the ``alembic`` CLI runs it without one,
in which case the database comes from ``sqlalchemy.url`` or ``RemiConfig().data_dir``.
Migration connections have ``foreign_keys=OFF`` so batch table rebuilds cannot cascade.
"""

from logging.config import fileConfig
from typing import Any, Literal

from alembic import context
from sqlalchemy import URL, Connection

from remi.core.config import RemiConfig
from remi.core.db import WRITE_OPTIONS, make_engine, sqlite_url
from remi.core.paths import db_path, ensure_private_dir
from remi.repositories.models import Base, UTCDateTime

config = context.config
if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def _render_item(type_: str, obj: Any, _autogen_context: Any) -> str | Literal[False]:
    # Keep migrations free of app imports: UTCDateTime is ISO-8601 text on disk.
    if type_ == "type" and isinstance(obj, UTCDateTime):
        return "sa.String(length=32)"
    return False


def _configure(**kwargs: Any) -> None:
    context.configure(
        target_metadata=target_metadata,
        render_as_batch=True,
        compare_type=True,
        render_item=_render_item,
        **kwargs,
    )


def _default_url() -> URL:
    data_dir = ensure_private_dir(RemiConfig().data_dir)
    return sqlite_url(db_path(data_dir))


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url") or _default_url().render_as_string()
    _configure(url=url, literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def _run(connection: Connection) -> None:
    _configure(connection=connection)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    shared = config.attributes.get("connection")
    if isinstance(shared, Connection):
        _run(shared)
        return
    url = config.get_main_option("sqlalchemy.url") or _default_url()
    engine = make_engine(url, foreign_keys=False)
    try:
        connection = engine.connect().execution_options(**WRITE_OPTIONS)
        # One BEGIN IMMEDIATE transaction around the whole run (SQLite DDL is transactional).
        with connection, connection.begin():
            _run(connection)
    finally:
        engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
