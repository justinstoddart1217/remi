# ADR-0001: Backend is Python 3.12 + FastAPI with a fixed package layout

- Status: Accepted
- Date: 2026-09-24
- Plan: binding decision 1

## Context
The prototype keeps every number in one in-browser `model`. Production needs a real database,
a real calendar and clock, and one place that owns the planning maths.

## Decision
- Python 3.12 (managed by `uv`; the system Python 3.9 is never used) and FastAPI, served by
  uvicorn. SQLite through SQLAlchemy 2.0 with Alembic migrations; Pydantic v2 DTOs in camelCase
  define the OpenAPI contract.
- `backend/app/` has exactly these top-level packages: `api/` (with `endpoints/`), `core/`,
  `schemas/`, `services/` (with the pure `engine/` and the pluggable `ai/`), `repositories/`
  (with `models/`) and `utils/`.
- `app.main.create_app(config, clock)` builds the app; both arguments are injectable for tests.
  The `remi` console script (`app.main:cli`) starts uvicorn on loopback and opens the browser.
- Quality gates: `ruff` (py312, line 100, E F I B UP SIM RUF S PTH DTZ) and `pyright --strict`
  over `app/` and `tests/`; `pytest` with `pytest-socket` limited to loopback.

## Consequences
- The server owns every number; the frontend only formats and lays out.
- `contracts/openapi.json` is generated from the app and committed; `make openapi-check` fails on drift.
- Starlette's test client uses `httpx2` (a dev dependency); runtime code keeps `httpx`.
