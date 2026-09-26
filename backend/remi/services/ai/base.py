"""The provider contract: what a parse provider receives, what it returns, how it fails.

A provider turns one check-in update into a *raw* proposal. It never touches the database
and never applies anything: the registry validates every reply with the engine's
``validate()`` and the user reviews the result before ``/checkins/apply``.

Errors are ``DomainError`` subclasses, so the API layer maps them to the error envelope:

| Error | Status | Code |
|---|---|---|
| ``AIDisabled`` | 409 | ``AI_DISABLED`` (internal: the registry answers with the simple reading) |
| ``AINotConfigured`` | 409 | ``AI_NOT_CONFIGURED`` (no key, SDK missing, bad Ollama URL) |
| ``ParseCancelled`` | 409 | ``PARSE_CANCELLED`` |
| ``AIAuth`` | 502 | ``AI_AUTH`` |
| ``AIBadReply`` | 502 | ``AI_BAD_REPLY`` |
| ``AIUnavailable`` | 502 | ``AI_UNAVAILABLE`` |
| ``AIRateLimited`` | 503 | ``AI_RATE_LIMITED`` |
| ``AITimeout`` | 504 | ``AI_TIMEOUT`` |

Messages are short and safe to show inside the drawer's error panel ("The assistant didn't
answer cleanly ({message})"). They never contain an API key.
"""

import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import ClassVar, Final, Literal, Protocol

from remi.core.errors import DomainError
from remi.schemas.settings import AiProvider
from remi.services.engine.validate import RawProposal as EngineRawProposal

TOOL_NAME: Final = "propose_changes"
"""The one tool the Anthropic provider offers; its input is the proposal."""

DEFAULT_MAX_TOKENS: Final = 8000
"""A ceiling, not a target. The prototype used 1800, but current models think before they call
the tool (adaptive thinking), so a low ceiling would cut replies off (``max_tokens``). Only
tokens actually generated are billed."""

AuditStatus = Literal["ok", "error", "timeout", "cancelled"]


# ---------------------------------------------------------------- request and reply


@dataclass(frozen=True, slots=True)
class ParseRequest:
    """Everything a provider sends. ``context`` is built by ``context.build_context``."""

    system: str
    context: Mapping[str, object]
    text: str
    schema: Mapping[str, object]
    timeout_s: float
    max_tokens: int = DEFAULT_MAX_TOKENS

    def user_message(self) -> str:
        """The prototype's user turn: ``CONTEXT\\n{json}\\n\\nUPDATE\\n{text}``."""
        context_json = json.dumps(self.context, ensure_ascii=False, separators=(",", ":"))
        return f"CONTEXT\n{context_json}\n\nUPDATE\n{self.text}"


@dataclass(frozen=True, slots=True)
class RawProposal:
    """A provider's reply before validation: loose JSON plus what the audit log keeps."""

    summary: object = ""
    changes: object = field(default_factory=list[object])
    unplaced: object = field(default_factory=list[object])
    response_raw: str = ""
    """The raw reply exactly as received (for ``ai_audit.response_raw``)."""
    model: str | None = None
    """The model that answered, when the provider reports it."""
    input_tokens: int | None = None
    output_tokens: int | None = None

    @classmethod
    def from_json(
        cls,
        data: Mapping[str, object],
        *,
        response_raw: str,
        model: str | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
    ) -> "RawProposal":
        return cls(
            summary=data.get("summary", ""),
            changes=data.get("changes", []),
            unplaced=data.get("unplaced", []),
            response_raw=response_raw,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )

    def for_validation(self) -> EngineRawProposal:
        """The engine's input type for ``validate()``."""
        return EngineRawProposal(summary=self.summary, changes=self.changes, unplaced=self.unplaced)


class ParseProvider(Protocol):
    """A check-in parser. ``propose`` may be cancelled at any await point."""

    @property
    def name(self) -> AiProvider: ...

    @property
    def model(self) -> str | None: ...

    @property
    def default_timeout_s(self) -> float: ...

    async def propose(self, req: ParseRequest) -> RawProposal: ...


# ---------------------------------------------------------------- errors


class AIError(DomainError):
    """Base for every provider failure. Carries what the audit row needs."""

    default_code: ClassVar[str] = "AI_ERROR"
    default_status: ClassVar[int] = 502
    default_message: ClassVar[str] = "the assistant failed"
    audit_status: ClassVar[AuditStatus] = "error"

    response_raw: str | None
    input_tokens: int | None
    output_tokens: int | None

    def __init__(
        self,
        message: str | None = None,
        *,
        response_raw: str | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
    ) -> None:
        super().__init__(
            self.default_code,
            message if message is not None else self.default_message,
            None,
            self.default_status,
        )
        self.response_raw = response_raw
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens


class AIDisabled(AIError):
    """The ``none`` provider: no AI is configured. The registry answers with the simple
    reading instead, so this never reaches the client from ``/checkins/parse``."""

    default_code = "AI_DISABLED"
    default_status = 409
    default_message = "AI is off; Remi uses a simple reading"


class AINotConfigured(AIError):
    default_code = "AI_NOT_CONFIGURED"
    default_status = 409
    default_message = "the assistant is not set up"


class ParseCancelled(AIError):
    default_code = "PARSE_CANCELLED"
    default_status = 409
    default_message = "the update was cancelled"
    audit_status = "cancelled"


class AIAuth(AIError):
    default_code = "AI_AUTH"
    default_status = 502
    default_message = "the API key was not accepted"


class AIBadReply(AIError):
    default_code = "AI_BAD_REPLY"
    default_status = 502
    default_message = "Remi replied without a plan."


class AIUnavailable(AIError):
    default_code = "AI_UNAVAILABLE"
    default_status = 502
    default_message = "the assistant could not be reached"


class AIRateLimited(AIUnavailable):
    default_code = "AI_RATE_LIMITED"
    default_status = 503
    default_message = "the assistant is busy; try again in a minute"


class AITimeout(AIError):
    default_code = "AI_TIMEOUT"
    default_status = 504
    default_message = "the assistant took too long"
    audit_status = "timeout"
