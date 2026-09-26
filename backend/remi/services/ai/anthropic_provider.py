"""The ``anthropic`` provider: Claude through the official SDK (optional extra ``anthropic``).

- The SDK is imported lazily, so a default install (provider ``none``) never loads it.
- One ``messages.create`` call with a single **strict** tool, ``propose_changes``, whose input
  schema is ``PROPOSAL_SCHEMA``. ``tool_choice`` stays ``auto``: newer models (Claude Opus 5.5,
  Claude Fable 5.1) reject a forced tool with a 400, and ``strict: true`` still guarantees
  the arguments match the schema. The system prompt says to answer only through the tool,
  exactly once; ``disable_parallel_tool_use`` makes the API enforce "at most one call".
- Thinking is left at the model default (adaptive on current models) with ``effort: low``:
  this is extraction, not deep reasoning.
- The stop reason is checked before the content: ``refusal``, ``max_tokens`` or no tool call
  is ``AIBadReply``.
- SDK errors map to typed ``AIError`` s (most specific first): timeout -> ``AITimeout``;
  connection -> ``AIUnavailable``; 401/403 -> ``AIAuth``; 429 -> ``AIRateLimited``;
  anything else -> ``AIUnavailable``. Messages never include the key or the SDK's text.
- Optional server-side fallback (Settings ``ai_server_fallback``): the beta
  ``server-side-fallback-2026-07-01`` with ``fallbacks: "default"``, which re-runs a
  declined request on a fallback model inside the same call.
- The key is passed explicitly, so the SDK does not look for credentials elsewhere, and the
  base URL is pinned so an ``ANTHROPIC_BASE_URL`` in the environment cannot redirect it.
"""

import importlib.util
import logging
from typing import TYPE_CHECKING, Final

from remi.schemas.settings import AiProvider
from remi.services.ai.base import (
    TOOL_NAME,
    AIAuth,
    AIBadReply,
    AINotConfigured,
    AIRateLimited,
    AITimeout,
    AIUnavailable,
    ParseRequest,
    RawProposal,
)

if TYPE_CHECKING:
    import httpx2
    from anthropic import AsyncAnthropic
    from anthropic.types import Message
    from anthropic.types.beta import BetaMessage

logger = logging.getLogger(__name__)

DEFAULT_ANTHROPIC_MODEL: Final = "claude-opus-5"
"""The current general model (per the ``claude-api`` skill). ``settings.ai_model`` overrides."""
ANTHROPIC_TIMEOUT_S: Final = 30.0
ANTHROPIC_BASE_URL: Final = "https://api.anthropic.com"
MAX_RETRIES: Final = 1
EFFORT: Final = "low"
FALLBACK_BETA: Final = "server-side-fallback-2026-07-01"

TOOL_DESCRIPTION: Final = (
    "Propose the changes this update supports: a short summary, the typed changes (only ids "
    "from the CONTEXT) and quotes you could not place. The analyst reviews every change "
    "before anything is applied."
)

_NO_EFFORT_PREFIXES: Final = ("claude-haiku-", "claude-sonnet-4-5", "claude-3")
"""Models that reject ``output_config.effort``; everything newer accepts it."""


SDK_MISSING: Final = "the anthropic package is not installed (uv sync --extra anthropic)"


def sdk_installed() -> bool:
    return importlib.util.find_spec("anthropic") is not None


def _supports_effort(model: str) -> bool:
    return not model.startswith(_NO_EFFORT_PREFIXES)


def _read_reply(message: "Message | BetaMessage") -> RawProposal:
    raw = message.to_json(indent=None)
    tin, tout = message.usage.input_tokens, message.usage.output_tokens
    if message.stop_reason == "refusal":
        raise AIBadReply(
            "the assistant declined this update",
            response_raw=raw,
            input_tokens=tin,
            output_tokens=tout,
        )
    if message.stop_reason in ("max_tokens", "model_context_window_exceeded"):
        raise AIBadReply(
            "the reply was cut off", response_raw=raw, input_tokens=tin, output_tokens=tout
        )
    for block in message.content:
        if block.type == "tool_use" and block.name == TOOL_NAME:
            return RawProposal.from_json(
                block.input,
                response_raw=raw,
                model=str(message.model),
                input_tokens=tin,
                output_tokens=tout,
            )
    raise AIBadReply(response_raw=raw, input_tokens=tin, output_tokens=tout)


class AnthropicProvider:
    """Claude via ``AsyncAnthropic``. One instance per parse; holds the key in memory only."""

    __slots__ = (
        "_api_key",
        "_base_url",
        "_http_client",
        "_max_retries",
        "_model",
        "_server_fallback",
    )

    def __init__(
        self,
        api_key: str,
        model: str | None = None,
        *,
        server_fallback: bool = False,
        base_url: str = ANTHROPIC_BASE_URL,
        http_client: "httpx2.AsyncClient | None" = None,
        max_retries: int = MAX_RETRIES,
    ) -> None:
        if not api_key:
            raise AINotConfigured("no Anthropic API key is set")
        self._api_key = api_key
        self._model = model or DEFAULT_ANTHROPIC_MODEL
        self._server_fallback = server_fallback
        self._base_url = base_url
        self._http_client = http_client
        self._max_retries = max_retries

    def __repr__(self) -> str:  # never show the key
        return f"AnthropicProvider(model={self._model!r})"

    @property
    def name(self) -> AiProvider:
        return "anthropic"

    @property
    def model(self) -> str:
        return self._model

    @property
    def default_timeout_s(self) -> float:
        return ANTHROPIC_TIMEOUT_S

    async def propose(self, req: ParseRequest) -> RawProposal:
        try:
            import anthropic as sdk  # lazy: the optional extra
        except ImportError:
            raise AINotConfigured(SDK_MISSING) from None
        client = sdk.AsyncAnthropic(
            api_key=self._api_key,
            base_url=self._base_url,
            timeout=req.timeout_s,
            max_retries=self._max_retries,
            http_client=self._http_client,
        )
        try:
            message = await self._create(client, req)
        except sdk.APITimeoutError:  # a subclass of APIConnectionError: catch it first
            raise AITimeout(f"no answer within {req.timeout_s:g}s") from None
        except sdk.APIConnectionError:
            raise AIUnavailable("could not reach the Anthropic API") from None
        except (sdk.AuthenticationError, sdk.PermissionDeniedError):
            raise AIAuth from None
        except sdk.RateLimitError:
            raise AIRateLimited from None
        except sdk.NotFoundError:
            raise AIUnavailable(f"the model {self._model} is not available") from None
        except sdk.APIStatusError as exc:
            status = int(exc.status_code)
            logger.warning("Anthropic API answered %s (%s)", status, type(exc).__name__)
            raise AIUnavailable(f"the Anthropic API answered {status}") from None
        except sdk.CredentialsError:
            raise AIAuth from None
        except sdk.AnthropicError as exc:
            logger.warning("Anthropic SDK error %s", type(exc).__name__)
            raise AIUnavailable from None
        finally:
            await client.close()
        return _read_reply(message)

    async def _create(self, client: "AsyncAnthropic", req: ParseRequest) -> "Message | BetaMessage":
        from anthropic import omit  # lazy: the optional extra

        effort = _supports_effort(self._model)
        schema = dict(req.schema)
        system = req.system
        content = req.user_message()
        if self._server_fallback:
            return await client.beta.messages.create(
                model=self._model,
                max_tokens=req.max_tokens,
                system=system,
                tools=[
                    {
                        "name": TOOL_NAME,
                        "description": TOOL_DESCRIPTION,
                        "strict": True,
                        "input_schema": schema,
                    }
                ],
                tool_choice={"type": "auto", "disable_parallel_tool_use": True},
                output_config={"effort": EFFORT} if effort else omit,
                messages=[{"role": "user", "content": content}],
                betas=[FALLBACK_BETA],
                fallbacks="default",
            )
        return await client.messages.create(
            model=self._model,
            max_tokens=req.max_tokens,
            system=system,
            tools=[
                {
                    "name": TOOL_NAME,
                    "description": TOOL_DESCRIPTION,
                    "strict": True,
                    "input_schema": schema,
                }
            ],
            tool_choice={"type": "auto", "disable_parallel_tool_use": True},
            output_config={"effort": EFFORT} if effort else omit,
            messages=[{"role": "user", "content": content}],
        )
