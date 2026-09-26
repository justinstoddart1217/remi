"""The Ollama provider against a respx-mocked loopback server (no network)."""

import asyncio
import json
from typing import Any

import httpx
import pytest
import respx

from remi.services.ai.base import (
    AIBadReply,
    AINotConfigured,
    AITimeout,
    AIUnavailable,
    ParseRequest,
    RawProposal,
)
from remi.services.ai.context import build_context
from remi.services.ai.ollama_provider import (
    DEFAULT_OLLAMA_MODEL,
    OllamaProvider,
    is_loopback_url,
    normalise_loopback_url,
    ollama_status,
)
from remi.services.ai.prompt import system_prompt
from remi.services.ai.schema import PROPOSAL_SCHEMA
from remi.tests.ai.conftest import context_input

BASE = "http://127.0.0.1:11434"
PROPOSAL = {
    "summary": "You can give ManCo 2h a day now.",
    "changes": [{"type": "hours_per_day", "project_id": "manco", "value": 2}],
    "unplaced": [],
}


def request(timeout_s: float = 90.0) -> ParseRequest:
    return ParseRequest(
        system=system_prompt(8.0, "json"),
        context=build_context(context_input()),
        text="I can give ManCo 2h a day now.",
        schema=PROPOSAL_SCHEMA,
        timeout_s=timeout_s,
    )


def chat_reply(content: str, **extra: Any) -> dict[str, Any]:
    return {
        "model": "llama3.1",
        "message": {"role": "assistant", "content": content},
        "done": True,
        "prompt_eval_count": 900,
        "eval_count": 40,
        **extra,
    }


def run(p: OllamaProvider) -> RawProposal:
    return asyncio.run(p.propose(request()))


@respx.mock(assert_all_called=True)
def test_happy_path(respx_mock: respx.MockRouter) -> None:
    route = respx_mock.post(f"{BASE}/api/chat").respond(200, json=chat_reply(json.dumps(PROPOSAL)))
    reply = run(OllamaProvider(BASE))

    assert reply.changes == PROPOSAL["changes"]
    assert reply.summary == PROPOSAL["summary"]
    assert reply.model == "llama3.1"
    assert (reply.input_tokens, reply.output_tokens) == (900, 40)
    body = json.loads(route.calls.last.request.content)
    assert body["model"] == DEFAULT_OLLAMA_MODEL
    assert body["format"] == PROPOSAL_SCHEMA
    assert body["stream"] is False
    assert body["options"] == {"temperature": 0, "num_ctx": 8192}
    system, user = body["messages"]
    assert system["role"] == "system"
    assert "JSON object" in system["content"]
    assert user["content"].startswith("CONTEXT\n{")


@respx.mock
def test_configured_model_and_trailing_slash(respx_mock: respx.MockRouter) -> None:
    route = respx_mock.post(f"{BASE}/api/chat").respond(200, json=chat_reply(json.dumps(PROPOSAL)))
    run(OllamaProvider(BASE + "/", "qwen2.5:14b"))
    assert json.loads(route.calls.last.request.content)["model"] == "qwen2.5:14b"


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1:11434",
        "http://127.0.0.2:11434",
        "http://localhost:11434",
        "http://[::1]:11434",
        "https://127.0.0.1:8443/ollama",
    ],
)
def test_loopback_urls_are_accepted(url: str) -> None:
    assert is_loopback_url(url)
    OllamaProvider(url)


@pytest.mark.parametrize(
    "url",
    [
        "http://192.168.1.20:11434",
        "http://10.0.0.1:11434",
        "http://0.0.0.0:11434",
        "http://example.com:11434",
        "http://127.0.0.1.nip.io:11434",
        "http://localhost.example.com",
        "http://user:secret@127.0.0.1:11434",
        "http://127.0.0.1:11434/?next=http://example.com",
        "ftp://127.0.0.1:11434",
        "127.0.0.1:11434",
        "http://127.0.0.1:99999",
        "",
    ],
)
def test_non_loopback_urls_are_refused(url: str) -> None:
    assert not is_loopback_url(url)
    with pytest.raises(AINotConfigured) as info:
        OllamaProvider(url)
    assert info.value.status == 409


def test_normalise_strips_the_trailing_slash() -> None:
    assert normalise_loopback_url(" http://127.0.0.1:11434/ ") == BASE


@respx.mock
def test_not_running(respx_mock: respx.MockRouter) -> None:
    respx_mock.post(f"{BASE}/api/chat").mock(side_effect=httpx.ConnectError("refused"))
    with pytest.raises(AIUnavailable) as info:
        run(OllamaProvider(BASE))
    assert info.value.message == "Ollama is not running on 127.0.0.1:11434"
    assert info.value.status == 502


@respx.mock
def test_connect_timeout_is_not_running(respx_mock: respx.MockRouter) -> None:
    respx_mock.post(f"{BASE}/api/chat").mock(side_effect=httpx.ConnectTimeout("slow"))
    with pytest.raises(AIUnavailable):
        run(OllamaProvider(BASE))


@respx.mock
def test_read_timeout(respx_mock: respx.MockRouter) -> None:
    respx_mock.post(f"{BASE}/api/chat").mock(side_effect=httpx.ReadTimeout("slow"))
    with pytest.raises(AITimeout) as info:
        run(OllamaProvider(BASE))
    assert info.value.status == 504


@respx.mock
def test_model_not_pulled(respx_mock: respx.MockRouter) -> None:
    respx_mock.post(f"{BASE}/api/chat").respond(404, json={"error": "model 'x' not found"})
    with pytest.raises(AIUnavailable) as info:
        run(OllamaProvider(BASE, "x"))
    assert "not installed" in info.value.message
    assert info.value.response_raw


@respx.mock
def test_server_error(respx_mock: respx.MockRouter) -> None:
    respx_mock.post(f"{BASE}/api/chat").respond(500, text="boom")
    with pytest.raises(AIUnavailable) as info:
        run(OllamaProvider(BASE))
    assert info.value.message == "Ollama answered 500"


@pytest.mark.parametrize(
    "payload",
    [
        "not json at all",
        json.dumps({"message": {"role": "assistant", "content": "I think you should..."}}),
        json.dumps(chat_reply(json.dumps(["a", "list"]))),
        json.dumps({"message": "no content"}),
        json.dumps([1, 2]),
    ],
    ids=["body-not-json", "content-not-json", "content-a-list", "no-content", "body-a-list"],
)
@respx.mock
def test_bad_replies(respx_mock: respx.MockRouter, payload: str) -> None:
    respx_mock.post(f"{BASE}/api/chat").respond(200, text=payload)
    with pytest.raises(AIBadReply) as info:
        run(OllamaProvider(BASE))
    assert info.value.code == "AI_BAD_REPLY"
    assert info.value.response_raw == payload


@respx.mock
def test_proxy_environment_is_ignored(
    respx_mock: respx.MockRouter, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("HTTP_PROXY", "http://proxy.example:3128")
    monkeypatch.setenv("ALL_PROXY", "http://proxy.example:3128")
    route = respx_mock.post(f"{BASE}/api/chat").respond(200, json=chat_reply(json.dumps(PROPOSAL)))
    run(OllamaProvider(BASE))
    assert route.calls.last.request.url.host == "127.0.0.1"


# ---------------------------------------------------------------- status probe


@respx.mock
def test_status_ok_when_the_model_is_pulled(respx_mock: respx.MockRouter) -> None:
    respx_mock.get(f"{BASE}/api/tags").respond(
        200, json={"models": [{"name": "llama3.1:latest"}, {"name": "qwen2.5:14b"}]}
    )
    assert asyncio.run(ollama_status(BASE, None)) is None
    assert asyncio.run(ollama_status(BASE, "qwen2.5:14b")) is None
    assert asyncio.run(ollama_status(BASE, "mistral")) == (
        "the model mistral is not installed in Ollama"
    )


@respx.mock
def test_status_not_running(respx_mock: respx.MockRouter) -> None:
    respx_mock.get(f"{BASE}/api/tags").mock(side_effect=httpx.ConnectError("refused"))
    assert asyncio.run(ollama_status(BASE, None)) == "Ollama is not running on 127.0.0.1:11434"


def test_status_refuses_a_remote_url_without_calling_it() -> None:
    with respx.mock(assert_all_called=False) as mock:
        reason = asyncio.run(ollama_status("http://192.168.1.20:11434", None))
        assert mock.calls.call_count == 0
    assert reason is not None
    assert "this Mac" in reason
