"""Service tests run on a real migrated SQLite file (``uow_factory`` from tests/conftest.py)."""

from collections.abc import Iterator
from pathlib import Path

import pytest

from remi.core.clock import FixedClock
from remi.core.uow import UnitOfWorkFactory
from remi.schemas.setup import SetupIn
from remi.services import setup as setup_service
from remi.services.ai import keys
from remi.services.dev_fixtures import SeedIds
from remi.tests.fixtures import design_seed


@pytest.fixture(autouse=True)
def _isolated_keys(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    for name in keys.ENV_VARS["anthropic"]:
        monkeypatch.delenv(name, raising=False)
    previous = keys.use_key_store(keys.MemoryKeyStore())
    yield
    keys.use_key_store(previous)


@pytest.fixture
def seeded(uow_factory: UnitOfWorkFactory, clock: FixedClock, tmp_path: Path) -> SeedIds:
    """The design seed loaded straight through the loader (one event)."""
    return design_seed.load(uow_factory, clock, tmp_path)


@pytest.fixture
def set_up(uow_factory: UnitOfWorkFactory, clock: FixedClock) -> None:
    """First-run setup done (London, England and Wales, move Mon 4 Jan 2027), nothing else."""
    body = SetupIn(
        move_date=design_seed.DESIGN_MOVE,
        timezone="Europe/London",
        holiday_region="GB-ENG",
        capacity_hours_per_day=8,
    )
    setup_service.complete_setup(uow_factory, clock, body)
