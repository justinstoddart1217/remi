"""Where the Anthropic API key lives: the macOS Keychain, or the environment (read only).

The settings endpoints call exactly ``set_api_key``, ``clear_api_key`` and
``api_key_configured`` (plus ``api_key_source`` for ``AiStatusOut.keySource``). Only the
provider registry calls ``load_api_key``. A key is never written to the database, a log, an
audit row, an error message or a response.

Lookup order: the Keychain (what the user saved in Settings), then ``REMI_ANTHROPIC_API_KEY``,
then ``ANTHROPIC_API_KEY``. Environment keys are read only: ``clear_api_key`` removes the
Keychain entry and cannot unset them.

The Keychain is reached through the ``keyring`` package when it happens to be installed; Remi
no longer depends on it (inside APEX it must not be installed, docs/apex/INTEGRATION_
REQUIREMENTS.md R-22). Without it, saving a key is refused with 409 ``KEYCHAIN_UNAVAILABLE``
and only the environment is read: ``REMI_ANTHROPIC_API_KEY``, which ``remi.mount`` fills from
APEX's ``PM_ASSISTANT_API_KEY``. Under pytest (``PYTEST_CURRENT_TEST``) the real Keychain is never
touched: an in-memory store stands in unless a test installs its own with ``use_key_store``.
"""

import importlib
import logging
import os
from collections.abc import Mapping
from typing import Final, Protocol, cast

from pydantic import SecretStr

from remi.core.errors import Conflict, ValidationFailed
from remi.schemas.ai import AiKeySource
from remi.schemas.settings import AiProvider

logger = logging.getLogger(__name__)

KEYCHAIN_SERVICE: Final = "Remi"
KEY_ACCOUNTS: Final[Mapping[AiProvider, str]] = {"anthropic": "anthropic-api-key"}
ENV_VARS: Final[Mapping[AiProvider, tuple[str, ...]]] = {
    "anthropic": ("REMI_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"),
}
MIN_KEY_LENGTH: Final = 8
MAX_KEY_LENGTH: Final = 400


class KeychainUnavailable(Conflict):
    default_code = "KEYCHAIN_UNAVAILABLE"
    default_message = (
        "Remi cannot store a key here. Set REMI_ANTHROPIC_API_KEY on the server (inside APEX, "
        "APEX's PM_ASSISTANT_API_KEY is used), then restart."
    )


class KeyStore(Protocol):
    """A secret store keyed by account name (the Keychain, or memory in tests)."""

    def get(self, account: str) -> str | None: ...
    def set(self, account: str, secret: str) -> None: ...
    def delete(self, account: str) -> None: ...


class _KeyringModule(Protocol):
    def get_password(self, service_name: str, username: str) -> str | None: ...
    def set_password(self, service_name: str, username: str, password: str) -> None: ...
    def delete_password(self, service_name: str, username: str) -> None: ...


class KeyringStore:
    """The ``keyring`` package (the macOS Keychain on a Mac)."""

    def __init__(self, module: object, service: str = KEYCHAIN_SERVICE) -> None:
        self._keyring = cast("_KeyringModule", module)
        self._service = service

    def get(self, account: str) -> str | None:
        try:
            return self._keyring.get_password(self._service, account)
        except Exception as exc:  # keyring raises backend-specific errors
            logger.warning("Keychain read failed (%s)", type(exc).__name__)
            return None

    def set(self, account: str, secret: str) -> None:
        try:
            self._keyring.set_password(self._service, account, secret)
        except Exception as exc:
            logger.warning("Keychain write failed (%s)", type(exc).__name__)
            raise KeychainUnavailable from None

    def delete(self, account: str) -> None:
        try:
            self._keyring.delete_password(self._service, account)
        except Exception as exc:  # e.g. PasswordDeleteError when there is nothing to delete
            logger.info("Keychain delete skipped (%s)", type(exc).__name__)


class MemoryKeyStore:
    """A process-local store (tests)."""

    def __init__(self) -> None:
        self._items: dict[str, str] = {}

    def get(self, account: str) -> str | None:
        return self._items.get(account)

    def set(self, account: str, secret: str) -> None:
        self._items[account] = secret

    def delete(self, account: str) -> None:
        self._items.pop(account, None)

    def __repr__(self) -> str:
        return f"MemoryKeyStore({len(self._items)} item(s))"


_override: KeyStore | None = None
_pytest_store = MemoryKeyStore()


def use_key_store(store: KeyStore | None) -> KeyStore | None:
    """Install ``store`` (``None`` restores the default) and return the previous override."""
    global _override
    previous = _override
    _override = store
    return previous


def import_keyring() -> object | None:
    """The ``keyring`` module, or ``None`` when the optional extra is not installed."""
    try:
        return importlib.import_module("keyring")
    except ImportError:
        return None


def _default_store() -> KeyStore | None:
    if _override is not None:
        return _override
    if "PYTEST_CURRENT_TEST" in os.environ:
        return _pytest_store
    module = import_keyring()
    return KeyringStore(module) if module is not None else None


def _account(provider: AiProvider) -> str:
    account = KEY_ACCOUNTS.get(provider)
    if account is None:
        msg = f"The {provider} provider does not use an API key."
        raise ValidationFailed(msg, field="provider")
    return account


def _env_key(provider: AiProvider) -> str | None:
    for name in ENV_VARS.get(provider, ()):
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return None


def set_api_key(provider: AiProvider, value: str | SecretStr) -> None:
    """Save the key in the Keychain. Raises ``KeychainUnavailable`` (409) without one."""
    account = _account(provider)
    secret = (value.get_secret_value() if isinstance(value, SecretStr) else value).strip()
    if not MIN_KEY_LENGTH <= len(secret) <= MAX_KEY_LENGTH:
        msg = "That does not look like an API key."
        raise ValidationFailed(msg, field="apiKey")
    if any(ch.isspace() for ch in secret):
        msg = "An API key has no spaces or line breaks."
        raise ValidationFailed(msg, field="apiKey")
    store = _default_store()
    if store is None:
        raise KeychainUnavailable
    store.set(account, secret)
    logger.info("API key saved for %s", provider)


def clear_api_key(provider: AiProvider) -> None:
    """Remove the Keychain entry (environment keys are read only and stay)."""
    account = _account(provider)
    store = _default_store()
    if store is not None:
        store.delete(account)
    logger.info("API key cleared for %s", provider)


def api_key_source(provider: AiProvider) -> AiKeySource | None:
    """Where the key the provider would use comes from, or ``None``."""
    account = KEY_ACCOUNTS.get(provider)
    if account is None:
        return None
    store = _default_store()
    if store is not None and store.get(account):
        return "keychain"
    if _env_key(provider) is not None:
        return "env"
    return None


def api_key_configured(provider: AiProvider) -> bool:
    return api_key_source(provider) is not None


def load_api_key(provider: AiProvider) -> str | None:
    """The key itself. Server-internal: only the provider registry may call this."""
    account = KEY_ACCOUNTS.get(provider)
    if account is None:
        return None
    store = _default_store()
    stored = store.get(account) if store is not None else None
    return stored or _env_key(provider)
