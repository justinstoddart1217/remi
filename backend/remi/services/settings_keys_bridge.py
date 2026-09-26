"""The settings side of the AI key and the provider status.

Keys live outside the database (the macOS Keychain, or the environment) and are owned by
``remi.services.ai.keys``; the settings endpoints call exactly its ``set_api_key(provider,
value)``, ``clear_api_key(provider)`` and ``api_key_configured(provider)``. The provider status
(``AiStatusOut``) comes from ``remi.services.ai.status.ai_status``, which is async (it may probe
Ollama on loopback); ``ai_status`` here runs it from a sync service. Neither ever returns a key.
"""

import asyncio
import functools

import anyio
import anyio.from_thread
from pydantic import SecretStr

from remi.repositories.models import Settings
from remi.schemas.ai import AiStatusOut
from remi.services.ai import keys

KEY_PROVIDER = "anthropic"
"""The only provider that takes an API key."""


def set_api_key(value: str | SecretStr) -> None:
    """Save the Anthropic key (``ValidationFailed``/``KeychainUnavailable`` from the store)."""
    keys.set_api_key(KEY_PROVIDER, value)


def clear_api_key() -> None:
    keys.clear_api_key(KEY_PROVIDER)


def api_key_configured() -> bool:
    return keys.api_key_configured(KEY_PROVIDER)


def ai_status(settings: Settings) -> AiStatusOut:
    """``AiStatusOut`` for the settings row, from sync code.

    Inside a FastAPI worker thread the coroutine runs on the app's event loop; elsewhere (tests,
    scripts) on a fresh loop.
    """
    from remi.services.ai.registry import AiSettings
    from remi.services.ai.status import ai_status as provider_status

    call = functools.partial(provider_status, AiSettings.from_row(settings))
    try:
        return anyio.from_thread.run(call)
    except anyio.NoEventLoopError:
        return asyncio.run(call())
