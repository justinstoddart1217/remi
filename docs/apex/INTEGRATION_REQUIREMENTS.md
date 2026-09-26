# Remi inside APEX: tech stack and technical requirements

| | |
|---|---|
| **Status** | Draft for decision, 2026-09-26 |
| **Scope** | A one-time integration of Remi into the APEX repository and process. It **replaces** the sidecar plan (`README.md`, `IIS_RULE.md`, and Remi's ADR-0012/0013 server install) |
| **Source** | `justinstoddart1217/remi` at **v0.3.0**, commit `057d80a` (2026-09-26), cloned to `C:\Users\jstoddart\repos\remi` |
| **Target** | APEX `main` at `96597b4` + the uncommitted Remi tile in `frontend/src/pages/Home.jsx` |
| **Language** | **MUST** / **SHOULD** / **MAY** as in RFC 2119. Every requirement has an id (`R-xx`) so the work and its review can cite it |

---

## 1. Summary

**Recommendation: mount Remi in APEX's process, and keep its code and front end as they are.**
Copy Remi into the APEX repo once. Rename its Python package from `app` to `remi`. Run its
FastAPI app **inside APEX's waitress process** at `/remi/` through an ASGI→WSGI adapter
(`a2wsgi`). Build its TypeScript front end with its own toolchain into a folder Remi serves
itself. Keep the `<base href>` and `REMI_PUBLIC_URL` support Remi 0.3.0 already ships, because
that is exactly the contract a mount under `/remi/` needs.

**What this buys you:**
- one repository, one process, one port;
- one deploy: `git pull`, `rebuild.bat`, restart;
- no IIS rule, since IIS already forwards everything to `:8000`;
- no GitHub token, no installer, no `C:\Remi`, no LOCAL SERVICE task.

**What it costs, stated plainly:**

1. **Remi forks.** After the copy, APEX's copy is the source of truth. Edits made in the GitHub
   repo on the laptop no longer arrive by themselves; each one is a manual port (§8, D1).
2. **Remi's Python dependencies move into APEX's production venv.** That means FastAPI,
   Starlette, SQLAlchemy, Alembic and more, plus an **Anthropic SDK upgrade from 1.2.0 to
   1.8.0**, which pm_core's assistant also uses (R-21).
3. **Python version gap.** Remi requires Python 3.12. APEX's venv is **3.11.7**, and 8 Remi
   modules don't even parse on 3.11 (R-10).
4. **Remi's uptime is tied to APEX's.** Every APEX restart, crash or `rebuild`/restart cycle
   takes Remi down with it, and a Remi fault must never take APEX down (R-33).
5. **Two design systems.** Remi keeps its own look (its tokens, its Ninety One prototype
   styling), which differs from APEX's GRIP `grip.css`. Merging the looks is a separate,
   large project (§3.3), and this document doesn't propose it.
6. **Some of Remi's quality gates don't survive.** The visual-parity, behaviour and egress
   suites run on Playwright's Chromium, which the work network's TLS blocks. The prototype
   folder and the release/bundle pipeline are gone too (R-60 to R-63).

**The alternatives:**
- Rewriting Remi natively into Flask and APEX's JSX (§3.2) is **not recommended**. It means
  about 57k lines of code and 17k lines of tests, 98 endpoints, and the loss of the typed API
  contract.
- The sidecar (§3.4) is still the lowest-risk option technically: Remi 0.3.0 already
  implements it. It was set aside for its operational steps, not for any technical flaw.

---

## 2. The two stacks, precisely

### 2.1 Side by side

| Layer | APEX (target) | Remi v0.3.0 (source) | Gap → requirement |
|---|---|---|---|
| **Python** | 3.11.7 (`.venv`; the host venv must be checked, R-10) | **≥ 3.12** (`requires-python`), PEP 695 generics in 8 modules | **Blocking.** R-10 |
| **Web framework** | Flask 3.1.3 / Werkzeug 3.1.8, **WSGI** | FastAPI 0.141.1 / Starlette 1.7.0, **ASGI** | Adapter. R-30 |
| **App server** | waitress 3.0.2, `--threads=8`, `127.0.0.1:8000` behind IIS (prod); `python server.py` on `:8011` (dev) | uvicorn 0.53.0, `127.0.0.1:8765` | uvicorn not needed. R-15 |
| **TLS / edge** | IIS on `:443` for `apex.ny1.ninetyone.com` → `localhost:8000` (`C:\inetpub\wwwroot\web.config`) | none (plain http, or behind a proxy since 0.3.0) | None: IIS already forwards `/remi/*` to waitress |
| **Validation / models** | ad hoc dicts; pydantic 2.13.5 installed | pydantic 2.13.5 + pydantic-settings 2.15.0, strict response models | Add pydantic-settings. R-20 |
| **Persistence** | Databricks Delta lake (pm_* schemas) via pm_core; **no local database** since SQLite retired with Revolution (2026-08-25) | **SQLite** (`remi.db`), SQLAlchemy 2.0.54, Alembic 1.20.0 (4 migrations), WAL, `busy_timeout=5000` | New local state for APEX. R-40 to R-45 |
| **Data layout** | `runtime/` (gitignored) for logs; `.env` for credentials | `REMI_DATA_DIR`: `remi.db`, `charts/`, `backups/` (default via `platformdirs`) | Re-anchored under `runtime/remi/`. R-41 |
| **Other Python deps** | pandas 3, numpy, pyarrow, databricks-sql-connector/sdk, requests, openpyxl, anthropic 1.2.0 | holidays 0.105, platformdirs, python-multipart 0.0.32, httpx 0.28.1, tzdata, anthropic ≥ 1.8 (optional), keyring (optional) | R-20, R-21 |
| **AI** | pm_core `services/ai_assistant` over `anthropic` 1.2.0; key from `.env` | Pluggable check-in parser: `none` (default) / `anthropic` (strict tool use, `BetaMessage`) / `ollama`; key in Keychain or `REMI_ANTHROPIC_API_KEY` / `ANTHROPIC_API_KEY`; every call in `ai_audit` | Shared SDK upgrade; no keyring. R-21, R-50 |
| **Security model** | No server auth. `PasswordGate` is a client-side deterrent (per-area, sessionStorage). No CSP | TrustedHost allowlist, Origin + `X-Remi-Client: 1` on every mutation, strict CSP (`'self'`), sandboxed chart CSP | Keep all of Remi's, scoped to `/remi`. R-50 to R-54 |
| **Front end language** | **JavaScript (JSX)**, no TypeScript | **TypeScript 5.9, strict**, `tsc -b` in the build | Separate project. R-70 |
| **Build** | Vite **8**, `@vitejs/plugin-react` 6, one entry, `dist/` served by Flask | Vite **7**, plugin-react 5, `base: './'`, stay-local plugin, `dist/` served by Remi | Separate build. R-71 |
| **Routing** | `react-router-dom` 7.14, `/`, `/private-markets/*` | `react-router` 7.18 (43 imports), `createBrowserRouter` with runtime `basename` | No merge needed. R-73 |
| **Front-end libraries** | react 19.2 only | TanStack Query 5, zustand 5, openapi-fetch 0.17 (typed from `contracts/openapi.json`), KaTeX 0.16, clsx | Stay inside Remi's project |
| **Styling** | `grip.css` (118 tokens), `grip-pm.css` scoped `.grip-pm`, per-page sheets; rules in `frontend/DESIGN.md` | 7 global sheets (`tokens.css` …) + **66 CSS modules**; global `html,body,a,button` rules; `:root[data-accent|data-motion|data-serif]`; **6 token names collide with APEX** (`--brand-deep --ease-out --font-display --hairline --ink --shadow-popover`) | Harmless while Remi is its own document (R-74); blocking only for a merged SPA (§3.3) |
| **Fonts** | N1 Display / N1 Visuelt (self-hosted) | Visuelt (proprietary, WOFF2), Material Symbols subset, KaTeX fonts, all self-hosted | Keep Remi's. R-75 |
| **Node** | the version on the host running `rebuild.bat` (check it) | **≥ 24** (`engines`); developed on 25; v24.15.0 on this laptop | R-72 |
| **Backend tests** | pytest ≥ 8; `testpaths = pm_core/tests, private_markets/tests` | pytest + hypothesis, respx, pytest-socket, httpx2, pytest-cov; about 17k lines | Add as a third test path. R-60 |
| **Front-end tests** | **none** | vitest 4 + jsdom + msw + Testing Library, 80 test files | Remi's project keeps them. R-61 |
| **Static analysis** | eslint (js/jsx) | ruff, **pyright strict**, eslint `--max-warnings 0`, `tsc -b` | R-62 |
| **Visual / e2e** | headless **Edge** over DevTools from plain Node (Playwright TLS-blocked) | Playwright Chromium: parity, behaviour, egress | R-63 |
| **Release / deploy** | `git pull` on the host + `rebuild.bat` (front end, live at once) + `serve-host.bat` (backend restart) | `make release` → GitHub Actions → zip → `update-remi.bat` | Remi's pipeline retires. R-80 |

### 2.2 Size of what is being moved

| Part | Lines |
|---|---|
| Backend `app/` (Python) | 24,491 |
| Backend tests | 17,130 |
| Front end `src/` (TS/TSX, excluding tests and the generated schema) | 32,306 |
| Front end CSS | 13,382 |
| API | 98 route handlers under `/api` |

At this size, "copy and adapt" is the only proportionate integration. Anything that rewrites
Remi is a new project.

---

## 3. The integration shapes, compared

### 3.1 Recommended: mounted in-process, Remi's own SPA

```
Browser ── https://apex.ny1.ninetyone.com/… ── IIS :443 ── waitress 127.0.0.1:8000 (one process)
                                                             │
                                             WSGI dispatch on the path prefix
                                     ┌───────────────────────┴───────────────────────┐
                               /remi/*  (prefix stripped)                      everything else
                     a2wsgi.ASGIMiddleware(remi FastAPI app)                 Flask (APEX as today)
                     ├─ /api/*   Remi's 98 handlers → runtime/remi/remi.db   ├─ /api/pm/*  PM blueprint
                     └─ /*       Remi's SPA (frontend/remi/dist),            └─ /*         APEX SPA (frontend/dist)
                                 index.html with <base href="/remi/">
```

- **Remi's code changes are mechanical:** the package rename, the 3.11 backport, and path and
  version anchoring.
- **Remi's own tests still pass after the move,** and they prove the move.
- **One deploy path,** with no IIS, GitHub, installer or Windows task.
- **Remi's security middleware stays wrapped around Remi alone.** APEX's `/api/pm/*` is untouched.

### 3.2 Rejected: a native rewrite into Flask and APEX's JSX

Remi's 98 FastAPI handlers would become a Flask blueprint. That means:
- rewriting its dependency injection (`Depends`, the unit-of-work factory), its pydantic
  request and response contracts, and its three middlewares;
- losing the OpenAPI → TypeScript contract (`contracts/openapi.json`, `schema.d.ts`) that the
  whole front end is typed against;
- porting 17k lines of `TestClient` tests;
- then converting 32k lines of strict TypeScript to untyped JSX.

This is a rewrite with regression risk everywhere, for no functional gain.

### 3.3 Deferred: merge Remi's screens into APEX's SPA (a Phase 2 option, not part of this integration)

If Remi should one day *look and navigate* like APEX (one sidebar, one theme, `PasswordGate`),
the front end has to merge. Each item below is a requirement of *that* project, listed so its
cost is visible now:

- TypeScript in APEX's front end: `typescript`, `typescript-eslint`, a `tsconfig`, and `tsc`
  in `npm run build`.
- One router package: `react-router` 7.18 and `react-router-dom` 7.14 are the same v7 library,
  so pin one version.
- One Vite major: 7 → 8 and plugin-react 5 → 6 for Remi's code.
- New dependencies in APEX: TanStack Query, zustand, openapi-fetch, KaTeX, clsx, plus vitest,
  msw and Testing Library.
- Remi's global CSS (`html,body,a,button` and `:root[data-*]`) scoped under a `.remi` root.
- The 6 colliding tokens renamed to `--remi-*`.
- Remi's accent, motion and serif settings mapped onto APEX's `data-theme`.
- Every screen restyled onto `grip.css`, per `frontend/DESIGN.md` (square corners, the token
  laws). That is effectively a redesign of 73 stylesheets.

### 3.4 Still available: the sidecar (Remi 0.3.0 as released)

Remi 0.3.0 already implements a separate process behind IIS at `/remi/` (Remi ADR-0013; this
folder's `IIS_RULE.md`). It remains the lowest-risk option:
- no shared venv, no Python upgrade;
- Remi faults can't reach APEX;
- updates are pulled rather than ported.

It was set aside for its steps: the token, the installer, the IIS edit, a second service.

---

## 4. Target layout in the APEX repository

```
APEX/
  backend/
    remi/                      ← Remi's backend/app/, renamed package `remi` (R-11)
      __init__.py              ← __version__ = "0.3.0" (R-13)
      api/ core/ repositories/ schemas/ services/ utils/
      alembic/                 ← Remi's backend/alembic/ (4 revisions), moved INSIDE the package (R-14)
      mount.py                 ← NEW: builds the WSGI app APEX mounts (R-30 to R-34)
      tests/                   ← Remi's backend/tests/ (R-60)
      PROVENANCE.md            ← source repo, tag, commit, what was changed on import (R-01)
    platform/                  ← unchanged except server.py/config.py wiring (R-30, R-35)
    private_markets/  pm_core/ ← untouched
  frontend/
    src/ …                     ← APEX's SPA (only the tile, already done)
    remi/                      ← Remi's frontend/ as its own npm project (R-70)
      package.json  package-lock.json  tsconfig*.json  vite.config.ts  src/  scripts/
      dist/                    ← build output, gitignored (R-71)
  contracts/remi-openapi.json  ← Remi's contracts/openapi.json (R-64)
  runtime/remi/                ← remi.db, charts/, backups/  (gitignored via /runtime/) (R-41)
```

The **following do not come across**:
- `parity/` and `docs/parity-report.md`;
- `deploy/` (Windows scripts, the tile snippet);
- `.github/workflows/`;
- `backend/scripts/build_bundle.py`;
- `launch.command`, `launch.bat` and the `Makefile`, whose targets are re-expressed in APEX's
  scripts (R-72, R-80);
- the `Remi Dashboard Design Review/` prototype reference.

`docs/decisions/` comes across as `docs/remi/decisions/`, as history (R-02).

---

## 5. Requirements

### 5.1 Source and provenance

- **R-01 MUST:** import from a single tagged commit, v0.3.0 (`057d80a`) or a later tag.
  `backend/remi/PROVENANCE.md` records:
  - the repo, the tag and the commit;
  - the date;
  - every deliberate change on import: the rename, the backport, the path anchors, the
    dropped files.

  This is what makes a later manual re-sync possible (D1).
- **R-02 SHOULD:** bring Remi's ADRs across unchanged as `docs/remi/decisions/`, and add one
  new ADR, "Remi mounted inside APEX", which supersedes 0012 and 0013 for deployment.
- **R-03 MUST NOT:** add Remi as a git submodule or a pip or npm dependency. The integration
  is a copy (D1).

### 5.2 Python runtime

- **R-10 MUST:** make Remi run on APEX's interpreter. Today that is **3.11.7**, and these 8
  files fail to parse on 3.11, all because of PEP 695 generic syntax (`class RepoKey[R]`,
  `def with_calendar[T](…)`):
  - `core/uow.py:97`
  - `services/calendar.py:194`
  - `services/checkins.py:494`
  - `services/mutations.py:112`
  - `services/notes.py:148`
  - `services/project_items.py:65`
  - `services/views.py:379`
  - `services/ai/fake_provider.py:167`

  The line numbers are only the first error in each file. There are two ways to comply (D2):
  - **(a) Backport** (recommended): rewrite them with `typing.TypeVar` / `Generic`. The whole of
    Remi's pytest suite must then pass **on 3.11**, which is the proof that no other
    3.12-only runtime API is in use.
  - **(b) Upgrade APEX's venv to 3.12,** on the laptop and the host. That requires re-verifying
    pm_core's full test suite and the internal `nw_client` / `pw_client` / `jw_client`
    wheels, the Databricks connectors, and a live pull and CALCULATE. It is not recommended
    as part of this work, since it puts the production PM stack at risk for Remi's sake.
- **R-11 MUST:** rename the top-level package from `app` to `remi`, mechanically (every
  `from app.` / `import app` line, test imports and Alembic's `env.py`). `app` is far too
  generic to live on APEX's `sys.path`, which already carries `backend/` and
  `backend/platform/`, and `wsgi.py` exposes a variable called `app`. The rename MUST be the
  only change in its commit, so the diff can be reviewed.
- **R-12 MUST NOT:** add an `__init__.py` to `backend/platform/` (the stdlib `platform` clash).
  `backend/remi/` is a real package and lives beside `private_markets/`.
- **R-13 MUST:** set `__version__` in `remi/__init__.py` as a literal (`"0.3.0"`).
  Today it reads `parents[1] / "pyproject.toml"`. In APEX that resolves to `backend/pyproject.toml`,
  which doesn't exist, and then to package metadata that isn't installed, so health would
  report `0.0.0+local`.
- **R-14 MUST:** re-anchor `core/paths.py`:
  - `alembic_dir()` points at `remi/alembic/` (inside the package);
  - `alembic_ini()` is dropped, since `alembic_config()` already builds its config in memory;
  - `default_frontend_dist()` points at `frontend/remi/dist`;
  - `repo_root()` is replaced.

  No path may depend on the working directory, per APEX's `config.py` rule.
- **R-15 MUST:** keep `uvicorn` out of APEX's import path. `remi/main.py` imports `uvicorn` at
  module top for its CLI. Split the app factory (`create_app`, `_lifespan`) from the CLI, or
  import uvicorn inside `cli()`, so mounting needs no uvicorn. The CLI (`remi db
  upgrade|backup|path`) SHOULD survive as `python -m remi db …`, run with APEX's venv; if it
  does, uvicorn becomes an optional dev dependency.

### 5.3 Dependencies (APEX's venv)

- **R-20 MUST:** add Remi's runtime dependencies to APEX's `pyproject.toml` `server` extra,
  never to the pm-core wheel's `dependencies`: the Databricks jobs must not install them.
  Pin the versions Remi was tested with:

  | Package | Version | Note |
  |---|---|---|
  | fastapi | 0.141.1 | brings starlette 1.7.0 |
  | sqlalchemy | 2.0.54 | `<2.1` as Remi pins |
  | alembic | 1.20.0 | brings mako 1.4.3 |
  | pydantic-settings | 2.15.0 | pydantic 2.13.5 is already installed |
  | holidays | 0.105 | |
  | platformdirs | 4.11.12 | only for the default data dir, which R-41 overrides |
  | python-multipart | 0.0.32 | chart uploads |
  | httpx | 0.28.1 | check what is installed first |
  | tzdata | ≥ 2026.3 | already installed |
  | **a2wsgi** | 1.10.10 | NEW. The ASGI→WSGI adapter. It installs from this laptop's index; check the host's Nexus mirror too |

  Every package MUST be installable on the host through the Nexus pip mirror. Check with
  `python -m pip download` before the integration starts.
- **R-21 MUST:** upgrade `anthropic` from 1.2.0 to 1.8.0 (Remi uses strict tools and
  `BetaMessage`), or disable Remi's Anthropic provider (D4). An upgrade MUST be followed by a
  regression run of pm_core's `services/ai_assistant` tests and one live assistant answer,
  because the SDK is shared.
- **R-22 MUST NOT:** install `keyring`. On the host, the key comes from the environment (R-50).
- **R-23 SHOULD:** add Remi's test dependencies to APEX's `dev` group: hypothesis, respx,
  pytest-socket, pytest-cov and httpx2 (Starlette's `TestClient` prefers it).

### 5.4 Mounting in the APEX process

- **R-30 MUST:** mount Remi at `/remi` **at the WSGI level, in front of Flask**, so Flask's SPA
  fallback never sees `/remi/*`. The mounted app MUST receive requests **with the `/remi`
  prefix removed and an empty ASGI `root_path`**. That is exactly the contract IIS provided in
  Remi 0.3.0's design (ADR-0013), which its tests cover. Write a small path-strip dispatcher
  in `remi/mount.py`:
  - `/remi` → 302 to `/remi/`;
  - `/remi/…` → the a2wsgi-wrapped app, with `PATH_INFO` minus the prefix and `SCRIPT_NAME`
    left empty;
  - anything else → Flask.

  Do not use Werkzeug's `DispatcherMiddleware` as is. It moves the prefix into `SCRIPT_NAME`,
  and a2wsgi 1.10.10 builds `root_path = SCRIPT_NAME` and `path = SCRIPT_NAME + PATH_INFO`
  (`a2wsgi/asgi.py:92-104`). Remi would then see `/remi/api/...` with a `/remi` root_path,
  which is a different path contract from the one Remi tested.
- **R-31 MUST:** set `REMI_PUBLIC_URL` to the address the browser uses:
  - `https://apex.ny1.ninetyone.com/remi` on the host;
  - `http://localhost:8011/remi` for the dev server.

  From it, Remi derives its `<base href="/remi/">`, its router `basename`, its `/remi/api` base
  and its accepted Host and Origin. If it's unset, the pages would be served at the wrong base.
- **R-32 MUST NOT:** rely on ASGI lifespan events. a2wsgi 1.10.10's `ASGIMiddleware` never
  sends lifespan to the app; its source has no lifespan handling. `mount.py` MUST open the database itself: it calls `prepare_database(data_dir)` and sets
  `app.state.db` and `app.state.uow_factory` before the first request. Remi's `_lifespan`
  already skips its own setup when `app.state.db` is set. It also registers `database.close()`
  with `atexit`.
- **R-33 MUST:** isolate failures. If Remi's import, configuration, migration or database
  open fails at boot:
  - APEX MUST still boot and serve every PM page;
  - `/remi/*` MUST answer a plain 503 page that names the error and the log line;
  - the failure MUST be logged loudly, once, at boot.

  In the other direction, an unhandled exception inside a Remi request MUST NOT kill the
  waitress worker. Remi's `UnexpectedErrorMiddleware` already turns these into a 500
  envelope; a test MUST prove it through the mount.
- **R-34 MUST:** have waitress's 8 threads and a2wsgi's event loop share one Remi app
  instance and one SQLAlchemy engine. Remi's handlers are almost all sync; the async ones are
  in `ai.py`, `checkins.py` and `textbook.py`. SQLite runs in WAL mode with
  `busy_timeout=5000` and `check_same_thread=False`, so concurrent requests are safe **within
  one process**. See R-44 for more than one process.
- **R-35 MUST:** keep the mount out of pm_core and `private_markets`. It is wired in
  `backend/platform/server.py`'s `create_app()` (dev) and therefore in `wsgi.py` (host), and
  can be switched off with `APEX_REMI_ENABLED=0`, default on. When it's off, `/remi/*` gets
  the same 503 page.
- **R-36 MUST NOT:** let the mount slow APEX's boot or PM prewarm. Remi's `prepare_database`
  runs synchronously at boot. It takes milliseconds when no migration is pending. A pending
  migration backs up first, and that is acceptable.

### 5.5 Configuration

- **R-37 MUST:** set Remi's settings in APEX's launch scripts, not in Remi's code:
  `serve-host.bat` (host) and `launch.bat` / `server.py` defaults (dev). The set is:

  | Variable | Host | Dev |
  |---|---|---|
  | `REMI_PUBLIC_URL` | `https://apex.ny1.ninetyone.com/remi` | `http://localhost:8011/remi` |
  | `REMI_DATA_DIR` | `%REPO%\runtime\remi` | `%REPO%\runtime\remi-dev` (never the host's copy) |
  | `REMI_FRONTEND_DIST` | `%REPO%\frontend\remi\dist` | same |
  | `REMI_ENV` | `prod` | `dev` (enables sample-data reset, never on the host) |
  | `REMI_NETWORK`, `REMI_HOST`, `REMI_PORT`, `REMI_ALLOWED_HOSTS` | **unset** (meaningless when mounted) | unset |
  | `REMI_TODAY`, `REMI_NOW` | **MUST be unset** | optional |
- **R-38 SHOULD:** have `server.py`'s startup banner print the Remi line (version and public
  URL) beside the PM API line, and have `/api/pm/health` stay Remi-free. Remi's own health is
  `/remi/api/health`.

### 5.6 Data

- **R-40 MUST:** keep Remi's data out of Databricks. It is a local SQLite database, owned by
  the one APEX process on the host.
- **R-41 MUST:** keep the data under `runtime/remi/`, which is gitignored through `/runtime/`:
  `remi.db` (plus `-wal` and `-shm`), `charts/` and `backups/`. `REMI_DATA_DIR` MUST always be
  set (R-37). The `platformdirs` default would put it in the service account's `%LOCALAPPDATA%`.
- **R-42 MUST:** include the folder in a backup. Remi prunes its own pre-migration backups
  (the newest 10), but those sit on the same disk. Copy `runtime\remi\` to the shared drive
  (the one the ACO exports use), at least nightly. The copy MUST use the sqlite backup API or
  `python -m remi db backup`, never a raw file copy of a live WAL database.
- **R-43 MAY:** carry the laptop's plan into the host once, by copying the laptop `remi.db`
  (taken with `remi db backup`) into `runtime\remi\` while APEX is stopped. It works only if
  both are at the same Alembic head, because Remi refuses a database written by a newer
  schema. Otherwise, start from the first-run wizard.
- **R-44 MUST:** have exactly one process open `runtime\remi\remi.db`. The known double-bind
  hazard on `:8011` (two `server.py` instances) is harmless for the lake but not for SQLite
  migrations. `mount.py` SHOULD take an exclusive lock file (`runtime\remi\.lock`) and refuse
  to mount if it is held (R-33's 503).
- **R-45 MUST:** add the laptop-to-host note to `PRODUCTION.md`: code moves by `git pull`, data
  never does.

### 5.7 Security

- **R-50 MUST:** have the Anthropic key, when the provider is used, come from the environment,
  and write it nowhere else. Watch the names:
  - APEX's assistant reads `PM_ASSISTANT_API_KEY`, falling back to `ANTHROPIC_API_KEY`
    (`pm_core/services/ai_assistant/llm.py`).
  - Remi reads `REMI_ANTHROPIC_API_KEY`, falling back to `ANTHROPIC_API_KEY`.

  If the host's `.env` only carries `PM_ASSISTANT_API_KEY`, `mount.py` MUST pass that value to
  Remi as `REMI_ANTHROPIC_API_KEY` at mount time rather than duplicate the secret. Settings ›
  Tell Remi then shows "configured" and never the value.
- **R-51 MUST:** keep Remi's three middlewares around the mounted Remi app only: TrustedHost,
  MutationGuard (Origin + `X-Remi-Client: 1`) and SecurityHeaders (CSP). They MUST NOT
  wrap Flask. They MUST accept:
  - the public host, `apex.ny1.ninetyone.com`;
  - whatever Host IIS forwards (loopback or the public name; both are allowed today);
  - the public Origin, `https://apex.ny1.ninetyone.com`.

  A test MUST prove a foreign Origin still gets a 403 through the mount.
- **R-52 MUST (critical):** serve chart HTML only from `/remi/api/charts/{id}`, with Remi's
  `CHART_CSP`: `sandbox allow-scripts`, **no** `allow-same-origin`. Under the mount, uploaded
  chart HTML is served from **APEX's own origin**. Without the sandbox it could call APEX's
  unauthenticated `/api/pm/*` write endpoints (sign-off, mapping, calculate) from the user's
  browser. The existing Remi tests for this CSP MUST pass through the mount. A new test
  MUST assert the header on a mounted chart response. `NEVER_SPA`'s `/charts` rule stays.
- **R-53 MUST:** recognise that **anyone on the network who can open APEX can open and change
  Remi**. APEX's `PasswordGate` does not cover `/remi/`: it is a different document, and the
  gate is only client-side anyway. Choose one (D3):
  - accept this, as APEX does today;
  - have IIS require Windows sign-in on the `remi` path only (`IIS_RULE.md`, "Optional");
  - add a server-side check in `mount.py`.
- **R-54 SHOULD:** keep Remi's CSP (`default-src 'self'`) on Remi's pages as is. APEX has no
  CSP, and this work MUST NOT add one to APEX.

### 5.8 Front end

- **R-70 MUST:** give Remi's front end its own npm project at `frontend/remi/`, with its own
  `package.json`, lock file, `node_modules`, `tsconfig`, eslint config and `vite.config.ts`,
  exactly as in the Remi repo. APEX's front end MUST NOT import from it or depend on it.
  APEX's `eslint.config.js` MUST add `remi` to `globalIgnores`, so `eslint .` in `frontend/`
  doesn't lint TypeScript with the JSX config.
- **R-71 MUST:** build it with `npm ci && npm run build` (`tsc -b && vite build`) into
  `frontend/remi/dist/`, and gitignore that folder. The build MUST keep `base: './'` and the
  `index.html` `<base href="/">`, which Remi replaces at serve time. It MUST keep the
  stay-local check: no external URLs in `dist`.
- **R-72 MUST:** have `rebuild.bat` build **both** front ends: APEX's, then Remi's. It MUST
  fail loudly if Remi's `tsc` fails, but still leave APEX's build live, so one failure doesn't
  cascade into the other. The host MUST have **Node ≥ 24** and npm access to the packages in
  Remi's lock file (check the host's Node version and npm registry path before starting). The
  `subset-icons` script downloads at build time, so the committed icon subset MUST be used,
  never regenerated on the host.
- **R-73 MUST:** leave the router untouched. Remi's `basePath()` reads `document.baseURI`, and
  the tile in `Home.jsx` is a plain `<a href="/remi/">`, already done. No change to APEX's
  `App.jsx` routes is needed: `/remi/*` never reaches APEX's SPA (R-30).
- **R-74 MUST:** keep Remi rendering as its **own document**, never embedded in APEX's React
  tree or in an iframe. Then Remi's global CSS, its `:root` tokens and the 6 colliding token
  names can't affect APEX, and the reverse holds too.
- **R-75 MUST:** keep serving Remi's self-hosted fonts (Visuelt, Material Symbols subset,
  KaTeX) from Remi's `dist`. The Visuelt files are proprietary: APEX's repository has to be
  internal-only, which it is. They MUST NOT be copied into APEX's `frontend/public`.
- **R-76 SHOULD:** give Remi's header a way back to APEX (a link to `/`). This is the one UI
  change inside Remi this integration asks for. Without it, the only way back is the browser's
  Back button.

### 5.9 Tests and gates

- **R-60 MUST:** add `backend/remi/tests` to `[tool.pytest.ini_options].testpaths`, with Remi's
  `conftest.py` intact. The full Remi suite MUST pass on APEX's venv (on 3.11, if D2(a)) from
  APEX's repo root. `pytest-socket` MUST stay scoped to Remi's tests, because pm_core tests
  may need sockets.
- **R-61 MUST:** keep the front-end gates in `frontend/remi/`: `npm run typecheck`,
  `npm run lint`, `npm test` (vitest) and `npm run build`. Document them in `PRODUCTION.md` as
  the check before committing a Remi change.
- **R-62 SHOULD:** keep ruff with Remi's config for `backend/remi`, and keep pyright strict
  for `backend/remi`, pointed at APEX's venv. APEX has no Python linter today, so these apply
  to Remi's folder only.
- **R-63:** Remi's browser suites.
  - **MUST retire** visual parity, goldens and design-verify: they need the prototype folder
    and Playwright Chromium.
  - **SHOULD port** the behaviour flows that matter (first-run wizard, a check-in apply, a
    deep-link reload) to headless Edge over DevTools, the way APEX already verifies UI.
  - **MAY drop** egress. APEX isn't a stay-local app, and R-71's `dist` check keeps most of
    its value.
- **R-64 MUST:** keep the OpenAPI contract. `contracts/remi-openapi.json` and
  `frontend/remi/src/api/schema.d.ts` must be regenerable from APEX's venv, as
  `python -m remi.scripts.export_openapi` followed by `npm run gen:api`, and checked for drift
  before a commit (Remi's `openapi-check`). The contract is what keeps 32k lines of TypeScript
  honest about 98 endpoints.
- **R-65 MUST:** add integration tests through Flask's test client, against the mounted
  WSGI app:

  | Request | Expected |
  |---|---|
  | `GET /remi/api/health` | 200, `"app": "remi"`, version `0.3.0` |
  | `GET /remi` | 302 → `/remi/` |
  | `GET /remi/app/timeline` | `index.html` with `<base href="/remi/">` |
  | `GET /remi/assets/<hashed>.js` | immutable cache headers |
  | `POST /remi/api/…` with `Origin: https://apex.ny1.ninetyone.com` and `X-Remi-Client: 1` | succeeds |
  | the same with a foreign Origin, or without the header | 403 |
  | a chart response | `CHART_CSP` present (R-52) |
  | `GET /api/pm/health` and `GET /` | unchanged APEX responses, **no** Remi CSP header |
  | boot with a broken `REMI_DATA_DIR` | APEX boots; `/remi/` answers 503 (R-33) |
  | boot with `APEX_REMI_ENABLED=0` | `/remi/` answers 503 |

### 5.10 Operations and deploy

- **R-80 MUST:** retire Remi's own release machinery: `make release`, the GitHub workflow,
  the bundle, `update-remi.bat` and the Windows scripts. Deploying Remi becomes APEX's deploy:
  - `git pull` on the host;
  - `python -m pip install -e .[server]` **only when R-20's pins change**;
  - `rebuild.bat` for the front ends;
  - `serve-host.bat` to restart the backend. Remi migrations run at that restart, with a
    backup first.
- **R-81 MUST:** state in `PRODUCTION.md` that restarting APEX restarts Remi. The nightly
  01:05 refresh runs on Databricks, not in waitress, so it is unaffected. `NEVER
  /api/admin/restart on prod` still applies.
- **R-82 MUST:** send Remi's logs to APEX's host log (`runtime\server-host.log`) under a `remi`
  logger name, so one window or log shows both.
- **R-83 MUST:** leave nothing of the sidecar on the host. If it was ever installed, uninstall
  it: `C:\Remi`, the `Remi` scheduled task and the `Remi` firewall rule. The IIS rule in
  `IIS_RULE.md` MUST NOT be applied: IIS already forwards `/remi/*` to waitress, and the rule
  would send it to a port nothing listens on.

---

## 6. Critical risks and open issues

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| K1 | **Fork drift.** Remi keeps evolving on the laptop and diverges from APEX's copy. A later "re-sync" is a hand merge across a rename and a backport | High (certain over time) | D1. If Remi keeps being developed, do it **in APEX**. Otherwise freeze the GitHub repo with a README pointer. PROVENANCE.md (R-01) is the merge base either way |
| K2 | **Shared production venv.** A Remi dependency upgrade can break PM, or the reverse. The Anthropic SDK is already shared (R-21) | High | The `server` extra with exact pins (R-20); a pm_core suite run on every pin change |
| K3 | **3.11 backport hides a runtime 3.12 dependency** beyond syntax | Medium | R-10(a): Remi's full suite must pass on 3.11 before merge |
| K4 | **Coupled uptime.** A Remi bug that deadlocks a waitress thread (a long AI call, a stuck SQLite write) eats one of APEX's 8 threads | Medium | Remi's AI calls are user-initiated and bounded by the SDK timeout; `busy_timeout=5000`; the thread count could be raised to 12 if Remi use is heavy |
| K5 | **Chart HTML on APEX's origin** (R-52) | High if the sandbox is lost | R-52 test through the mount; code review of any change to `SecurityHeadersMiddleware` |
| K6 | **No sign-in on `/remi/`**: personal notes readable by anyone who can reach APEX | Medium (by choice) | D3 |
| K7 | **Lost gates.** Parity, behaviour and egress go, so visual regressions in Remi go unnoticed | Medium | R-63 ported flows; vitest and the typecheck stay |
| K8 | **Host toolchain.** Node < 24, or no npm route to Remi's packages, stops `rebuild.bat` | Medium, unknown until checked | Check before starting (§8 Phase 0) |
| K9 | **Two design systems** inside one product | Low (cosmetic) | Accept for now; §3.3 is the path if it matters |
| K10 | **SQLite on the host disk**, backed up only to that disk | Medium | R-42 nightly copy to the shared drive |
| K11 | **The a2wsgi path contract** differs from what Remi tested | Medium | R-30's own strip dispatcher; R-65 tests |

---

## 7. Decisions needed

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | **Where Remi is developed after the import** | (a) in APEX only, with the GitHub repo frozen; (b) keep developing on the laptop and hand-port each change | **(a).** (b) re-creates the complexity this move is meant to remove, only more manual |
| D2 | **Python version** | (a) backport Remi to 3.11; (b) upgrade APEX's venv to 3.12 | **(a)** now. Treat (b) as its own later project with a PM regression run |
| D3 | **Access control on `/remi/`** | (a) none, like APEX; (b) IIS Windows sign-in on `remi` only; (c) a server-side check in `mount.py` | **(b)** if IIS allows it, else (a) |
| D4 | **Remi's AI provider on the host** | (a) `anthropic` with the shared key and SDK 1.8; (b) `none` only; skip the SDK upgrade | **(a)** only if the PM assistant regression passes; otherwise (b) until it does |
| D5 | **Integration shape** | §3.1 mounted, §3.4 sidecar, §3.3 merged SPA | **§3.1.** §3.4 is equally valid if the shared-venv risk (K2) outweighs the operational steps |

---

## 8. Phased plan

Every phase ends green before the next one starts.

**Phase 0: prove the environment (no code).**
- The host Python version: `.venv\Scripts\python --version`.
- Node and npm on the host.
- `python -m pip download` of every R-20 package through Nexus.
- A dry `npm ci` of Remi's lock file on the host.
- Decisions D1 to D5 made.

**Phase 1: import, without mounting.**
- Clone v0.3.0.
- Copy it into the §4 layout, then rename `app` → `remi` in a commit of its own.
- Backport to 3.11 (D2a), anchor versions and paths (R-13, R-14), split out uvicorn (R-15).
- Add the dependencies (R-20, R-23).
- **Gate:** Remi's full pytest suite passes on APEX's venv from APEX's root; `frontend/remi`
  typecheck, lint, tests and build are green.

**Phase 2: mount.**
- `remi/mount.py` (R-30 to R-34), `server.py` wiring and the switch (R-35), launch-script
  settings (R-37).
- **Gate:** R-65's integration tests; the dev server at `http://localhost:8011/remi/` shows
  the wizard; APEX's own test suite is unchanged.

**Phase 3: build and ops.**
- `rebuild.bat` builds both front ends (R-72), with the logs (R-82) and the backup job (R-42).
- `PRODUCTION.md` and `docs/remi/` updated; the sidecar docs marked superseded (R-80, R-83).
- **Gate:** the whole deploy rehearsed on the laptop from a clean clone.

**Phase 4: host.**
- `git pull`, pip install of the server extra, `rebuild.bat`, `serve-host.bat`.
- **Gate:** the §9 checks from the laptop's browser.

**Phase 5: settle.**
- D1 carried out: the GitHub repo frozen, or the development workflow documented.
- R-63's ported browser flows.
- D3 applied.

## 9. Acceptance, on the host

1. `https://apex.ny1.ninetyone.com/` shows APEX with two tiles. Private Markets works as
   before, and `/api/pm/health` is unchanged.
2. The Remi tile opens `https://apex.ny1.ninetyone.com/remi/` and shows the first-run wizard
   (or the imported plan, R-43).
3. A reload on `/remi/app/timeline` and `/remi/textbook/p1` returns to the same page.
4. A saved note survives an APEX restart (`serve-host.bat`).
5. A Textbook chart uploads and renders, and its response carries the sandbox CSP.
6. `/remi/api/health` reports `0.3.0`; `runtime\remi\remi.db` exists; the backup copy lands on
   the shared drive.
7. With `REMI_DATA_DIR` pointed at an unwritable path, APEX still boots and `/remi/` shows the
   503 page.
8. Nothing of the sidecar remains (R-83).

## Appendix A: files in this folder after the decision

| File | State under §3.1 |
|---|---|
| `README.md` | Sidecar rollout. **Superseded** by this document |
| `IIS_RULE.md` | **Do not apply** under §3.1 (R-83). It stays valid only for §3.4 |
| `REMI_CHANGES.md` | **Implemented** in Remi 0.3.0. Its `REMI_PUBLIC_URL` and `<base href>` work is what §3.1 builds on |
| `INTEGRATION_REQUIREMENTS.md` | This document |
