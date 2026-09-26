"""Choose the provider, run the parse, validate it, audit it.

``parse`` is what ``POST /checkins/parse`` calls:

1. ``none`` (the default) answers at once with the engine's simple reading
   (``source: "simple"``). Nothing is sent and nothing is audited.
2. Otherwise the provider runs as an ``asyncio`` task in a ``ParseRegistry`` under the
   ``parse_id``. ``cancel(parse_id)`` (``DELETE /checkins/parse/{parseId}``) or a client
   disconnect (``is_disconnected``, polled every 250 ms) cancels it (409
   ``PARSE_CANCELLED``); the deadline (Settings ``ai_timeout_s``, else 30 s for Anthropic
   and 90 s for Ollama) turns into 504 ``AI_TIMEOUT``.
3. The reply goes through the engine's ``validate()``: unknown ids, closed tasks, bad
   numbers, dates outside the calendar and duplicates are dropped. What survives is a
   *proposal*; this module never writes plan state.
4. Every provider call writes one ``ai_audit`` row (ok, error, timeout or cancelled).

``parse_simple`` serves ``POST /checkins/parse-simple`` and the drawer's "Use a simple
reading" button.
"""

import asyncio
import json
import logging
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable, Coroutine, Mapping, Sequence
from dataclasses import dataclass, fields, replace
from typing import Any, Final
from uuid import UUID

from pydantic import TypeAdapter, ValidationError

from app.core.config import Env
from app.repositories.models.settings import DEFAULT_OLLAMA_BASE_URL, Settings
from app.schemas.checkin import Change, ProposalOut, ProposalSource
from app.schemas.settings import AiProvider
from app.services.ai.anthropic_provider import DEFAULT_ANTHROPIC_MODEL, AnthropicProvider
from app.services.ai.audit import AuditRecord, AuditSink, safe_write
from app.services.ai.base import (
    AIDisabled,
    AIError,
    AINotConfigured,
    AITimeout,
    ParseCancelled,
    ParseProvider,
    ParseRequest,
    RawProposal,
)
from app.services.ai.context import CheckinContextInput, build_context
from app.services.ai.keys import load_api_key
from app.services.ai.none_provider import NoneProvider
from app.services.ai.ollama_provider import DEFAULT_OLLAMA_MODEL, OllamaProvider
from app.services.ai.prompt import system_prompt
from app.services.ai.schema import PROPOSAL_SCHEMA
from app.services.engine.aliases import AliasIndex
from app.services.engine.model import EngineCtx, Project, Task
from app.services.engine.simple_reading import parse_simple as engine_parse_simple
from app.services.engine.validate import (
    ValidatedProposal,
    ValidationState,
    validate,
    validation_state,
)
from app.utils.text import clip

logger = logging.getLogger(__name__)

POLL_S: Final = 0.25
"""How often a running parse checks for a client disconnect."""
PRE_CANCEL_TTL_S: Final = 10.0
"""A cancel that arrives before its parse starts is remembered this long."""
SUMMARY_MAX: Final = 600
UNPLACED_TEXT_MAX: Final = 200

_CHANGE: Final = TypeAdapter[Change](Change)


# ---------------------------------------------------------------- settings and providers


@dataclass(frozen=True, slots=True)
class AiSettings:
    """The Tell Remi part of the ``settings`` row."""

    provider: AiProvider = "none"
    model: str | None = None
    send_notes: bool = False
    ollama_base_url: str = DEFAULT_OLLAMA_BASE_URL
    timeout_s: float | None = None
    """``None`` = the provider default (30 s Anthropic, 90 s Ollama)."""
    server_fallback: bool = False
    audit_retention_days: int = 90

    @classmethod
    def from_row(cls, row: Settings) -> "AiSettings":
        return cls(
            provider=row.ai_provider,
            model=row.ai_model or None,
            send_notes=row.ai_send_recent_notes,
            ollama_base_url=row.ollama_base_url,
            timeout_s=row.ai_timeout_s,
            server_fallback=row.ai_server_fallback,
            audit_retention_days=row.ai_audit_retention_days,
        )


def effective_model(settings: AiSettings) -> str | None:
    """The model that will be asked (``None`` for ``none``)."""
    if settings.provider == "anthropic":
        return settings.model or DEFAULT_ANTHROPIC_MODEL
    if settings.provider == "ollama":
        return settings.model or DEFAULT_OLLAMA_MODEL
    return None


def select_provider(settings: AiSettings) -> ParseProvider:
    """The configured provider. Raises ``AINotConfigured`` (no key, bad Ollama URL)."""
    if settings.provider == "anthropic":
        key = load_api_key("anthropic")
        if not key:
            msg = "no Anthropic API key is set"
            raise AINotConfigured(msg)
        return AnthropicProvider(key, settings.model, server_fallback=settings.server_fallback)
    if settings.provider == "ollama":
        return OllamaProvider(settings.ollama_base_url, settings.model)
    return NoneProvider()


ProviderFactory = Callable[[AiSettings], ParseProvider]
DisconnectCheck = Callable[[], Awaitable[bool]]


def provider_factory_for(env: Env) -> ProviderFactory:
    """The provider factory for a process running in ``env``.

    Outside ``test`` this is always ``select_provider``. Under ``REMI_ENV=test`` only, a
    ``REMI_AI_FAKE`` JSON file swaps in the test double (``fake_provider``), so parity and
    behaviour runs can reproduce an AI reply without a network or a key.
    """
    if env != "test":
        return select_provider
    from app.services.ai.fake_provider import with_fake  # test-only module

    return with_fake(env, select_provider)


# ---------------------------------------------------------------- engine inputs


@dataclass(frozen=True, slots=True)
class EngineInputs:
    """What ``validate()`` and the simple reading need (server-only, never sent)."""

    ctx: EngineCtx
    projects: Sequence[Project]
    alias_index: AliasIndex

    def open_tasks(self) -> dict[str, Sequence[Task]]:
        return {p.id: p.open_now_tasks() for p in self.projects}

    def validation_state(self) -> ValidationState:
        return validation_state(self.projects, self.ctx)

    def known_project(self, project_id: str | None) -> str | None:
        if project_id is None:
            return None
        return project_id if any(p.id == project_id for p in self.projects) else None


# ---------------------------------------------------------------- cancellation registry


async def _cancel_and_wait(task: "asyncio.Task[Any]") -> None:
    task.cancel()
    await asyncio.wait({task})


class ParseRegistry:
    """In-flight provider calls by ``parse_id`` (one process, one event loop per call)."""

    def __init__(self) -> None:
        self._tasks: dict[UUID, asyncio.Task[RawProposal]] = {}
        self._pre_cancelled: OrderedDict[UUID, float] = OrderedDict()

    def active(self) -> frozenset[UUID]:
        return frozenset(pid for pid, task in self._tasks.items() if not task.done())

    def cancel(self, parse_id: UUID) -> bool:
        """Cancel a running parse. ``False`` if none was running (the cancel is then
        remembered briefly, so a parse that starts right after it is refused)."""
        task = self._tasks.get(parse_id)
        if task is not None and not task.done():
            task.cancel()
            return True
        self._pre_cancelled[parse_id] = time.monotonic()
        self._pre_cancelled.move_to_end(parse_id)
        while len(self._pre_cancelled) > 256:
            self._pre_cancelled.popitem(last=False)
        return False

    def take_pre_cancel(self, parse_id: UUID) -> bool:
        """Consume a cancel that arrived before the parse started (``True`` if there was one)."""
        at = self._pre_cancelled.pop(parse_id, None)
        return at is not None and time.monotonic() - at <= PRE_CANCEL_TTL_S

    async def run(
        self,
        parse_id: UUID,
        call: Coroutine[Any, Any, RawProposal],
        *,
        timeout_s: float,
        is_disconnected: DisconnectCheck | None = None,
    ) -> RawProposal:
        """Run ``call`` as a task under ``parse_id``; raise ``ParseCancelled``/``AITimeout``."""
        if self.take_pre_cancel(parse_id):
            call.close()
            raise ParseCancelled
        previous = self._tasks.get(parse_id)
        if previous is not None and not previous.done():
            previous.cancel()  # a re-send under the same id replaces the old call
        task = asyncio.create_task(call)
        self._tasks[parse_id] = task
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout_s
        try:
            while not task.done():
                remaining = deadline - loop.time()
                if remaining <= 0:
                    await _cancel_and_wait(task)
                    raise AITimeout(f"no answer within {timeout_s:g}s")
                await asyncio.wait({task}, timeout=min(POLL_S, remaining))
                if task.done() or is_disconnected is None:
                    continue
                if await is_disconnected():
                    await _cancel_and_wait(task)
                    raise ParseCancelled("the drawer was closed")
            if task.cancelled():
                raise ParseCancelled
            return task.result()
        except BaseException as exc:
            # Never leave the provider call running with nobody watching it: the request
            # itself was cancelled (shutdown, disconnect), or waiting failed (for example a
            # raising ``is_disconnected``).
            if not task.done():
                task.cancel()
                if isinstance(exc, Exception):
                    await asyncio.wait({task})  # let it unwind before the error is reported
            raise
        finally:
            if self._tasks.get(parse_id) is task:
                del self._tasks[parse_id]


PARSE_REGISTRY: Final = ParseRegistry()
"""The process-wide registry used by the check-in endpoints."""


# ---------------------------------------------------------------- proposals


def _jsonable(value: object) -> Any:
    return json.loads(json.dumps(value, default=str, ensure_ascii=False))


def to_proposal(
    validated: ValidatedProposal,
    *,
    source: ProposalSource,
    parse_id: UUID,
    provider: AiProvider,
    model: str | None,
) -> tuple[ProposalOut, list[dict[str, Any]]]:
    """The API model plus the dropped items (for the audit only)."""
    changes: list[Change] = []
    dropped: list[dict[str, Any]] = [
        {"index": d.index, "reason": d.reason, "item": _jsonable(d.item)} for d in validated.dropped
    ]
    for change in validated.changes:
        data = {f.name: getattr(change, f.name) for f in fields(change)}
        try:
            changes.append(_CHANGE.validate_python(data))
        except ValidationError:
            dropped.append(
                {"index": None, "reason": "outside the API limits", "item": _jsonable(data)}
            )
    out = ProposalOut(
        summary=clip(validated.summary, SUMMARY_MAX),
        changes=changes,
        unplaced=[clip(u, UNPLACED_TEXT_MAX) for u in validated.unplaced][:4],
        source=source,
        parse_id=parse_id,
        provider=provider,
        model=model,
    )
    return out, dropped


def parse_simple(
    text: str, focus_id: str | None, engine: EngineInputs, parse_id: UUID
) -> ProposalOut:
    """The deterministic simple reading, validated (``source: "simple"``)."""
    focus = engine.known_project(focus_id)
    raw = engine_parse_simple(text, focus, engine.ctx, engine.alias_index, engine.open_tasks())
    validated = validate(raw, engine.validation_state())
    out, _ = to_proposal(validated, source="simple", parse_id=parse_id, provider="none", model=None)
    return out


def _elapsed_ms(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)


async def _write_audit(sink: AuditSink, record: AuditRecord) -> None:
    """Store ``record`` off the event loop (the default sink is a synchronous SQLite write
    that may wait on the write lock). Shielded, so a request cancelled again while the
    write runs still gets its row."""
    await asyncio.shield(asyncio.to_thread(safe_write, sink, record))


async def parse(
    text: str,
    focus_id: str | None,
    ctx_input: CheckinContextInput,
    settings: AiSettings,
    audit: AuditSink,
    *,
    engine: EngineInputs,
    parse_id: UUID,
    registry: ParseRegistry = PARSE_REGISTRY,
    provider_factory: ProviderFactory = select_provider,
    is_disconnected: DisconnectCheck | None = None,
) -> ProposalOut:
    """Turn ``text`` into a validated proposal with the configured provider (see module doc).

    Whether recent notes are sent is decided by ``settings.send_notes`` (the Settings toggle
    that ``GET /ai/status`` reports as ``sendsNotes``), never by ``ctx_input.send_notes``.
    """
    # Off the event loop: selecting Anthropic reads the key, which may wait on a Keychain
    # access prompt.
    provider = await asyncio.to_thread(provider_factory, settings)
    if provider.name == "none":
        return parse_simple(text, focus_id, engine, parse_id)

    if registry.take_pre_cancel(parse_id):
        raise ParseCancelled  # cancelled before anything was sent: nothing to audit
    focus = engine.known_project(focus_id)
    context: Mapping[str, object] = build_context(
        replace(ctx_input, focus_project_id=focus, send_notes=settings.send_notes)
    )
    system = system_prompt(ctx_input.capacity_h, "tool" if provider.name == "anthropic" else "json")
    timeout_s = settings.timeout_s or provider.default_timeout_s
    req = ParseRequest(
        system=system, context=context, text=text, schema=PROPOSAL_SCHEMA, timeout_s=timeout_s
    )
    template = AuditRecord(
        parse_id=str(parse_id),
        provider=provider.name,
        model=provider.model,
        sent={"system": system, "context": context},
        text=text,
        status="error",
        latency_ms=0,
    )
    started = time.perf_counter()
    try:
        reply = await registry.run(
            parse_id, provider.propose(req), timeout_s=timeout_s, is_disconnected=is_disconnected
        )
    except AIDisabled:
        return parse_simple(text, focus_id, engine, parse_id)
    except AIError as exc:
        record = replace(
            template,
            status=exc.audit_status,
            latency_ms=_elapsed_ms(started),
            response_raw=exc.response_raw,
            error_code=exc.code,
            input_tokens=exc.input_tokens,
            output_tokens=exc.output_tokens,
        )
        await _write_audit(audit, record)
        raise
    except asyncio.CancelledError:
        record = replace(
            template,
            status="cancelled",
            latency_ms=_elapsed_ms(started),
            error_code=ParseCancelled.default_code,
        )
        await _write_audit(audit, record)
        raise
    except Exception:
        record = replace(template, latency_ms=_elapsed_ms(started), error_code="INTERNAL_ERROR")
        await _write_audit(audit, record)
        raise

    latency = _elapsed_ms(started)
    validated = validate(reply.for_validation(), engine.validation_state())
    model = reply.model or provider.model
    out, dropped = to_proposal(
        validated, source="ai", parse_id=parse_id, provider=provider.name, model=model
    )
    record = replace(
        template,
        model=model,
        status="ok",
        latency_ms=latency,
        response_raw=reply.response_raw,
        proposal=out.model_dump(mode="json"),
        dropped=dropped,
        input_tokens=reply.input_tokens,
        output_tokens=reply.output_tokens,
    )
    await _write_audit(audit, record)
    return out
