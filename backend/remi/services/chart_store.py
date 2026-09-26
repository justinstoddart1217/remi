"""The chart store: uploaded HTML charts, content-addressed on disk.

* A chart's file lives at ``<data>/charts/<h[:2]>/<h>.html`` where ``h`` is the SHA-256 of its
  bytes, so identical uploads share one file and one ``chart_assets`` row (deduplicated).
* Files are written atomically (temp file + ``os.replace``) *inside* the unit of work that adds
  the row, i.e. while that transaction holds SQLite's write lock. A file this command created is
  removed again if the unit of work rolls back (``after_rollback``).
* Nothing is deleted before commit. A file that must go is renamed to a ``.trash`` name inside
  the transaction, unlinked ``after_commit`` and renamed back ``after_rollback``, so a failed
  command never loses a chart and a concurrent upload of the same bytes can never have its new
  file removed by an older delete.
* Garbage collection (:func:`collect_garbage`) runs ``after_commit`` of commands that may have
  dropped the last reference to an asset (block autosave, page delete, uploads, fixtures). An
  unreferenced asset is removed when it was uploaded more than :data:`GC_GRACE` ago, or at once
  when the command just dropped it and it has not been uploaded again since the dropping page
  last saved it. An upload answer is a promise: the editor puts its ``assetId`` into a block
  on its next autosave, so a fresh (re-)upload always gets the full grace period, even if a
  save that removes an older block with the same (deduplicated) asset commits first. Stray
  files with no row are swept too.
* ``GET /api/charts/{id}`` (:func:`read_chart`) serves the bytes; the route adds the strict
  sandbox CSP (``remi.api.middleware.CHART_CSP``).
"""

import hashlib
import logging
import os
import re
import tempfile
import time
import unicodedata
from collections.abc import Collection, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path, PurePosixPath
from typing import Final
from urllib.parse import urlsplit
from uuid import uuid4

from remi.core.errors import Conflict, DomainError, NotFound, ValidationFailed
from remi.core.paths import charts_dir, ensure_private_dir, make_private_file
from remi.core.uow import UnitOfWork, UnitOfWorkFactory, ref
from remi.repositories import models as orm
from remi.repositories.registry import CHART_ASSETS
from remi.schemas.textbook import ChartUploadOut

logger = logging.getLogger(__name__)

HTML_SUFFIXES: Final = (".html", ".htm")
DEFAULT_CHART_NAME: Final = "chart.html"
GC_GRACE: Final = timedelta(hours=1)
"""How long an upload that no block uses yet is kept (the editor autosaves within 350 ms)."""
STALE_TEMP_SECONDS: Final = 3600.0
"""Leftover temp and trash files (from a crash) older than this are swept by the GC."""
MAX_NAME_CHARS: Final = 255
MAX_WARNED_HOSTS: Final = 3

_HEX64: Final = re.compile(r"^[0-9a-f]{64}$")
_CHART_FILE: Final = re.compile(r"^([0-9a-f]{64})\.html$")
_WEB_URL: Final = re.compile(r"https?://[^\s\"'<>()\\`]+", re.IGNORECASE)
_HOST: Final = r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+"
_PROTOCOL_RELATIVE: Final = re.compile(
    # ``src="//cdn…"``, ``url(//fonts…)``, ``@import '//…'``, or a quoted ``'//host/…'`` in a
    # script. The ``//`` must open a quoted string, a ``url(`` or an unquoted attribute value,
    # so JavaScript ``// comments`` are not mistaken for URLs.
    r"(?:[\"'`]|\burl\(\s*[\"']?|=\s*)//(" + _HOST + r")(?::\d+)?(?=[/?#\"'`)\s>]|$)",
    re.IGNORECASE,
)
_XML_NAMESPACE_HOSTS: Final = frozenset({"www.w3.org"})
"""SVG/XHTML namespace URIs (``createElementNS``, ``xmlns``) are names, not requests."""
_TEMP_PREFIX: Final = ".chart-"
_TRASH_SUFFIX: Final = ".trash"


# ---------------------------------------------------------------------------- errors
class UnsupportedChartType(DomainError):
    def __init__(self, message: str) -> None:
        super().__init__("UNSUPPORTED_MEDIA_TYPE", message, "file", 415)


class ChartTooLarge(DomainError):
    def __init__(self, message: str) -> None:
        super().__init__("PAYLOAD_TOO_LARGE", message, "file", 413)


# ---------------------------------------------------------------------------- paths and files
@dataclass(frozen=True, slots=True)
class StoredChart:
    """What :func:`store_file` wrote (or found already stored)."""

    content_hash: str
    storage_relpath: str
    size_bytes: int
    created: bool
    """``True`` when this call wrote the file (``False``: identical bytes were on disk)."""


def content_hash(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def relpath_for(digest: str) -> str:
    """``charts/<h[:2]>/<h>.html``: the file's path relative to the data dir."""
    if not _HEX64.match(digest):
        msg = f"not a sha256 hex digest: {digest!r}"
        raise ValueError(msg)
    return f"charts/{digest[:2]}/{digest}.html"


def resolve_file(data_dir: Path, storage_relpath: str) -> Path | None:
    """The absolute path of a stored chart, or ``None`` if ``storage_relpath`` would leave the
    charts folder (the path comes from the database, but it is checked anyway)."""
    rel = PurePosixPath(storage_relpath)
    if rel.is_absolute() or any(part in {"", ".", ".."} for part in rel.parts):
        return None
    root = charts_dir(data_dir).resolve()
    candidate = (data_dir / rel).resolve()
    if not candidate.is_relative_to(root) or candidate == root:
        return None
    return candidate


def _atomic_write(target: Path, body: bytes) -> None:
    fd, tmp_name = tempfile.mkstemp(dir=target.parent, prefix=_TEMP_PREFIX, suffix=".tmp")
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
        tmp.replace(target)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    make_private_file(target)


def _holds(path: Path, digest: str) -> bool:
    try:
        return content_hash(path.read_bytes()) == digest
    except OSError:
        return False


def store_file(uow: UnitOfWork, data_dir: Path, body: bytes) -> StoredChart:
    """Write ``body`` content-addressed under ``<data>/charts`` inside ``uow``.

    Call it while ``uow`` is active (so the write lock is held). A file this call wrote is
    removed again if the unit of work rolls back. An existing file is reused only if its bytes
    really hash to its name; otherwise it is rewritten.
    """
    digest = content_hash(body)
    relpath = relpath_for(digest)
    # ``charts/`` itself is tightened too (an older run may have left it at the umask's 0755).
    ensure_private_dir(charts_dir(data_dir))
    folder = ensure_private_dir(charts_dir(data_dir) / digest[:2])
    target = folder / f"{digest}.html"
    if target.is_file() and _holds(target, digest):
        return StoredChart(digest, relpath, len(body), created=False)
    _atomic_write(target, body)
    uow.after_rollback(lambda: target.unlink(missing_ok=True))
    return StoredChart(digest, relpath, len(body), created=True)


def trash_file(uow: UnitOfWork, path: Path) -> None:
    """Remove ``path`` when ``uow`` commits; keep it if it rolls back.

    The file is renamed out of the way now (inside the transaction), unlinked after commit and
    renamed back after a rollback.
    """
    if not path.exists():
        return
    parked = path.with_name(f"{path.name}.{uuid4().hex}{_TRASH_SUFFIX}")
    path.replace(parked)
    uow.after_commit(lambda: parked.unlink(missing_ok=True))

    def restore() -> None:
        if parked.exists() and not path.exists():
            parked.replace(path)
        else:
            parked.unlink(missing_ok=True)

    uow.after_rollback(restore)


# ---------------------------------------------------------------------------- upload checks
def clean_name(filename: str | None) -> str:
    """The uploaded file's base name, without folders or control characters."""
    raw = (filename or "").replace("\\", "/")
    base = PurePosixPath(raw).name if raw else ""
    base = "".join(ch for ch in base if unicodedata.category(ch)[0] != "C").strip()
    return base[:MAX_NAME_CHARS] or DEFAULT_CHART_NAME


def is_html_name(name: str) -> bool:
    return name.lower().endswith(HTML_SUFFIXES)


def web_hosts(html: str) -> list[str]:
    """Hosts the chart loads from: ``http(s)://`` URLs and protocol-relative ``//host/…``
    references (which resolve to the web too), in order of appearance. XML namespace URIs
    (``http://www.w3.org/…``) are excluded."""
    found: list[tuple[int, str]] = []
    for match in _WEB_URL.finditer(html):
        url = match.group(0)
        found.append((match.start(), urlsplit(url).hostname or url))
    for match in _PROTOCOL_RELATIVE.finditer(html):
        found.append((match.start(1), match.group(1).lower()))
    hosts: list[str] = []
    for _, host in sorted(found):
        if host not in _XML_NAMESPACE_HOSTS and host not in hosts:
            hosts.append(host)
    return hosts


def upload_warnings(name: str, html: str) -> list[str]:
    hosts = web_hosts(html)
    if not hosts:
        return []
    shown = ", ".join(hosts[:MAX_WARNED_HOSTS])
    if len(hosts) > MAX_WARNED_HOSTS:
        shown += f" and {len(hosts) - MAX_WARNED_HOSTS} more"
    return [
        f"{name} loads from the web ({shown}). Charts run offline, "
        "so anything it fetches from there will be missing."
    ]


def too_large(name: str, max_bytes: int) -> ChartTooLarge:
    """The 413 for an upload over ``max_bytes`` ("x.html is over 4 MB; …")."""
    limit_mb = max_bytes / (1024 * 1024)
    shown = f"{limit_mb:g} MB" if limit_mb >= 1 else f"{max_bytes} bytes"
    return ChartTooLarge(f"{name} is over {shown}; charts that large cannot be saved.")


def check_upload(name: str, body: bytes, max_bytes: int) -> str:
    """Validate an upload and return its text. Raises 415, 413 or 422."""
    if not is_html_name(name):
        raise UnsupportedChartType("Only HTML files become live charts.")
    if len(body) > max_bytes:
        raise too_large(name, max_bytes)
    if not body.strip():
        raise ValidationFailed(f"{name} is empty.", "file")
    try:
        return body.decode("utf-8")
    except UnicodeDecodeError:
        raise UnsupportedChartType(f"{name} is not UTF-8 text.") from None


# ---------------------------------------------------------------------------- commands
def upload_chart(
    uow_factory: UnitOfWorkFactory,
    data_dir: Path,
    *,
    filename: str | None,
    body: bytes,
    max_bytes: int,
) -> ChartUploadOut:
    """``POST /textbook/charts``: store an HTML chart (deduplicated by content hash)."""
    name = clean_name(filename)
    html = check_upload(name, body, max_bytes)
    warnings = upload_warnings(name, html)
    with uow_factory() as uow:
        assets = uow.repo(CHART_ASSETS)
        now = uow.clock.now()
        stored = store_file(uow, data_dir, body)
        asset = assets.get_by_hash(stored.content_hash)
        deduplicated = asset is not None
        if asset is None:
            asset = assets.add(
                orm.ChartAsset(
                    content_hash=stored.content_hash,
                    filename=name,
                    size_bytes=stored.size_bytes,
                    storage_relpath=stored.storage_relpath,
                    uploaded_at=now,
                )
            )
        else:
            # A re-upload counts as fresh: the GC grace period starts again.
            asset.uploaded_at = now
            asset.storage_relpath = stored.storage_relpath
        uow.record(
            "textbook.chart_uploaded",
            [ref("chart_asset", asset.id)],
            {
                "assetId": asset.id,
                "name": name,
                "sizeBytes": stored.size_bytes,
                "contentHash": stored.content_hash,
                "deduplicated": deduplicated,
            },
        )
        schedule_gc(uow, uow_factory, data_dir)
        out = ChartUploadOut(
            asset_id=asset.id,
            name=name,
            size_bytes=stored.size_bytes,
            content_hash=stored.content_hash,
            deduplicated=deduplicated,
            warnings=warnings,
        )
    return out


def delete_chart(uow_factory: UnitOfWorkFactory, data_dir: Path, asset_id: str) -> None:
    """``DELETE /textbook/charts/{id}``: only while no block uses it (409 otherwise)."""
    with uow_factory() as uow:
        assets = uow.repo(CHART_ASSETS)
        asset = assets.get(asset_id)
        if asset is None:
            raise NotFound("No such chart.", "assetId")
        if assets.is_referenced(asset_id):
            raise Conflict("A chart block still shows this chart; remove the block first.")
        path = resolve_file(data_dir, asset.storage_relpath)
        assets.delete(asset)
        uow.session.flush()
        if path is not None:
            trash_file(uow, path)
        uow.record("textbook.chart_deleted", [ref("chart_asset", asset_id)], {"assetId": asset_id})


@dataclass(frozen=True, slots=True)
class ChartContent:
    body: bytes
    etag: str


def read_chart(uow_factory: UnitOfWorkFactory, data_dir: Path, asset_id: str) -> ChartContent:
    """The stored HTML of ``asset_id`` (404 when the asset or its file is gone)."""
    with uow_factory.read() as uow:
        asset = uow.repo(CHART_ASSETS).get(asset_id)
        relpath = asset.storage_relpath if asset is not None else None
        digest = asset.content_hash if asset is not None else ""
    path = resolve_file(data_dir, relpath) if relpath is not None else None
    if path is None:
        raise NotFound("No such chart.", "assetId")
    try:
        body = path.read_bytes()
    except OSError:
        raise NotFound("This chart's file is missing.", "assetId") from None
    return ChartContent(body=body, etag=f'"{digest}"')


# ---------------------------------------------------------------------------- garbage collection
def schedule_gc(
    uow: UnitOfWork,
    uow_factory: UnitOfWorkFactory,
    data_dir: Path,
    dropped: Mapping[str, datetime] | None = None,
) -> None:
    """Run :func:`collect_garbage` once ``uow`` has committed.

    ``dropped`` maps each asset id the command stopped using to when the dropped reference was
    last saved: the ``blocks_saved_at`` of the page that held it, before this command (never
    later than the command's own ``clock.now()``; a rename does not move it). Such an asset
    goes at once if nothing else uses it and it was not uploaded after that time; otherwise it
    waits for :data:`GC_GRACE`, like any other unreferenced asset.
    """
    candidates = dict(dropped or {})

    def run() -> None:
        collect_garbage(uow_factory, data_dir, dropped=candidates)

    uow.after_commit(run)


def _due(asset: orm.ChartAsset, dropped: Mapping[str, datetime], cutoff: datetime) -> bool:
    """Whether an unreferenced ``asset`` is collected now.

    A (re-)upload newer than the drop is an answer the editor may still be about to use, so it
    keeps the asset for the full grace period.
    """
    if asset.uploaded_at <= cutoff:
        return True
    saved_at = dropped.get(asset.id)
    return saved_at is not None and asset.uploaded_at <= saved_at


def _stray_files(data_dir: Path, known: Collection[str]) -> list[Path]:
    """Chart files with no ``chart_assets`` row, plus stale temp and trash leftovers."""
    root = charts_dir(data_dir)
    if not root.is_dir():
        return []
    stray: list[Path] = []
    cutoff = time.time() - STALE_TEMP_SECONDS
    for folder in root.iterdir():
        if not folder.is_dir() or not re.fullmatch(r"[0-9a-f]{2}", folder.name):
            continue
        for path in folder.iterdir():
            if not path.is_file():
                continue
            match = _CHART_FILE.match(path.name)
            if match is not None:
                if match.group(1)[:2] == folder.name and relpath_for(match.group(1)) not in known:
                    stray.append(path)
            elif path.name.startswith(_TEMP_PREFIX) or path.name.endswith(_TRASH_SUFFIX):
                # A rename updates ctime, so a file parked a moment ago is never "stale".
                try:
                    info = path.stat()
                except OSError:
                    continue
                if max(info.st_mtime, info.st_ctime) < cutoff:
                    stray.append(path)
    return stray


def collect_garbage(
    uow_factory: UnitOfWorkFactory,
    data_dir: Path,
    *,
    dropped: Mapping[str, datetime] | None = None,
    grace: timedelta = GC_GRACE,
) -> list[str]:
    """Delete unreferenced chart assets and stray chart files. Returns the deleted asset ids.

    An unreferenced asset goes if it was uploaded more than ``grace`` ago, or if it is in
    ``dropped`` and was not uploaded after its drop time (see :func:`schedule_gc`). The
    decision is re-checked inside a write unit of work, so an upload that commits in between
    (and refreshes ``uploaded_at``) keeps its asset. That unit of work records one
    ``textbook.charts_collected`` event (actor ``system``) when rows are deleted.
    """
    dropped = dropped or {}
    with uow_factory.read() as uow:
        assets = uow.repo(CHART_ASSETS)
        cutoff = uow.clock.now() - grace
        due = [a.id for a in assets.unreferenced() if _due(a, dropped, cutoff)]
        known = assets.storage_relpaths()
    stray = _stray_files(data_dir, known)
    if not due and not stray:
        return []

    collected: list[str] = []
    with uow_factory("system") as uow:
        assets = uow.repo(CHART_ASSETS)
        cutoff = uow.clock.now() - grace
        for asset in assets.unreferenced():
            if not _due(asset, dropped, cutoff):
                continue
            path = resolve_file(data_dir, asset.storage_relpath)
            assets.delete(asset)
            if path is not None:
                trash_file(uow, path)
            collected.append(asset.id)
        uow.session.flush()
        known = assets.storage_relpaths()
        for path in _stray_files(data_dir, known):
            if path.name.endswith(_TRASH_SUFFIX) or path.name.startswith(_TEMP_PREFIX):
                uow.after_commit(lambda p=path: p.unlink(missing_ok=True))
            else:
                trash_file(uow, path)
        if collected:
            uow.record(
                "textbook.charts_collected",
                [ref("chart_asset", asset_id) for asset_id in collected],
                {"assetIds": collected},
            )
    if collected:
        logger.info("collected %d unreferenced chart(s)", len(collected))
    return collected
