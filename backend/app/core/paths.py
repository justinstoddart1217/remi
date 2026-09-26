"""Filesystem locations.

Remi keeps everything it owns under one per-user data directory
(``~/Library/Application Support/Remi/`` on macOS): ``remi.db``, ``charts/`` and ``backups/``.
The functions that only compute a path never create anything; :func:`ensure_private_dir` and
:func:`make_private_file` create directories (0700) and tighten files (0600) when first written.
"""

import os
from pathlib import Path

from platformdirs import user_data_dir

APP_NAME = "Remi"
PRIVATE_DIR_MODE = 0o700
PRIVATE_FILE_MODE = 0o600


def default_data_dir() -> Path:
    """The per-user data directory, e.g. ``~/Library/Application Support/Remi``."""
    return Path(user_data_dir(APP_NAME, appauthor=False))


def db_path(data_dir: Path) -> Path:
    return data_dir / "remi.db"


def charts_dir(data_dir: Path) -> Path:
    return data_dir / "charts"


def backups_dir(data_dir: Path) -> Path:
    return data_dir / "backups"


def backend_root() -> Path:
    """The ``backend/`` directory of the source checkout."""
    return Path(__file__).resolve().parents[2]


def alembic_dir() -> Path:
    """Alembic's script location (``backend/alembic``)."""
    return backend_root() / "alembic"


def alembic_ini() -> Path:
    return backend_root() / "alembic.ini"


def repo_root() -> Path:
    """The repository root (``remi/``) when running from a source checkout."""
    return Path(__file__).resolve().parents[3]


def default_frontend_dist() -> Path:
    """The built SPA served by ``make serve`` (``frontend/dist``)."""
    return repo_root() / "frontend" / "dist"


def ensure_private_dir(path: Path) -> Path:
    """Create ``path`` (and parents) if needed and make it owner-only (0700).

    Every directory this call creates is 0700, parents included (``mkdir``'s ``mode`` does not
    reach the parents it creates, which get the umask default, typically 0755). ``path`` itself
    is tightened even when it already existed; ancestors that already existed are left alone.
    """
    missing: list[Path] = []
    current = path
    while not current.exists() and current != current.parent:
        missing.append(current)
        current = current.parent
    for directory in reversed(missing):
        directory.mkdir(mode=PRIVATE_DIR_MODE, exist_ok=True)
        if os.name == "posix":
            directory.chmod(PRIVATE_DIR_MODE)
    path.mkdir(mode=PRIVATE_DIR_MODE, parents=True, exist_ok=True)
    if os.name == "posix":
        path.chmod(PRIVATE_DIR_MODE)
    return path


def make_private_file(path: Path) -> None:
    """Make an existing file owner-read/write only (0600). Missing files are ignored."""
    if os.name == "posix" and path.exists():
        path.chmod(PRIVATE_FILE_MODE)
