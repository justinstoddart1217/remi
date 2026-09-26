"""Fixtures for the Tell Remi providers: the design seed as engine and context inputs, an
in-memory key store, an audit log, and a mocked Anthropic transport (``httpx2``, which the
``anthropic`` 1.x SDK uses; respx only mocks ``httpx``, so Ollama uses respx)."""

import json
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import Any

import pytest

from remi.services.ai.audit import AuditRecord
from remi.services.ai.context import (
    CheckinContextInput,
    ContextMilestone,
    ContextNote,
    ContextProject,
    ContextRoutine,
    ContextTask,
)
from remi.services.ai.keys import MemoryKeyStore, use_key_store
from remi.services.ai.registry import EngineInputs
from remi.services.engine.aliases import build_index
from remi.services.engine.routines import counts_on
from tests.engine import seed as S

TEST_KEY = "sk-ant-api03-TEST-ONLY-0123456789abcdef"
KEY_ENV_VARS = (
    "REMI_ANTHROPIC_API_KEY",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
)
DOMAIN_NAMES = {"pc": "Private Credit", "fi": "Fixed Income"}


@pytest.fixture(autouse=True)
def key_store(monkeypatch: pytest.MonkeyPatch) -> Iterator[MemoryKeyStore]:
    """No real Keychain and no ambient keys in any AI test."""
    for name in KEY_ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    store = MemoryKeyStore()
    previous = use_key_store(store)
    yield store
    use_key_store(previous)


@pytest.fixture
def engine_inputs() -> EngineInputs:
    ctx = S.ctx()
    projects = S.projects()
    return EngineInputs(ctx, projects, build_index(projects, ctx.routines, S.ALIASES))


def context_input(*, send_notes: bool = False, focus: str | None = None) -> CheckinContextInput:
    ctx = S.ctx()
    projects = [
        ContextProject(
            id=p.id,
            name=p.name,
            short=p.plan.short,
            domain=DOMAIN_NAMES[p.plan.domain],
            forecast=p.plan.forecast,
            target=p.plan.target,
            hours_per_day=p.plan.rate,
            confidence=p.confidence,
            open_tasks=[ContextTask(t.id, t.text, t.hours) for t in p.open_now_tasks()],
            milestones=[ContextMilestone(m.name, m.due) for m in p.milestones],
            aliases=S.ALIASES.get(p.id, ()),
        )
        for p in S.projects()
    ]
    routines = [
        ContextRoutine(
            id=r.id,
            name=r.name,
            rule=f"BD{r.bd} each month",
            runs_today=counts_on(r, ctx.today, ctx),
            aliases=S.ALIASES.get(r.id, ()),
        )
        for r in ctx.routines
    ]
    notes = [
        ContextNote(S.d(day), "09:00", text) for day, texts in S.NOTES.items() for text in texts
    ]
    return CheckinContextInput(
        today=ctx.today,
        today_bdm=3,
        capacity_h=ctx.capacity,
        move=ctx.move,
        focus_project_id=focus,
        projects=projects,
        routines=routines,
        recent_notes=notes,
        send_notes=send_notes,
    )


@pytest.fixture
def ctx_input() -> CheckinContextInput:
    return context_input()


@dataclass
class AuditLog:
    records: list[AuditRecord] = field(default_factory=list[AuditRecord])

    def __call__(self, record: AuditRecord) -> None:
        self.records.append(record)


@pytest.fixture
def audit_log() -> AuditLog:
    return AuditLog()


# ---------------------------------------------------------------- Anthropic mock


def claude_message(
    tool_input: dict[str, Any] | None,
    *,
    stop_reason: str = "tool_use",
    text: str | None = None,
    model: str = "claude-opus-5",
) -> dict[str, Any]:
    content: list[dict[str, Any]] = []
    if text is not None:
        content.append({"type": "text", "text": text})
    if tool_input is not None:
        content.append(
            {"type": "tool_use", "id": "toolu_01", "name": "propose_changes", "input": tool_input}
        )
    return {
        "id": "msg_01",
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": content,
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": {"input_tokens": 1234, "output_tokens": 56},
    }


@dataclass
class ClaudeMock:
    """Records requests and answers each with ``respond(request)``."""

    respond: Callable[[Any], Any]
    requests: list[Any] = field(default_factory=list[Any])

    def handler(self, request: Any) -> Any:
        self.requests.append(request)
        return self.respond(request)

    def body(self, i: int = -1) -> dict[str, Any]:
        return json.loads(self.requests[i].content)

    def client(self) -> Any:
        import anthropic
        import httpx2

        return anthropic.DefaultAsyncHttpxClient(transport=httpx2.MockTransport(self.handler))


def json_response(status: int, payload: dict[str, Any], **headers: str) -> Any:
    import httpx2

    return httpx2.Response(status, json=payload, headers={"x-should-retry": "false", **headers})
