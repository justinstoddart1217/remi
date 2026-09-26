"""``GET /api/ai/status`` and ``GET /api/ai/audit``."""

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
import respx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from remi.core.clock import FixedClock
from remi.core.uow import UnitOfWorkFactory
from remi.repositories.models.settings import SETTINGS_ID, Settings
from remi.services.ai import status as status_module
from remi.services.ai.audit import AuditRecord, uow_audit_sink
from remi.services.ai.base import AuditStatus
from remi.services.ai.keys import set_api_key
from remi.tests.ai.conftest import TEST_KEY

OLLAMA = "http://127.0.0.1:11434"


def configure(app: FastAPI, **values: Any) -> None:
    factory: UnitOfWorkFactory = app.state.uow_factory
    with factory("user") as uow:
        row = uow.session.get(Settings, SETTINGS_ID)
        assert row is not None
        for key, value in values.items():
            setattr(row, key, value)
        uow.record("settings.updated", [], {"test": True})


def record(parse_id: str, *, status: AuditStatus = "ok", text: str = "hello") -> AuditRecord:
    return AuditRecord(
        parse_id=parse_id,
        provider="anthropic",
        model="claude-opus-5",
        sent={"system": "SYS", "context": {"today": "2026-10-05"}},
        text=text,
        status=status,
        latency_ms=321,
        response_raw='{"id": "msg_01"}',
        proposal={"summary": "", "changes": []},
        dropped=[{"index": 0, "reason": "unknown project", "item": {"type": "note"}}],
        error_code=None if status == "ok" else "AI_TIMEOUT",
        input_tokens=100,
        output_tokens=20,
    )


# ---------------------------------------------------------------- status


def test_status_defaults_to_none(client: TestClient) -> None:
    body = client.get("/api/ai/status").json()
    assert body == {
        "provider": "none",
        "model": None,
        "keySet": False,
        "keySource": None,
        "available": True,
        "reason": None,
        "sendsNotes": False,
        "ollamaBaseUrl": OLLAMA,
        "sdkInstalled": body["sdkInstalled"],
        "egress": False,
    }


def test_status_none_never_sends_notes(client: TestClient, app: FastAPI) -> None:
    configure(app, ai_send_recent_notes=True)
    assert client.get("/api/ai/status").json()["sendsNotes"] is False


def test_status_anthropic_without_a_key(client: TestClient, app: FastAPI) -> None:
    pytest.importorskip("anthropic")
    configure(app, ai_provider="anthropic", ai_send_recent_notes=True)
    body = client.get("/api/ai/status").json()
    assert body["provider"] == "anthropic"
    assert body["model"] == "claude-opus-5"
    assert body["available"] is False
    assert body["reason"].startswith("No API key")
    assert body["egress"] is True
    assert body["sendsNotes"] is True


def test_status_anthropic_with_a_key_never_returns_it(client: TestClient, app: FastAPI) -> None:
    pytest.importorskip("anthropic")
    configure(app, ai_provider="anthropic", ai_model="claude-sonnet-5")
    set_api_key("anthropic", TEST_KEY)
    response = client.get("/api/ai/status")
    body = response.json()
    assert body["available"] is True
    assert body["keySet"] is True
    assert body["keySource"] == "keychain"
    assert body["model"] == "claude-sonnet-5"
    assert TEST_KEY not in response.text


def test_status_env_key(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REMI_ANTHROPIC_API_KEY", TEST_KEY)
    response = client.get("/api/ai/status")
    assert response.json()["keySource"] == "env"
    assert TEST_KEY not in response.text


def test_status_anthropic_without_the_sdk(
    client: TestClient, app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    configure(app, ai_provider="anthropic")
    monkeypatch.setattr(status_module, "sdk_installed", lambda: False)
    body = client.get("/api/ai/status").json()
    assert body["available"] is False
    assert body["sdkInstalled"] is False
    assert "anthropic package is not installed" in body["reason"]


@respx.mock
def test_status_ollama_probes_loopback(
    respx_mock: respx.MockRouter, client: TestClient, app: FastAPI
) -> None:
    configure(app, ai_provider="ollama")
    respx_mock.get(f"{OLLAMA}/api/tags").respond(200, json={"models": [{"name": "llama3.1:8b"}]})
    body = client.get("/api/ai/status").json()
    assert body["available"] is False
    assert body["reason"] == "The model llama3.1 is not installed in Ollama"
    assert body["egress"] is False

    configure(app, ai_model="llama3.1:8b")
    assert client.get("/api/ai/status").json()["available"] is True

    respx_mock.get(f"{OLLAMA}/api/tags").mock(side_effect=httpx.ConnectError("refused"))
    body = client.get("/api/ai/status").json()
    assert body["available"] is False
    assert body["reason"] == "Ollama is not running on 127.0.0.1:11434"


def test_status_reads_the_key_off_the_event_loop(
    client: TestClient, app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A Keychain read can wait on a macOS access prompt: it must not run on the loop."""
    configure(app, ai_provider="anthropic")
    set_api_key("anthropic", TEST_KEY)
    real = status_module.api_key_source
    in_loop: list[bool] = []

    def spy(provider: Any) -> Any:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            in_loop.append(False)
        else:
            in_loop.append(True)
        return real(provider)

    monkeypatch.setattr(status_module, "api_key_source", spy)
    assert client.get("/api/ai/status").json()["keySet"] is True
    assert in_loop == [False]


def test_status_ollama_remote_url_is_unavailable(client: TestClient, app: FastAPI) -> None:
    configure(app, ai_provider="ollama", ollama_base_url="http://192.168.1.9:11434")
    body = client.get("/api/ai/status").json()
    assert body["available"] is False
    assert "this Mac" in body["reason"]


# ---------------------------------------------------------------- audit


def test_audit_is_empty_on_a_fresh_install(client: TestClient) -> None:
    assert client.get("/api/ai/audit").json() == {"items": [], "nextBefore": None}


def test_audit_lists_newest_first_with_a_cursor(
    client: TestClient, app: FastAPI, clock: FixedClock
) -> None:
    for i in range(3):
        stepped = FixedClock(clock.today(), clock.now() + timedelta(minutes=i))
        sink = uow_audit_sink(UnitOfWorkFactory(app.state.uow_factory.session_factory, stepped))
        sink(record(f"parse-{i}", status="ok" if i != 1 else "timeout"))

    first = client.get("/api/ai/audit", params={"limit": 2}).json()
    assert [item["parseId"] for item in first["items"]] == ["parse-2", "parse-1"]
    assert first["nextBefore"] == first["items"][-1]["id"]
    item = first["items"][1]
    assert item["status"] == "timeout"
    assert item["errorCode"] == "AI_TIMEOUT"
    assert item["context"] == {"system": "SYS", "context": {"today": "2026-10-05"}}
    assert item["dropped"] == [{"index": 0, "reason": "unknown project", "item": {"type": "note"}}]
    assert item["latencyMs"] == 321
    assert (item["inputTokens"], item["outputTokens"]) == (100, 20)
    assert item["createdAt"].startswith("2026-10-05T08:01:00")

    second = client.get("/api/ai/audit", params={"limit": 2, "before": first["nextBefore"]}).json()
    assert [item["parseId"] for item in second["items"]] == ["parse-0"]
    assert second["nextBefore"] is None


def test_audit_unknown_cursor_is_422(client: TestClient) -> None:
    response = client.get("/api/ai/audit", params={"before": "nope"})
    assert response.status_code == 422
    assert response.json()["error"]["field"] == "before"


def test_audit_rows_past_retention_are_pruned(app: FastAPI, client: TestClient) -> None:
    factory: UnitOfWorkFactory = app.state.uow_factory
    old = FixedClock(datetime(2026, 5, 1, tzinfo=UTC).date(), datetime(2026, 5, 1, 9, tzinfo=UTC))
    uow_audit_sink(UnitOfWorkFactory(factory.session_factory, old))(record("old"))
    uow_audit_sink(factory)(record("new"))
    items = client.get("/api/ai/audit").json()["items"]
    assert [item["parseId"] for item in items] == ["new"]
