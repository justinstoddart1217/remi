import shutil
from collections.abc import Iterator
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from remi.core.clock import FixedClock
from remi.core.config import RemiConfig
from remi.core.db import checkpoint, make_engine, make_session_factory
from remi.core.migrations import upgrade_to_head
from remi.core.uow import UnitOfWorkFactory
from remi.main import create_app

# The design's fixed "today" (Mon 5 Oct 2026, 09:00 in London).
DESIGN_TODAY = date(2026, 10, 5)
DESIGN_NOW = datetime(2026, 10, 5, 8, 0, tzinfo=UTC)


@pytest.fixture
def config(tmp_path: Path) -> RemiConfig:
    return RemiConfig(data_dir=tmp_path, env="test", open_browser=False)


@pytest.fixture
def clock() -> FixedClock:
    return FixedClock(DESIGN_TODAY, DESIGN_NOW)


@pytest.fixture
def app(config: RemiConfig, clock: FixedClock) -> FastAPI:
    return create_app(config, clock)


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(
        app,
        base_url="http://127.0.0.1:8765",
        headers={"X-Remi-Client": "1", "Origin": "http://127.0.0.1:8765"},
    ) as test_client:
        yield test_client


# --- Database fixtures (a real migrated SQLite file per test; never :memory:) ---


@pytest.fixture(scope="session")
def migrated_template(tmp_path_factory: pytest.TempPathFactory) -> Path:
    path = tmp_path_factory.mktemp("template") / "template.db"
    engine = make_engine(path)
    try:
        upgrade_to_head(engine)
        checkpoint(engine)
    finally:
        engine.dispose()
    return path


@pytest.fixture
def db_path(migrated_template: Path, tmp_path: Path) -> Path:
    target = tmp_path / "remi.db"
    shutil.copyfile(migrated_template, target)
    return target


@pytest.fixture
def engine(db_path: Path) -> Iterator[Engine]:
    engine = make_engine(db_path)
    yield engine
    engine.dispose()


@pytest.fixture
def session_factory(engine: Engine) -> sessionmaker[Session]:
    return make_session_factory(engine)


@pytest.fixture
def uow_factory(session_factory: sessionmaker[Session], clock: FixedClock) -> UnitOfWorkFactory:
    return UnitOfWorkFactory(session_factory, clock)
