"""Fixtures for the read-model tests: an app on a migrated copy of the template database.

``design_client`` is module-scoped (the design seed loaded once; tests must not mutate it).
``fresh_client`` is a function-scoped app on an empty database (setup still needed).
"""

import shutil
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from remi.core.clock import FixedClock
from remi.core.config import RemiConfig
from remi.core.db import open_database
from remi.core.uow import UnitOfWorkFactory
from remi.main import create_app
from remi.services.ai import keys
from remi.tests.fixtures import design_seed


def build_app(data_dir: Path, template: Path, clock: FixedClock) -> FastAPI:
    """An app whose database is a copy of the migrated template (no lifespan migration)."""
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
def _isolated_keys(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """No API key from the environment or other tests: each test starts with none."""
    for name in keys.ENV_VARS["anthropic"]:
        monkeypatch.delenv(name, raising=False)
    previous = keys.use_key_store(keys.MemoryKeyStore())
    yield
    keys.use_key_store(previous)


def _client(app: FastAPI) -> TestClient:
    return TestClient(app, base_url=design_seed.BASE_URL, headers=design_seed.CLIENT_HEADERS)


@pytest.fixture(scope="module")
def design_client(
    migrated_template: Path, tmp_path_factory: pytest.TempPathFactory
) -> Iterator[TestClient]:
    clock = FixedClock(design_seed.DESIGN_TODAY, design_seed.DESIGN_NOW)
    app = build_app(tmp_path_factory.mktemp("design"), migrated_template, clock)
    with _client(app) as client:
        design_seed.load_via_api(client)
        yield client
    app.state.db.close()


@pytest.fixture
def fresh_client(migrated_template: Path, tmp_path: Path) -> Iterator[TestClient]:
    clock = FixedClock(design_seed.DESIGN_TODAY, design_seed.DESIGN_NOW)
    app = build_app(tmp_path / "data", migrated_template, clock)
    with _client(app) as client:
        yield client
    app.state.db.close()


@pytest.fixture
def seeded_client(fresh_client: TestClient) -> TestClient:
    """A function-scoped app with the design seed (safe to mutate)."""
    design_seed.load_via_api(fresh_client)
    return fresh_client
