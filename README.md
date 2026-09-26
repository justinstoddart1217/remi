# Remi

Remi is a personal workflow dashboard that runs only on your own computer (a Mac; Windows has a
launcher too), or on the APEX server for your work laptop (see
[Hosting on the APEX server](#hosting-on-the-apex-server)). It plans BAU and project work across Private Credit and Fixed Income, about three
months ahead and one business day at a time, to keep the move from PC to FI on schedule:
routines pinned to business-day rules, a Fixed Income country rotation, goal-first projects
forecast from work left and hours a day, check-ins, daily notes and a textbook. When something
changes, Remi recalculates the plan.

This repo productionises the Claude Design prototype in `Remi Dashboard Design Review/`
(a read-only reference) as a FastAPI backend plus a React frontend, with a real database,
calendar and clock.

- Plan and binding decisions: [`docs/PLAN.md`](docs/PLAN.md)
- Decisions (ADRs): [`docs/decisions/`](docs/decisions/README.md)
- Design spec used for implementation: [`docs/design-spec/`](docs/design-spec/)

> Status: **feature complete (Phase 4).** Every screen of the design, the first-run wizard,
> Settings and the Textbook are built on the full API. `make check` runs every gate below; the
> visual-parity figures are in [`docs/parity-report.md`](docs/parity-report.md).

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| [uv](https://docs.astral.sh/uv/) | 0.12+ | `brew install uv`, then `uv python install 3.12` |
| Python | 3.12 | managed by uv (`backend/.python-version`); the system Python is not used |
| Node.js / npm | 24+ / 11+ | Node 25 is what the repo is developed on |

## Launching Remi

Double-click the launcher at the root of the repo:

| | macOS | Windows |
| --- | --- | --- |
| Launcher | `launch.command` (Finder) | `launch.bat` (File Explorer) |
| Needs | [uv](https://docs.astral.sh/uv/) and Node.js (`brew install uv node`) | uv and Node.js, installed from their websites |
| Rebuilds the app | whenever the frontend sources are newer than the last build | on first run only; set `REMI_REBUILD=1` after updating the code |
| Your data | `~/Library/Application Support/Remi` | `%LOCALAPPDATA%\Remi` |

What a launcher does:

1. If Remi is already running on its port, it just opens it in your browser.
2. Otherwise it checks that uv and Node.js are installed (and says how to get them if not).
3. The first time (and on macOS whenever the code has changed) it builds the app into
   `frontend/dist`, installing the frontend's npm packages first if they are missing. That takes
   about a minute. uv sets up Python 3.12 and the backend's packages on first use.
4. It starts Remi on http://127.0.0.1:8765 and opens it in your browser. A fresh install opens
   the first-run wizard.

Keep the launcher's window open while you use Remi. **To stop Remi, close that window** (or press
Ctrl+C in it). Your data stays in the folder above (`remi.db`, `charts/`, `backups/`) between
runs, and nothing leaves your computer unless you choose an AI provider (see below).

- `REMI_PORT=9000 ./launch.command` (macOS) or `set REMI_PORT=9000` then `launch.bat` (Windows)
  runs Remi on another port. Extra arguments go to Remi, e.g. `./launch.command --no-browser`.
- `REMI_REBUILD=1` (Windows only) forces a rebuild of the app after you update the code; the
  macOS launcher notices changes by itself.
- The first time you open it, macOS may refuse a script it has not seen before: right-click
  `launch.command` › Open › Open (or run `chmod +x launch.command` if it opens as text). Windows
  SmartScreen may show "Windows protected your PC": More info › Run anyway.
- To have Tell Remi use Anthropic, install the extras once (`cd backend && uv sync --extra
  anthropic --extra keyring`) and paste the key in Settings, or set `REMI_ANTHROPIC_API_KEY`
  before launching; see [AI provider](#ai-provider-check-in).

The launchers run the same thing as `make serve` without the Makefile: `uv run python -m app.main`
from `backend/` (see the iCloud note below for why not the `remi` script).

## Getting started

```sh
make setup      # uv sync (backend), npm ci (frontend and parity/)
make browsers   # once: Playwright's Chromium, for make parity / behaviour / egress
```

### Day to day: one process

```sh
make serve      # builds frontend/dist, then runs Remi on http://127.0.0.1:8765 and opens it
```

`make serve` runs the backend with `REMI_ENV=prod` and serves the API under `/api` and the built
app for every other path (client routes get `index.html`; hashed assets are cached). Stop it with
Ctrl-C. A fresh install opens the first-run wizard (the move, your working day, the Fixed Income
rotation, the Tell Remi provider) and then starts with an empty plan: there is no sample data
outside the test fixtures.

### Development: two processes

```sh
make dev        # API on http://127.0.0.1:8765 (reload), Vite on http://127.0.0.1:5173
```

Open http://127.0.0.1:5173. Vite proxies `/api` to the backend. `make dev` sets `REMI_ENV=dev`
and keeps **its own data folder**, never the `remi.db` that the launchers, `make serve` and
`remi` use: a dev build can replace the whole database with the sample fixture (⌘K "Reset to
sample data"). The folder is `REMI_DEV_DATA_DIR`, by default `dev/` inside Remi's data folder
(`~/Library/Application Support/Remi/dev`); `make dev-data-dir` prints it. An exported
`REMI_DATA_DIR` does not apply to `make dev`. `make dev API_PORT=8800 WEB_PORT=5200` moves both
servers.

### The `remi` command

`remi` is the backend's CLI (`app.main:cli`). It binds 127.0.0.1 only and opens the browser:

```sh
remi                          # http://127.0.0.1:8765, opens the browser
remi --port 8800 --no-browser # another port, no browser
remi --data-dir /tmp/remi     # another data folder (default ~/Library/Application Support/Remi)
remi db path                  # where remi.db lives
remi db upgrade               # back up, then migrate to the latest schema (also done at startup)
remi db backup                # copy remi.db into backups/
remi --network --host 0.0.0.0 # server mode: other computers may open it (no sign-in; see below)
```

It serves the built app from `frontend/dist` (run `make build` first, or point `REMI_FRONTEND_DIST`
at a build). To put `remi` on your PATH:

```sh
uv tool install --editable ./backend
```

> **iCloud Desktop note.** When the repo sits in an iCloud-synced folder (this one is on the
> Desktop), macOS flags dot-folders such as `backend/.venv` as hidden, and Python 3.12 skips
> hidden `.pth` files. The editable install's `remi` script *inside* `backend/.venv` then cannot
> import `app`. Two ways round it:
> - `uv tool install --editable ./backend` puts the tool's venv outside the synced folder, so
>   its `remi` works;
> - or run the same entry point as a module from `backend/`, which never needs the `.pth`:
>   `cd backend && uv run python -m app.main [--port N] [--no-browser] [db path|upgrade|backup]`.
>
> The Makefile always uses the module form (`python -m app.main`, `python -m
> scripts.export_openapi`), and pytest adds the source tree to `sys.path`.

## Hosting on the APEX server

Remi can also run on the APEX server, a Windows computer on the Ninety One network, and open
from a "remi" tile on APEX's landing page. The guide, step by step:
[`docs/deploy/APEX.md`](docs/deploy/APEX.md) ([ADR-0012](docs/decisions/0012-apex-server-bundle.md)).

- **Develop here, release to GitHub.** `make release VERSION=x.y.z` bumps the version, tags it
  and pushes. [`.github/workflows/release.yml`](.github/workflows/release.yml) then builds
  `remi-<version>-windows.zip`, installs and tests it on a Windows runner, and publishes it as a
  GitHub Release. `make bundle` builds the same zip locally, to look inside.
- **The bundle is self-contained:** its own Python 3.12, the locked dependencies, the backend and
  the built dashboard. The server needs nothing installed.
- **The server only pulls.** `C:\Remi\update-remi.bat` downloads the latest release with a
  read-only GitHub token, backs up the database, switches over and goes back by itself if the
  new version does not start. Nothing on the work side ever pushes.
- **Server mode** (`REMI_NETWORK=1`): Remi binds `0.0.0.0` and answers to the server's own
  names and addresses (plus `REMI_ALLOWED_HOSTS`). It runs at startup as a Windows task under
  the low-privilege LOCAL SERVICE account, with its data in `C:\Remi\data`.
- **No sign-in.** Anyone on the network who can reach port 8765 can open and change Remi. The
  Host and Origin checks still stop other websites from using your browser to change it.

## Make targets

| Target | What it does |
| --- | --- |
| `setup` | Install backend (uv), frontend and parity (npm) dependencies |
| `browsers` | Install Playwright's Chromium |
| `dev` | Backend with reload on 127.0.0.1:8765 plus Vite on 127.0.0.1:5173, on its own data folder |
| `dev-data-dir` | Print that folder (`REMI_DEV_DATA_DIR`, default `<Remi data>/dev`) |
| `serve` | Build the frontend, then run Remi as one process on 127.0.0.1:8765 |
| `build` | `tsc -b && vite build` into `frontend/dist`, then check it has no external URLs |
| `lint` | `ruff check`, `ruff format --check`, `eslint` |
| `typecheck` | `pyright` (strict), `tsc -b` for the frontend and `tsc` for the parity harness |
| `test-backend` / `test-frontend` / `test-harness` / `test` | pytest / vitest / `node --test` on `parity/tests` (the Remi-only states and their approvals, and these docs against the files they describe) / all three |
| `openapi` | FastAPI → `contracts/openapi.json` → `frontend/src/api/schema.d.ts` |
| `openapi-check` | Fail if the committed contract or TS schema is stale |
| `design-verify` | Fail if the design folder differs from `docs/design-spec/design-manifest.sha256` |
| `goldens` / `goldens-check` | Extract the prototype's golden values into `parity/golden/` / fail if they are stale |
| `parity-baseline` | Capture the prototype's baselines (`parity/baselines/prototype/`) |
| `parity` | Visual parity of Remi against the prototype, written to `docs/parity-report.md` (`STATE=<regex>`; `PARITY_APPROVE=1 PARITY_APPROVER="<who>"` approves Remi-only captures) |
| `parity-confirm` | A person signs off approved Remi-only baselines after looking at them (`STATE=<regex> BY="<name>"`) |
| `behaviour` | The Playwright behaviour flows against Remi (`FLOW=<regex>`) |
| `egress` | The stay-local crawl of a fresh production build |
| `icons` | Rebuild the Material Symbols subset (downloads at build time only) |
| `bundle` | Build the Windows server bundle into `build/release/` (releases build it on GitHub) |
| `release` | `VERSION=x.y.z`: bump the version, commit, tag and push; GitHub builds and publishes the bundle |
| `check` | `lint typecheck test openapi-check design-verify build goldens-check parity behaviour egress` |

`make help` lists them all. `make check` must be green, offline, before anything is merged. The
parity, behaviour and egress runs start their own backend and frontend on 127.0.0.1:8804 and
5304 (`REMI_PARITY_API_PORT` / `REMI_PARITY_WEB_PORT` move them), so they can run beside
`make dev`; [`parity/README.md`](parity/README.md) explains the harness.

A full `make check` takes a while. On a Mac, run it as `caffeinate -i make check` so the machine
does not idle-sleep in the middle: a browser test that spans a sleep fails on its timeout.

## Configuration

Process settings come from `REMI_*` environment variables (`backend/app/core/config.py`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `REMI_DATA_DIR` | `~/Library/Application Support/Remi` (Windows: `%LOCALAPPDATA%\Remi`) | `remi.db`, `charts/`, `backups/`. Not used by `make dev`, which has `REMI_DEV_DATA_DIR` |
| `REMI_HOST` | `127.0.0.1` | Must be a loopback address unless `REMI_NETWORK=1` |
| `REMI_NETWORK` | `false` | Server mode (the APEX server): any bind address, and Remi answers to this computer's own names and addresses. No sign-in |
| `REMI_ALLOWED_HOSTS` | empty | Server mode only: more names Remi answers to, comma-separated (a DNS alias, say); `*` for any |
| `REMI_PORT` | `8765` | |
| `REMI_ENV` | `prod` | `prod`, `dev` or `test` (`test` enables `POST /api/dev/fixtures`) |
| `REMI_TODAY` | unset | Start the business date on this day; the wall clock keeps running (tests and parity runs) |
| `REMI_NOW` | unset | Dev and test only: stand the clock still at this instant, e.g. `2026-10-05T09:30:00+01:00` (it must fall on `REMI_TODAY`) |
| `REMI_DEFAULT_TIMEZONE` | unset | Dev and test only: the zone the first-run wizard pre-fills instead of the Mac's own |
| `REMI_WEB_PORT` | `5173` | Dev and test only: the Vite port whose origin may send mutations |
| `REMI_FRONTEND_DIST` | `frontend/dist` | Built SPA to serve |
| `REMI_CHART_MAX_BYTES` | `4194304` | Textbook chart upload limit |
| `REMI_OPEN_BROWSER` | `true` | Whether `remi` opens the browser |
| `REMI_ANTHROPIC_API_KEY` | unset | The Anthropic key, if you use that provider and do not keep it in the Keychain |

Used only by the tooling, not by Remi itself:

| Variable | Used by | Meaning |
| --- | --- | --- |
| `REMI_DEV_DATA_DIR` | `make dev` | Its data folder (default `<Remi data>/dev`) |
| `REMI_REBUILD` | `launch.bat` | `1` rebuilds the app before starting |
| `REMI_API_PORT` / `REMI_WEB_PORT` | Vite (`make dev`) | Where Vite proxies `/api`, and its own port |
| `REMI_PARITY_API_PORT` / `REMI_PARITY_WEB_PORT` | `make parity`, `behaviour`, `egress` | The harness's own ports (8804 / 5304) |
| `REMI_UPDATE_REPO` | the APEX server's `update-remi.bat` (`C:\Remi\server.env`) | The GitHub repository releases come from |
| `REMI_GITHUB_TOKEN` | the same | A read-only token for it, instead of the one saved on the server |

Everything else (move date, working hours, holidays, rotation, appearance) is set in the app's
first-run wizard and Settings page and stored in the database.

## AI provider (check-in)

The check-in drawer can read a free-text update and propose changes. Providers are pluggable
([ADR-0004](docs/decisions/0004-pluggable-ai-check-in.md)):

| Provider | Setup | Network |
| --- | --- | --- |
| `none` (**default**) | nothing | none: a deterministic "simple reading" parser |
| `anthropic` | `cd backend && uv sync --extra anthropic --extra keyring`; then paste the key in Settings › Tell Remi (stored in the macOS Keychain), or set `REMI_ANTHROPIC_API_KEY` (or `ANTHROPIC_API_KEY`) before starting Remi | calls the Anthropic API only when you send a check-in |
| `ollama` | run Ollama on this Mac and pull a model (default `llama3.1`); the base URL must be a loopback address (default `http://127.0.0.1:11434`) | loopback only |

Choose the provider in the first-run wizard or in Settings › Tell Remi, where you can also set
the model (Anthropic defaults to `claude-opus-5`) and whether your recent notes are sent along
with a check-in (off by default). The key is write-only: the API never returns or logs it, and
Settings only says whether one is configured. The server builds the context itself, and goals,
charters and risks are never sent. AI output is always a proposal that you review, untick and
apply yourself; if the provider fails, "Use a simple reading" gives the offline parser's
proposal instead. Every provider call is recorded in the `ai_audit` table.

## Stays local

Remi never talks to the network on its own
([ADR-0003](docs/decisions/0003-local-only-no-network.md)). The guarantee:

- It binds to 127.0.0.1 only. The CLI and config refuse non-loopback hosts, the server accepts
  only loopback `Host` headers, and every mutation needs a loopback `Origin` plus the
  `X-Remi-Client: 1` header. Single user, no accounts, no CORS.
- The one exception is opt-in: server mode (`REMI_NETWORK=1`, only on the APEX server) lets
  other computers on the network open Remi, under the same Host and Origin checks for the
  server's own names. It still makes no outbound calls; only the server's update script talks
  to GitHub.
- The app's Content-Security-Policy is `'self'` only. Live charts run in `sandbox="allow-scripts"`
  iframes under `default-src 'none'; connect-src 'none'`, so a chart cannot fetch anything.
- Fonts (Ninety One Visuelt) are self-hosted WOFF2 files; icons are a committed Material Symbols
  subset; KaTeX is bundled. Nothing loads from a CDN, and FastAPI's
  CDN-backed Swagger UI and ReDoc are disabled.
- The only outbound call Remi can make is to the AI provider you choose. The default, `none`,
  makes none; `ollama` is refused unless its URL is loopback; `anthropic` calls the Anthropic
  API only when you send a check-in.

How to verify it:

```sh
make egress      # Playwright crawl of a fresh production build, served by the backend
make dist-urls   # frontend/dist holds no http(s) URL except XML namespaces (also part of make build)
make test-backend  # pytest under pytest-socket: sockets only to 127.0.0.1
```

`make egress` visits every screen and state, runs the key flows (a check-in applied, the AI
error phase, Notes, Today ticks, the NavRail, Home keys, the Textbook chart full screen, a first
run on an empty install), and fails on any request, websocket or CSP-blocked attempt that is not
127.0.0.1, `data:`, `blob:` or `about:`, from any page or frame, the sandboxed charts included.
Two self-tests prove it would catch one. For a belt-and-braces check, turn Wi-Fi off and run
`make check`: every gate runs offline.

## Repository layout

```
Remi Dashboard Design Review/   read-only design reference: the Ninety One redesign, with the original
                                design kept in its "Remi v1/" subfolder (checked by make design-verify)
Remi Dashboard Design Review.zip   the same export as downloaded from Claude Design (not used by the app)
docs/        PLAN.md, SPEC.md, api.md, design-spec/, decisions/ (ADRs), requests/, parity-report.md
backend/     uv project: app/{api,core,schemas,services,repositories,utils}, tests/, scripts/
frontend/    Vite + React + TS: src/{app,api,shell,screens,components,stores,lib,styles,assets}, scripts/
parity/      Playwright harness: prototype baselines, goldens, parity, behaviour and egress suites; tests/
contracts/   openapi.json (generated, committed)
deploy/      the APEX server: windows/ (remi-server.ps1 and its .bat shortcuts), apex/ (the tile)
build/       make bundle output (ignored); .github/workflows/release.yml builds releases
launch.command   double-click launcher (macOS)
launch.bat       double-click launcher (Windows)
Makefile
README.md
```
