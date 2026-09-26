# ADR-0013: Behind APEX's IIS at /remi/

- Status: accepted, 2026-09-26 (release 0.3.0)
- Amends: ADR-0012, replacing its tile, server mode and firewall parts for the APEX server
- Requested by: the APEX side ("Remi change request: serve under /remi/ behind APEX's HTTPS proxy")

## Context

ADR-0012 put Remi on the APEX server at `http://<server>:8765/`, reached from a Jinja tile. APEX
actually runs differently:

- IIS terminates TLS at `https://apex.ny1.ninetyone.com` and reverse-proxies to APEX's waitress
  on loopback.
  - Nobody opens a server name and port.
  - A plain-http port needs IT to open the firewall, and it is a different origin from APEX.
- APEX's landing page is a React SPA, which now carries its own tile: `<a href="/remi/">`.
- Behind HTTPS the browser sends `Origin: https://apex.ny1.ninetyone.com`. Remi only accepted
  `http://<host>:<port>` origins, so it refused every write.

## Decision

Remi stays a separate process with its own releases. It now sits **behind APEX's IIS at
`https://apex.ny1.ninetyone.com/remi/`**:

- It binds `127.0.0.1` only.
- There is no firewall port.
- IIS removes the `/remi` prefix before forwarding (APEX `docs/remi/IIS_RULE.md`:
  `^remi/(.*)` → `http://127.0.0.1:8765/{R:1}`, and `^remi$` → 302 `/remi/`). Remi's own routes
  do not change.

The changes:

- **One setting, `REMI_PUBLIC_URL`.** It takes an absolute http(s) URL with a host, and no query,
  fragment or credentials. It is normalised: lower-case scheme and host, a default port dropped,
  no trailing slash. From it come `base_path` (`/remi`), `public_origin`
  (`https://apex.ny1.ninetyone.com`) and `public_host`.
  - It is independent of server mode. The point is a loopback bind behind a proxy.
  - Unset, nothing changes.
- **The base is decided at runtime.** One build serves both the laptop at `/` and the server at
  `/remi/`:
  - When `SpaFiles` serves `index.html`, it replaces any `<base>` with `<base href="{base_path}/">`
    as the first child of `<head>`, HTML-escaped.
  - Vite builds with `base: './'`, so asset links and lazy chunks resolve against it; `vite dev`
    keeps `/`.
  - The source `index.html` ships `<base href="/">`, so `vite preview` and the dev server behave
    as before.
- **The frontend follows `document.baseURI`.** `src/lib/basePath.ts` reads it (`""` without a
  `<base>`). The router's basename is `/remi/` (with a slash, so Home is `/remi/` like the tile),
  and `API_BASE_URL` is `/remi/api`, so the chart frames follow. The few plain anchors go through
  `appHref`, and `RouteError` and the dev-only Foundations links became router `<Link>`s.
- **The Host and Origin checks accept the public address.** `allowed_hosts` adds `public_host`,
  and `allowed_origins` adds `public_origin`. The loopback names stay, so either Host IIS
  forwards works. The Origin must still be in the set, and `X-Remi-Client: 1` is still required.
- **No redirects.** `redirect_slashes=False`: FastAPI's trailing-slash redirect carries an
  absolute `Location` that IIS would not rewrite. A test walks every operation in the contract,
  with and without a trailing slash, and finds no `Location` header.
- **CSP `base-uri 'self'`** (it was `'none'`). This is the one change to the app CSP, and it is
  needed: `'none'` blocks the `<base>` element itself, and asset links then resolve against the
  route (`/remi/app/assets/…`). A base on any other origin is still refused. Everything else in
  the CSP, the chart sandbox and the stay-local rules is unchanged.
- **Windows scripts.**
  - `install -PublicUrl https://apex.ny1.ninetyone.com/remi` writes a `server.env` with
    `REMI_HOST=127.0.0.1`, `REMI_PORT`, `REMI_PUBLIC_URL`, `REMI_DATA_DIR` and
    `REMI_UPDATE_REPO`, and no `REMI_NETWORK`.
  - The firewall rule now follows `server.env`: it is opened only in server mode and removed
    otherwise.
  - An existing `server.env` is never rewritten. The installer prints the hand edit, which
    `docs/deploy/APEX.md` also gives.
  - `status` and the install summary show the public URL. The health check stays on
    `http://127.0.0.1:<port>/api/health`.
- **Tests.**
  - Backend:
    - the setting's validation;
    - `<base>` injection and escaping;
    - public Origin and Host accepted with the setting and refused without it, and foreign
      ones refused;
    - the no-redirect walk.
  - Frontend: `basePath()` at `/` and `/remi/`, and the API client building `/remi/api/...`.
  - Harness: `parity/specs/proxy.spec.ts`, in the egress run, puts that run's production build
    behind a Node proxy that strips `/remi`. It runs deep links and reloads, every screen,
    saving, the Textbook chunk with KaTeX and a chart upload, Settings and the first-run
    wizard. It fails on any request outside `/remi/` and on any `Location` from Remi.
  - `release.yml` reinstalls with `-PublicUrl` after the server-mode legs. It checks:
    - `server.env` has no server mode, and there is no firewall rule;
    - Remi listens on 127.0.0.1 only;
    - `index.html` has `<base href="/remi/">`;
    - the public Host passes, and a write from the public Origin passes while a foreign one
      gets a 403;
    - the data survived.

  The GitHub update then runs behind the proxy too.

## Consequences

- **The laptop is unchanged.** With `REMI_PUBLIC_URL` unset, the page says `<base href="/">`
  and every route, the API and the Origin rules are as before. `make check` covers it.
- **ADR-0012's server mode stays** as the no-proxy alternative (`install` without
  `-PublicUrl`). The APEX server uses the proxy.
- `deploy/apex/remi-tile.html` is deleted: the tile lives in APEX.
- **Remi still has no sign-in.** Anyone who can open `https://apex.ny1.ninetyone.com/remi/` can
  use it, as with APEX itself.
