"""Local attack surface guards. Remi has no auth, so these are what keep other sites out.

1. ``TrustedHostMiddleware`` accepts only loopback ``Host`` headers, which defeats DNS
   rebinding (a hostile page resolving its own name to 127.0.0.1).
2. :class:`MutationGuardMiddleware`: every mutating ``/api`` request needs a loopback
   ``Origin`` on Remi's own port (plus the Vite dev port outside prod) and ``X-Remi-Client: 1``.
   A cross-site form or ``fetch`` cannot satisfy both; there is no CORS, so no preflight passes.
3. :class:`SecurityHeadersMiddleware` adds the app CSP (``'self'`` only) and a few hardening
   headers to every response that does not set its own CSP (chart HTML sets
   :data:`CHART_CSP`).
4. :class:`UnexpectedErrorMiddleware`, just inside the security headers, turns an unhandled
   exception into the 500 ``INTERNAL_ERROR`` envelope. Starlette's own 500 comes from
   ``ServerErrorMiddleware``, which wraps every other middleware and so would skip the headers.
"""

from collections.abc import Collection, Iterable
from typing import Final

from fastapi import FastAPI
from starlette.datastructures import Headers, MutableHeaders
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.api.errors import error_body, internal_error_response, is_api_path
from app.core.config import RemiConfig

APP_CSP: Final = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; "
    "font-src 'self' data:; "
    "connect-src 'self'; "
    "frame-src 'self'; "
    "object-src 'none'; "
    "base-uri 'none'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)
"""The SPA and the API. ``'unsafe-inline'`` styles are needed by KaTeX; nothing loads from
another origin. ``data:`` fonts cover small KaTeX fonts Vite may inline."""

CHART_CSP: Final = (
    "sandbox allow-scripts; "
    "default-src 'none'; "
    "script-src 'unsafe-inline'; "
    "style-src 'unsafe-inline'; "
    "img-src data: blob:; "
    "font-src data:; "
    "connect-src 'none'; "
    "form-action 'none'; "
    "base-uri 'none'; "
    "frame-ancestors 'self'"
)
"""Uploaded chart HTML (``GET /api/charts/{id}``): scripts run, but in an opaque origin with no
network at all. The iframe also sets ``sandbox="allow-scripts"`` (never ``allow-same-origin``)."""

CLIENT_HEADER: Final = "x-remi-client"
CLIENT_HEADER_VALUE: Final = "1"
SAFE_METHODS: Final = frozenset({"GET", "HEAD", "OPTIONS"})
DEV_ENVS: Final = frozenset({"dev", "test"})
LOOPBACK_NAMES: Final = ("127.0.0.1", "localhost", "[::1]")


def _host_literal(host: str) -> str:
    """``::1`` -> ``[::1]``: the form a Host or Origin header uses for IPv6."""
    bare = host.strip().strip("[]")
    return f"[{bare}]" if ":" in bare else bare


def allowed_hosts(config: RemiConfig) -> list[str]:
    """Host header values (without port) Remi answers to."""
    hosts = [*LOOPBACK_NAMES, _host_literal(config.host)]
    return list(dict.fromkeys(hosts))


def allowed_origins(config: RemiConfig) -> frozenset[str]:
    """``Origin`` values allowed on mutating ``/api`` calls."""
    ports = [config.port]
    if config.env in DEV_ENVS:
        ports.append(config.web_port)
    return frozenset(f"http://{host}:{port}" for host in allowed_hosts(config) for port in ports)


class MutationGuardMiddleware:
    """Rejects mutating ``/api`` requests without a loopback Origin and ``X-Remi-Client: 1``."""

    def __init__(self, app: ASGIApp, origins: Iterable[str]) -> None:
        self.app = app
        self.origins: Collection[str] = frozenset(origins)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or scope["method"] in SAFE_METHODS
            or not is_api_path(scope["path"])
        ):
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        origin = headers.get("origin")
        if origin is None or origin not in self.origins:
            response = JSONResponse(
                error_body(
                    "FORBIDDEN_ORIGIN",
                    "Changes must come from Remi itself (a loopback Origin on Remi's port).",
                ),
                status_code=403,
            )
            await response(scope, receive, send)
            return
        if headers.get(CLIENT_HEADER) != CLIENT_HEADER_VALUE:
            response = JSONResponse(
                error_body(
                    "CLIENT_HEADER_REQUIRED",
                    "Changes must carry the X-Remi-Client: 1 header.",
                ),
                status_code=403,
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


class SecurityHeadersMiddleware:
    """Adds the app CSP and hardening headers unless the response set its own CSP."""

    def __init__(self, app: ASGIApp, csp: str = APP_CSP) -> None:
        self.app = app
        self.csp = csp

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                if "content-security-policy" not in headers:
                    headers["Content-Security-Policy"] = self.csp
                headers.setdefault("X-Content-Type-Options", "nosniff")
                headers.setdefault("Referrer-Policy", "no-referrer")
                headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
            await send(message)

        await self.app(scope, receive, send_with_headers)


class UnexpectedErrorMiddleware:
    """Sends the 500 ``INTERNAL_ERROR`` envelope for an unhandled exception, from inside
    :class:`SecurityHeadersMiddleware` so the response carries the CSP and hardening headers.

    The exception is re-raised afterwards: ``ServerErrorMiddleware`` then runs the app's
    ``Exception`` handler (which logs) without sending a second response, and the server logs
    it too. If the response had already started, nothing more can be sent; it only re-raises.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def send_tracking(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, send_tracking)
        except Exception:
            if not started:
                await internal_error_response()(scope, receive, send)
            raise


def install_security(app: FastAPI, config: RemiConfig) -> None:
    """Add the guards. Starlette runs the last-added middleware first, so the order of a
    request is: security headers (outermost, so even rejections and 500s carry them) ->
    unexpected-error envelope -> Host check -> mutation guard -> the app."""
    app.add_middleware(MutationGuardMiddleware, origins=allowed_origins(config))
    app.add_middleware(
        TrustedHostMiddleware, allowed_hosts=allowed_hosts(config), www_redirect=False
    )
    app.add_middleware(UnexpectedErrorMiddleware)
    app.add_middleware(SecurityHeadersMiddleware, csp=APP_CSP)
