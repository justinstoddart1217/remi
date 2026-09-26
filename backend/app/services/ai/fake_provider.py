"""A test-only parse provider: canned replies read from a JSON file. Never used in prod.

It stands in for ``window.claude`` the way the parity harness stubs it in the prototype, so
the drawer states (review from an AI reply, thinking, error) can be reproduced against Remi
without a network or a key.

It is selected only when **both** hold (``registry.provider_factory_for``):

- the process runs with ``REMI_ENV=test`` (``RemiConfig.env``); in ``prod`` and ``dev`` the
  factory is the plain ``select_provider`` and this module is never consulted;
- ``REMI_AI_FAKE`` names a file that exists. While it does not (a harness that has not
  written it yet), the configured provider answers, so ``none`` still gives the simple reading.

The file is read on every parse, so a test driver can switch replies between states without
restarting the server. Its shape (``mode`` defaults to ``reply``)::

    {"mode": "reply", "reply": {"summary": ..., "changes": [...], "unplaced": [...]}}
    {"mode": "raw", "raw": "Here is the plan.\\n{...}"}      # prose around JSON, like a model
    {"mode": "none"}                                          # no AI: the simple reading
    {"mode": "pending"}                                       # never answers (thinking)
    {"mode": "error", "code": "AI_UNAVAILABLE", "message": "..."}
    {"summary": ..., "changes": [...]}                        # a bare proposal = "reply"

``delayS`` (optional, any mode) waits that long before answering. ``raw`` takes the greedy
``{...}`` match like the prototype (``/\\{[\\s\\S]*\\}/``); prose without JSON is
``AI_BAD_REPLY`` ("Remi replied without a plan."). The reply still goes through the registry's
``validate()``, so unknown ids are dropped exactly as for a real provider.
"""

import asyncio
import json
import os
import re
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Final, cast

from app.core.config import Env
from app.schemas.settings import AiProvider
from app.services.ai.base import (
    AIAuth,
    AIBadReply,
    AIDisabled,
    AIError,
    AINotConfigured,
    AIRateLimited,
    AITimeout,
    AIUnavailable,
    ParseProvider,
    ParseRequest,
    RawProposal,
)

ENV_VAR: Final = "REMI_AI_FAKE"
FAKE_MODEL: Final = "fake"
FAKE_TIMEOUT_S: Final = 30.0
ALLOWED_ENV: Final[Env] = "test"

_JSON_OBJECT: Final = re.compile(r"\{[\s\S]*\}")
_ERRORS: Final[Mapping[str, type[AIError]]] = {
    cls.default_code: cls
    for cls in (AIAuth, AIBadReply, AINotConfigured, AIRateLimited, AITimeout, AIUnavailable)
}


class FakeProviderRefused(RuntimeError):
    """The fake provider was asked for outside ``REMI_ENV=test``."""


def fake_path(env: Env, environ: Mapping[str, str] | None = None) -> Path | None:
    """The reply file when the fake is enabled (``env`` is ``test`` and ``REMI_AI_FAKE`` is
    set), else ``None``. It never enables in ``prod`` or ``dev``, whatever the environment."""
    if env != ALLOWED_ENV:
        return None
    value = (environ if environ is not None else os.environ).get(ENV_VAR, "").strip()
    return Path(value) if value else None


def _object(value: object) -> dict[str, object] | None:
    return cast("dict[str, object]", value) if isinstance(value, dict) else None


class FakeProvider:
    """Answers from ``path`` (see the module docstring). Refuses to exist outside tests."""

    def __init__(self, path: Path, env: Env, *, name: AiProvider = "anthropic") -> None:
        if env != ALLOWED_ENV:
            msg = "the fake AI provider only exists when REMI_ENV=test"
            raise FakeProviderRefused(msg)
        self._path = path
        self._name: AiProvider = name

    def __repr__(self) -> str:
        return f"FakeProvider(path={str(self._path)!r})"

    @property
    def name(self) -> AiProvider:
        """``anthropic``: it plays the part of ``window.claude`` (an AI reply, ``source: ai``)."""
        return self._name

    @property
    def model(self) -> str:
        return FAKE_MODEL

    @property
    def default_timeout_s(self) -> float:
        return FAKE_TIMEOUT_S

    def _spec(self) -> dict[str, object]:
        try:
            text = self._path.read_text(encoding="utf-8")
        except OSError as exc:
            msg = f"the fake reply file cannot be read ({type(exc).__name__})"
            raise AIUnavailable(msg) from None
        try:
            data = json.loads(text)
        except ValueError:
            msg = "the fake reply file is not JSON"
            raise AIUnavailable(msg) from None
        spec = _object(data)
        if spec is None:
            msg = "the fake reply file must hold a JSON object"
            raise AIUnavailable(msg)
        return spec

    async def propose(self, req: ParseRequest) -> RawProposal:
        spec = self._spec()
        delay = spec.get("delayS")
        if isinstance(delay, int | float) and not isinstance(delay, bool) and delay > 0:
            await asyncio.sleep(float(delay))
        mode = spec.get("mode", "reply")
        if mode == "none":
            raise AIDisabled
        if mode == "pending":
            while True:  # never answers: the registry's timeout or a cancel ends it
                await asyncio.sleep(3600)
        if mode == "error":
            code = spec.get("code")
            error = _ERRORS.get(code, AIUnavailable) if isinstance(code, str) else AIUnavailable
            message = spec.get("message")
            raise error(message if isinstance(message, str) else None)
        if mode == "raw":
            raw = spec.get("raw")
            text = raw if isinstance(raw, str) else ""
            match = _JSON_OBJECT.search(text)
            if match is None:
                raise AIBadReply(response_raw=text)
            try:
                parsed = json.loads(match.group(0))
            except ValueError:
                raise AIBadReply(response_raw=text) from None
            data = _object(parsed)
            if data is None:
                raise AIBadReply(response_raw=text)
            return RawProposal.from_json(data, response_raw=text, model=FAKE_MODEL)
        if mode != "reply":
            msg = f"unknown fake mode {mode!r}"
            raise AIUnavailable(msg)
        reply = _object(spec.get("reply")) if "reply" in spec else spec
        if reply is None:
            raise AIBadReply(response_raw=json.dumps(spec.get("reply")))
        return RawProposal.from_json(
            reply, response_raw=json.dumps(reply, ensure_ascii=False), model=FAKE_MODEL
        )


def with_fake[S](
    env: Env,
    fallback: Callable[[S], ParseProvider],
    environ: Mapping[str, str] | None = None,
) -> Callable[[S], ParseProvider]:
    """A provider factory that answers with the fake whenever it is enabled and its file
    exists (checked on each call, so ``REMI_AI_FAKE`` and the file can change between tests),
    else calls ``fallback``."""
    if env != ALLOWED_ENV:
        return fallback

    def factory(settings: S) -> ParseProvider:
        path = fake_path(env, environ)
        if path is None or not path.is_file():
            return fallback(settings)
        return FakeProvider(path, env)

    return factory
