"""FastAPI dependencies. Routes and tests reach process state only through these.

``create_app`` stores the process objects on ``app.state``:

- ``config``: :class:`~app.core.config.RemiConfig`
- ``clock``: :class:`~app.core.clock.Clock`
- ``db``: :class:`~app.core.db.Database` (engine + session factory), set by the lifespan
- ``uow_factory``: :class:`~app.core.uow.UnitOfWorkFactory`, set by the lifespan

Tests override any of them with ``app.dependency_overrides[get_clock] = ...``. A dependency
whose object is not wired yet fails with 501 ``NOT_IMPLEMENTED`` rather than a 500.

FastAPI resolves ``Depends`` before it validates path, query and body parameters, so a route
that takes ``UowFactoryDep``/``ClockDep`` answers 501 in an unwired app even when the request
itself is invalid (422). Routes with validated inputs take :data:`WiringDep` instead: it
resolves the unit of work factory and the clock only when the route body asks for them.
"""

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.api.errors import ApiError
from app.core.clock import Clock
from app.core.config import RemiConfig
from app.core.db import Database
from app.core.uow import UnitOfWorkFactory


def _not_wired(what: str) -> ApiError:
    return ApiError(501, "NOT_IMPLEMENTED", f"The {what} is not wired into the app yet.")


def get_config(request: Request) -> RemiConfig:
    config = getattr(request.app.state, "config", None)
    if not isinstance(config, RemiConfig):
        raise _not_wired("configuration")
    return config


def get_clock(request: Request) -> Clock:
    clock: Clock | None = getattr(request.app.state, "clock", None)
    if clock is None:
        raise _not_wired("clock")
    return clock


def get_database(request: Request) -> Database:
    db = getattr(request.app.state, "db", None)
    if not isinstance(db, Database):
        raise _not_wired("database")
    return db


def get_session(db: Annotated[Database, Depends(get_database)]) -> Iterator[Session]:
    """A read session for one request (read models). Writes go through a unit of work."""
    with db.session_factory() as session:
        yield session


def get_uow_factory(request: Request) -> UnitOfWorkFactory:
    """``uow_factory(actor)`` opens one write transaction; ``.read()`` and ``.dry_run()`` too."""
    factory = getattr(request.app.state, "uow_factory", None)
    if not isinstance(factory, UnitOfWorkFactory):
        raise _not_wired("unit of work")
    return factory


class Wiring:
    """The unit of work factory and clock, resolved lazily (see the module docstring)."""

    __slots__ = ("_request",)

    def __init__(self, request: Request) -> None:
        self._request = request

    @property
    def uow_factory(self) -> UnitOfWorkFactory:
        return get_uow_factory(self._request)

    @property
    def clock(self) -> Clock:
        return get_clock(self._request)


ConfigDep = Annotated[RemiConfig, Depends(get_config)]
ClockDep = Annotated[Clock, Depends(get_clock)]
DatabaseDep = Annotated[Database, Depends(get_database)]
SessionDep = Annotated[Session, Depends(get_session)]
UowFactoryDep = Annotated[UnitOfWorkFactory, Depends(get_uow_factory)]
WiringDep = Annotated[Wiring, Depends(Wiring)]
