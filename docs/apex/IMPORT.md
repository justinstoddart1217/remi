# Importing Remi into APEX: the runbook

This is the one-time copy of Remi into the APEX repository, following the APEX team's
[`INTEGRATION_REQUIREMENTS.md`](INTEGRATION_REQUIREMENTS.md) (R-xx) and
[ADR-0014](../decisions/0014-mounted-inside-apex.md).

**The source** is tag **`v0.4.0`** of `justinstoddart1217/remi`. Everything that could be done
in Remi's repository is already done there:
- the APEX layout;
- Python 3.11;
- pinned dependencies;
- `remi.mount`;
- the tests that prove the mount.

What is left is a copy and a handful of edits to APEX's own files, given below ready to paste.

**Where the work happens:**
- `[laptop]` is the work laptop with the APEX clone.
- `[host]` is the APEX server.

---

## 0. Before starting: check the environment (no code yet)

| Check | Command | Needs |
|---|---|---|
| **[host]** Python | `.venv\Scripts\python --version` | 3.11.x (Remi's floor) |
| **[host]** Node and npm | `node --version` / `npm --version` | Node **20.19+, 22.13+ or 24+** (not only 24: the toolchain was checked on 20.19 and 22.13) |
| **[host]** pip, through Nexus | `python -m pip download -d %TEMP%\remi-pins fastapi==0.141.1 sqlalchemy==2.0.54 alembic==1.20.0 pydantic-settings==2.15.0 holidays==0.105 platformdirs==4.11.12 python-multipart==0.0.32 httpx==0.28.1 a2wsgi==1.10.10 anthropic==1.8.0` | every package downloads |
| **[host]** npm registry | `npm ci --dry-run` in `frontend\remi` (after step 1) | Remi's lock file resolves |

## 1. Copy (one commit, no edits)

From a clone of Remi at `v0.4.0`, into the APEX repository:

| From Remi | To APEX | Notes |
|---|---|---|
| `backend/remi/` | `backend/remi/` | The package: code, `alembic/`, `fixtures/`, `scripts/`, `tests/`, `mount.py`, `ruff.toml`, `pyrightconfig.json`, `PROVENANCE.md`. Leave out `__pycache__/` |
| `frontend/remi/` | `frontend/remi/` | Its own npm project. Leave out `node_modules/` and `dist/` |
| `contracts/remi-openapi.json` | `contracts/remi-openapi.json` | The typed API contract (R-64) |
| `docs/decisions/` | `docs/remi/decisions/` | Remi's ADRs, as history (R-02) |
| `docs/apex/` | `docs/remi/` | These two files |

**Not copied (R-63, R-80):**
- `backend/pyproject.toml`, `backend/uv.lock` and `backend/.python-version` (the dependencies go
  into APEX's `pyproject`, in step 2);
- `parity/` and `docs/parity-report.md`;
- `Makefile`, `launch.command`, `launch.bat` and `README.md`;
- the other `docs/`.

One way to do it from the APEX root, with Remi cloned at `..\remi` (PowerShell):

```powershell
robocopy ..\remi\backend\remi backend\remi /E /XD __pycache__ .pytest_cache .ruff_cache
robocopy ..\remi\frontend\remi frontend\remi /E /XD node_modules dist
Copy-Item ..\remi\contracts\remi-openapi.json contracts\
robocopy ..\remi\docs\decisions docs\remi\decisions /E
robocopy ..\remi\docs\apex docs\remi /E
```

Fill in `backend\remi\PROVENANCE.md`: the commit is `git -C ..\remi rev-parse v0.4.0`, plus
the date of the copy.

## 2. APEX's files: paste-ready edits

### 2.1 `pyproject.toml` (R-20, R-21, R-23)

Add these to the **`server` extra**, never to the pm-core wheel's `dependencies`:

```toml
    # Remi (backend/remi), mounted at /remi/ (docs/remi/IMPORT.md)
    "fastapi==0.141.1",
    "sqlalchemy==2.0.54",
    "alembic==1.20.0",
    "pydantic-settings==2.15.0",
    "holidays==0.105",
    "platformdirs==4.11.12",
    "python-multipart==0.0.32",
    "httpx==0.28.1",
    "tzdata>=2026.3",
    "a2wsgi==1.10.10",
```

- **Anthropic.** Raise the shared `anthropic` pin to **`==1.8.0`** (R-21, D4a). Then run
  pm_core's `services/ai_assistant` tests and one live assistant answer, since the SDK is shared.
- **Test dependencies,** in the `dev` group: `hypothesis`, `respx`, `pytest-socket`,
  `pytest-cov` and `httpx2`.
- **Leave out:** `keyring` (R-22) and `uvicorn` (R-15). Remi never imports uvicorn when mounted.

pydantic 2.13.5, Flask 3.1.3 and waitress 3.0.2 are the versions Remi was tested with, which
are already APEX's.

### 2.2 Wiring the mount: `backend/platform/server.py` (dev) and `wsgi.py` (host) (R-30, R-35, R-38)

Right after APEX's Flask app is created in `create_app()`, before it is returned or served:

```python
from remi.mount import mount as mount_remi, status as remi_status

app.wsgi_app = mount_remi(app.wsgi_app)  # Remi at /remi/; never raises (R-33)
```

For the startup banner, next to the PM API line:

```python
print(remi_status())  # "Remi 0.4.0: https://apex.ny1.ninetyone.com/remi/", or why it is off
```

`/api/pm/health` stays as it is. Remi's own health is `/remi/api/health`.

### 2.3 Settings in the launch scripts (R-37, R-31, R-41)

**`serve-host.bat` (host):**

```bat
rem --- Remi, mounted at /remi/ (docs/remi/IMPORT.md)
set "REMI_PUBLIC_URL=https://apex.ny1.ninetyone.com/remi"
set "REMI_DATA_DIR=%REPO%\runtime\remi"
set "REMI_FRONTEND_DIST=%REPO%\frontend\remi\dist"
set "REMI_ENV=prod"
set "REMI_TODAY="
set "REMI_NOW="
```

**`launch.bat` / `server.py` defaults (dev):**

```bat
set "REMI_PUBLIC_URL=http://localhost:8011/remi"
set "REMI_DATA_DIR=%REPO%\runtime\remi-dev"
set "REMI_FRONTEND_DIST=%REPO%\frontend\remi\dist"
set "REMI_ENV=dev"
```

- Leave `REMI_NETWORK`, `REMI_HOST`, `REMI_PORT` and `REMI_ALLOWED_HOSTS` unset.
- `APEX_REMI_ENABLED=0` switches Remi off, and `/remi/` then answers 503.
- The Anthropic key needs nothing: `remi.mount` passes APEX's `PM_ASSISTANT_API_KEY` to Remi
  (R-50).

### 2.4 `rebuild.bat` builds both front ends (R-72)

After APEX's own front-end build:

```bat
rem --- Remi's front end: its own npm project. A failure here leaves APEX's build live.
pushd "%REPO%\frontend\remi"
call npm ci --no-audit --no-fund
if errorlevel 1 goto remi_build_failed
call npm run build
if errorlevel 1 goto remi_build_failed
popd
goto remi_build_done
:remi_build_failed
popd
echo.
echo *** REMI FRONT END BUILD FAILED (APEX's front end is built and live) ***
echo.
set "BUILD_FAILED=1"
:remi_build_done
```

`npm run build` is `tsc -b && vite build`, plus the stay-local check of `dist`. Never run
`npm run subset-icons` on the host: the icon font is committed.

### 2.5 Front-end config (R-70)

- **`frontend/eslint.config.js`:** add `'remi'` to `globalIgnores`. Remi's TypeScript has its
  own eslint config.
- **`.gitignore`:** add `frontend/remi/dist/` and `frontend/remi/node_modules/`, unless the
  existing `dist/` and `node_modules/` rules already cover them. `runtime/` is already ignored.

### 2.6 pytest (R-60)

In `[tool.pytest.ini_options]`, add `backend/remi/tests` to `testpaths`. `backend/` must be on
`pythonpath`, as it is for `private_markets`.

Remi's `conftest.py` scopes its own rules to Remi's tests only: warnings as errors, loopback-only
sockets, and its markers. pm_core's tests are unaffected.

### 2.7 `PRODUCTION.md` (R-45, R-61, R-81, R-42)

Add:

- **Deploy.** Remi deploys with APEX, in this order:
  1. `git pull`;
  2. `pip install -e .[server]`, only when the Remi pins change;
  3. `rebuild.bat`;
  4. `serve-host.bat`. Remi's migrations run at that restart, after an automatic backup.
- **Uptime.** Restarting APEX restarts Remi. The nightly 01:05 refresh runs on Databricks and is
  unaffected. **Never** use `/api/admin/restart` on prod.
- **Data.** Code moves by `git pull`; data never does. Remi's data is `runtime\remi\`:
  `remi.db` (plus `-wal` and `-shm`), `charts\` and `backups\`.
- **Before committing a Remi change,** run the gates in section 3.
- **Nightly backup to the shared drive (R-42).** Never copy a live WAL database file directly.
  `db backup` writes a consistent copy with SQLite's backup API; move that copy:

  ```bat
  .venv\Scripts\python -m remi db backup --data-dir "%REPO%\runtime\remi"
  robocopy "%REPO%\runtime\remi\backups" "\\<share>\APEX\remi-backups" /XO
  robocopy "%REPO%\runtime\remi\charts" "\\<share>\APEX\remi-backups\charts" /E /XO
  ```

## 3. Gates after the copy (run from APEX's root)

| Gate | Command |
|---|---|
| Remi's backend suite, on APEX's venv (R-60) | `.venv\Scripts\python -m pytest backend\remi\tests` (1,317 tests + the mount's 27) |
| The mount (R-65) | `.venv\Scripts\python -m pytest backend\remi\tests\mount`. It runs against a stand-in APEX; adding a copy that wraps APEX's real `create_app()` is recommended |
| APEX's own suite | unchanged |
| Lint and types (R-62) | `.venv\Scripts\python -m ruff check backend\remi`; `.venv\Scripts\python -m pyright -p backend\remi` |
| Remi's front end (R-61) | in `frontend\remi`: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` |
| The API contract (R-64) | `.venv\Scripts\python -m remi.scripts.export_openapi` rewrites `contracts\remi-openapi.json`; then `npm run gen:api` in `frontend\remi`; then `git diff --exit-code contracts frontend\remi\src\api\schema.d.ts` |

- **R-63, browser checks.** Remi's Playwright suites stay in Remi's repository. Their
  replacement comes across with the front end: `frontend/remi/e2e/run.mjs`. It is plain Node 22+
  driving Edge (or Chrome) over the DevTools protocol, the way APEX checks its own UI. It runs
  three flows:
  1. the first-run wizard;
  2. a check-in applied by simple reading;
  3. reloads on `/remi/app/timeline` and `/remi/textbook/fi-rates`.

  It fails on any request outside `/remi/` and on any failed response. Run it against the **dev**
  server (`REMI_ENV=dev`, since it resets the data), never the host:

  ```bat
  cd frontend\remi
  npm run e2e -- --base http://localhost:8011/remi
  ```

  It finds Edge in its usual place (or pass `--browser <path>` or set `REMI_E2E_BROWSER`). In
  Remi's repository, `make e2e` runs it against the stand-in APEX.

## 4. Optional: bring the laptop's plan across (R-43)

1. On the Mac, run `cd backend && uv run python -m remi db backup`.
2. Copy the newest file from the Mac's `…/Application Support/Remi/backups/` to the host's
   `runtime\remi\remi.db`, **while APEX is stopped**.

Both sides must be at the same Alembic head (`0004` for 0.4.0). Otherwise start from the
first-run wizard.

## 5. The sidecar: leave nothing behind (R-83)

- Remi 0.2.0/0.3.0 may have been installed on the host as a sidecar. If so, run
  `C:\Remi\uninstall-remi.bat`, then delete `C:\Remi` (move `C:\Remi\data` aside first if its
  plan should come across, as in step 4).
- **Do not apply** `IIS_RULE.md`. IIS already forwards `/remi/*` to waitress on `:8000`.

## 6. Acceptance on the host (§9)

1. `https://apex.ny1.ninetyone.com/` shows APEX with its tiles. Private Markets works as before,
   and `/api/pm/health` is unchanged.
2. The remi tile opens `/remi/` and shows the first-run wizard (or the imported plan). The "‹ APEX"
   link at the top left goes back.
3. A reload on `/remi/app/timeline` and `/remi/textbook/p1` returns to the same page.
4. A saved note survives `serve-host.bat`.
5. A Textbook chart uploads and renders; `/remi/api/charts/<id>` carries the sandbox CSP.
6. `/remi/api/health` reports `0.4.0` (R-65's table says 0.3.0; the import tag is 0.4.0).
   `runtime\remi\remi.db` exists, and the backup reaches the share.
7. With `REMI_DATA_DIR` pointed at an unwritable path, APEX still boots and `/remi/` shows the
   503 page.
8. Nothing of the sidecar remains.

---

## Requirement status

**Done in Remi's repository, at v0.4.0:**

| R | What |
|---|---|
| R-01 | Tag `v0.4.0`; `backend/remi/PROVENANCE.md` pre-filled (commit and date at copy time) |
| R-02 | The ADRs come across as they are; ADR-0014 supersedes 0012/0013 for deployment |
| R-10 | Backported to 3.11 (13 sites); the full suite passes on 3.11.16 |
| R-11 | `app` → `remi`, in its own commit |
| R-13 | The literal `__version__ = "0.4.0"` |
| R-14 | Migrations inside the package, no `alembic.ini`; the SPA at `frontend/remi/dist`; nothing depends on the working directory |
| R-15 | No uvicorn import when mounted (a test proves it); `python -m remi db …` |
| R-20 | Pinned in Remi's `pyproject` to these versions, plus `a2wsgi` |
| R-22 | No `keyring` dependency; the key comes from the environment |
| R-30 to R-36 | `remi.mount`: path-strip dispatcher, 302, database opened without lifespan, a shared app and engine, failure isolation, `APEX_REMI_ENABLED`, fast when no migration is pending |
| R-41 | `REMI_DATA_DIR` is required by the mount |
| R-44 | Exclusive lock on `<data>/.lock`; a second process gets the 503 |
| R-50 | `PM_ASSISTANT_API_KEY` → `REMI_ANTHROPIC_API_KEY` |
| R-51, R-52, R-54 | Remi's guards and CSPs wrap Remi only, tested through the mount |
| R-60 | Remi's test rules scoped in `remi/tests/conftest.py` |
| R-62 | `remi/ruff.toml`, `remi/pyrightconfig.json` |
| R-64 | `contracts/remi-openapi.json`; `python -m remi.scripts.export_openapi` |
| R-65 | `remi/tests/mount/test_mount.py`: every row, against a stand-in APEX |
| R-70, R-71 | `frontend/remi` is its own project; `base: './'`, `<base href="/">`, stay-local check |
| R-73 | Router basename from `document.baseURI`; nothing in APEX's router |
| R-74, R-75 | Its own document; self-hosted fonts from its `dist` |
| R-63 | The browser checks without Playwright: `frontend/remi/e2e/run.mjs` (`npm run e2e`), for Edge |
| R-76 | "‹ APEX" in the top bar and on Home, when mounted |
| R-80 | The sidecar pipeline deleted (v0.3.0 remains as the fallback) |
| K8 | The Node floor relaxed to `^20.19 \|\| ^22.13 \|\| >=24` and verified |

**Left for the APEX side (steps 0 to 6 above):**
- R-12;
- R-21 (the SDK upgrade and the assistant regression);
- R-23;
- R-31 and R-37 (the launch scripts);
- R-38 (the banner);
- R-42 (the nightly copy);
- R-43;
- R-45 and R-81 (`PRODUCTION.md`);
- R-53 (D3, access control: none, as the user chose before, unless IIS Windows sign-in is
  added on `/remi`);
- R-61;
- R-63 (running `npm run e2e` on APEX's dev server with Edge);
- R-72;
- R-82 (Remi logs on `remi.*` loggers, which APEX's logging picks up with no Remi change);
- R-83.
