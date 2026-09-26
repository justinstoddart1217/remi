"""``AiStatusOut``: can the configured provider answer right now? Never includes a key.

``GET /ai/status`` and the settings key endpoints (``PUT``/``DELETE /settings/ai-key``) all
answer with ``ai_status``. It makes no call off the machine: Anthropic availability means
"the SDK is installed and a key is set"; Ollama is probed on its loopback address.

The key lookup runs in a worker thread: a Keychain read can wait on a macOS access prompt,
and that must not stall the event loop.
"""

import asyncio

import httpx

from app.schemas.ai import AiKeySource, AiStatusOut
from app.services.ai.anthropic_provider import SDK_MISSING, sdk_installed
from app.services.ai.keys import api_key_source
from app.services.ai.ollama_provider import ollama_status
from app.services.ai.registry import AiSettings, effective_model

NO_KEY = "No API key. Add one in Settings, or set REMI_ANTHROPIC_API_KEY."


def _local_state() -> tuple[AiKeySource | None, bool]:
    """Where the Anthropic key comes from, and whether the SDK is installed (blocking)."""
    return api_key_source("anthropic"), sdk_installed()


async def ai_status(
    settings: AiSettings, *, ollama_transport: httpx.AsyncBaseTransport | None = None
) -> AiStatusOut:
    key_source, installed = await asyncio.to_thread(_local_state)
    reason: str | None = None
    if settings.provider == "anthropic":
        if not installed:
            reason = SDK_MISSING[0].upper() + SDK_MISSING[1:]
        elif key_source is None:
            reason = NO_KEY
    elif settings.provider == "ollama":
        problem = await ollama_status(
            settings.ollama_base_url, settings.model, transport=ollama_transport
        )
        reason = problem[0].upper() + problem[1:] if problem else None
    return AiStatusOut(
        provider=settings.provider,
        model=effective_model(settings),
        key_set=key_source is not None,
        key_source=key_source,
        available=reason is None,
        reason=reason,
        sends_notes=settings.provider != "none" and settings.send_notes,
        ollama_base_url=settings.ollama_base_url,
        sdk_installed=installed,
        egress=settings.provider == "anthropic",
    )
