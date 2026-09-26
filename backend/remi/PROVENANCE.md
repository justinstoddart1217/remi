# Provenance of `backend/remi`

APEX's copy of Remi comes from one tagged commit (docs/remi/INTEGRATION_REQUIREMENTS.md
R-01). This is the merge base for any later hand re-sync. After the import, APEX's copy is the
source of truth, and the original repository is frozen (D1a).

| | |
|---|---|
| Repository | `justinstoddart1217/remi` (GitHub, private) |
| Tag | `v0.4.0` |
| Commit | _fill in at copy time: `git rev-parse v0.4.0`_ |
| Copied into APEX on | _fill in_ |
| Copied by | _fill in_ |

## What came across

- `backend/remi/` → `backend/remi/`
- `frontend/remi/` → `frontend/remi/`
- `contracts/remi-openapi.json` → `contracts/remi-openapi.json`
- `docs/decisions/` → `docs/remi/decisions/`
- `docs/apex/` → `docs/remi/`

The steps are in `docs/remi/IMPORT.md`.

## Deliberate changes made for APEX before the copy (Remi 0.3.0 → 0.4.0)

All of them are in Remi's history between `v0.3.0` and `v0.4.0`. The reasons are in
`docs/remi/decisions/0014-mounted-inside-apex.md`.

1. **The rename (R-11), in a commit of its own:** the package `app` became `remi`, with every
   import following.
2. **APEX's layout (§4):**
   - the migrations (`remi/alembic`, with no `alembic.ini`), tests, golden data, sample seed
     (`remi/fixtures`) and scripts moved inside the package;
   - `frontend/` became `frontend/remi/`;
   - the contract became `contracts/remi-openapi.json`.
3. **Python 3.11 (R-10):**
   - 13 uses of PEP 695 syntax were backported to `TypeVar` / `Generic` / `TypeAlias`;
   - `__version__` became a literal (R-13);
   - uvicorn is imported only when Remi serves itself (R-15);
   - pinned dependencies (R-20);
   - no `keyring` (R-22);
   - the test rules were scoped in `tests/conftest.py` (R-60);
   - the ruff and pyright config moved into the package (R-62).
4. **`mount.py`, new (R-30 to R-36, R-44, R-50):** Remi is mounted in APEX's WSGI process through
   a2wsgi. The tests are in `tests/mount/`.
5. **The front end:** "‹ APEX" appears when mounted (R-76), and `engines.node` is the
   toolchain's real floor. `e2e/run.mjs` holds the browser checks without Playwright (R-63).
6. **Dropped:** the sidecar pipeline (Windows scripts, release workflow, bundle builder).
   The parity harness stays in Remi's repository.

## Changes made during the copy

_None expected. List any here._
