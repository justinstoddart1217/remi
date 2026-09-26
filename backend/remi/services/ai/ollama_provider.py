"""The ``ollama`` provider: a local model through Ollama's HTTP API, on loopback only.

- The base URL must be ``http(s)://`` on a loopback host (``127.0.0.0/8``, ``::1`` or
  ``localhost``) with no credentials, query or fragment; anything else is refused before a
  request is made (``AINotConfigured``). The client ignores proxy environment variables
  (``trust_env=False``) and never follows redirects, so nothing can leave the machine.
- ``POST /api/chat`` with ``format`` = ``PROPOSAL_SCHEMA``, ``stream: false``,
  ``temperature: 0`` and ``num_ctx: 8192``; the reply's ``message.content`` must be a JSON
  object. ``num_ctx`` is set because Ollama's default context window can silently drop the
  start of the prompt, system prompt included (the seed CONTEXT alone is about 4.3k
  characters). It is fixed, not sized per request: a different ``num_ctx`` reloads the model.
- Errors: connect failure -> ``AIUnavailable`` ("Ollama is not running on ..."); timeout ->
  ``AITimeout``; 404 -> ``AIUnavailable`` (model not pulled); other HTTP errors ->
  ``AIUnavailable``; non-JSON or non-object content -> ``AIBadReply``.
"""

import json
from typing import Final, cast
from urllib.parse import urlsplit

import httpx

from remi.core.config import is_loopback_host
from remi.schemas.settings import AiProvider
from remi.services.ai.base import (
    AIBadReply,
    AINotConfigured,
    AITimeout,
    AIUnavailable,
    ParseRequest,
    RawProposal,
)

DEFAULT_OLLAMA_MODEL: Final = "llama3.1"
OLLAMA_TIMEOUT_S: Final = 90.0
OLLAMA_NUM_CTX: Final = 8192
"""Context window (tokens) asked of Ollama: room for the prompt, notes and the reply."""
CONNECT_TIMEOUT_S: Final = 2.0
STATUS_TIMEOUT_S: Final = 1.5
HTTP_BAD_REQUEST: Final = 400
HTTP_NOT_FOUND: Final = 404


class NotLoopback(ValueError):
    """The Ollama base URL is not a loopback address."""


def normalise_loopback_url(url: str) -> str:
    """``url`` without a trailing slash, or ``NotLoopback`` if it could leave the machine."""
    candidate = url.strip()
    try:
        parts = urlsplit(candidate)
        _ = parts.port  # raises for a malformed or out-of-range port
    except ValueError as exc:
        msg = "the Ollama address is not a valid URL"
        raise NotLoopback(msg) from exc
    if parts.scheme not in ("http", "https"):
        msg = "the Ollama address must start with http:// or https://"
        raise NotLoopback(msg)
    if parts.username is not None or parts.password is not None:
        msg = "the Ollama address must not contain credentials"
        raise NotLoopback(msg)
    if parts.query or parts.fragment:
        msg = "the Ollama address must not have a query or fragment"
        raise NotLoopback(msg)
    host = parts.hostname
    if not host or not is_loopback_host(host):
        msg = "Ollama must run on this Mac (127.0.0.1, ::1 or localhost)"
        raise NotLoopback(msg)
    return candidate.rstrip("/")


def is_loopback_url(url: str) -> bool:
    try:
        normalise_loopback_url(url)
    except NotLoopback:
        return False
    return True


def display_address(base_url: str) -> str:
    """``127.0.0.1:11434`` for messages."""
    return urlsplit(base_url).netloc or base_url


def _client(
    base_url: str, timeout: httpx.Timeout, transport: httpx.AsyncBaseTransport | None
) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=base_url,
        timeout=timeout,
        transport=transport,
        trust_env=False,
        follow_redirects=False,
    )


class OllamaProvider:
    __slots__ = ("_base_url", "_model", "_transport")

    def __init__(
        self,
        base_url: str,
        model: str | None = None,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        try:
            self._base_url = normalise_loopback_url(base_url)
        except NotLoopback as exc:
            raise AINotConfigured(str(exc)) from None
        self._model = model or DEFAULT_OLLAMA_MODEL
        self._transport = transport

    def __repr__(self) -> str:
        return f"OllamaProvider(base_url={self._base_url!r}, model={self._model!r})"

    @property
    def name(self) -> AiProvider:
        return "ollama"

    @property
    def model(self) -> str:
        return self._model

    @property
    def base_url(self) -> str:
        return self._base_url

    @property
    def default_timeout_s(self) -> float:
        return OLLAMA_TIMEOUT_S

    def request_body(self, req: ParseRequest) -> dict[str, object]:
        return {
            "model": self._model,
            "messages": [
                {"role": "system", "content": req.system},
                {"role": "user", "content": req.user_message()},
            ],
            "format": dict(req.schema),
            "stream": False,
            "options": {"temperature": 0, "num_ctx": OLLAMA_NUM_CTX},
        }

    async def propose(self, req: ParseRequest) -> RawProposal:
        where = display_address(self._base_url)
        timeout = httpx.Timeout(req.timeout_s, connect=CONNECT_TIMEOUT_S)
        async with _client(self._base_url, timeout, self._transport) as client:
            try:
                response = await client.post("/api/chat", json=self.request_body(req))
            except httpx.ConnectTimeout:
                raise AIUnavailable(f"Ollama is not running on {where}") from None
            except httpx.TimeoutException:
                raise AITimeout(f"no answer within {req.timeout_s:g}s") from None
            except httpx.ConnectError:
                raise AIUnavailable(f"Ollama is not running on {where}") from None
            except httpx.HTTPError:
                raise AIUnavailable(f"could not reach Ollama on {where}") from None
        raw = response.text
        if response.status_code == HTTP_NOT_FOUND:
            raise AIUnavailable(
                f"the model {self._model} is not installed in Ollama", response_raw=raw
            )
        if response.status_code >= HTTP_BAD_REQUEST:
            raise AIUnavailable(f"Ollama answered {response.status_code}", response_raw=raw)
        return self._read(raw)

    def _read(self, raw: str) -> RawProposal:
        try:
            body = json.loads(raw)
        except ValueError:
            raise AIBadReply(response_raw=raw) from None
        if not isinstance(body, dict):
            raise AIBadReply(response_raw=raw)
        reply = cast("dict[str, object]", body)
        tokens_in = reply.get("prompt_eval_count")
        tokens_out = reply.get("eval_count")
        tin = tokens_in if isinstance(tokens_in, int) else None
        tout = tokens_out if isinstance(tokens_out, int) else None
        message = reply.get("message")
        content = (
            cast("dict[str, object]", message).get("content") if isinstance(message, dict) else None
        )
        if not isinstance(content, str):
            raise AIBadReply(response_raw=raw, input_tokens=tin, output_tokens=tout)
        try:
            data = json.loads(content)
        except ValueError:
            raise AIBadReply(response_raw=raw, input_tokens=tin, output_tokens=tout) from None
        if not isinstance(data, dict):
            raise AIBadReply(response_raw=raw, input_tokens=tin, output_tokens=tout)
        model = reply.get("model")
        return RawProposal.from_json(
            cast("dict[str, object]", data),
            response_raw=raw,
            model=model if isinstance(model, str) else self._model,
            input_tokens=tin,
            output_tokens=tout,
        )


async def ollama_status(
    base_url: str,
    model: str | None,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> str | None:
    """``None`` when Ollama answers on loopback and has the model; otherwise the reason."""
    try:
        url = normalise_loopback_url(base_url)
    except NotLoopback as exc:
        return str(exc)
    wanted = model or DEFAULT_OLLAMA_MODEL
    where = display_address(url)
    timeout = httpx.Timeout(STATUS_TIMEOUT_S, connect=STATUS_TIMEOUT_S)
    async with _client(url, timeout, transport) as client:
        try:
            response = await client.get("/api/tags")
        except httpx.HTTPError:
            return f"Ollama is not running on {where}"
    if response.status_code >= HTTP_BAD_REQUEST:
        return f"Ollama answered {response.status_code} on {where}"
    try:
        body = response.json()
    except ValueError:
        return f"Ollama on {where} did not answer as expected"
    names: set[str] = set()
    if isinstance(body, dict):
        models = cast("dict[str, object]", body).get("models")
        if isinstance(models, list):
            for item in cast("list[object]", models):
                if isinstance(item, dict):
                    name = cast("dict[str, object]", item).get("name")
                    if isinstance(name, str):
                        names.add(name)
    if wanted in names or f"{wanted}:latest" in names:
        return None
    return f"the model {wanted} is not installed in Ollama"
