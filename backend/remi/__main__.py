"""``python -m remi``: the same command as ``remi`` (``remi.main.cli``).

``python -m remi db path|upgrade|backup`` manages the database and needs no uvicorn, so it works
with APEX's venv (docs/apex/IMPORT.md); ``python -m remi`` on its own serves Remi and needs the
``serve`` extra.
"""

from remi.main import cli

if __name__ == "__main__":  # pragma: no cover
    cli()
