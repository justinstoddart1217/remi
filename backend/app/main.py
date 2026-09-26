"""Application factory and the ``remi`` command.

``create_app`` is what uvicorn (``--factory``) and the tests build: the API under ``/api`` and
the built SPA (``frontend/dist``) for everything else. ``cli`` is the installed ``remi`` entry
point: it serves on loopback only and opens the browser. ``remi db path|upgrade|backup``
manages the database without starting the server.

A ``remi.db`` that cannot be used as it is (written by a newer Remi, or not a readable
database) stops ``remi`` and ``remi db upgrade|backup`` with a plain message and exit status 1,
not a traceback: ``cli`` prepares the database before it starts the server.
"""

import argparse
import sqlite3
import sys
import threading
import time
import webbrowser
from collections.abc import AsyncGenerator, Sequence
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import sqlalchemy.exc
import uvicorn
from fastapi import FastAPI
from fastapi.routing import APIRoute
from pydantic import ValidationError

from app import __version__
from app.api.router import install_api
from app.api.static import install_static
from app.core.clock import Clock, build_clock
from app.core.config import RemiConfig, is_loopback_host
from app.core.db import make_engine
from app.core.migrations import (
    DatabaseProblem,
    backup_database,
    current_revision,
    head_revision,
    prepare_database,
)
from app.core.paths import backups_dir, db_path
from app.core.uow import UnitOfWorkFactory
from app.services.settings import SettingsTimezone

BROWSER_WAIT_SECONDS = 30.0


def _operation_id(route: APIRoute) -> str:
    # Stable, readable operationIds for the generated TypeScript client.
    return route.name


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncGenerator[None]:
    """Open ``remi.db`` (backing up and migrating it to head first) for the app's lifetime.

    Sets ``app.state.db`` and ``app.state.uow_factory`` unless a test already set them.
    """
    if getattr(app.state, "db", None) is not None:
        yield
        return
    cfg: RemiConfig = app.state.config
    database = prepare_database(cfg.data_dir)
    app.state.db = database
    app.state.uow_factory = UnitOfWorkFactory(database.session_factory, app.state.clock)
    try:
        yield
    finally:
        del app.state.uow_factory
        del app.state.db
        database.close()


def create_app(config: RemiConfig | None = None, clock: Clock | None = None) -> FastAPI:
    """Build the FastAPI app. Both arguments are injectable for tests."""
    cfg = config if config is not None else RemiConfig()

    app = FastAPI(
        title="Remi",
        version=__version__,
        # Swagger UI and ReDoc pull their assets from a CDN, so they stay off (stay-local).
        docs_url=None,
        redoc_url=None,
        openapi_url="/api/openapi.json",
        generate_unique_id_function=_operation_id,
        lifespan=_lifespan,
    )
    app.state.config = cfg
    # The business timezone comes from settings (read lazily once the database is open).
    tz_getter = SettingsTimezone(lambda: getattr(app.state, "db", None))
    app.state.clock = (
        clock if clock is not None else build_clock(cfg.today, tz_getter, now_override=cfg.now)
    )
    install_api(app, cfg)
    install_static(app, cfg.frontend_dist)
    return app


def _browser_url(host: str, port: int) -> str:
    shown = f"[{host}]" if ":" in host else host
    return f"http://{shown}:{port}/"


def _open_browser_when_started(server: uvicorn.Server, url: str) -> None:
    deadline = time.monotonic() + BROWSER_WAIT_SECONDS
    while not server.started:
        if server.should_exit or time.monotonic() > deadline:
            return
        time.sleep(0.05)
    webbrowser.open(url)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="remi",
        description="Run Remi locally on 127.0.0.1 and open it in the browser.",
    )
    parser.add_argument(
        "--host",
        default=None,
        help="loopback address to bind (default 127.0.0.1); anything else is refused",
    )
    parser.add_argument("--port", type=int, default=None, help="port (default 8765)")
    parser.add_argument("--data-dir", type=Path, default=None, help="override the data dir")
    parser.add_argument("--no-browser", action="store_true", help="do not open the browser")
    commands = parser.add_subparsers(dest="command", metavar="command")
    db = commands.add_parser("db", help="manage the database (path, upgrade, backup)")
    db.add_argument(
        "action",
        choices=("path", "upgrade", "backup"),
        help="path: print where remi.db lives; upgrade: back up and migrate to the latest "
        "schema; backup: copy remi.db into backups/",
    )
    # SUPPRESS keeps a --data-dir given before "db" from being reset by this default.
    db.add_argument(
        "--data-dir", type=Path, default=argparse.SUPPRESS, help="override the data dir"
    )
    return parser


def _config(parser: argparse.ArgumentParser, overrides: dict[str, Any]) -> RemiConfig:
    try:
        base = RemiConfig()
        return RemiConfig.model_validate({**base.model_dump(), **overrides}) if overrides else base
    except ValidationError as exc:
        parser.error(str(exc))


def db_command(action: str, cfg: RemiConfig) -> int:
    """``remi db path|upgrade|backup``. Prints the result; returns the exit status."""
    path = db_path(cfg.data_dir)
    if action == "path":
        print(path)
        return 0
    if action == "upgrade":
        before = _revision_of(path)
        try:
            database = prepare_database(cfg.data_dir)
        except DatabaseProblem as error:
            print(error, file=sys.stderr)
            return 1
        database.close()
        head = head_revision()
        if before == head:
            print(f"{path} is already at the latest schema ({head}).")
        else:
            print(f"{path} upgraded to {head} (from {before or 'an empty database'}).")
        return 0
    if not path.exists():
        print(f"No database at {path}; nothing to back up.", file=sys.stderr)
        return 1
    try:
        print(backup_database(path, backups_dir(cfg.data_dir), label="manual"))
    except sqlite3.DatabaseError as error:
        print(f"Could not back up {path}: {error}.", file=sys.stderr)
        return 1
    return 0


def _revision_of(path: Path) -> str | None:
    """The schema revision of an existing ``remi.db`` (``None``: no file, or unreadable, which
    ``prepare_database`` then reports)."""
    if not path.exists():
        return None
    engine = make_engine(path)
    try:
        return current_revision(engine)
    except sqlalchemy.exc.DBAPIError:
        return None
    finally:
        engine.dispose()


def check_database(cfg: RemiConfig) -> None:
    """Back up and migrate ``remi.db`` before the server starts, so a database Remi cannot use
    ends ``remi`` with a plain message (exit 1) instead of a startup traceback."""
    try:
        prepare_database(cfg.data_dir).close()
    except DatabaseProblem as error:
        print(f"Remi cannot start: {error}", file=sys.stderr)
        raise SystemExit(1) from None


def cli(argv: Sequence[str] | None = None) -> None:
    """Entry point for the ``remi`` command."""
    parser = _parser()
    args = parser.parse_args(argv)
    host: str | None = args.host
    port: int | None = args.port
    data_dir: Path | None = args.data_dir
    no_browser: bool = args.no_browser
    command: str | None = args.command

    if host is not None and not is_loopback_host(host):
        parser.error(f"refusing to bind to non-loopback host {host!r}: Remi is local-only")

    overrides: dict[str, Any] = {}
    if host is not None:
        overrides["host"] = host
    if port is not None:
        overrides["port"] = port
    if data_dir is not None:
        overrides["data_dir"] = data_dir
    cfg = _config(parser, overrides)

    if command == "db":
        raise SystemExit(db_command(str(args.action), cfg))

    check_database(cfg)
    server = uvicorn.Server(
        uvicorn.Config(
            create_app(cfg),
            host=cfg.host,
            port=cfg.port,
            workers=1,
            server_header=False,
            log_level="info",
        )
    )
    if cfg.open_browser and not no_browser:
        threading.Thread(
            target=_open_browser_when_started,
            args=(server, _browser_url(cfg.host, cfg.port)),
            name="remi-open-browser",
            daemon=True,
        ).start()
    server.run()


if __name__ == "__main__":  # pragma: no cover
    cli()
