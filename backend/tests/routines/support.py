"""Shared helpers for the routines and notes API tests (design seed, one app per test)."""

import shutil
from collections.abc import Iterator
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.clock import FixedClock
from app.core.config import RemiConfig
from app.core.db import open_database
from app.core.uow import UnitOfWorkFactory
from app.main import create_app
from app.services.ai import keys
from tests.fixtures import design_seed

Json = dict[str, Any]


def build_app(data_dir: Path, template: Path, clock: FixedClock) -> FastAPI:
    """An app on a copy of the migrated template database."""
    data_dir.mkdir(parents=True, exist_ok=True)
    db_file = data_dir / "remi.db"
    shutil.copyfile(template, db_file)
    config = RemiConfig(data_dir=data_dir, env="test", open_browser=False)
    app = create_app(config, clock)
    database = open_database(db_file)
    app.state.db = database
    app.state.uow_factory = UnitOfWorkFactory(database.session_factory, clock)
    return app


@pytest.fixture(autouse=True)
def isolated_keys(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    for name in keys.ENV_VARS["anthropic"]:
        monkeypatch.delenv(name, raising=False)
    previous = keys.use_key_store(keys.MemoryKeyStore())
    yield
    keys.use_key_store(previous)


@pytest.fixture
def fresh_client(migrated_template: Path, tmp_path: Path) -> Iterator[TestClient]:
    """An app on an empty database (setup still needed)."""
    clock = FixedClock(design_seed.DESIGN_TODAY, design_seed.DESIGN_NOW)
    app = build_app(tmp_path / "data", migrated_template, clock)
    with TestClient(
        app, base_url=design_seed.BASE_URL, headers=design_seed.CLIENT_HEADERS
    ) as client:
        yield client
    app.state.db.close()


@pytest.fixture
def client(fresh_client: TestClient) -> TestClient:
    """The design seed, loaded through ``POST /dev/fixtures`` (safe to mutate)."""
    design_seed.load_via_api(fresh_client)
    return fresh_client


def body(response: Any) -> Json:
    return cast(Json, response.json())


def rows(response: Any) -> list[Json]:
    """A JSON array response."""
    return cast(list[Json], response.json())


def error(response: Any) -> Json:
    return cast(Json, response.json()["error"])


def revision(client: TestClient) -> int:
    return int(body(client.get("/api/plan"))["revision"])


def events_since(client: TestClient, seq: int) -> list[Json]:
    page = body(client.get("/api/events", params={"since": seq, "limit": 50}))
    return cast(list[Json], page["items"])


def one_event(client: TestClient, seq: int) -> Json:
    """The single event written since ``seq`` (fails when there are none or several)."""
    found = events_since(client, seq)
    assert len(found) == 1, [e["type"] for e in found]
    return found[0]


def routine(plan: Json, routine_id: str) -> Json:
    return next(r for r in plan["routines"] if r["id"] == routine_id)


def project(plan: Json, project_id: str) -> Json:
    return next(p for p in plan["projects"] if p["id"] == project_id)


def load_ids(plan: Json, iso: str) -> list[str]:
    return [i["refId"] for i in plan["loads"][iso]["items"]]
