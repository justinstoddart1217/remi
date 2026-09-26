"""The Anthropic provider against a mocked Messages API (no network)."""

import asyncio
import sys
from typing import Any

import pytest

pytest.importorskip("anthropic")

import httpx2

from remi.services.ai.anthropic_provider import (
    DEFAULT_ANTHROPIC_MODEL,
    FALLBACK_BETA,
    AnthropicProvider,
)
from remi.services.ai.base import (
    AIAuth,
    AIBadReply,
    AIError,
    AINotConfigured,
    AIRateLimited,
    AITimeout,
    AIUnavailable,
    ParseRequest,
    RawProposal,
)
from remi.services.ai.context import build_context
from remi.services.ai.prompt import system_prompt
from remi.services.ai.schema import PROPOSAL_SCHEMA
from remi.tests.ai.conftest import (
    TEST_KEY,
    ClaudeMock,
    claude_message,
    context_input,
    json_response,
)

PROPOSAL = {
    "summary": "You finished the FX share classes.",
    "changes": [{"type": "task_done", "project_id": "ret", "task_id": "ret-3"}],
    "unplaced": [],
}


def request(timeout_s: float = 30.0) -> ParseRequest:
    return ParseRequest(
        system=system_prompt(8.0, "tool"),
        context=build_context(context_input()),
        text="Finished the FX share classes.",
        schema=PROPOSAL_SCHEMA,
        timeout_s=timeout_s,
    )


def provider(mock: ClaudeMock, **kwargs: Any) -> AnthropicProvider:
    return AnthropicProvider(TEST_KEY, http_client=mock.client(), max_retries=0, **kwargs)


def run(p: AnthropicProvider, req: ParseRequest | None = None) -> RawProposal:
    return asyncio.run(p.propose(req or request()))


def test_happy_path_sends_a_strict_tool_call() -> None:
    mock = ClaudeMock(lambda _r: json_response(200, claude_message(PROPOSAL)))
    reply = run(provider(mock))

    assert reply.summary == PROPOSAL["summary"]
    assert reply.changes == PROPOSAL["changes"]
    assert reply.model == DEFAULT_ANTHROPIC_MODEL
    assert (reply.input_tokens, reply.output_tokens) == (1234, 56)
    assert '"propose_changes"' in reply.response_raw

    sent = mock.requests[0]
    assert sent.url.host == "api.anthropic.com"
    assert sent.url.path == "/v1/messages"
    assert sent.headers["x-api-key"] == TEST_KEY
    body = mock.body()
    assert body["model"] == "claude-opus-5"
    assert body["max_tokens"] >= 1800
    assert body["tool_choice"] == {"type": "auto", "disable_parallel_tool_use": True}
    assert body["output_config"] == {"effort": "low"}
    assert "thinking" not in body
    (tool,) = body["tools"]
    assert tool["name"] == "propose_changes"
    assert tool["strict"] is True
    assert tool["input_schema"] == PROPOSAL_SCHEMA
    assert '"a day" = 8h' in body["system"]
    assert "propose_changes" in body["system"]
    (message,) = body["messages"]
    assert message["role"] == "user"
    assert message["content"].startswith("CONTEXT\n{")
    assert message["content"].endswith("\n\nUPDATE\nFinished the FX share classes.")


def test_configured_model_and_env_base_url_is_ignored(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "http://evil.example")
    mock = ClaudeMock(
        lambda _r: json_response(200, claude_message(PROPOSAL, model="claude-sonnet-5"))
    )
    reply = run(provider(mock, model="claude-sonnet-5"))
    assert mock.body()["model"] == "claude-sonnet-5"
    assert reply.model == "claude-sonnet-5"
    assert mock.requests[0].url.host == "api.anthropic.com"


def test_models_without_effort_do_not_get_it() -> None:
    mock = ClaudeMock(lambda _r: json_response(200, claude_message(PROPOSAL)))
    run(provider(mock, model="claude-haiku-4-5"))
    assert "output_config" not in mock.body()


def test_server_side_fallback_uses_the_beta() -> None:
    mock = ClaudeMock(lambda _r: json_response(200, claude_message(PROPOSAL)))
    reply = run(provider(mock, server_fallback=True))
    assert reply.changes == PROPOSAL["changes"]
    assert FALLBACK_BETA in mock.requests[0].headers["anthropic-beta"]
    assert mock.body()["fallbacks"] == "default"
    assert mock.body()["tools"][0]["strict"] is True
    assert mock.body()["tool_choice"] == {"type": "auto", "disable_parallel_tool_use": True}


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        (claude_message(None, stop_reason="refusal"), "declined"),
        (claude_message(PROPOSAL, stop_reason="max_tokens"), "cut off"),
        (claude_message(None, stop_reason="end_turn", text="Sure! Here is a plan."), "without"),
    ],
    ids=["refusal", "max_tokens", "no-tool-call"],
)
def test_bad_replies(message: dict[str, Any], expected: str) -> None:
    mock = ClaudeMock(lambda _r: json_response(200, message))
    with pytest.raises(AIBadReply) as info:
        run(provider(mock))
    assert expected in info.value.message
    assert info.value.status == 502
    assert info.value.code == "AI_BAD_REPLY"
    assert info.value.response_raw  # kept for the audit
    assert info.value.input_tokens == 1234


def _error(status: int, kind: str) -> dict[str, Any]:
    return {"type": "error", "error": {"type": kind, "message": f"{kind} ({TEST_KEY[:6]})"}}


@pytest.mark.parametrize(
    ("status", "kind", "error", "code", "http"),
    [
        (401, "authentication_error", AIAuth, "AI_AUTH", 502),
        (403, "permission_error", AIAuth, "AI_AUTH", 502),
        (429, "rate_limit_error", AIRateLimited, "AI_RATE_LIMITED", 503),
        (404, "not_found_error", AIUnavailable, "AI_UNAVAILABLE", 502),
        (400, "invalid_request_error", AIUnavailable, "AI_UNAVAILABLE", 502),
        (500, "api_error", AIUnavailable, "AI_UNAVAILABLE", 502),
        (529, "overloaded_error", AIUnavailable, "AI_UNAVAILABLE", 502),
    ],
)
def test_http_error_mapping(
    status: int, kind: str, error: type[AIError], code: str, http: int
) -> None:
    mock = ClaudeMock(lambda _r: json_response(status, _error(status, kind)))
    with pytest.raises(error) as info:
        run(provider(mock))
    assert info.value.code == code
    assert info.value.status == http
    assert TEST_KEY not in info.value.message
    assert info.value.__cause__ is None  # the SDK exception (and its request) is not chained


def test_timeout_maps_to_ai_timeout() -> None:
    def slow(request: Any) -> Any:
        raise httpx2.ReadTimeout("slow", request=request)

    with pytest.raises(AITimeout) as info:
        run(provider(ClaudeMock(slow)), request(timeout_s=30))
    assert info.value.status == 504
    assert info.value.code == "AI_TIMEOUT"


def test_connection_error_maps_to_unavailable() -> None:
    def down(request: Any) -> Any:
        raise httpx2.ConnectError("no route", request=request)

    with pytest.raises(AIUnavailable) as info:
        run(provider(ClaudeMock(down)))
    assert info.value.code == "AI_UNAVAILABLE"
    assert "reach" in info.value.message


def test_missing_sdk_is_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    mock = ClaudeMock(lambda _r: json_response(200, claude_message(PROPOSAL)))
    p = provider(mock)
    monkeypatch.setitem(sys.modules, "anthropic", None)
    with pytest.raises(AINotConfigured) as info:
        run(p)
    assert info.value.status == 409
    assert mock.requests == []
    asyncio.run(mock_client_close(p))


async def mock_client_close(p: AnthropicProvider) -> None:
    client: Any = p._http_client  # pyright: ignore[reportPrivateUsage]
    await client.aclose()


def test_empty_key_is_not_configured() -> None:
    with pytest.raises(AINotConfigured):
        AnthropicProvider("")


def test_repr_never_shows_the_key() -> None:
    p = AnthropicProvider(TEST_KEY)
    assert TEST_KEY not in repr(p)
    assert TEST_KEY not in str(p)
