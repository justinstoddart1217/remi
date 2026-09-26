"""Shared helpers for the project and check-in API tests (``tests/projects``, ``tests/checkins``).

Each test gets its own app on a copy of the migrated template database; ``seeded_app`` loads
the design seed through ``POST /api/dev/fixtures`` (today Mon 5 Oct 2026, the prototype ids).
"""

import shutil
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.clock import FixedClock
from app.core.config import Env, RemiConfig
from app.core.db import open_database
from app.core.uow import UnitOfWorkFactory
from app.main import create_app
from app.repositories import models as orm
from tests.fixtures import design_seed

JSON = dict[str, Any]


@dataclass(frozen=True, slots=True)
class Api:
    """A test client plus the app behind it."""

    client: TestClient
    app: FastAPI

    @property
    def uow_factory(self) -> UnitOfWorkFactory:
        return cast(UnitOfWorkFactory, self.app.state.uow_factory)

    def plan(self) -> JSON:
        response = self.client.get("/api/plan")
        assert response.status_code == 200, response.text
        return cast(JSON, response.json())

    def project(self, project_id: str) -> JSON:
        found = [p for p in self.plan()["projects"] if p["id"] == project_id]
        assert found, project_id
        return cast(JSON, found[0])

    def events(self) -> list[orm.RemiEvent]:
        with self.uow_factory.read() as uow:
            rows = list(uow.session.scalars(select(orm.RemiEvent).order_by(orm.RemiEvent.seq)))
            for row in rows:
                uow.session.expunge(row)
            return rows

    def event_count(self) -> int:
        return len(self.events())

    def feed(self) -> list[JSON]:
        response = self.client.get("/api/feed", params={"limit": 50})
        assert response.status_code == 200, response.text
        return cast(list[JSON], response.json()["items"])

    def call(self, method: str, path: str, body: object = None, status: int = 200) -> JSON:
        """One request that must answer ``status`` (and, for a mutation, one event)."""
        before = self.event_count()
        response = self.client.request(method, f"/api{path}", json=body)
        assert response.status_code == status, response.text
        if method != "GET" and 200 <= status < 300:
            assert self.event_count() == before + 1, f"{method} {path} must record one event"
        return cast(JSON, response.json()) if response.content else {}

    def error(self, method: str, path: str, body: object, status: int) -> JSON:
        """A request that must fail with ``status`` and record no event."""
        before = self.event_count()
        response = self.client.request(method, f"/api{path}", json=body)
        assert response.status_code == status, response.text
        assert self.event_count() == before, f"a failed {method} {path} recorded an event"
        return cast(JSON, response.json()["error"])


def build_app(data_dir: Path, template: Path, *, env: Env = "test") -> FastAPI:
    """An app whose database is a copy of the migrated template (no lifespan migration)."""
    data_dir.mkdir(parents=True, exist_ok=True)
    db_file = data_dir / "remi.db"
    shutil.copyfile(template, db_file)
    clock = FixedClock(design_seed.DESIGN_TODAY, design_seed.DESIGN_NOW)
    app = create_app(RemiConfig(data_dir=data_dir, env=env, open_browser=False), clock)
    database = open_database(db_file)
    app.state.db = database
    app.state.uow_factory = UnitOfWorkFactory(database.session_factory, clock)
    return app


@contextmanager
def api_for(
    data_dir: Path, template: Path, *, seed: bool = True, env: Env = "test"
) -> Generator[Api]:
    app = build_app(data_dir, template, env=env)
    try:
        with TestClient(
            app, base_url=design_seed.BASE_URL, headers=design_seed.CLIENT_HEADERS
        ) as client:
            if seed:
                design_seed.load_via_api(client)  # the dev route exists in dev and test only
            yield Api(client, app)
    finally:
        app.state.db.close()
