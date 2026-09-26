# ADR-0012: Hosting Remi on the APEX server

- Status: accepted, 2026-09-26
- Amends: ADR-0003 (local only), with an opt-in server mode
- Amended by: [ADR-0013](0013-behind-apex-iis.md). On the APEX server Remi sits behind IIS at
  `/remi/` on loopback; server mode, the firewall rule and the Jinja tile below are the
  no-proxy alternative

## Context

The user develops Remi on a Mac and wants to use it at work from a "remi" tile on APEX. APEX is
an internal Flask site on an old Windows computer on the Ninety One network, used only by the
user. Company rules allow pulling from the user's personal GitHub, but nothing may be pushed
from the work side. APEX has no login; its data lives in Databricks.

The user chose:

- Remi runs on the APEX server itself.
- The server pulls updates from GitHub.
- No sign-in.

## Decision

- **A separate program.** Remi runs on the server as its own process, on its own port (8765),
  with its own SQLite database. APEX only gets a tile that links to it
  (then `deploy/apex/remi-tile.html`; ADR-0013 removed it, since APEX carries its own tile).
  Databricks is not involved.
- **Server mode.** `REMI_NETWORK=1` (or `remi --network`) lets Remi bind a non-loopback
  address. The Host allowlist then adds this computer's own names and IPv4 addresses
  (`machine_names()`, lower-cased) and `REMI_ALLOWED_HOSTS`, and mutations need an Origin
  among those names on Remi's port.
  - With `REMI_ALLOWED_HOSTS=*`, any name is allowed, and the Origin must match the request's
    own Host.
  - Server mode never opens a browser. It prints the URLs it answers to.
  - Loopback stays the default. `REMI_ALLOWED_HOSTS` without server mode is refused.
- **A self-contained bundle.** `backend/scripts/build_bundle.py` (`make bundle`) builds
  `remi-<version>-windows.zip`. It holds:
  - CPython 3.12 for Windows (python-build-standalone via uv, with Tk, IDLE and pip removed);
  - the locked runtime dependencies, installed for `x86_64-pc-windows-msvc` with `--target`;
  - the backend source, precompiled as unchecked-hash .pyc, since Remi's account cannot write
    `__pycache__`;
  - the built SPA, stay-local checked;
  - the Windows scripts.

  `backend/` and `frontend/dist/` keep their relative places, so `app.core.paths` works
  unchanged. The server needs neither uv, pip nor PyPI. The version comes from
  `backend/pyproject.toml` (`app.__version__` reads it first), and `GET /api/health` reports it.
- **Releases on GitHub.** `make release VERSION=x.y.z` bumps, commits, tags and pushes.
  `.github/workflows/release.yml` then runs on `windows-latest`. It:
  1. builds the bundle;
  2. installs it through `install-remi.bat` into `C:\Remi`, as on the server;
  3. checks health by machine name, that the process runs as LOCAL SERVICE, that setup saves,
     and that foreign Hosts and Origins are refused;
  4. updates from the zip, restarts and checks the data survived;
  5. publishes the zip and its SHA-256;
  6. updates again through the GitHub API;
  7. uninstalls.

  This is the only place the PowerShell is executed.
- **The server only pulls.** `deploy/windows/remi-server.ps1`, with double-click `.bat`
  shortcuts:
  - `install` copies the release into `C:\Remi\releases\<version>`, writes `server.env`, gives
    LOCAL SERVICE read access (and modify on `data\` and `logs\`), opens TCP 8765 in the
    firewall, and registers a startup task. The task runs as LOCAL SERVICE, never SYSTEM, with
    no time limit, and restarts Remi if it stops.
  - `update` downloads the latest release through the GitHub API with a fine-grained
    **read-only** token, saved with DPAPI for that Windows account. The API's redirect is
    followed without the token, and the checksum is verified. It then backs up the database,
    switches `current.txt`, starts Remi and waits for health on the new version. If that fails,
    it goes back to the previous release by itself.
  - `-Zip <file>` installs a zip downloaded by hand.
  - The other commands are `rollback`, `restart`, `stop`, `status` and `uninstall`; uninstall
    keeps `data\`.

## Consequences

- **No sign-in**, by the user's choice: anyone on the network who can reach port 8765 can read
  and change Remi. The Host and Origin checks still stop DNS rebinding and cross-site changes,
  and CSP and the chart sandbox are unchanged. A passcode can be added later.
- **A browser does not treat a plain-http network name as a secure context.** Remi relies on no
  API that needs one (`crypto.randomUUID` has fallbacks). The only effect is a console notice
  that `Cross-Origin-Opener-Policy` was ignored.
- **Rolling back past a migration:** Remi refuses a database written by a newer schema, so going
  back means restoring the backup the update made (`data\backups\`). The guide explains how.
- **The Windows scripts must stay ASCII.** Windows PowerShell 5.1 reads a .ps1 without a BOM in
  the ANSI code page. `build_bundle` enforces this and writes CRLF line endings.
