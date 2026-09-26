## Findings that shape the harness

- **Prototype boot.** `support.js` first loads `react@18.3.1` and `react-dom@18.3.1` UMD from unpkg. The script tags carry SRI (`sha384-…`) and `crossOrigin="anonymous"`. It then boots `<x-dc>`. Sibling screens are fetched as `./<Name>.dc.html`, so they cannot load over `file://` and need an HTTP server. Babel (`@babel/standalone@7.29.0`) loads only when a component uses `x-import` of JSX. Logic is compiled with `new Function('DCLogic','StreamableLogic','React', src + ';return Component')`, and there is no JSX in the logic.
- **Other external requests in the design.** Fonts come from `fonts.googleapis.com`/`gstatic` (Albert Sans, Libre Caslon Text, JetBrains Mono, and a subset of Material Symbols Outlined). The Textbook loads KaTeX `0.16.11` from jsdelivr. Chart iframes use `srcDoc` with `sandbox="allow-scripts"`.
- **Setting props.** After boot, call `window.__dcSetProps('Remi', {frame:'1920 × 1080', motion:'Reduced'})`. The root name comes from the file name. The defaults are `frame 1920×1080`, `motion Full`, `accents ["#526e2a","#47619c"]` and `serif true`. `applyTweaks` writes these accent hex values over the oklch CSS variables, so the hex values are what actually render. Record this as a token decision.
- **Reduced motion on Home.** `Remi Home`'s `reduced()` only reads `matchMedia`. The harness therefore also needs the context option `reducedMotion:'reduce'`.
- **Getting at the shell's state.** The DCLogic instance sits at `wrapper.stateNode.logic`. To reach it, walk the React fiber upward from a DOM node:
  ```js
  const el=document.querySelector('[data-screen-label="Remi app"]');
  let f=el[Object.keys(el).find(k=>k.startsWith('__reactFiber$'))];
  while(f&&!f.stateNode?.logic?.buildModel) f=f.return; window.__remi=f.stateNode.logic;
  ```
  Screens are then selected with `__remi.setState({screen:'timeline', ws:'ret', instant:true})`. The other entry points are `openCheckIn(pid)`, `openPalette()`, `previewDay(n)`, `openRoutine(id)` and `openProject(id)`.
- **Things that change between runs.**
  - `TODAY` is hard-coded to `2026-10-05`.
  - `Date.now()` is used for ids and `moved.at`.
  - `new Date()` is read in Notes (the clock tick), in `addNote` and in the Home greeting.
  - `Math.random` is used in Textbook and Workspace uids.
  - State persists to `localStorage['remi.v1']`, so every test must start with a fresh context.
- **AI path.** CheckIn calls `window.claude.complete`. When it is missing, CheckIn shows the error phase and offers `offline()`, which runs `simple(text)`.
- **Holiday difference.** `holidays.UK(subdiv='ENG')` matches the prototype's `HOL` exactly from 2026-09-01 to 2027-04-30. The one difference is **2026-08-31 (Summer bank holiday)**, which the prototype treats as a business day and which falls inside `CAL0`. Goldens compare from 2026-09-01 onward.
- **Toolchain on this machine.** Node v25.9.0 and Python 3.9.6 are installed. `uv` and `pnpm` are not. Playwright's current version is 1.63.0. Use `uv` with Python 3.12 and npm workspaces.

## (1) Repo layout

- Make `/Users/justinstoddart/Desktop/Ninety One/remi/` the git repo root and run `git init -b main` there.
  - Keep `Remi Dashboard Design Review/` where it is as the reference.
  - Add a symlink `design -> "Remi Dashboard Design Review"`.
  - Add a pre-commit check, `git diff --cached --quiet -- design/`, that blocks edits to the reference.
- **`backend/`** (`pyproject.toml` with Python 3.12, fastapi 0.115+, uvicorn, sqlalchemy 2.0, alembic, pydantic 2, holidays 0.6x, httpx; dev: pytest, pytest-socket, respx, hypothesis, ruff, pyright). Code lives in `backend/remi/`:
  - `api/`: `routers/*.py`, `deps.py`, `middleware.py` (TrustedHost, Origin guard, CSP)
  - `core/`: `config.py` (`REMI_TODAY`, `REMI_TZ=Europe/London`, `REMI_AI=none|anthropic|ollama`, host locked to 127.0.0.1), `db.py`, `clock.py`
  - `schemas/`: Pydantic DTOs
  - `services/`: `engine/` (calendar, forecast, loads, verdict, rotation, routines_occ, preview), `ai/` (base, none_simple, anthropic, ollama, context), `checkins.py`, `projects.py`, …
  - `repositories/`: `models.py` (ORM) plus one repo per aggregate
  - `utils/`: dates, ids, holidays_gen
  - Also: `backend/alembic/`, `backend/tests/{unit,engine,api,golden/*.json,fixtures/prototype_seed.json}`, and `backend/scripts/export_openapi.py`
- **`frontend/`** (Vite 6, React 18.3.1, TypeScript 5.x, react-router 7, `katex@0.16.11`, `openapi-typescript@7`, `openapi-fetch`, TanStack Query 5, vitest, eslint):
  - `src/{api/schema.d.ts (generated), app/, screens/<Screen>/, components/, styles/tokens.css, assets/fonts/*.woff2}`
  - Fonts come from `@fontsource-variable/albert-sans`, `@fontsource/libre-caslon-text`, `@fontsource/jetbrains-mono` and `material-symbols`.
- **`contracts/openapi.json`**: generated and committed.
- **`parity/`** (Playwright 1.63.0, pixelmatch 7, pngjs 7):
  - `playwright.config.ts`, `drivers/{prototype,remi}.ts`, `states.ts`, `specs/{visual,behaviour,egress}.spec.ts`
  - `golden/extract.mjs`, `vendor-routes.ts`, `baselines/{prototype,remi}/`
- **`docs/`**: `decisions/000N-*.md` (one ADR per binding decision; 0007 covers forecast unification), `spec/` (a markdown export of the extracted spec), `parity-report.md`.
- **`.gitignore`**: `.venv/`, `node_modules/`, `dist/`, `*.sqlite*`, `.remi/`, `parity/test-results/`, `parity/playwright-report/`, `.env`, `.DS_Store`, `__pycache__/`, `.pytest_cache/`, `.ruff_cache/`.
- **`README.md`**: covers setup, `make dev`, the AI provider configuration, and the no-network guarantee.

## (2) Build phases

- **P0, scaffold (1 agent, serial).** Owns the root, `Makefile`, both package manifests, lint configs, `design` symlink, ADRs, `tokens.css` (extracted from `:root` in `Remi.dc.html`) and the self-hosted fonts.
  - Accept when: `make setup lint typecheck` is green; a FastAPI `/api/health` endpoint and an empty Vite app both serve on 127.0.0.1.
- **P1, contracts (2 agents in parallel).**
  - **A.** `schemas/` DTOs, ORM models plus the Alembic initial migration, and stub routers that return 501. Also writes the engine function signatures in `services/engine/__init__.py`, e.g.:
    - `business_days(from_,to,holidays)`
    - `day_load(day, projects, routines, capacity)->DayLoad`
    - `forecast(project, cal)->date`
    - `preview_shift(state, pid, hours)->ShiftPreview`
    - `verdict(state)->Verdict`
    - `rotation(move, segments)->list[Segment]`
    - `countdown(today, move)`
  - **B.** Parity infrastructure: vendor routes, both drivers, `extract.mjs`, and the prototype baselines and goldens.
  - **Gate:** `make openapi` produces `contracts/openapi.json` and `frontend/src/api/schema.d.ts`, and `git diff --exit-code` passes. After this the contract is frozen; changes go through an ADR plus a regeneration.
  - Accept when: goldens are committed; prototype baselines are captured for every state in `states.ts`.
- **P2, core fan-out (5 agents).** Each owns one path; no shared files.
  - **Engine:** `services/engine/**` and `tests/engine/**`. Accept when all "exact" goldens pass, preview == apply holds as a Hypothesis property, and `countdown == 61` on 2026-10-05.
  - **Persistence:** `repositories/**`, `core/db.py`, `alembic/**`, plus the fixture loader `scripts/load_fixture.py`. The loader is refused unless `REMI_ENV=test`. Accept when the fixture round-trips losslessly.
  - **API/services:** `api/**`, `services/*.py` (not engine, not ai). Accept when API tests cover every route and error codes follow `{error:{code,message,field}}`.
  - **AI:** `services/ai/**`. Accept when:
    - The `none` provider's `simple()` port equals the goldens.
    - Anthropic and Ollama are tested with respx; keys are held on the server only.
    - The response is a proposal schema only, and apply goes through `POST /api/checkins`.
  - **Frontend platform:** `app/`, `components/`, `styles/`, `api/` hooks, motion utilities and the ⌘K palette shell. Accept when the shell, nav rail and drawer frame reach pixel parity on an empty screen.
- **P3, screens (7 agents).** Each owns `frontend/src/screens/<X>/**` and `parity/specs/screens/<x>.spec.ts`. They consume shared components as read-only and file change requests in `docs/requests/`. The groups:
  - Today
  - Timeline
  - Calendar
  - Projects + Roll + Workspace
  - Routines + Transition
  - Notes + CheckIn drawer + palette content
  - Home + Textbook
  - Accept when: the screen's visual states pass the thresholds, its behaviour flows pass, and its empty state has an approved baseline.
- **P4, integration (1 agent).** First-run setup, cross-screen flows, `make serve` (FastAPI serves `dist/`), and the egress suite. Accept when `make check` is green.
- **P5, adversarial review (4 agents, read-only).** Dimensions are listed in section 6.

## (3) Visual-parity harness

- **Serving the prototype.** `python3 -m http.server 4800 --bind 127.0.0.1 --directory design`. Remi runs on `127.0.0.1:8765`, started with `REMI_ENV=test REMI_TODAY=2026-10-05` and a fresh SQLite database loaded from `prototype_seed.json`.
- **`vendor-routes.ts`.** Installed with `context.route` for the prototype project, and with `serviceWorkers:'block'`:
  - `https://unpkg.com/react@18.3.1/umd/react.production.min.js` → `node_modules/react/umd/…`, same for react-dom and `@babel/standalone@7.29.0/babel.min.js`. The npm files are byte-identical to unpkg's, so SRI still passes. Responses must include `access-control-allow-origin:*` and a JS content type.
  - `fonts.googleapis.com/css2*` → a local `fonts.css` pointing at the same woff2 files the frontend bundles; `fonts.gstatic.com/**` → those files.
  - `cdn.jsdelivr.net/npm/katex@0.16.11/**` → `node_modules/katex/dist/**`.
  - Anything else → `route.abort()`, and the URL is recorded.
  - Fallback if SRI fails: an `addInitScript` that sets `window.__resources={[url]: '/__vendor/…'}`, which skips SRI.
- **Context options (both apps).** `viewport 1920×1080`, `deviceScaleFactor 1`, `reducedMotion 'reduce'`, `colorScheme 'light'`, `locale 'en-GB'`, `timezoneId 'Europe/London'`. Pin the clock with `page.clock.setFixedTime(new Date('2026-10-05T09:30:00+01:00'))` (this also fixes `Date.now` ids). Use the same bundled Chromium for both.
- **Prototype driver.**
  1. `goto('/Remi.dc.html')` and wait for `window.__dcRootName?.()==='Remi'`.
  2. Call `__dcSetProps('Remi',{motion:'Reduced'})`.
  3. Take the fiber handle and apply the state with `setState({…, instant:true})`.
  4. Wait until `document.fonts.ready`, no `.sc-placeholder`, no `html.sc-dc-streaming`, then two rAFs.
- **Remi driver.** Deep links (`/app/today`, `/app/projects/ret`, `?drawer=manco`, `?palette=+6h%20returns`) and the same readiness wait. The new app must keep the prototype's `data-screen-label` values so regions line up.
- **States to capture (`states.ts`):**
  - Home
  - Today (default, plus `previewDay` on the first `model.upcoming` overload day and on the BD3 of November)
  - Notes
  - Timeline (default, plus tooltip hover on the `ret` bar and on the rotation row)
  - Calendar (month, plus day panel)
  - Projects/Roll
  - Workspace for every seed project id (`ret`, `manco`, and each FI project), plus the date-picker open
  - Routines (plus `openRoutine('r-ret')`)
  - Transition
  - Drawer: compose (pid `manco`); review via `offline()` on corpus text `"+6h returns, blocked on data access"`; review via an `addInitScript` stub `window.claude={complete:async()=>FIXTURE}`; error
  - Palette: empty, `+6h returns`, no match
  - Textbook: home, KaTeX page, fullscreen chart
  - Remi only (human-approved baselines): first-run setup and each screen's empty state
- **Scoring tiers:**
  - **A, must pass:** normalised `innerText` of each `[data-screen-label]` region is identical. `data-parity` anchors are within ±2px of their bounding boxes.
  - **B:** pixelmatch with `threshold 0.1`, `maxDiffPixelRatio ≤ 0.01` for chrome/nav/Transition/Routines and `≤ 0.02` for Timeline/Calendar/Textbook. Mask the Notes clock, "Just now" feed stamps and the caret.
  - **C:** anything else is a report-only diff.
  - The report puts side-by-side and diff PNGs in the Playwright HTML report.

## (4) Behavioural parity tests

Each test runs through both drivers where the prototype supports it and asserts on identical visible strings.
- Navigation: the nav rail; ⌘K opens and Esc closes the palette; jumping to a project from the palette opens its workspace with no view transition.
- Palette `+6h returns`: the preview shows `+N BD`, from → to, new overload days and the key-run warning. Enter applies it. The forecast, the feed body `Scope added (… +6h). Forecast moved X → Y.` and the `+N BD` chip must equal the preview (preview == apply).
- Check-in: opened from Today's stale prompt; ⌘↵ with provider `none` gives the simple reading; untick one item; apply. Check that the check-in reads "Today", the confidence and the feed item. Also: error-phase ⌘↵ retries, and Esc inside a field does not close the drawer.
- Today: toggling a task and a BAU item updates `doneOn`/`bauDone` and the load legend hours. A returns BAU item on its occurrence day calls `setAllFunds`.
- Workspace:
  - Changing the target snaps it to a business day and logs a feed item.
  - Adding a milestone or task, overriding a day's hours, and replanning the rate each move the forecast.
  - Deleting a project returns to Projects.
- Routines: changing a rule updates the next three occurrences and Today/Timeline loads. Moving the stage updates Transition.
- Transition: the countdown reads 61 and the buffer is shown. Pushing a PC exit past the key run gives "Move at risk"; pushing it past the move gives "Off track".
- Calendar: Esc closes the day panel. Notes: adding a note stamps 09:30. Home: keys `1`/`2` route. Textbook: the slash menu, formula to KaTeX, and the sandboxed chart.
- Remi only: first-run setup leading to empty states; state survives a reload; there is no sample data unless the fixture is loaded.

## (5) Golden values: feasible

- **Method: `parity/golden/extract.mjs` (Node, no dependencies).**
  1. Regex out `<script … data-dc-script …>([\s\S]*?)</script>`.
  2. Run `new Function('DCLogic','StreamableLogic','React','localStorage','window','document', src+'\nreturn {Component,CAL,F,HOL,TODAY,MOVE,DEC_RUN,CAPACITY,ROT,ROUTINES,BASE_PROJECTS,BASE_FEED,BASE_NOTES,BASE_DONE_ON,FUNDS,normalize,normR,derivedMs,occurs,dayLoad}')`.
  3. Stubs: a `DCLogic` whose `setState` is synchronous and merges its argument; `React={createRef:()=>({current:null})}`; a `localStorage` that returns null (so the base seed is used); `window` undefined; `Date.now` pinned.
- **What to dump from `new Component({motion:'Reduced'}).buildModel()`.** Convert day numbers to ISO strings, then write:
  - Calendar days (bd, bdm)
  - `loads` for every business day
  - Each project's forecast, delta, status, since, stale, growth and derived milestones
  - verdict (with buffer and toRun), attention, upcoming
  - Routine next occurrences
  - `ROT` segments
  - `previewShift(pid,h)` for every project with h ∈ {0, 0.5, 1, 2, 4, 6, 8, 16, 40}
- **Scenario goldens.** Scripted `saveCheckIn(draft)`, `toggleTask` and `updateRoutine` sequences, with the model dumped after each step.
- **Screen-level goldens.** Evaluate each screen script the same way with `props:{model}` and call `renderVals()` inside a try block. Dump Transition `firstRot`/`loopEnd`, Today's day plans for every business day, and `CheckIn.simple(text)` over a text corpus.
- **Cross-check in the browser.** `page.evaluate` against the fiber handle's `buildModel()` must equal the Node output. This proves the extractor is faithful.
- **Three golden classes:**
  - **exact:** calendar, loads, rotation, occurrences, verdict.
  - **unified:** the prototype's `ceil(h/rate)` in `previewShift` and the `bdDiff+1` refit in `saveCheckIn` (line 479) disagree. The new engine is tested against its own invariant; where the two prototype formulas agree, results must match; divergences go in a table in ADR-0007.
  - **seed:** `prototype_seed.json` is emitted from `BASE_*` and imported by the fixture loader. Stable string ids are allowed.
- **Where the goldens differ from the binding decisions:**
  - The countdown is re-derived under decision 9 (61) rather than copied from the prototype.
  - The generalised capacity, key run and key project are configured as 8, 2026-12-03 and `ret`.

## (6) Adversarial review dimensions

- **Staying local (egress audit):**
  - `context.on('request')`, `page.on('websocket')` and `route('**/*')` cover every frame, including srcdoc iframes. Anything outside `127.0.0.1:8765`, `data:`, `blob:` or `about:` fails the test. Crawl all states plus the flows.
  - `pytest-socket --allow-hosts=127.0.0.1`.
  - Statically grep `dist/` for `https?://`, allowing only the w3.org SVG namespace.
  - CSP: `default-src 'self'; connect-src 'self'; font-src 'self'; frame-src 'self' about:`, and a `default-src 'none'` meta injected into chart srcdocs.
- **Local attack surface:**
  - The server binds only to 127.0.0.1 and refuses 0.0.0.0.
  - `TrustedHostMiddleware` blocks DNS rebinding.
  - Mutations require an Origin check or a custom `X-Remi` header, so a malicious local web page cannot post.
  - API keys never appear in responses or logs.
- **Correctness:** engine against goldens; preview == apply; business-day edges around holidays and DST; the empty-database path; stale data after mutations.
- **Contract drift:** the regenerated client diff is empty; no hand-written fetch calls.
- **AI safety:** provider `none` is the default, output is proposals only, the schema is validated, and prompt-injection text in updates cannot apply changes.
- **Scope:** decision 8 audit, i.e. no UI for features that are computed but never rendered.
- **Accessibility and keyboard:** every keyboard behaviour listed in the critique.

## (7) Make targets and definition of done

- **Targets:**
  - `setup` (uv sync, npm ci, `npx playwright install chromium`)
  - `dev`, `serve`, `prototype`
  - `openapi`
  - `goldens`, `fixture-db`, `holidays`
  - `test-backend`, `test-frontend`
  - `parity-baseline`, `parity`, `behaviour`, `egress`
  - `lint`, `typecheck`, `build`, `clean`
  - `check` = lint + typecheck + test-* + openapi-diff + parity + behaviour + egress
- **Definition of done:**
  - `make check` is green offline, with Wi-Fi off.
  - Tier A passes on 100% of states and Tier B on at least 95%, with the rest documented.
  - Every golden passes or has an ADR-listed divergence.
  - First-run starts empty.
  - The AI provider is `none` by default.
  - No egress.
  - The design folder is unchanged.
  - The README explains how to reproduce all of the above.

### Critical Files for Implementation
- /Users/justinstoddart/Desktop/Ninety One/remi/Remi Dashboard Design Review/support.js
- /Users/justinstoddart/Desktop/Ninety One/remi/Remi Dashboard Design Review/Remi.dc.html
- /Users/justinstoddart/Desktop/Ninety One/remi/Remi Dashboard Design Review/CheckIn.dc.html
- /Users/justinstoddart/Desktop/Ninety One/remi/Remi Dashboard Design Review/Transition.dc.html
- /Users/justinstoddart/Desktop/Ninety One/remi/Remi Dashboard Design Review/Remi Textbook.dc.html