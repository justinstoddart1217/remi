"""Dependency providers read ``remi.state`` and can be overridden in tests."""

import datetime as dt
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text

from remi.api.deps import (
    ClockDep,
    ConfigDep,
    SessionDep,
    UowFactoryDep,
    get_clock,
    get_config,
)
from remi.api.errors import install_error_handlers
from remi.core.clock import FixedClock
from remi.core.config import RemiConfig
from remi.core.db import open_database
from tests.api.conftest import BASE_URL


def _app(state: dict[str, Any]) -> FastAPI:
    app = FastAPI()
    install_error_handlers(app)
    for key, value in state.items():
        setattr(app.state, key, value)

    @app.get("/api/today")
    def today(clock: ClockDep) -> str:  # pyright: ignore[reportUnusedFunction]
        return clock.today().isoformat()

    @app.get("/api/env")
    def env(config: ConfigDep) -> str:  # pyright: ignore[reportUnusedFunction]
        return config.env

    @app.get("/api/one")
    def one(session: SessionDep) -> int:  # pyright: ignore[reportUnusedFunction]
        return int(session.execute(text("select 1")).scalar_one())

    @app.get("/api/uow")
    def uow(factory: UowFactoryDep) -> str:  # pyright: ignore[reportUnusedFunction]
        return type(factory).__name__

    return app


@pytest.fixture
def state(config: RemiConfig, clock: FixedClock) -> dict[str, Any]:
    return {"config": config, "clock": clock}


def test_config_and_clock_come_from_app_state(state: dict[str, Any]) -> None:
    with TestClient(_app(state), base_url=BASE_URL) as client:
        assert client.get("/api/today").json() == "2026-10-05"
        assert client.get("/api/env").json() == "test"


def test_clock_and_config_can_be_overridden(state: dict[str, Any], tmp_path: Path) -> None:
    app = _app(state)
    app.dependency_overrides[get_clock] = lambda: FixedClock(
        dt.date(2027, 1, 4), dt.datetime(2027, 1, 4, 9, tzinfo=dt.UTC)
    )
    app.dependency_overrides[get_config] = lambda: RemiConfig(
        data_dir=tmp_path, env="dev", open_browser=False
    )
    with TestClient(app, base_url=BASE_URL) as client:
        assert client.get("/api/today").json() == "2027-01-04"
        assert client.get("/api/env").json() == "dev"


def test_unwired_database_and_uow_are_501(state: dict[str, Any]) -> None:
    with TestClient(_app(state), base_url=BASE_URL) as client:
        for path in ("/api/one", "/api/uow"):
            response = client.get(path)
            assert response.status_code == 501
            assert response.json()["error"]["code"] == "NOT_IMPLEMENTED"


def test_unwired_clock_is_501() -> None:
    with TestClient(_app({}), base_url=BASE_URL) as client:
        response = client.get("/api/today")
        assert response.status_code == 501


@pytest.fixture
def db_state(state: dict[str, Any], tmp_path: Path) -> Iterator[dict[str, Any]]:
    database = open_database(tmp_path / "deps.db")
    try:
        yield {**state, "db": database}
    finally:
        database.close()


def test_session_comes_from_the_database(db_state: dict[str, Any]) -> None:
    with TestClient(_app(db_state), base_url=BASE_URL) as client:
        assert client.get("/api/one").json() == 1
