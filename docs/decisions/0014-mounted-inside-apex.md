# ADR-0014: Remi mounted inside APEX

- Status: accepted, 2026-09-26 (release 0.4.0, the import source)
- Supersedes, for deployment: [ADR-0012](0012-apex-server-bundle.md) (the Windows sidecar) and
  [ADR-0013](0013-behind-apex-iis.md) (the sidecar behind IIS). Their `REMI_PUBLIC_URL`,
  `<base href>` and Host and Origin rules stay; the mount builds on them.
- Source of the requirements: the APEX team's
  [`docs/apex/INTEGRATION_REQUIREMENTS.md`](../apex/INTEGRATION_REQUIREMENTS.md) (R-xx below)

## Context

The sidecar asked too much of the APEX host: its own service, a GitHub token, an installer and
an IIS rule. The user chose instead to copy Remi into the APEX repository **once**, and to
develop it there afterwards (D1a). The APEX team recommended mounting Remi inside APEX's waitress
process, keeping Remi's stack (§3.1).

The user chose:
- adapt Remi to APEX's runtime, keeping FastAPI, TypeScript and every test;
- keep the Anthropic provider on SDK 1.8, with APEX upgrading its shared SDK (D4a).

## Decision

Everything that can be done before the copy is done in this repository, so the import is a copy
plus paste-ready edits ([`docs/apex/IMPORT.md`](../apex/IMPORT.md)).

- **APEX's layout (§4).** The package is `backend/remi` (renamed from `app`, R-11), with its
  migrations (`remi/alembic`, R-14), sample seed (`remi/fixtures`), tests, golden data and
  scripts inside it. The front end is its own npm project at `frontend/remi` (R-70), and the
  contract is `contracts/remi-openapi.json` (R-64). The path helpers are package- or
  layout-relative, so they resolve the same way in both repositories.
- **Python 3.11 (R-10, D2a).**
  - The 13 uses of 3.12-only syntax are backported to `TypeVar` / `Generic` / `TypeAlias`.
  - The full suite (1,317 tests) passes on 3.11.16.
  - `__version__` is a literal (R-13).
  - uvicorn is imported only when Remi serves itself (R-15); `python -m remi db ...` needs none.
- **Dependencies (R-20, R-22).** They are pinned to APEX's versions, plus `a2wsgi==1.10.10`, with
  `anthropic==1.8.0` optional. `keyring` is no longer a dependency: the key comes from the
  environment.
- **The mount (R-30 to R-36, R-44, R-50).** `remi.mount.mount(app.wsgi_app)` is a path-strip
  dispatcher in front of APEX's WSGI app.
  - `/remi` goes to `/remi/` with a 302.
  - `/remi/...` reaches Remi with `PATH_INFO` minus the prefix and an empty `SCRIPT_NAME`, which
    is the contract of ADR-0013 (Werkzeug's `DispatcherMiddleware` would move the prefix into
    a2wsgi's `root_path`).
  - Everything else goes to APEX untouched.
  - Remi is one FastAPI app behind one `a2wsgi.ASGIMiddleware`, shared by all of waitress's
    threads.
  - At mount time:
    - It requires `REMI_PUBLIC_URL` and `REMI_DATA_DIR`, and refuses `REMI_TODAY` in prod.
    - It hands `PM_ASSISTANT_API_KEY` to Remi when Remi's own key is unset.
    - It takes an exclusive lock on the data folder.
    - It prepares and opens the database. a2wsgi sends no lifespan events, so this happens here.
  - `APEX_REMI_ENABLED=0` turns it off. `status()` gives APEX's banner its line.
- **Failure isolation (R-33).**
  - A failure at mount time is logged once on `remi.mount`, and `/remi/...` answers a 503 page
    naming it, while APEX serves as before.
  - An exception inside a Remi request never reaches waitress's worker.
- **Security, unchanged in substance (R-51 to R-54).** Remi's TrustedHost, Origin + `X-Remi-Client`
  and CSP middlewares wrap Remi's routes only. Chart HTML keeps its sandbox CSP on APEX's origin,
  which matters more there, because APEX's `/api/pm/*` has no auth. Tests prove each rule
  through the mount.
- **Front end (R-71 to R-76).**
  - The runtime `<base href>` from 0.3.0 does the rest.
  - "‹ APEX" appears in the top bar and on Home when Remi is mounted.
  - `engines.node` is the toolchain's real floor (`^20.19 || ^22.13 || >=24`), checked on each.
- **Tests (R-60, R-62, R-65).**
  - Remi's test rules (markers, warnings as errors, loopback-only sockets) live in
    `remi/tests/conftest.py`, scoped to Remi's tests, so they hold under APEX's pytest config.
    Ruff and pyright settings live in `remi/ruff.toml` and `remi/pyrightconfig.json`.
  - `remi/tests/mount` covers every row of R-65 through Flask's test client and a stand-in
    APEX.
  - `make mounted` serves that stand-in on waitress. The browser flows
    (`parity/specs/mounted.spec.ts`) run the production build through it.
  - `frontend/remi/e2e/run.mjs` (`make e2e`) is the Playwright-free replacement that goes to
    APEX (R-63). It drives Edge or Chrome over the DevTools protocol through the first run, a
    check-in and deep-link reloads.
- **Retired (R-80).** `deploy/`, the release workflow, the bundle builder, `make bundle` and
  `make release` are deleted; tag `v0.3.0` keeps the sidecar as a fallback (§3.4). Server-mode
  code stays: it is unused when mounted, and harmless.

## Consequences

- **The import is mechanical.** Copy `backend/remi`, `frontend/remi` and
  `contracts/remi-openapi.json`, then apply `IMPORT.md`'s edits to APEX's files. Remi's own
  suites prove the move.
- **The copy in APEX becomes the source of truth.** This repository is frozen after the import,
  and `backend/remi/PROVENANCE.md` records the base.
- **Only the parity harness stays behind.** It needs Playwright's Chromium and the design folder,
  and it is the safety net for the preparation, not something APEX runs (R-63). APEX gets
  `frontend/remi/e2e/run.mjs` instead, on Edge.
- **Remi's uptime is APEX's.** A Remi fault shows as a 503 on `/remi/` and never as an APEX
  outage.
