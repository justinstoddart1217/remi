# Remi: productionise the Claude Design prototype

## Context
The user finished designing Remi in Claude Design. The export in `remi/Remi Dashboard Design Review/` is a working prototype:
- 14 `.dc.html` components on a generated runtime (`support.js`);
- all state in one in-browser `model` (`Remi.dc.html`), persisted to `localStorage`;
- sample data and "today" (Mon 5 Oct 2026) hard-coded;
- React, fonts and KaTeX loaded from CDNs;
- a check-in that calls `window.claude.complete`, which exists only inside Claude Design.

The goal is a production local app that looks and moves exactly like the design. It will have a React + TS frontend and a Python FastAPI backend in the user's folder layout, with a real database, a real calendar and clock, and no network egress.

Two read-only workflows have already produced an exhaustive spec: a design extraction (17 agents) and an architecture design (5 agents). The spec covers every entity, algorithm, interaction, motion value and piece of copy, plus about 100 completeness corrections. It currently lives in session temp files, and **Phase 0 copies it into the repo** as the implementation reference:
- `/private/tmp/claude-501/-Users-justinstoddart-Desktop-Ninety-One-remi/622aff35-855d-49a3-a808-4e619d697863/tasks/ws5i1wijn.output` → `docs/design-spec/extraction.json`;
- `…/tasks/w5c1xa5v5.output` → `docs/design-spec/architecture.json`.

## Binding decisions
1. **Backend:** Python 3.12 + FastAPI. The top-level packages are exactly `api/` (endpoints), `core/`, `schemas/`, `services/`, `repositories/` and `utils/`.
2. **Frontend:** React 19 + TypeScript (Vite).
3. **Local only:** binds to 127.0.0.1, single user, no auth. **No runtime network calls**: fonts, icons and KaTeX are self-hosted or bundled.
4. **AI check-in:** pluggable, `none | anthropic | ollama`, **default `none`**, which uses a deterministic "simple reading" parser. The server builds the context and holds keys. AI output is always a proposal that the user reviews before anything applies.
5. **Scope:** everything, meaning Home launcher, 8 app screens, check-in drawer, ⌘K palette, Notes and Textbook. Foundations is a dev-only route.
6. **Start empty:** a first-run wizard and real empty states. Design sample data exists **only** as test fixtures.
7. **Forecasting:** the design's per-project model (work left + hours a day), with **unified formulas so preview == apply**. The hard-coded `bd3/bd8`, `ret`/`r-ret`/`DEC_RUN` and 8h values are generalised.
8. **Build what the design renders.** Features the prototype computes but never shows (phase stepper, exit routes, scope log list, risks, feed/attention/prompt, structured check-in form) are **stored as data but get no UI**.
9. **Day counts exclude today and the move day everywhere.** The countdown is 61, and the buffer is the business days strictly between the last PC exit and the move.
10. **New UI for data the design can't create:**
    - a first-run wizard;
    - a Settings page (move, hours, holidays, timezone, rotation editor, key project/run, AI provider, appearance);
    - inline add-item lists, reusing the Charter list pattern, for routine checklists (on Routines) and FI onboarding items (on Transition).

    All of it uses the Foundations design language.

## Repo layout (git init at `remi/`)
```
remi/
  Remi Dashboard Design Review/   # read-only reference (make check asserts it is unchanged)
  docs/  SPEC.md  CLAUDE_DESIGN_BRIEF.md  design-spec/  decisions/ (ADRs)  parity-report.md
  backend/  pyproject.toml uv.lock alembic/ app/ tests/
  frontend/ package.json vite.config.ts src/ e2e/
  parity/   playwright.config.ts drivers/ golden/extract.mjs vendor-routes.ts specs/ baselines/
  contracts/openapi.json          # generated, committed
  Makefile  README.md  .gitignore
```
**Toolchain:** Node 25 and npm are already installed. **Install `uv` via Homebrew**, then run `uv python install 3.12`; system Python is only 3.9.

## Backend (`backend/app/`)
- `main.py`: `create_app(config, clock)` and the `remi` CLI. The CLI starts uvicorn on 127.0.0.1:8765 and opens the browser. Subcommands: `remi db path|upgrade|backup`.
- `api/`: `deps.py`, `middleware.py`, `static.py`, `errors.py`, plus `endpoints/` for health, setup, settings, plan, day, home, projects, milestones, tasks, charter, routines, rotation, checkins, notes, textbook and charts.
- `core/`:
  - `config.py` (`REMI_*` env; the host is locked to loopback)
  - `paths.py` (`~/Library/Application Support/Remi/`: `remi.db`, `charts/`, `backups/`)
  - `db.py` (SQLite with WAL, `foreign_keys=ON`, `BEGIN IMMEDIATE` for writes)
  - `migrations.py` (Alembic upgrade on startup, with a backup first)
  - `uow.py`: **one mutation = one transaction = one `remi_events` row**, with before-flush diff capture and a guard that fails any mutation that forgot to record its event
  - `clock.py` (`SystemClock` in the business timezone, `FixedClock` for tests, `OffsetClock` for `REMI_TODAY`)
  - `ids.py`, `errors.py`
- `schemas/`: Pydantic v2 DTOs in camelCase. These produce the OpenAPI contract.
- `repositories/`:
  - `models/`: SQLAlchemy 2 ORM tables for:
    - settings (singleton), holidays and holiday years, leave;
    - projects, charter items, milestones, tasks, hour overrides;
    - **`project_bau_day_hours(project, routine, hours)`**, which replaces bd3/bd8;
    - scope changes, checkins (a full snapshot including target and milestones), readiness items, risks, checklists and items;
    - routines, routine checklist items, `routine_runs` and ticks keyed by occurrence date;
    - rotation and segments, notes, entity aliases, feed events, `remi_events`, `ai_audit`;
    - textbook sections, pages and blocks (with a version for optimistic locking), and chart assets.
  - One repository per aggregate, typed by Protocols.
- `services/`:
  - `engine/`: **pure functions, no I/O**, over frozen dataclasses:
    - `calendar.BusinessCalendar`: `next_bd`, `add_bd`, `bd_diff`, `bd_between`, `bdm`. It raises when the range runs out instead of clamping.
    - `routines`: `occurs`, `counts_on`, `next_occurrences`, `last_occurrence_before`.
    - `rotation`: `layout`, `current`.
    - `forecast`, `loads`, `derive`, `verdict`, `flags`, `allocation` (focus blocks and month snapshot), `checkin` (`plan_project_changes`, `preview`, `diff_movements`), `aliases` (one word-boundary tagger for Notes and the simple reader), `simple_reading`, `validate`.
  - `ai/`: `base` (the `ParseProvider` protocol and a discriminated union of the 9 Change types), `context` (server-built; goals, charters and risks are never sent; notes only when enabled), `anthropic_provider` (official SDK, strict tool-use schema; load the `claude-api` skill before writing it; the model is configurable), `ollama_provider` (httpx to a loopback-only address with a JSON-schema format), a parse registry with cancellation, timeouts and the `ai_audit` log.
  - Domain services: `setup`, `settings`, `holidays` (generated offline by the `holidays` package, GB-ENG/ZA, auto-extended by year), `projects`, `routines`, `rotation`, `checkins`, `notes`, `textbook`, `chart_store` (content-addressed, 4 MB, garbage-collected after commit), `views` (read models).
- `utils/`: `dates`, `text`, `hashing`, `fs` (atomic write).

### Unified forecast maths (`services/engine/forecast.py`, ADR-0007)
- **`day_hours(p,d)`**, first match wins:
  1. A non-business day → 0.
  2. An override for that day → the override hours.
  3. On or after the move → `rate_after`.
  4. A day when any routine with a rule on this project counts → the minimum of those rules' `bau_day_hours`.
  5. Otherwise → `rate`.
- **`finish_for(p, from, H)`** is the first business day where the running total reaches H − ε. If the hours run out before that, it records the leftover as `unplaced_h`, which counts as landing after the move.
- **Invariant:** `finish_for(from, work_left) == forecast`.
- **Edits reuse the same functions:**
  - Rate, work-left and start edits all use `refit`.
  - A rate change goes through `rescale`, which scales `rate_after`, the BAU-day hours and the overrides together.
  - Scope slip is `finish_for(work_left + H)`, replacing `ceil(H/rate)`.
  - An hours-a-day check-in runs the same refit as a rate edit.
  - The need solver is linear in the rate and rounds up to 0.1.
- **Preview == apply:** both `/checkins/preview` and `/checkins/apply` call `plan_project_changes`. A Hypothesis property test checks that they agree.
- **Verdict:** `off_track → at_risk → on_track_narrowly → on_track` (plus `no_pc`). The key project and routine come from Settings, and the key run is the routine's last occurrence before the move.
- **Golden values that must hold** (fixture seed, today 2026-10-05):
  - Countdown **61**.
  - Business days per month: Oct 22, Nov 21, Dec 21, Jan 20.
  - Loads: 5 Oct 8h; **4 Nov 9.5h**, the only overload.
  - Rotation: 49 BD in total, loop 1 is 46 BD ending Mon 8 Mar.
  - Returns pipeline (`ret`) +3 BD and at risk.
  - Verdict "Move on track, narrowly".
  - Month snapshot "2 of 17 done · 1 overdue".
  - ManCo focus tasks today: 0.5 / 0.75 / 0.75h.
- **Deliberate changes from the prototype**, recorded in the ADR:
  - The buffer goes from 8 to **7**.
  - The ret "need" rate goes from 3.6 to **3.8**.
  - ret +6h scope moves the forecast to **Mon 7 Dec (+3 BD)** instead of Fri 4 Dec, with new overloads on 4 and 7 Dec.
  - New projects start in Define with no forecast.
  - The prototype's 31 Aug 2026 missing-holiday bug is fixed.

### Read model and API (all under `/api`)
- **`GET /plan`** returns one bundle. ETag = revision.
  - Today and settings.
  - Calendar days: iso, weekday, bd, bdm, holiday, week.
  - Loads per business day.
  - Projects with stored and derived fields: status, delta, stale, growth, work left, need, buffer, sentence case with its parameters, milestones, and `day_hours`.
  - Routines (rule, next 3, checklist), rotation, move strip, verdict, flags, aliases and counts.
- **Parameterised reads:**
  - `GET /day/{iso}`: BAU rows, the checklist run, focus-block allocation and next milestone.
  - `GET /month-snapshot?month=`
  - `GET /home`
  - `GET /projects/{id}/snapshots`
  - `GET /notes/days`, `GET /notes?day=`, `GET /notes/day-text`
  - `/textbook/*`
- **Mutations return `MutationOut{plan, movements[], entity?}`.** `Movement{projectId, fromForecast, toForecast, deltaBD, cause, label}` drives the "plan moves" animation.
- **Endpoint groups:**
  - setup, settings, and the AI key (write-only)
  - projects (CRUD plus `POST /projects/{id}/replan`), charter items, milestones, tasks
  - routines, routine runs and checklist ticks, routine checklist items
  - rotation segments, readiness items
  - `checkins/parse` (and `parse-simple`, `DELETE parse/{id}`), `checkins/preview`, `checkins/apply`
  - notes
  - textbook sections, pages, `PUT` blocks (versioned, 409 on conflict), charts upload, and `GET /charts/{id}` served with a strict sandbox CSP
  - Data-only routes with no UI: feed, aliases, BAU-day hours, overrides, `ai/audit`.
  - `POST /dev/fixtures` exists only when `REMI_ENV=test`.
- Until setup is complete, reads that need the move date return 409 `SETUP_REQUIRED`.
- **Security:**
  - `TrustedHostMiddleware` for loopback only.
  - Mutations require a loopback `Origin` and the `X-Remi-Client: 1` header.
  - App CSP is `'self'` only. There is no CORS.
  - Keys are never returned or logged.
  - Chart iframes use `sandbox="allow-scripts"` with `src` (not `srcdoc`) under a `default-src 'none'; connect-src 'none'` CSP.

## Frontend (`frontend/src/`)
- **Stack:**
  - Vite 7, React 19.2, TS strict, react-router 7 (data mode).
  - TanStack Query 5, Zustand 5.
  - `openapi-typescript` + `openapi-fetch`. The client is generated from `contracts/openapi.json`, and CI fails on drift.
  - KaTeX, lazy-loaded in the Textbook chunk.
  - Fonts via `@fontsource` (Albert Sans, Libre Caslon Text, JetBrains Mono), plus a **Material Symbols woff2 subset** of the 28 icons used, at weight 300 and committed.
  - Vitest, Testing Library, msw, Playwright.
- **Folders:**
  - `app/` (router, providers, SetupGate, appearance)
  - `api/` (generated schema, client, query hooks)
  - `stores/` (`ui`, `overlays` stack, `hover`, `planMoves`)
  - `lib/` (`calendar.ts` for lookups only, `format.ts` with fixed en-GB arrays, `keyboard`, `focus`, `viewTransition`, `arrival`, `reducedMotion`, `stage`)
  - `styles/` (`tokens.css` **verbatim** from `Remi.dc.html :root`, with accent hex defaults `#526e2a`/`#47619c` because that is what the prototype actually renders; `derived.css` for the named colour-mix recipes; `base`, `keyframes`, `view-transitions`, `motion`)
  - `shell/` (NavRail, HeaderBar, ScreenStack, CommandPalette, DrawerHost)
  - `components/` (one folder per primitive: Roll, CapacityBar with 6 variants, DeltaChip, TimelineBar, diamonds and markers, BauTick/BauChip, RotationSegment/Tile, ConfidencePips, InlineField, BusinessDayDatePicker, SegmentedControl, BdStepper, HandoverStepper, SidePanel, Drawer, Tooltip, TwoStepConfirmButton, ProgressRule, EmptyState, Toast, Checkbox, Icon, ErrorBoundary, …)
  - `screens/` (home, setup, settings, today, notes, timeline, calendar, projects, workspace, routines, transition, checkin, textbook, foundations for dev)
- **Routing:**
  - `/` is Home. `/setup` is gated by SetupGate. `/settings`.
  - `/app/{today/:day?, notes/:day?, timeline, calendar/:month?, projects, projects/:id, routines, transition}`.
  - `/textbook/:pageId?`.
  - **All 8 app screens stay mounted** in ScreenStack, with the exact cross-fade: in, 240ms ease-out after 60ms; out, 140ms. Inactive sections are made `inert`.
- **Fidelity rules:**
  - CSS Modules carry the exact px values.
  - Dynamic geometry uses inline style or custom properties.
  - `data-screen-label` values match the prototype.
  - Nodes keep stable identity, so CSS transitions animate from the old value.
  - Keep the prototype's "Fit window" behaviour. `?frame=1920x1080|2560x1440` turns on the scaled canvas for tests. Home is a fixed 1920×1080 canvas scaled uniformly.
- **Motion:**
  - `--spring-soft` `linear()` at 440ms.
  - View Transitions API for card → workspace (`remi-goal`, 420ms).
  - Arrival staggers run once, on each screen's first activation.
  - `planMoves`: the drawer closes, then after 220ms apply runs. That sets `flash` for 1100ms (ghost bar) and `moved` for 5200ms (delta chip), and Roll animates the dates.
  - Reduced motion comes from the OS setting or the in-app setting and sets `:root[data-motion=reduced]`.
- **Server owns every number.** The client only does geometry and formatting from server calendar days. Forecasts and previews always come from the API: check-in review preview is debounced 150ms, and Workspace fields commit on Enter or blur, then call `replan`.
- **Check-in drawer:** a reducer over compose → thinking → review → error. Details:
  - Requests use an AbortController and a session guard.
  - ⌘↵ sends in compose and error, and applies in review.
  - Typing in review drops back to compose.
  - All copy comes from the critique.
- **Textbook:**
  - Block reducer, slash menu (10 types), markdown shortcuts on `p` only, Enter/Backspace semantics, drag reorder.
  - KaTeX with `throwOnError:false` and `trust:false`.
  - Charts upload to the API and render in a sandboxed iframe via `src`, with S/M/L sizes, drag resize and fullscreen.
  - Autosave is debounced 350ms with a version check.
- **New UI (Foundations language, same components):**
  - The setup wizard:
    1. The move (date picker, with a live Roll countdown).
    2. Working day (hours, holiday region, timezone).
    3. Fixed Income rotation (ordered RotationTiles with BD lengths and Build/Refresh).
    4. Tell Remi provider (default None).
  - A Settings page with the same sections plus key project/routine and appearance (accent, serif, motion).
  - Inline Charter-style lists for the routine checklist on the Routines row and onboarding items on Transition.
  - Empty states per screen, using the design's copy where it exists and new copy otherwise; the catalogue is in the frontend-screens design.

## Build phases (each a Workflow run; the user has opted into ultracode)
Each phase has fixed file ownership, so parallel agents never edit the same files. Parallel implementers use worktree isolation. Every phase ends with an adversarial verify pass.
- **P0 Scaffold (1 agent):**
  - `git init`, `.gitignore`, Makefile, README.
  - Copy the design-spec JSONs into `docs/design-spec/`, and write ADRs for the decisions above.
  - `brew install uv`, then `uv python install 3.12`.
  - Backend and frontend skeletons, `tokens.css`, fonts and the icon subset.
  - **Gate:** `make setup lint typecheck` is green; `/api/health` and an empty Vite app both serve on 127.0.0.1.
- **P1 Contracts (2 parallel agents):**
  - **A.** Schemas, ORM models, the Alembic `0001`, stub endpoints and engine signatures. Then `make openapi` generates the TS client.
  - **B.** Parity infrastructure:
    - `vendor-routes.ts` serves unpkg React 18.3.1, Babel, Google Fonts and jsDelivr KaTeX from local `node_modules`, so the harness runs offline.
    - Prototype driver: serve the design folder with `http.server`, call `__dcSetProps('Remi',{motion:'Reduced'})`, then walk the React fiber to the shell logic and `setState({screen,…})`.
    - `golden/extract.mjs` runs `Remi.dc.html`'s script in Node with DCLogic stubs and dumps golden JSON: calendar, loads, derived projects, verdict, rotation, `previewShift` grid, simple-reader corpus and the seed as `prototype_seed.json`.
    - Capture prototype baselines.
  - **Gate:** the contract is frozen (changes need an ADR plus regeneration).
- **P2 Core (5 parallel agents):**
  - engine plus goldens and property tests;
  - persistence (repositories, UoW, migrations, test-only fixture loader);
  - API and services;
  - AI providers (Anthropic and Ollama tested with respx);
  - frontend platform (shell, primitives, stores, motion utilities, palette frame).
- **P3 Screens (7 parallel agents)**, each owning `screens/<X>/**` and its parity spec:
  1. Today
  2. Timeline
  3. Calendar
  4. Projects + Workspace
  5. Routines + Transition
  6. Notes + Check-in drawer + palette content
  7. Home + Textbook
- **P4 Integration (1–2 agents):** setup wizard, Settings, inline lists, empty states, cross-screen flows, `make serve` (one process serving `dist/`), the egress suite.
- **P5 Adversarial review (≥4 read-only reviewers, then a fix loop until dry):**
  - correctness against goldens and preview == apply;
  - visual and motion fidelity;
  - stay-local egress and local attack surface;
  - decision-8 scope audit, accessibility and keyboard (every critique shortcut), and performance.

## Verification
- **Backend:** `uv run pytest`:
  - engine unit tests plus goldens (exact, unified and seed classes);
  - a Hypothesis test that preview == apply == `GET /plan`;
  - UoW (one event per mutation, none on rollback);
  - migrations (upgrade and compare-metadata);
  - holidays (31 Aug 2026 present, years auto-extend);
  - serving and security (SPA fallback, CSP, Host/Origin rejection);
  - AI (the `none` default, validate() rules, respx providers, and prompt-injection text that cannot apply anything);
  - a test that a fresh start has **0 projects and needs setup**.
  - Also `ruff` and `pyright --strict`.
- **Frontend:** Vitest for Roll `tokenize`, formatters, the calendar index, the drawer reducer and the textbook editor reducer. Also typecheck, lint, and OpenAPI drift.
- **Visual parity (`make parity`):**
  - Both apps run in Chromium at 1920×1080 with `reducedMotion`, the en-GB locale, the Europe/London timezone and the clock fixed at 2026-10-05 09:30. Remi runs with `REMI_ENV=test REMI_TODAY=2026-10-05` and the fixture DB.
  - States: every screen, tooltips, side panels, the date picker, the drawer (compose, review via the simple reader, review via a stubbed `window.claude`, error), palette states and Textbook states.
  - **Tier A (must pass):** identical text per `[data-screen-label]` region and anchors within ±2px.
  - **Tier B:** pixelmatch ≤1–2% by screen, with the clock and caret masked.
  - Documented divergences, such as the unified forecast numbers, are listed in `docs/parity-report.md`.
- **Behaviour (`make behaviour`):** Playwright flows covering:
  - palette `+6h returns` → preview == applied forecast plus chip and feed;
  - simple-reader check-in with untick and apply;
  - Today checklist ticks;
  - Workspace target snap, replan and delete;
  - a routine rule change updating Today and Timeline;
  - Transition verdict states;
  - Calendar Esc, Notes tagging, Home `1`/`2`, Textbook slash, formula and chart;
  - first-run wizard → empty states, and reload persistence.
- **Egress (`make egress`):**
  - Playwright request interception fails on any non-loopback request, in any frame.
  - `pytest-socket` limited to 127.0.0.1.
  - Grep `dist/` for `https?://`.
  - Run with Wi-Fi off.
- **Definition of done:**
  - `make check` is green offline.
  - Tier A passes on 100% of states and Tier B on at least 95%.
  - Every golden passes or has an ADR-listed divergence.
  - A fresh install starts empty with AI `none`.
  - The design folder is unchanged.
  - `remi` launches the app in the browser.

## Notes and risks
- **Brand:** colours and fonts are still stand-ins; the swap touches only `tokens.css`. Ninety One's PowerPoint template is still the best source for the real values.
- **Dates:** the prototype's move date (4 Jan 2027), 8h day and rotation are fixtures only. Real values come from the setup wizard.
- **Anthropic provider:** read the `claude-api` skill during P2 for the current model ids and tool-use details; don't rely on memory.
- **Sample chart fonts:** the sample chart used Google Fonts. The chart CSP blocks that, so rewrite the fixture chart to use system fonts, and warn on upload when a chart references `http(s)` URLs.
