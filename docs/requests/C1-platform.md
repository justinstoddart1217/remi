# Requests from C1-platform (frontend app platform)

C1 owns `frontend/src/{app,shell,stores,lib,test}/**`, `src/main.tsx`, `src/App.tsx`,
`src/styles/{derived,motion}.css` and the route placeholders in `src/screens/*/index.tsx`.
These changes are needed outside those paths.

## 1. Remove the P0 App test and its stylesheet (owner: whoever owns `src/` root files / integration)
- `frontend/src/App.test.tsx` asserts the P0 placeholder (`<h1>Remi</h1>`). `App` now renders the
  data router, so this test fails by design.
- `frontend/src/App.module.css` is no longer imported by anything.
- Request: delete both. The replacement coverage is `src/shell/ScreenStack/ScreenStack.test.tsx`,
  which renders the real route table (`routes` from `src/app/router.tsx`) in a memory router
  through `src/test/renderApp.tsx`.

## 2. Stay-local check rejects react-router's inert strings (owner: `frontend/scripts/`)
`vite build` (and so `make build` / `make check`) fails in `scripts/vite-plugin-stay-local.ts`
(and would in `scripts/check-dist-urls.mjs`) because react-router 7 bundles two strings that are
never fetched:
- `https://reactrouter.com/en/main/routers/picking-a-router.`: an error-message doc link.
  Request: add `['https://reactrouter.com/', 'reactrouter.com/']` to `INERT_DOC_LINKS`.
- `"http://localhost"`: react-router's URL-parsing fallback base (`createBrowserURLImpl`,
  `new URL("http://localhost")`), used only when `window` is undefined. It is loopback, not
  egress. Request: allow exactly `http://localhost` (as a parse base) in `findExternalUrls`, or
  rewrite it inertly in `stripInertDocLinks`.
I checked the rest of the bundle: with those two handled, the build is clean, and the
Foundations chunk is dropped from production.

## 3. Contract notes (owner: backend schemas / API)
The frontend now uses the backend's names directly:
- `CalendarDay` in `src/lib/calendar.ts` mirrors `CalendarDayOut` `{iso, w, bd, bdm, hol, week}`.
- `Movement` in `src/stores/planMoves.ts` mirrors `schemas/mutation.py` `Movement`
  (`deltaBd`, `flash`, `moved`, …).
- `SetupGate` reads `GET /api/setup` → `needsSetup` (also accepts `required`). Until the endpoint
  exists (404/501/network error) setup counts as not required.
Please keep these field names when `make openapi` regenerates `schema.d.ts`.

## 4. Parity driver alignment (owner: `parity/drivers/remi.ts`)
- Supported deep links: `?palette=<query>`, `?drawer=<projectId|new|any>` (both read on shell
  mount), `/app/calendar/<YYYY-MM>?day=<iso>`, `/app/today/<iso>`, `/app/projects/<id>`.
- `/foundations` is the route in PLAN.md; `/dev/foundations` is also registered (dev only) for
  the driver.
- The driver opens a routine with `/app/routines?routine=<id>`, but `paths.routines()` (from
  arch-frontend-core §3) builds `?focus=<id>`. One of them should change; the Routines screen
  agent should read whichever is chosen.
