"""Fixtures for the HTTP contract tests.

These tests exercise routing, schemas, errors and middleware only, so the client does not run
the app lifespan (no database is opened). ``install_api`` is called explicitly, so the tests
hold whether or not ``create_app`` already calls it.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from remi.api.router import install_api
from remi.core.clock import FixedClock
from remi.core.config import RemiConfig
from remi.main import create_app

BASE_URL = "http://127.0.0.1:8765"
ORIGIN = "http://127.0.0.1:8765"
CLIENT_HEADERS = {"X-Remi-Client": "1", "Origin": ORIGIN}


def build_app(config: RemiConfig, clock: FixedClock) -> FastAPI:
    app = create_app(config, clock)
    install_api(app, config)
    return app


@pytest.fixture
def app(config: RemiConfig, clock: FixedClock) -> FastAPI:
    return build_app(config, clock)


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    test_client = TestClient(app, base_url=BASE_URL, headers=CLIENT_HEADERS)
    yield test_client
    test_client.close()


@pytest.fixture
def bare_client(app: FastAPI) -> Iterator[TestClient]:
    """No Origin or X-Remi-Client header: what a foreign caller looks like."""
    test_client = TestClient(app, base_url=BASE_URL)
    yield test_client
    test_client.close()


@pytest.fixture
def prod_config(tmp_path: Path) -> RemiConfig:
    return RemiConfig(data_dir=tmp_path, env="prod", open_browser=False)
