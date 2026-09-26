"""Property: for any reviewed change set, preview == apply == ``GET /plan`` (ADR-0007).

Each example runs on a fresh copy of a database with the design seed: ``POST
/checkins/preview``, then ``POST /checkins/apply``, then ``GET /plan``.
"""

import datetime as dt
import shutil
from collections.abc import Iterator
from pathlib import Path

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from app.core.clock import FixedClock
from app.core.db import open_database
from app.core.uow import UnitOfWorkFactory
from app.services.ai import keys
from tests.fixtures import design_seed
from tests.projects.helpers import JSON, api_for

PROJECTS = ("ret", "manco", "play", "fion", "alpha")
OPEN_TASKS = {
    "ret": ("ret-2", "ret-3", "ret-4", "ret-5"),
    "manco": ("man-0", "man-1", "man-2", "man-3", "man-4"),
    "play": ("pl-1", "pl-2"),
    "fion": ("fi-2",),
}
TARGETS = tuple(dt.date(2026, 10, 5) + dt.timedelta(days=k) for k in range(0, 200, 3))

_pid = st.sampled_from(PROJECTS)


def _scope(pv: tuple[str, float]) -> JSON:
    return {"type": "scope_add", "projectId": pv[0], "text": "More", "hours": pv[1]}


def _hours(pv: tuple[str, float]) -> JSON:
    return {"type": "hours_per_day", "projectId": pv[0], "value": pv[1]}


def _target(pv: tuple[str, dt.date]) -> JSON:
    return {"type": "target_move", "projectId": pv[0], "date": pv[1].isoformat()}


def _confidence(pv: tuple[str, int]) -> JSON:
    return {"type": "confidence", "projectId": pv[0], "value": pv[1]}


def _task_add(pv: tuple[str, float]) -> JSON:
    return {"type": "task_add", "projectId": pv[0], "text": "New task", "hours": pv[1]}


def _task_done(pt: tuple[str, str]) -> JSON:
    return {"type": "task_done", "projectId": pt[0], "taskId": pt[1]}


def _note(pid: str) -> JSON:
    return {"type": "note", "projectId": pid, "text": "Progress."}


def _blocker(pid: str) -> JSON:
    return {"type": "blocker", "projectId": pid, "text": "Waiting."}


CHANGE: st.SearchStrategy[JSON] = st.one_of(
    st.tuples(_pid, st.sampled_from([0.25, 0.5, 1.0, 2.0, 3.5, 6.0, 8.0, 16.0, 40.0])).map(_scope),
    st.tuples(_pid, st.sampled_from([0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0])).map(_hours),
    st.tuples(_pid, st.sampled_from(TARGETS)).map(_target),
    st.tuples(_pid, st.integers(1, 5)).map(_confidence),
    st.tuples(_pid, st.sampled_from([0.5, 1.0, 2.0])).map(_task_add),
    _pid.map(_note),
    _pid.map(_blocker),
    st.sampled_from([(p, t) for p, ts in OPEN_TASKS.items() for t in ts]).map(_task_done),
    st.just({"type": "bau_done", "routineId": "r-ret"}),
)


@pytest.fixture(autouse=True)
def _isolated_keys(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    for name in keys.ENV_VARS["anthropic"]:
        monkeypatch.delenv(name, raising=False)
    previous = keys.use_key_store(keys.MemoryKeyStore())
    yield
    keys.use_key_store(previous)


@pytest.fixture(scope="module")
def seeded_template(migrated_template: Path, tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A database file with the design seed loaded (copied for every example)."""
    base = tmp_path_factory.mktemp("seeded-template")
    db_file = base / "remi.db"
    shutil.copyfile(migrated_template, db_file)
    database = open_database(db_file)
    clock = FixedClock(design_seed.DESIGN_TODAY, design_seed.DESIGN_NOW)
    try:
        design_seed.load(UnitOfWorkFactory(database.session_factory, clock), clock, base)
    finally:
        database.close()
    return db_file


@settings(
    max_examples=40,
    deadline=None,
    database=None,
    suppress_health_check=[HealthCheck.too_slow],
)
@given(changes=st.lists(CHANGE, min_size=1, max_size=6))
def test_preview_equals_apply_equals_plan(
    changes: list[JSON], seeded_template: Path, tmp_path_factory: pytest.TempPathFactory
) -> None:
    with api_for(tmp_path_factory.mktemp("example"), seeded_template, seed=False) as api:
        before = {p["id"]: p for p in api.plan()["projects"]}
        response = api.client.post("/api/checkins/preview", json={"changes": changes})
        assert response.status_code == 200, response.text
        shown = {p["projectId"]: p for p in response.json()["projects"]}

        out = api.call("POST", "/checkins/apply", {"changes": changes, "source": "simple"})
        plan = api.plan()
        assert plan == out["plan"]
        after = {p["id"]: p for p in plan["projects"]}

        named = {c["projectId"] for c in changes if "projectId" in c}
        for pid, p in shown.items():
            assert pid in named
            assert after[pid]["forecastDate"] == p["to"], (pid, changes)
            assert after[pid]["targetDate"] == p["targetAfter"], (pid, changes)
            assert p["from"] == before[pid]["forecastDate"]
            assert p["late"] == (p["to"] is not None and p["to"] > p["targetAfter"])
        for pid, project in after.items():
            if pid not in shown:
                assert project["forecastDate"] == before[pid]["forecastDate"], (pid, changes)
                assert project["targetDate"] == before[pid]["targetDate"], (pid, changes)
        for movement in out["movements"]:
            p = shown[movement["projectId"]]
            assert movement["toForecast"] == p["to"]
            assert movement["toTarget"] == p["targetAfter"]
            if movement["fromForecast"] is not None and movement["toForecast"] is not None:
                assert movement["deltaBd"] == p["deltaBd"]
                assert movement["label"] == p["label"]
        assert set(out["entity"]["projectIds"]) == named
