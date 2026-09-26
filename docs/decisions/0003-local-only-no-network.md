# ADR-0003: Local only: loopback, single user, no runtime network calls

- Status: Accepted
- Date: 2026-09-24
- Plan: binding decision 3

## Context
Remi holds personal planning notes. The prototype pulls React, Babel, fonts, icons and KaTeX
from CDNs and runs inside Claude Design.

## Decision
- The server binds only to loopback (127.0.0.1 by default). `RemiConfig` and the `remi` CLI both
  refuse any non-loopback host. Single user, no auth.
- Guards instead of auth (later phases): `TrustedHostMiddleware` for loopback names, mutations
  need a loopback `Origin` plus `X-Remi-Client: 1`, a `'self'`-only CSP, no CORS.
- No runtime network calls. Fonts come from `@fontsource` packages (latin + latin-ext only),
  the icons from a committed Material Symbols subset (`frontend/scripts/subset-icons.sh`, which
  downloads only at build time), and KaTeX is bundled. FastAPI's Swagger UI and ReDoc are
  disabled because they load from a CDN; only `/api/openapi.json` is served.
- The only outbound call Remi can ever make is an opt-in AI provider (ADR-0004).

## Consequences
- The Vite build fails if any output file contains an http(s) URL other than an XML namespace
  (`scripts/vite-plugin-stay-local.ts`); `make dist-urls` repeats the check on `dist/`.
- `pytest-socket` limits backend tests to loopback. `make egress` (P4) adds Playwright request
  interception and an offline run.
