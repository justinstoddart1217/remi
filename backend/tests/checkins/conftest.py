"""Fixtures: ``api`` is a fresh app with the design seed; ``bare`` has not run setup."""

from collections.abc import Iterator
from pathlib import Path

import pytest

from app.services.ai import keys
from tests.projects.helpers import Api, api_for


@pytest.fixture(autouse=True)
def _isolated_keys(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    for name in keys.ENV_VARS["anthropic"]:
        monkeypatch.delenv(name, raising=False)
    previous = keys.use_key_store(keys.MemoryKeyStore())
    yield
    keys.use_key_store(previous)


@pytest.fixture
def api(migrated_template: Path, tmp_path: Path) -> Iterator[Api]:
    with api_for(tmp_path / "seeded", migrated_template) as seeded:
        yield seeded


@pytest.fixture
def bare(migrated_template: Path, tmp_path: Path) -> Iterator[Api]:
    with api_for(tmp_path / "bare", migrated_template, seed=False) as fresh:
        yield fresh
