"""The design seed: the prototype's sample plan as a test fixture (ADR-0006).

The data comes from ``remi/fixtures/prototype_seed.json`` and is loaded by
``remi.services.dev_fixtures`` (the same loader ``POST /dev/fixtures`` uses), so tests and the
parity harness see exactly the same database. Use it opt-in, never autouse::

    ids = design_seed.load(uow_factory, clock, data_dir)

or through HTTP with ``design_client`` (see ``tests/read/conftest.py``). Today is Mon
5 Oct 2026 (``FixedClock``); the prototype's string ids are kept (``ret``, ``manco``, ``play``,
``fion``, ``alpha``, ``r-ret``, ``r-man``, ``man-0`` ...).
"""

import json
from collections.abc import Mapping
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, Final, cast

from fastapi.testclient import TestClient

from remi.core.clock import Clock
from remi.core.uow import UnitOfWorkFactory, ref
from remi.services.dev_fixtures import SeedIds, load_design, load_seed

DESIGN_TODAY: Final = date(2026, 10, 5)
DESIGN_NOW: Final = datetime(2026, 10, 5, 8, 0, tzinfo=UTC)
DESIGN_MOVE: Final = date(2027, 1, 4)
GOLDEN_DIR: Final = Path(__file__).resolve().parents[1] / "golden"

PROJECT_IDS: Final = ("ret", "manco", "play", "fion", "alpha")
ROUTINE_IDS: Final = ("r-ret", "r-man")
CLIENT_HEADERS: Final = {"X-Remi-Client": "1", "Origin": "http://127.0.0.1:8765"}
BASE_URL: Final = "http://127.0.0.1:8765"


def load(uow_factory: UnitOfWorkFactory, clock: Clock, data_dir: Path) -> SeedIds:
    """Reset the database and load the design seed in one unit of work (one event)."""
    with uow_factory("import") as uow:
        ids = load_design(uow, data_dir=data_dir, today=clock.today())
        uow.record("dev.fixture_loaded", [ref("fixture", "design")], {"fixture": "design"})
    return ids


def load_via_api(client: TestClient) -> dict[str, Any]:
    """``POST /api/dev/fixtures`` (the app must run with ``env`` dev or test)."""
    response = client.post("/api/dev/fixtures", json={"fixture": "design"})
    assert response.status_code == 200, response.text
    return cast(dict[str, Any], response.json())


def seed() -> Mapping[str, Any]:
    return load_seed()


def golden(name: str) -> Any:
    """A golden file from ``remi/tests/golden`` (``calendar``, ``loads``, ``rotation`` ...)."""
    with (GOLDEN_DIR / f"{name}.json").open(encoding="utf-8") as handle:
        return json.load(handle)
