"""Every ``/api`` failure becomes ``{"error": {"code", "message", "field"}}``.

- ``DomainError`` (``app.core.errors``) carries its own code, message, field and status.
- ``ApiError`` is the API layer's own error (``NOT_IMPLEMENTED`` stubs, dependency failures).
- Request validation failures are 422 ``VALIDATION_ERROR`` with the offending field.
- Starlette's 404/405 under ``/api`` become ``NOT_FOUND`` / ``METHOD_NOT_ALLOWED``; outside
  ``/api`` (the SPA and static files) FastAPI's default handling is kept.
- Anything unexpected is a 500 ``INTERNAL_ERROR`` with no details in the body. It is sent by
  ``app.api.middleware.UnexpectedErrorMiddleware`` so it still carries the security headers.
"""

import logging
from collections.abc import Mapping, Sequence
from typing import Any, Final, NoReturn

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.errors import DomainError
from app.schemas.errors import ErrorBody, ErrorOut

logger = logging.getLogger("remi.api")

API_PREFIX = "/api"

_STATUS_CODES: Mapping[int, str] = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    413: "PAYLOAD_TOO_LARGE",
    415: "UNSUPPORTED_MEDIA_TYPE",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
    500: "INTERNAL_ERROR",
    501: "NOT_IMPLEMENTED",
    503: "SERVICE_UNAVAILABLE",
}


class ApiError(Exception):
    """An error raised by the API layer itself. Services raise ``DomainError`` instead."""

    def __init__(self, status: int, code: str, message: str, field: str | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.field = field


def error_body(code: str, message: str, field: str | None = None) -> dict[str, Any]:
    """The envelope as a plain dict (for middleware that runs outside FastAPI)."""
    return ErrorOut(error=ErrorBody(code=code, message=message, field=field)).model_dump(
        mode="json"
    )


def error_response(
    status: int,
    code: str,
    message: str,
    field: str | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        error_body(code, message, field),
        status_code=status,
        headers=dict(headers) if headers else None,
    )


_RESPONSE_DESCRIPTIONS: Mapping[int, str] = {
    400: "Bad request",
    403: "Forbidden (missing loopback Origin or X-Remi-Client header)",
    404: "Not found",
    409: "Conflict (e.g. SETUP_REQUIRED, VERSION_CONFLICT)",
    413: "Payload too large",
    415: "Unsupported media type",
    422: "Validation error",
    502: "AI provider failed (AI_AUTH, AI_BAD_REPLY, AI_UNAVAILABLE)",
    503: "AI provider rate limited",
    504: "AI provider timed out",
}


def error_responses(*statuses: int) -> dict[int | str, dict[str, Any]]:
    """OpenAPI ``responses`` entries that use the error envelope. Declaring 422 here also
    replaces FastAPI's default ``HTTPValidationError`` schema with the envelope."""
    return {
        status: {"model": ErrorOut, "description": _RESPONSE_DESCRIPTIONS.get(status, "Error")}
        for status in statuses
    }


def not_implemented() -> NoReturn:
    """Every contract stub raises this until its service exists (501 ``NOT_IMPLEMENTED``)."""
    raise ApiError(
        501,
        "NOT_IMPLEMENTED",
        "This endpoint is part of the API contract but is not implemented yet.",
    )


def is_api_path(path: str) -> bool:
    return path == API_PREFIX or path.startswith(API_PREFIX + "/")


_LOC_SOURCES: Final = frozenset({"body", "query", "path", "header", "cookie"})

_WHOLE_BODY_MESSAGES: Mapping[str, str] = {
    "json_invalid": "The request body is not valid JSON.",
    "missing": "A JSON request body is required.",
    "model_attributes_type": "The request body must be a JSON object.",
    "dict_type": "The request body must be a JSON object.",
    "model_type": "The request body must be a JSON object.",
}
"""Errors about the body as a whole (no field to name) get a plain sentence."""


def _field_from_loc(loc: Sequence[int | str]) -> str | None:
    """The camelCase request field a validation error is about, or ``None``.

    FastAPI prefixes the source (``body``, ``query``, ``path``, ...); the rest is the field path
    as the client sent it (camelCase aliases), which is what the client can highlight. A loc
    with no named part is about the body as a whole: ``("body",)`` for a missing body, or
    ``("body", 1)`` for malformed JSON, where ``1`` is a character offset, not a field.
    """
    parts = list(loc)
    if parts and parts[0] in _LOC_SOURCES:
        parts = parts[1:]
    if all(isinstance(p, int) for p in parts):
        return None
    return ".".join(str(p) for p in parts)


def _validation_message(error: Mapping[str, Any]) -> str:
    field = _field_from_loc(error.get("loc", ()))
    kind = str(error.get("type", ""))
    if field is None and kind in _WHOLE_BODY_MESSAGES:
        return _WHOLE_BODY_MESSAGES[kind]
    msg = str(error.get("msg", "Invalid value"))
    return f"{field}: {msg}" if field else msg


async def _domain_error_handler(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, DomainError)  # noqa: S101 - narrowing for the type checker
    return error_response(exc.status, exc.code, exc.message, exc.field)


async def _api_error_handler(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, ApiError)  # noqa: S101
    return error_response(exc.status, exc.code, exc.message, exc.field)


async def _validation_error_handler(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, RequestValidationError)  # noqa: S101
    errors: Sequence[Mapping[str, Any]] = exc.errors()
    first: Mapping[str, Any] = errors[0] if errors else {}
    return error_response(
        422,
        "VALIDATION_ERROR",
        _validation_message(first),
        _field_from_loc(first.get("loc", ())),
    )


async def _http_error_handler(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, StarletteHTTPException)  # noqa: S101
    if not is_api_path(request.url.path):
        return await http_exception_handler(request, exc)
    code = _STATUS_CODES.get(exc.status_code, f"HTTP_{exc.status_code}")
    message = exc.detail or code.replace("_", " ").capitalize()
    return error_response(exc.status_code, code, message, headers=exc.headers)


INTERNAL_ERROR_MESSAGE: Final = "Something went wrong inside Remi."


def internal_error_response() -> JSONResponse:
    """The 500 envelope. It never carries exception details."""
    return error_response(500, "INTERNAL_ERROR", INTERNAL_ERROR_MESSAGE)


async def _unexpected_error_handler(request: Request, exc: Exception) -> Response:
    # Starlette runs this from ServerErrorMiddleware (outside every other middleware). The
    # response is normally already sent by ``UnexpectedErrorMiddleware`` (inside the security
    # headers), so this mostly logs. Log the type and path only: bodies may hold notes or keys.
    logger.error("Unhandled %s on %s %s", type(exc).__name__, request.method, request.url.path)
    return internal_error_response()


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(DomainError, _domain_error_handler)
    app.add_exception_handler(ApiError, _api_error_handler)
    app.add_exception_handler(RequestValidationError, _validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, _http_error_handler)
    app.add_exception_handler(Exception, _unexpected_error_handler)
