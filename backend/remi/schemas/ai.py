"""Tell Remi provider status, the write-only API key, and the parse audit log."""

from typing import Any, Literal

from pydantic import AwareDatetime, Field, SecretStr

from remi.schemas.base import CamelIn, CamelModel
from remi.schemas.settings import AiProvider

AiKeySource = Literal["env", "keychain"]
AiAuditStatus = Literal["ok", "error", "timeout", "cancelled"]


class AiStatusOut(CamelModel):
    """``GET /ai/status``: can the configured provider answer right now? Never includes a key."""

    provider: AiProvider
    model: str | None
    """The model that will be asked (``null`` for ``none``)."""
    key_set: bool
    """An Anthropic key is configured."""
    key_source: AiKeySource | None
    available: bool
    """``true`` when a parse would reach the provider (``none`` is always available)."""
    reason: str | None
    """Why it is unavailable, e.g. "No API key" or "Ollama is not running on 127.0.0.1:11434"."""
    sends_notes: bool
    """Recent notes are included in the context sent to the provider."""
    ollama_base_url: str
    sdk_installed: bool
    """The optional ``anthropic`` package is installed."""
    egress: bool
    """``true`` only for ``anthropic``: the one provider that sends data off the machine."""


class AiKeyPut(CamelIn):
    """``PUT /settings/ai-key``: stores the Anthropic key in the macOS keychain. Write-only."""

    api_key: SecretStr = Field(min_length=8, max_length=400)


class AiAuditOut(CamelModel):
    """One provider call, exactly as sent and received (keys are never recorded)."""

    id: str
    parse_id: str | None
    created_at: AwareDatetime
    provider: AiProvider
    model: str | None
    status: AiAuditStatus
    error_code: str | None
    latency_ms: int | None
    input_tokens: int | None
    output_tokens: int | None
    text: str
    """The user's update text."""
    context: dict[str, Any] | None
    """The server-built context that was sent."""
    response_raw: str | None
    proposal: dict[str, Any] | None
    """The validated proposal returned to the client."""
    dropped: list[dict[str, Any]]
    """Proposal items ``validate()`` removed, with the reason."""


class AiAuditPageOut(CamelModel):
    """``GET /ai/audit``: newest first. Pass ``nextBefore`` as ``before`` for the next page."""

    items: list[AiAuditOut]
    next_before: str | None
