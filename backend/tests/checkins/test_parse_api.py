"""``/api/checkins/parse``, ``parse-simple`` and cancel, and the test-only fake provider.

The fake stands in for the prototype's stubbed ``window.claude`` (parity state
``drawer-review-claude``). It exists only under ``REMI_ENV=test`` with ``REMI_AI_FAKE``
pointing at a JSON file, and can never be selected in dev or prod.
"""

import json
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from remi.core.clock import FixedClock
from remi.core.config import Env
from remi.core.uow import ref
from remi.repositories import models as orm
from remi.services.ai import registry
from remi.services.ai.fake_provider import (
    ENV_VAR,
    FakeProvider,
    FakeProviderRefused,
    fake_path,
    with_fake,
)
from tests.checkins.test_checkins_api import CLAUDE_FIXTURE
from tests.fixtures import design_seed
from tests.projects.helpers import JSON, Api, build_app

FIXTURE_TEXT = (
    "Finished parsing the security-level extract. They want FX attribution too, about 6h. "
    "Still waiting on the administrator for the last 4 funds, so confidence is down to 2. "
    "I can give ManCo 2h a day now. Push the playbook target to 8 Jan. "
    "Returns are done for today."
)
FIXTURE_REPLY: JSON = {  # parity/golden/claude-fixture.mjs CLAUDE_FIXTURE_REPLY
    "summary": (
        "You finished parsing the extract and added FX attribution to the returns pipeline. "
        "ManCo moves to 2h a day, the playbook target moves to Fri 8 Jan, and "
        "today\N{RIGHT SINGLE QUOTATION MARK}s returns run is done."
    ),
    "changes": [
        {"type": "task_done", "project_id": "ret", "task_id": "ret-2"},
        {"type": "scope_add", "project_id": "ret", "text": "FX attribution", "hours": 6},
        {
            "type": "blocker",
            "project_id": "ret",
            "text": "Administrator files for the last 4 funds",
        },
        {"type": "confidence", "project_id": "ret", "value": 2},
        {"type": "hours_per_day", "project_id": "manco", "value": 2},
        {
            "type": "note",
            "project_id": "manco",
            "text": "Moving to 2h a day to protect the November pack.",
        },
        {"type": "target_move", "project_id": "play", "date": "2027-01-08"},
        {"type": "bau_done", "routine_id": "r-ret"},
    ],
    "unplaced": ["the team lunch on Friday"],
}
FIXTURE_RAW = "Here is the plan.\n" + json.dumps(FIXTURE_REPLY, ensure_ascii=False) + "\n"
ERROR_RAW = "Sorry, I could not work out a plan from that."


def parse(api: Api, text: str = FIXTURE_TEXT, **extra: Any) -> tuple[int, JSON]:
    parse_id = extra.pop("parseId", str(uuid4()))
    before = api.event_count()
    response = api.client.post(
        "/api/checkins/parse", json={"text": text, "parseId": parse_id, **extra}
    )
    assert api.event_count() == before, "parsing never records an event"
    return response.status_code, dict(response.json())


def configure(api: Api, **values: Any) -> None:
    with api.uow_factory("user") as uow:
        row = uow.session.get(orm.Settings, orm.SETTINGS_ID)
        assert row is not None
        for key, value in values.items():
            setattr(row, key, value)
        uow.record("test.settings", [ref("settings", "1")], {"keys": sorted(values)})


def audit_rows(api: Api) -> list[JSON]:
    return list(api.client.get("/api/ai/audit").json()["items"])


@pytest.fixture
def fake_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    path = tmp_path / "fake-ai.json"
    monkeypatch.setenv(ENV_VAR, str(path))
    yield path


def write(path: Path, spec: JSON) -> None:
    path.write_text(json.dumps(spec), encoding="utf-8")


# ---------------------------------------------------------------------------- none (the default)
def test_parse_with_the_none_provider_is_the_simple_reading(api: Api) -> None:
    status, body = parse(api, "Returns BAU is done for today.", focusProjectId="ret")
    assert status == 200
    assert (body["source"], body["provider"], body["model"]) == ("simple", "none", None)
    assert {"type": "bau_done", "routineId": "r-ret"} in body["changes"]
    assert audit_rows(api) == []  # nothing was sent, nothing audited


def test_parse_simple_matches_parse_under_none(api: Api) -> None:
    parse_id = str(uuid4())
    _, via_parse = parse(api, FIXTURE_TEXT, parseId=parse_id)
    response = api.client.post(
        "/api/checkins/parse-simple", json={"text": FIXTURE_TEXT, "parseId": parse_id}
    )
    assert response.status_code == 200
    assert response.json() == via_parse


def test_parse_errors(api: Api, bare: Api) -> None:
    status, body = parse(api, focusProjectId="nope")
    assert (status, body["error"]["field"]) == (404, "focusProjectId")
    response = api.client.post(
        "/api/checkins/parse-simple",
        json={"text": "x", "parseId": str(uuid4()), "focusProjectId": "nope"},
    )
    assert response.status_code == 404
    status, body = parse(bare)
    assert (status, body["error"]["code"]) == (409, "SETUP_REQUIRED")
    response = api.client.post("/api/checkins/parse", json={"text": "x", "parseId": "not-a-uuid"})
    assert response.status_code == 422


def test_cancel_is_idempotent(api: Api) -> None:
    parse_id = str(uuid4())
    for _ in range(2):
        response = api.client.delete(f"/api/checkins/parse/{parse_id}")
        assert response.status_code == 204
        assert response.content == b""
    assert api.client.delete("/api/checkins/parse/not-a-uuid").status_code == 422


# ---------------------------------------------------------------------------- the fake provider
def test_fake_reply_reproduces_drawer_review_claude(api: Api, fake_file: Path) -> None:
    write(fake_file, {"mode": "raw", "raw": FIXTURE_RAW})
    status, body = parse(api)
    assert status == 200, body
    assert (body["source"], body["provider"], body["model"]) == ("ai", "anthropic", "fake")
    assert body["summary"] == FIXTURE_REPLY["summary"]
    assert body["changes"] == CLAUDE_FIXTURE
    assert body["unplaced"] == ["the team lunch on Friday"]
    (row,) = audit_rows(api)
    assert (row["status"], row["provider"], row["model"]) == ("ok", "anthropic", "fake")
    context = row["context"]["context"]
    assert context["today"] == "2026-10-05 (Monday 5 October, BD3)"
    assert (context["capacity_h"], context["move_date"]) == (8, "2027-01-04")
    projects = {p["id"]: p for p in context["projects"]}
    assert list(projects) == ["ret", "manco", "play", "fion", "alpha"]
    assert projects["ret"]["domain"] == "Private Credit"
    assert [t["id"] for t in projects["ret"]["open_tasks"]] == ["ret-2", "ret-3", "ret-4", "ret-5"]
    assert "Fund-level engine reconciles (2026-10-16)" in projects["ret"]["milestones"]
    routines = {r["id"]: r for r in context["routines"]}
    assert (routines["r-ret"]["runs_today"], routines["r-man"]["runs_today"]) == (True, False)
    assert "recent_notes" not in context  # Settings: notes are not sent by default
    assert "goal" not in json.dumps(context)  # goals and charters never leave


def test_fake_reply_then_apply_as_ai(api: Api, fake_file: Path) -> None:
    write(fake_file, {"reply": FIXTURE_REPLY})
    parse_id = str(uuid4())
    status, proposal = parse(api, parseId=parse_id, focusProjectId="ret")
    assert status == 200
    body = {
        "changes": proposal["changes"],
        "source": proposal["source"],
        "parseId": parse_id,
        "rawText": FIXTURE_TEXT,
        "focusProjectId": "ret",
    }
    out = api.call("POST", "/checkins/apply", body)
    assert out["entity"]["projectIds"] == ["ret", "manco", "play"]
    assert api.events()[-1].actor == "ai-proposal-accepted"
    snap = api.client.get("/api/projects/ret/snapshots").json()[-1]
    assert snap["source"] == "ai"


def test_fake_recent_notes_follow_the_setting(api: Api, fake_file: Path) -> None:
    configure(api, ai_send_recent_notes=True)
    write(fake_file, {"reply": FIXTURE_REPLY})
    assert parse(api)[0] == 200
    notes = audit_rows(api)[0]["context"]["context"]["recent_notes"]
    assert notes
    assert all(re.match(r"^\w{3} \d{1,2} \w{3} \d{2}:\d{2}: .+", n) for n in notes)


def test_fake_without_json_is_the_error_phase(api: Api, fake_file: Path) -> None:
    write(fake_file, {"mode": "raw", "raw": ERROR_RAW})
    status, body = parse(api)
    assert status == 502
    assert body["error"]["code"] == "AI_BAD_REPLY"
    assert body["error"]["message"] == "Remi replied without a plan."
    assert audit_rows(api)[0]["status"] == "error"


def test_fake_none_falls_back_to_the_simple_reading(api: Api, fake_file: Path) -> None:
    write(fake_file, {"mode": "none"})
    status, body = parse(api)
    assert (status, body["source"]) == (200, "simple")


def test_a_missing_fake_file_leaves_the_configured_provider(api: Api, fake_file: Path) -> None:
    # REMI_AI_FAKE is set but the harness has not written the file yet: the configured
    # provider (none) answers, and nothing is audited as the fake.
    assert not fake_file.exists()
    status, body = parse(api, "Returns BAU is done for today.", focusProjectId="ret")
    assert status == 200
    assert (body["source"], body["provider"], body["model"]) == ("simple", "none", None)
    assert audit_rows(api) == []
    write(fake_file, {"reply": FIXTURE_REPLY})  # once written, the fake answers
    status, body = parse(api)
    assert (status, body["source"], body["model"]) == (200, "ai", "fake")


def test_fake_pending_times_out(api: Api, fake_file: Path) -> None:
    configure(api, ai_timeout_s=1.0)
    write(fake_file, {"mode": "pending"})
    status, body = parse(api)
    assert (status, body["error"]["code"]) == (504, "AI_TIMEOUT")
    assert audit_rows(api)[0]["status"] == "timeout"


def test_a_cancel_before_the_parse_refuses_it(api: Api, fake_file: Path) -> None:
    write(fake_file, {"mode": "pending"})
    parse_id = str(uuid4())
    assert api.client.delete(f"/api/checkins/parse/{parse_id}").status_code == 204
    status, body = parse(api, parseId=parse_id)
    assert (status, body["error"]["code"]) == (409, "PARSE_CANCELLED")


def test_fake_error_mode(api: Api, fake_file: Path) -> None:
    write(fake_file, {"mode": "error", "code": "AI_RATE_LIMITED", "message": "busy"})
    status, body = parse(api)
    assert (status, body["error"]["code"]) == (503, "AI_RATE_LIMITED")


# ---------------------------------------------------------------------------- never outside tests
@pytest.mark.parametrize("env", ["prod", "dev"])
def test_the_fake_cannot_be_enabled_outside_test(env: Env, tmp_path: Path) -> None:
    environ = {ENV_VAR: str(tmp_path / "fake.json")}
    assert registry.provider_factory_for(env) is registry.select_provider
    assert with_fake(env, registry.select_provider, environ) is registry.select_provider
    assert fake_path(env, environ) is None
    with pytest.raises(FakeProviderRefused):
        FakeProvider(tmp_path / "fake.json", env)
    assert fake_path("test", environ) == tmp_path / "fake.json"
    assert fake_path("test", {}) is None


def test_a_prod_app_ignores_remi_ai_fake(
    migrated_template: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = tmp_path / "fake.json"
    write(fake, {"reply": FIXTURE_REPLY})
    monkeypatch.setenv(ENV_VAR, str(fake))
    data_dir = tmp_path / "prod"
    app = build_app(data_dir, migrated_template, env="prod")
    clock = FixedClock(design_seed.DESIGN_TODAY, design_seed.DESIGN_NOW)
    design_seed.load(app.state.uow_factory, clock, data_dir)
    try:
        with TestClient(
            app, base_url=design_seed.BASE_URL, headers=design_seed.CLIENT_HEADERS
        ) as client:
            response = client.post(
                "/api/checkins/parse", json={"text": FIXTURE_TEXT, "parseId": str(uuid4())}
            )
            assert response.status_code == 200
            assert (response.json()["source"], response.json()["provider"]) == ("simple", "none")
    finally:
        app.state.db.close()
