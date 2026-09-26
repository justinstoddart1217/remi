"""Remi inside APEX's process: the WSGI mount (docs/decisions/0014, docs/apex/IMPORT.md).

APEX makes one call when it builds its WSGI app::

    from remi.mount import mount
    app.wsgi_app = mount(app.wsgi_app)          # a Flask app: wrap its WSGI callable

The result dispatches on the path, in front of APEX:

* ``/remi`` redirects to ``/remi/``;
* ``/remi/...`` goes to Remi with the prefix removed: ``PATH_INFO`` without ``/remi`` and an
  empty ``SCRIPT_NAME``. That is the contract a path-stripping proxy gave Remi in ADR-0013 and
  that its tests cover (a2wsgi would otherwise turn ``SCRIPT_NAME`` into an ASGI ``root_path``);
* everything else goes to APEX, untouched.

Remi is its FastAPI app behind one ``a2wsgi.ASGIMiddleware``: one app and one SQLite engine,
shared by all of waitress's threads. a2wsgi sends no lifespan events, so the database is opened
here, at mount time (after a backup and any pending migration), and closed at exit.

Remi never takes APEX down. If it cannot start (a missing setting, a data folder it cannot
write, a database another process holds or a newer Remi wrote), the reason is logged once on
the ``remi.mount`` logger and ``/remi/...`` answers a plain 503 page that names it. A request
that fails inside Remi gets Remi's 500 envelope and never escapes into the server's worker.

Settings come from the environment, set by APEX's launch scripts:

* ``REMI_PUBLIC_URL`` (required): the address the browser uses, e.g.
  ``https://apex.ny1.ninetyone.com/remi``. Remi's ``<base href>``, router basename, API base and
  accepted Host and Origin follow from it.
* ``REMI_DATA_DIR`` (required): ``remi.db``, ``charts/`` and ``backups/``.
* ``REMI_FRONTEND_DIST``, ``REMI_ENV`` (``prod`` on the host): as for Remi on its own.
* ``PM_ASSISTANT_API_KEY``: passed to Remi as ``REMI_ANTHROPIC_API_KEY`` when that is unset,
  so the secret is not duplicated.
* ``APEX_REMI_ENABLED=0`` switches Remi off (``/remi/...`` then answers 503).
"""

import atexit
import logging
import os
import sys
from collections.abc import Callable, Iterable, Iterator, MutableMapping
from html import escape
from pathlib import Path
from typing import IO, TYPE_CHECKING, Any, Final, cast

from fastapi import FastAPI

log = logging.getLogger("remi.mount")

PREFIX: Final = "/remi"
ENABLE_VAR: Final = "APEX_REMI_ENABLED"
REQUIRED_VARS: Final = ("REMI_PUBLIC_URL", "REMI_DATA_DIR")
APEX_KEY_VAR: Final = "PM_ASSISTANT_API_KEY"
REMI_KEY_VAR: Final = "REMI_ANTHROPIC_API_KEY"
LOCK_FILE: Final = ".lock"
OFF_VALUES: Final = frozenset({"0", "false", "no", "off"})

if TYPE_CHECKING:
    # The standard WSGI types (PEP 3333, from typeshed), as Flask and waitress use them.
    from _typeshed.wsgi import StartResponse, WSGIApplication, WSGIEnvironment

_UNAVAILABLE_PAGE: Final = """<!doctype html>
<html lang="en-GB">
<head><meta charset="utf-8"><title>Remi is not available</title>
<style>body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#faf9f5;
color:#222;font:16px/1.5 'Segoe UI',Arial,sans-serif}}main{{max-width:36rem;padding:2rem}}
h1{{font-weight:500;font-size:1.4rem;margin:0 0 .75rem}}
code{{background:#eeece4;padding:.1rem .3rem}}
</style></head>
<body><main>
<h1>Remi is not available right now.</h1>
<p><code>{problem}</code></p>
<p>APEX itself is fine. The details are in APEX's log under <code>remi.mount</code>.
<a href="/">Back to APEX</a></p>
</main></body>
</html>
"""


class RemiUnavailable(RuntimeError):
    """Remi cannot start with this configuration (the message is shown on the 503 page)."""


class DataLock:
    """An exclusive lock on ``<data dir>/.lock``, held while this process serves Remi.

    SQLite is safe across threads of one process, but migrations are not safe across two
    processes (two APEX servers started on the same checkout). The second one refuses to mount.
    """

    def __init__(self, data_dir: Path) -> None:
        self.path = data_dir / LOCK_FILE
        handle: IO[bytes] = self.path.open("a+b")
        try:
            if sys.platform == "win32":
                import msvcrt

                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            handle.close()
            msg = f"another process already serves Remi's data folder ({self.path})"
            raise RemiUnavailable(msg) from error
        self._handle: IO[bytes] | None = handle

    def release(self) -> None:
        handle, self._handle = self._handle, None
        if handle is not None:
            handle.close()  # closing the file drops the lock on both platforms


class Mounted:
    """What :func:`mount` started: Remi's WSGI app, or the reason there is none."""

    def __init__(
        self,
        wsgi: "WSGIApplication | None" = None,
        problem: str | None = None,
        asgi: FastAPI | None = None,
        public_url: str = "",
        closers: tuple[Callable[[], None], ...] = (),
    ) -> None:
        self.wsgi = wsgi
        self.problem = problem
        self.asgi = asgi
        self.public_url = public_url
        self._closers = list(closers)

    @property
    def available(self) -> bool:
        return self.wsgi is not None

    def close(self) -> None:
        """Close the database and release the data lock (at exit; tests call it directly)."""
        while self._closers:
            closer = self._closers.pop()
            try:
                closer()
            except Exception:
                log.exception("Remi did not close cleanly")


_mounted: Mounted | None = None


def _switched_off(environ: MutableMapping[str, str]) -> bool:
    return environ.get(ENABLE_VAR, "1").strip().lower() in OFF_VALUES


def start(environ: MutableMapping[str, str] | None = None) -> Mounted:
    """Start Remi for mounting, or explain why not. Never raises."""
    env = os.environ if environ is None else environ
    if _switched_off(env):
        problem = f"Remi is switched off ({ENABLE_VAR}=0)."
        log.warning("%s /remi/ answers 503.", problem)
        return Mounted(problem=problem)
    try:
        return _build(env)
    except Exception as error:
        problem = (
            str(error) if isinstance(error, RemiUnavailable) else f"{type(error).__name__}: {error}"
        )
        log.exception("Remi could not start, so /remi/ answers 503: %s", problem)
        return Mounted(problem=problem)


def _build(env: MutableMapping[str, str]) -> Mounted:
    missing = [name for name in REQUIRED_VARS if not env.get(name, "").strip()]
    if missing:
        raise RemiUnavailable(f"{' and '.join(missing)} must be set when Remi is mounted in APEX.")
    if not env.get(REMI_KEY_VAR, "").strip() and env.get(APEX_KEY_VAR, "").strip():
        env[REMI_KEY_VAR] = env[APEX_KEY_VAR]

    # Imported here so that a broken Remi (or a missing dependency) only takes down /remi/.
    from a2wsgi import ASGIMiddleware

    from remi import __version__
    from remi.core.config import RemiConfig
    from remi.core.migrations import prepare_database
    from remi.core.paths import ensure_private_dir
    from remi.core.uow import UnitOfWorkFactory
    from remi.main import create_app

    cfg = RemiConfig()
    if cfg.env == "prod" and cfg.today is not None:
        raise RemiUnavailable("REMI_TODAY is for dev and test runs only; unset it on the host.")
    if cfg.network:
        log.warning("REMI_NETWORK has no effect when Remi is mounted in APEX.")

    ensure_private_dir(cfg.data_dir)
    lock = DataLock(cfg.data_dir)
    try:
        database = prepare_database(cfg.data_dir)
    except BaseException:
        lock.release()
        raise
    app = create_app(cfg)
    app.state.db = database
    app.state.uow_factory = UnitOfWorkFactory(database.session_factory, app.state.clock)
    mounted = Mounted(
        # a2wsgi's protocol types are narrower than Starlette's and PEP 3333's; both sides are
        # the standard ASGI and WSGI interfaces.
        wsgi=cast("WSGIApplication", ASGIMiddleware(cast("Any", app))),
        asgi=app,
        public_url=cfg.public_url,
        closers=(lock.release, database.close),
    )
    atexit.register(mounted.close)
    log.info("Remi %s mounted at %s/ (data in %s)", __version__, cfg.public_url, cfg.data_dir)
    return mounted


class PrefixDispatcher:
    """``/remi`` → redirect, ``/remi/...`` → Remi (prefix removed), anything else → APEX."""

    def __init__(self, apex: "WSGIApplication", remi: Mounted, prefix: str = PREFIX) -> None:
        self.apex = apex
        self.remi = remi
        self.prefix = prefix.rstrip("/")

    def __call__(
        self, environ: "WSGIEnvironment", start_response: "StartResponse"
    ) -> Iterable[bytes]:
        path = str(environ.get("PATH_INFO") or "")
        if path == self.prefix:
            return self._redirect(environ, start_response)
        if not path.startswith(f"{self.prefix}/"):
            return self.apex(environ, start_response)
        if self.remi.wsgi is None:
            return self._unavailable(start_response)
        inner = dict(environ)
        inner["PATH_INFO"] = path[len(self.prefix) :]
        inner["SCRIPT_NAME"] = ""
        return self._guarded(self.remi.wsgi, inner, start_response)

    def _redirect(
        self, environ: "WSGIEnvironment", start_response: "StartResponse"
    ) -> Iterable[bytes]:
        query = str(environ.get("QUERY_STRING") or "")
        location = f"{environ.get('SCRIPT_NAME') or ''}{self.prefix}/" + (
            f"?{query}" if query else ""
        )
        start_response(
            "302 Found",
            [("Location", location), ("Content-Length", "0"), ("Cache-Control", "no-store")],
        )
        return [b""]

    def _unavailable(self, start_response: "StartResponse") -> Iterable[bytes]:
        body = _UNAVAILABLE_PAGE.format(problem=escape(self.remi.problem or "unknown")).encode()
        start_response(
            "503 Service Unavailable",
            [
                ("Content-Type", "text/html; charset=utf-8"),
                ("Content-Length", str(len(body))),
                ("Cache-Control", "no-store"),
                ("Retry-After", "60"),
            ],
        )
        return [body]

    def _guarded(
        self, app: "WSGIApplication", environ: "WSGIEnvironment", start_response: "StartResponse"
    ) -> Iterator[bytes]:
        """Remi's response, with any exception kept away from the server's worker thread."""
        started = False

        def tracking(status: str, headers: list[tuple[str, str]], exc_info: Any = None) -> Any:
            nonlocal started
            started = True
            return start_response(status, headers, exc_info)

        body: Iterable[bytes] | None = None
        try:
            body = app(environ, tracking)
            yield from body
        except Exception:
            if started:
                # Remi already answered (its 500 envelope) and logged the error.
                log.warning("A Remi request failed after its response began", exc_info=True)
            else:
                log.exception("A Remi request failed")
                payload = (
                    b'{"error":{"code":"INTERNAL_ERROR","message":"Remi hit an unexpected '
                    b'error. It has been logged."}}'
                )
                start_response(
                    "500 Internal Server Error",
                    [("Content-Type", "application/json"), ("Content-Length", str(len(payload)))],
                    sys.exc_info(),
                )
                yield payload
        finally:
            close = getattr(body, "close", None)
            if callable(close):
                close()


def mount(apex: "WSGIApplication", prefix: str = PREFIX) -> "WSGIApplication":
    """Put Remi at ``prefix`` in front of APEX's WSGI app. Never raises (see :func:`start`)."""
    global _mounted
    _mounted = start()
    return PrefixDispatcher(apex, _mounted, prefix)


def status() -> str:
    """One line for APEX's startup banner."""
    if _mounted is None:
        return "Remi: not mounted"
    if _mounted.problem:
        return f"Remi: unavailable ({_mounted.problem})"
    from remi import __version__

    return f"Remi {__version__}: {_mounted.public_url}/"
