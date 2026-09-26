"""Fixtures for the Textbook and chart tests: an app on a migrated copy of the template database.

* ``client``: a fresh database (first-run setup not done: the Textbook works regardless).
* ``seeded``: the design seed (sections fi/pc/gen, four pages, the sample chart), safe to mutate.
* ``clock``: a :class:`MovableClock` (``advance`` moves ``now``), for the GC grace period.
"""

import shutil
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from remi.core.config import RemiConfig
from remi.core.db import open_database
from remi.core.uow import UnitOfWorkFactory
from remi.main import create_app
from remi.repositories import models as orm
from remi.tests.fixtures import design_seed

CHART_MAX_BYTES = 64 * 1024


class MovableClock:
    """A fixed clock whose ``now`` can be moved forward."""

    def __init__(self, today: date, now: datetime) -> None:
        self._today = today
        self._now = now

    def now(self) -> datetime:
        return self._now

    def today(self) -> date:
        return self._today

    def advance(self, delta: timedelta) -> None:
        self._now += delta


@dataclass
class Book:
    """The app under test plus handles the tests need."""

    client: TestClient
    app: FastAPI
    clock: MovableClock
    data_dir: Path

    @property
    def uow_factory(self) -> UnitOfWorkFactory:
        return cast(UnitOfWorkFactory, self.app.state.uow_factory)

    def events(self, event_type: str) -> list[dict[str, Any]]:
        """``{actor, refs, payload}`` of every event of ``event_type``, oldest first."""
        with self.uow_factory.read() as uow:
            rows = (
                uow.session.query(orm.RemiEvent)
                .filter(orm.RemiEvent.type == event_type)
                .order_by(orm.RemiEvent.seq)
                .all()
            )
            return [{"actor": r.actor, "refs": r.refs, "payload": r.payload} for r in rows]

    def event_count(self) -> int:
        with self.uow_factory.read() as uow:
            return uow.session.query(orm.RemiEvent).count()

    def json(self, method: str, url: str, expect: int, **kwargs: Any) -> Any:
        response = self.client.request(method, url, **kwargs)
        assert response.status_code == expect, response.text
        return response.json() if response.content else None


def _build(data_dir: Path, template: Path, clock: MovableClock) -> FastAPI:
    data_dir.mkdir(parents=True, exist_ok=True)
    db_file = data_dir / "remi.db"
    shutil.copyfile(template, db_file)
    config = RemiConfig(
        data_dir=data_dir, env="test", open_browser=False, chart_max_bytes=CHART_MAX_BYTES
    )
    app = create_app(config, clock)
    database = open_database(db_file)
    app.state.db = database
    app.state.uow_factory = UnitOfWorkFactory(database.session_factory, clock)
    return app


@pytest.fixture
def clock() -> MovableClock:
    return MovableClock(design_seed.DESIGN_TODAY, design_seed.DESIGN_NOW)


@pytest.fixture
def book(migrated_template: Path, tmp_path: Path, clock: MovableClock) -> Iterator[Book]:
    data_dir = tmp_path / "data"
    app = _build(data_dir, migrated_template, clock)
    with TestClient(
        app, base_url=design_seed.BASE_URL, headers=design_seed.CLIENT_HEADERS
    ) as client:
        yield Book(client=client, app=app, clock=clock, data_dir=data_dir)
    app.state.db.close()


@pytest.fixture
def seeded(book: Book) -> Book:
    design_seed.load_via_api(book.client)
    return book
