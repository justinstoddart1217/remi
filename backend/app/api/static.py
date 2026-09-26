"""Production serving: the built SPA (``frontend/dist``) from the same process as the API.

``install_static(app, dist)`` makes :class:`SpaFiles` the app router's *default* handler, the
one Starlette calls when no route matched. So every route (``/api``, and any route a test or
later code adds) always wins, and only unmatched ``GET``/``HEAD`` requests reach the SPA:

* ``/assets/*``: hashed build output, ``Cache-Control: public, max-age=31536000, immutable``.
  A missing asset is a 404, never ``index.html``.
* A file that exists at the top of ``dist`` (``/favicon.svg``): served, revalidated each time.
* Anything else (``/``, ``/app/today``, ``/textbook/p1``): ``index.html`` with ``no-cache``,
  so client-side routes survive a reload. It always starts its ``<head>`` with
  ``<base href="{base_path}/">`` (``/`` unless Remi sits behind a proxy under ``REMI_PUBLIC_URL``,
  docs/decisions/0013): the build's asset links are relative, and the frontend takes its router
  basename and API address from ``document.baseURI``, so one build serves any prefix.

Never the SPA: ``/api/*`` (the JSON 404 envelope), ``/charts/*`` (charts are only served from
``/api/charts/{id}`` with their own CSP) and the CDN-backed documentation pages FastAPI would
otherwise offer (``/docs``, ``/redoc``), which stay plain 404s. Paths with ``..``, hidden
segments, backslashes or NUL never map to a file, and every file is checked to resolve inside
``dist`` (symlinks included). If ``dist/index.html`` is missing, non-API pages get a 503 that
says how to build the app; the API keeps working.
"""

import re
from html import escape
from pathlib import Path, PurePosixPath
from typing import Final

from fastapi import FastAPI
from starlette.responses import FileResponse, HTMLResponse, Response
from starlette.types import ASGIApp, Receive, Scope, Send

from app.api.errors import is_api_path

IMMUTABLE: Final = "public, max-age=31536000, immutable"
REVALIDATE: Final = "no-cache"
ASSETS_DIR: Final = "assets"
INDEX: Final = "index.html"
NEVER_SPA: Final = frozenset({"charts", "docs", "redoc"})
"""First path segments the SPA never answers (plain 404 instead)."""
_READ_METHODS: Final = frozenset({"GET", "HEAD"})
_BASE_TAG: Final = re.compile(rb"<base\b[^>]*>[ \t]*\r?\n?", re.IGNORECASE)
_HEAD_OPEN: Final = re.compile(rb"<head\b[^>]*>", re.IGNORECASE)
_DOCTYPE: Final = re.compile(rb"^\s*<!doctype[^>]*>", re.IGNORECASE)

_NOT_BUILT: Final = """<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>Remi is not built yet</title>
<style>
body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f3ee;
color:#211c17;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif}}
main{{max-width:34rem;padding:2rem}}
h1{{font-weight:500;font-size:1.5rem;margin:0 0 .75rem}}
code{{font:14px ui-monospace,Menlo,monospace;background:#ebe5dc;padding:.1rem .3rem;
border-radius:3px}}
</style>
</head>
<body>
<main>
<h1>Remi's web app has not been built.</h1>
<p>Run <code>make build</code> (or <code>npm run build</code> in <code>frontend/</code>),
then reload this page. The server looked for <code>{index}</code>.</p>
<p>The API is running: <code>/api/health</code>.</p>
</main>
</body>
</html>
"""


def _route_path(scope: Scope) -> str:
    """The request path below the app's ``root_path`` (Remi is normally mounted at ``/``)."""
    path = str(scope["path"])
    root = str(scope.get("root_path", ""))
    if root and path.startswith(root + "/"):
        return path[len(root) :]
    return path


def with_base(html: bytes, base_path: str) -> bytes:
    """``html`` with ``<base href="{base_path}/">`` as the first thing in its ``<head>``.

    Any ``<base>`` already there (the build ships ``<base href="/">`` so ``vite preview`` works)
    is replaced: a document uses only its first. Without a ``<head>`` tag the element goes right
    after the doctype, which is where the parser's implied head begins.
    """
    tag = f'<base href="{escape(base_path + "/", quote=True)}">'.encode()
    body = _BASE_TAG.sub(b"", html)
    at = _HEAD_OPEN.search(body) or _DOCTYPE.search(body)
    if at is None:
        return tag + body
    return body[: at.end()] + tag + body[at.end() :]


def safe_file(root: Path, relative: str) -> Path | None:
    """The file ``relative`` names inside ``root``, or ``None``.

    ``None`` for anything that is not a plain existing file strictly inside ``root``: ``..``
    or hidden segments, backslashes, NUL, absolute paths, and symlinks that lead outside.
    """
    if not relative or "\x00" in relative or "\\" in relative:
        return None
    rel = PurePosixPath(relative)
    if rel.is_absolute() or any(part.startswith(".") for part in rel.parts):
        return None
    try:
        base = root.resolve(strict=True)
        candidate = (base / rel).resolve(strict=True)
    except (OSError, RuntimeError):
        return None
    if candidate == base or not candidate.is_relative_to(base) or not candidate.is_file():
        return None
    return candidate


class SpaFiles:
    """The router's fallback: the built SPA for unmatched ``GET``/``HEAD`` requests."""

    def __init__(self, dist: Path, fallback: ASGIApp, base_path: str = "") -> None:
        self.dist = dist
        self.fallback = fallback
        self.base_path = base_path

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        response = self.response_for(scope)
        if response is None:
            await self.fallback(scope, receive, send)
            return
        await response(scope, receive, send)

    def response_for(self, scope: Scope) -> Response | None:
        """The SPA's answer, or ``None`` to let the default 404 handling answer."""
        if scope["type"] != "http" or scope["method"] not in _READ_METHODS:
            return None
        path = _route_path(scope)
        if is_api_path(path):
            return None
        relative = path.lstrip("/")
        first = relative.split("/", 1)[0]
        if first in NEVER_SPA:
            return None
        index = safe_file(self.dist, INDEX)
        if index is None:
            return self.not_built()
        if first == ASSETS_DIR:
            asset = safe_file(self.dist, relative)
            if asset is None:
                return None
            return FileResponse(asset, headers={"Cache-Control": IMMUTABLE})
        found = safe_file(self.dist, relative) if relative else None
        if found is not None and found != index:
            return FileResponse(found, headers={"Cache-Control": REVALIDATE})
        return self.index_page(index, head_only=scope["method"] == "HEAD")

    def index_page(self, index: Path, head_only: bool) -> Response:
        """``index.html`` with this server's ``<base href>`` (see :func:`with_base`)."""
        try:
            page = with_base(index.read_bytes(), self.base_path)
        except OSError:
            return self.not_built()
        headers = {"Cache-Control": REVALIDATE, "Content-Length": str(len(page))}
        return Response(
            b"" if head_only else page, media_type="text/html; charset=utf-8", headers=headers
        )

    def not_built(self) -> Response:
        body = _NOT_BUILT.format(index=escape(str(self.dist / INDEX)))
        return HTMLResponse(body, status_code=503, headers={"Cache-Control": "no-store"})


def install_static(app: FastAPI, dist: Path, base_path: str = "") -> None:
    """Serve ``dist`` as the SPA for every request no route answers, its pages based at
    ``base_path`` (``""``: the root; ``/remi`` behind a proxy). Idempotent."""
    current = app.router.default
    if isinstance(current, SpaFiles):
        current.dist = dist
        current.base_path = base_path
        return
    app.router.default = SpaFiles(dist, current, base_path)
