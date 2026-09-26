"""Remi backend: a local-only FastAPI service."""

import tomllib
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path


def _read_version() -> str:
    """``backend/pyproject.toml``'s version, which is the release version (``make release``).

    It is read first because a server bundle runs from its source tree without installing
    Remi, and an editable install's metadata keeps the version it was installed with.
    """
    pyproject = Path(__file__).resolve().parents[1] / "pyproject.toml"
    try:
        return str(tomllib.loads(pyproject.read_text(encoding="utf-8"))["project"]["version"])
    except (OSError, KeyError, TypeError, tomllib.TOMLDecodeError):
        pass
    try:
        return version("remi")
    except PackageNotFoundError:  # pragma: no cover - neither a source tree nor installed
        return "0.0.0+local"


__version__ = _read_version()

__all__ = ["__version__"]
