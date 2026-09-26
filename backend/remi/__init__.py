"""Remi: a planning companion (FastAPI backend), mounted inside APEX at /remi/ (remi.mount)."""

__version__ = "0.4.0"
"""The release. A literal (docs/apex/INTEGRATION_REQUIREMENTS.md R-13): inside APEX there is no
pyproject beside the package to read it from. Bump it together with ``backend/pyproject.toml``;
a test keeps the two equal while both exist."""

__all__ = ["__version__"]
