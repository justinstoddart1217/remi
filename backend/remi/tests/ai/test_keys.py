"""API keys: Keychain via keyring (faked), env read only, never echoed."""

import logging
import sys
from types import SimpleNamespace

import pytest
from pydantic import SecretStr

from remi.core.errors import ValidationFailed
from remi.services.ai import keys
from remi.services.ai.keys import (
    KeychainUnavailable,
    KeyringStore,
    MemoryKeyStore,
    api_key_configured,
    api_key_source,
    clear_api_key,
    load_api_key,
    set_api_key,
    use_key_store,
)
from remi.tests.ai.conftest import TEST_KEY


class FakeKeyring:
    """The three ``keyring`` functions Remi uses, over a dict."""

    def __init__(self) -> None:
        self.items: dict[tuple[str, str], str] = {}

    def get_password(self, service_name: str, username: str) -> str | None:
        return self.items.get((service_name, username))

    def set_password(self, service_name: str, username: str, password: str) -> None:
        self.items[(service_name, username)] = password

    def delete_password(self, service_name: str, username: str) -> None:
        if (service_name, username) not in self.items:
            raise RuntimeError("PasswordDeleteError")
        del self.items[(service_name, username)]


def test_no_key_by_default() -> None:
    assert not api_key_configured("anthropic")
    assert api_key_source("anthropic") is None
    assert load_api_key("anthropic") is None


def test_set_and_clear_in_the_keychain(key_store: MemoryKeyStore) -> None:
    set_api_key("anthropic", SecretStr(f"  {TEST_KEY}\n"))
    assert api_key_configured("anthropic")
    assert api_key_source("anthropic") == "keychain"
    assert load_api_key("anthropic") == TEST_KEY
    assert TEST_KEY not in repr(key_store)
    clear_api_key("anthropic")
    assert not api_key_configured("anthropic")
    clear_api_key("anthropic")  # idempotent


def test_keyring_backend_is_used_with_the_remi_service() -> None:
    fake = FakeKeyring()
    previous = use_key_store(KeyringStore(fake))
    try:
        set_api_key("anthropic", TEST_KEY)
        assert fake.items == {("Remi", "anthropic-api-key"): TEST_KEY}
        assert load_api_key("anthropic") == TEST_KEY
        clear_api_key("anthropic")
        assert fake.items == {}
        clear_api_key("anthropic")  # the backend's delete error is swallowed
    finally:
        use_key_store(previous)


def test_keyring_write_failure_is_a_409_without_the_key(caplog: pytest.LogCaptureFixture) -> None:
    def broken(*_args: object) -> None:
        raise RuntimeError(f"backend exploded while storing {TEST_KEY}")

    module = SimpleNamespace(get_password=_nothing, set_password=broken, delete_password=_nothing)
    previous = use_key_store(KeyringStore(module))
    caplog.set_level(logging.DEBUG)
    try:
        with pytest.raises(KeychainUnavailable) as info:
            set_api_key("anthropic", TEST_KEY)
    finally:
        use_key_store(previous)
    assert info.value.status == 409
    assert info.value.code == "KEYCHAIN_UNAVAILABLE"
    assert TEST_KEY not in info.value.message
    assert info.value.__cause__ is None
    assert TEST_KEY not in caplog.text


def test_env_keys_are_read_only(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-from-plain-env-000")
    assert api_key_source("anthropic") == "env"
    assert load_api_key("anthropic") == "sk-ant-from-plain-env-000"
    monkeypatch.setenv("REMI_ANTHROPIC_API_KEY", "sk-ant-from-remi-env-000")
    assert load_api_key("anthropic") == "sk-ant-from-remi-env-000"
    clear_api_key("anthropic")
    assert api_key_configured("anthropic")  # env keys cannot be cleared from the app


def test_keychain_wins_over_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-from-plain-env-000")
    set_api_key("anthropic", TEST_KEY)
    assert api_key_source("anthropic") == "keychain"
    assert load_api_key("anthropic") == TEST_KEY


def test_without_keyring_saving_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    previous = use_key_store(None)
    monkeypatch.delenv("PYTEST_CURRENT_TEST")
    monkeypatch.setattr(keys, "import_keyring", _no_keyring)
    try:
        with pytest.raises(KeychainUnavailable):
            set_api_key("anthropic", TEST_KEY)
        assert api_key_source("anthropic") is None
    finally:
        use_key_store(previous)


def _no_keyring() -> object | None:
    return None


def _nothing(*_args: object) -> None:
    return None


def test_pytest_never_touches_the_real_keychain(monkeypatch: pytest.MonkeyPatch) -> None:
    previous = use_key_store(None)
    touched: list[str] = []

    def spy() -> object | None:
        touched.append("keyring")
        return None

    monkeypatch.setattr(keys, "import_keyring", spy)
    try:
        set_api_key("anthropic", TEST_KEY)
        assert load_api_key("anthropic") == TEST_KEY
        clear_api_key("anthropic")
    finally:
        use_key_store(previous)
    assert touched == []


@pytest.mark.parametrize("value", ["short", "sk-ant with spaces inside", "x" * 401])
def test_implausible_keys_are_refused(value: str) -> None:
    with pytest.raises(ValidationFailed) as info:
        set_api_key("anthropic", value)
    assert info.value.field == "apiKey"
    assert value not in info.value.message


def test_the_keyring_extra_is_optional(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(sys.modules, "keyring", None)
    assert keys.import_keyring() is None


def test_providers_without_keys() -> None:
    with pytest.raises(ValidationFailed):
        set_api_key("ollama", TEST_KEY)
    assert not api_key_configured("none")
    assert load_api_key("ollama") is None


def test_no_log_line_contains_the_key(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    set_api_key("anthropic", TEST_KEY)
    load_api_key("anthropic")
    clear_api_key("anthropic")
    assert caplog.records  # something was logged ...
    assert TEST_KEY not in caplog.text  # ... but never the key
