# parity/: goldens, prototype baselines and the parity harness

A separate npm project (Playwright 1.63.0 on Node 25, Chromium 153 headless shell). It holds:

| Path | What |
| --- | --- |
| `vendor-routes.ts` | Serves every external request of the prototype from local files (offline). |
| `playwright.config.ts` | `python3 -m http.server 4800` on the design folder. 1920×1080 at DPR 1, reduced motion, en-GB, Europe/London, light, service workers blocked. |
| `drivers/prototype.ts` | Drivers for `Remi.dc.html`, `Remi Home`, `Remi Textbook` and `Remi Foundations`. |
| `drivers/remi.ts` | The same interfaces for the production app, through deep links and `data-parity` anchors (see "Remi driver contract"). |
| `drivers/common.ts` | Pinned clock, `window.claude` stub, readiness wait, region capture. |
| `states.ts` | Every parity state, written against the driver interfaces only. |
| `specs/prototype-baseline.spec.ts` | Writes `baselines/prototype/<state>.png` and `<state>.json`. |
| `specs/golden-crosscheck.spec.ts` | Checks that the browser's `buildModel()` and `simple()` give the same output as the Node extraction. |
| `remi/` | A Remi run's servers: `env.ts` (ports, run selection), `servers.ts` (backend, Vite / build / preview, fixtures), `fake-ai.ts` (the fake Ollama provider), `api.ts` (the harness's own API calls), `global-setup.ts` / `global-teardown.ts`. |
| `specs/parity.spec.ts` | Captures Remi per state into `baselines/remi/` and scores it against the prototype (`compare.ts`). |
| `compare.ts`, `charts.ts`, `divergences.ts`, `report.ts` | Tier A / Tier B scoring, the live-chart check, the documented divergences (ADR-0007), and `docs/parity-report.md`. |
| `approvals.ts` | Who approved each Remi-only baseline and whether a person signed it off (`baselines/remi-approved/approvals.json`); `node approvals.ts status`. |
| `tests/` | `make test-harness` (`node --test`, no browser): the Remi-only states cover every screen and page and their approved baselines hold the whole page and match `approvals.json`; the README and `docs/requests` against the files they describe. |
| `specs/behaviour.spec.ts` | The behaviour flows (`make behaviour`), tagged `@p4`. |
| `specs/egress.spec.ts` | The stay-local crawl (`make egress`). |
| `golden/extract.mjs` | Runs the prototype's scripts in Node and writes `golden/*.json`. |

## Run it

```sh
make goldens            # node golden/extract.mjs (no deps, no browser); --check fails if stale
make parity-baseline    # baselines for every state + the golden cross-check (~40 s, 4 workers)
cd parity && npm ci && npx playwright install chromium   # first time only
```

The whole harness runs offline. Nothing in the design folder is written. `make parity-baseline` serves the design folder on 4800 (`PARITY_PROTOTYPE_PORT` moves it).

## How the prototype is driven

- **Vendor routes.** A `context.route` covers every non-loopback URL, in all frames. The files come from `parity/node_modules`:
  - unpkg React 18.3.1, ReactDOM 18.3.1 and Babel 7.29.0 are byte-identical to unpkg. `verifyVendorIntegrity()` recomputes the sha384 values that `support.js` pins before every run.
  - Google Fonts css2 is rebuilt from the `@fontsource` CSS, with all subsets and the weight ranges Google declares (`300 700` roman and `400 600` italic Albert Sans).
  - Material Symbols uses `frontend/src/assets/fonts/material-symbols-remi.woff2`.
  - KaTeX 0.16.11 comes from the local copy of the package.
  - Any other URL is aborted and recorded, and the test fails on it. No URL has been blocked so far.
- **Boot.** `page.clock.setFixedTime(2026-10-05T09:30+01:00)` runs before navigation, and every child frame (the live charts) gets a pinned animation clock (`drivers/common.ts` `pinChartClock`: `performance.now()` stands still at the frame's start and `requestAnimationFrame` callbacks get that start + 3000ms, so a chart is drawn at the same moment of its animation in every run and in both apps). The driver then:
  1. waits for `__dcRootName()`;
  2. calls `__dcSetProps('Remi', {motion:'Reduced', frame:'1920 × 1080'})`;
  3. walks the fiber from `[data-screen-label="Remi app"]` up to the logic that has `buildModel` (`window.__remi`);
  4. waits for all 9 child screens to mount and for Timeline's `settled`.
- **Child screens.** They are reached from their `.sc-host[data-sc-name]` wrapper through `__parity.dc(name)`.
- **Readiness.** The driver waits until:
  - there is no `.sc-placeholder` and no `html.sc-dc-streaming`;
  - `document.fonts.ready` has resolved;
  - finite animations have settled (bounded wait);
  - two rAFs have passed.

  Screenshots use `animations:'disabled'` and `caret:'hide'`.
- **JSON per state.** Each state's JSON records every `[data-screen-label]` region, or `#dc-root` on Foundations. Each region has:
  - `box`, `visible`, `inViewport`;
  - normalised `lines` and `text`;
  - `textNoIcons`, which is the Tier A string (the prototype writes icons as ligature names);
  - `icons`;
  - `fields`: input and textarea values, which `innerText` omits.

  The JSON also records the Tier B `masks` (time-dependent content only), the visible iframes (`frames`: the live charts, which the chart check crops from the screenshots; they are compared, not masked), the fonts that loaded, vendor requests, and page and console errors. Baselines captured before 2026-09-24 listed the charts under `masks` with kind `iframe`; Tier B ignores that kind (`compare.ts` `TIER_B_MASK_KINDS`) and `charts.ts` `framesOf` still reads it.

## Captured prototype states (38, all passing)

Remi-only states (`setup-wizard`, `empty-home`, `empty-<screen>` for every app screen but the workspace, `empty-textbook`, `settings`) are listed in `states.ts` with `remiOnly` and are not captured here.

| State | Surface | What |
| --- | --- | --- |
| `home`, `home-hover-plan`, `home-hover-textbook` | home | The launcher at rest and with each card hovered |
| `today` | app | Today on Mon 5 Oct (BD3) |
| `today-preview-2026-11-04` | app | `previewDay` on the first upcoming overload day. This is also November BD3, so the two §3 states are one capture. |
| `today-preview-2026-10-12`, `today-preview-2027-01-04` | app | BD8 (the ManCo run) and the move day (rotation BAU) |
| `notes` | app | Notes for today (clock pinned to 09:30) |
| `timeline`, `timeline-tip-ret`, `timeline-tip-rotation`, `timeline-panel-ret` | app | 3-month view; real mouse hovers on the `ret` bar and the rotation row; the side panel |
| `calendar`, `calendar-day-2026-10-05`, `calendar-day-2026-11-04` | app | October, plus day panels for today and the overload day |
| `projects` | app | The Roll cards |
| `workspace-{ret,manco,play,fion,alpha}`, `workspace-ret-datepicker` | app | Every seed project, plus the target date picker |
| `routines`, `routines-open-r-ret` | app | Routines, and `openRoutine('r-ret')` captured inside its 1.6 s row highlight |
| `transition` | app | Transition |
| `drawer-compose` | app | Opened with pid `manco` |
| `drawer-review-simple` | app | `"+6h returns, blocked on data access"` with no `window.claude`, which falls back to the simple reading |
| `drawer-review-claude` | app | `window.claude` stubbed with `golden/claude-fixture.mjs` (8 changes plus 1 unplaced) |
| `drawer-thinking`, `drawer-error`, `drawer-review-offline` | app | `complete()` never resolves; `complete()` replies with no JSON; "Use a simple reading" from the error phase |
| `palette-empty`, `palette-quick-add`, `palette-no-match` | app | ⌘K empty; `+6h returns`; `board minutes` |
| `textbook-home`, `textbook-katex`, `textbook-chart-full` | textbook | Home; the Rates primer (KaTeX plus the live chart); the chart full screen |
| `foundations` | foundations | A full-page screenshot |

**Determinism.** Two full runs compared with pixelmatch at threshold 0.1 give identical PNGs in all 38 states, and identical region text, boxes and anchors. The 3 Textbook states used to differ by up to 0.107%, all inside the live chart, which animates on `performance.now`; since the chart clock is pinned (2026-09-25 re-capture) they are identical too. The re-capture changed only those 3 PNGs (the chart now drawn at 3s); every other PNG and every text, box and anchor stayed the same.

**Failures.** None. One source of harness noise is recorded but does not fail a test. Playwright's `serviceWorkers:'block'` init script reads `navigator.serviceWorker`, which throws a `SecurityError` inside the sandboxed chart iframes. These errors are stored under `harnessNoise`.

## Golden files (`golden/`)

Day numbers are converted to ISO dates. `meta.json` holds the sha256 of every source file.

| File | Contents |
| --- | --- |
| `calendar.json` | Every day from 2026-08-31 to 2027-04-30: bd, bdm, holiday. Also business days per month and the countdown. |
| `loads.json` | `dayLoad` for every business day |
| `projects.json` | Derived projects: forecast, delta, status, since, stale, growth, derived milestones, labels |
| `verdict.json`, `attention.json` | The verdict (with `buffer` and `toRun`), attention, upcoming, prompt and nextDue |
| `routines.json`, `rotation.json` | Next 3 occurrences for each routine; the rotation segments |
| `preview_shift.json` | `previewShift` for every project × h ∈ {0, 0.5, 1, 2, 4, 6, 8, 16, 40} |
| `today_day_plans.json` | Today's `renderVals` for every business day from 5 Oct: capacity, focus blocks and their tasks, BAU, week strip. Also today's attention, prompt and feed. |
| `month_snapshot.json` | "2 of 17 done · 1 overdue", collapsed and expanded |
| `transition.json`, `workspace_panels.json`, `workspace_refit.json` | Transition values (`firstRot`, `loopEnd`, flags); each Workspace panel and sentence; the Workspace `refit` for rate edits and work-left edits |
| `simple_reader.json`, `notes_tags.json` | `CheckIn.simple()` over 33 corpus updates (`golden/corpus.mjs`), and Notes `tagsFor()` |
| `scenarios.json` | 8 scripted mutations, each with its before and after state (for example ret +6h, manco 2h a day, a routine moved to BD10, off track, the Claude fixture applied) |
| `prototype_seed.json` | `BASE_PROJECTS`, `ROUTINES`, `FUNDS`, `ROT_DEF`, `BASE_NOTES`, `BASE_DONE_ON`, the non-computed `BASE_FEED` rows (`feed`: only f1 `scope`), all alias maps, and the Textbook `SEED` with stable block ids. Also the sample chart (the same bytes as `charts/price-yield.html`). The f2 `stale` and f3 `overload` rows are computed flags (arch-backend-data §8), so they are left out of `feed` and kept only under `computedFeedReference`. The P2 fixture loader must not store them. |

These are the prototype's values. Where the binding decisions differ from them, PLAN.md and ADR-0007 win:

| What | Prototype | Binding decision |
| --- | --- | --- |
| Buffer | 8 | 7 |
| ret +6h scope | Fri 4 Dec, +2 BD | Mon 7 Dec |
| `bdDiff(today, move)` | 62 | 61 business days strictly between |
| Mon 31 Aug 2026 | Business day (the missing-holiday bug) | Holiday |

When hours run out, the Workspace refit clamps the forecast to the last day of the calendar (2027-04-30). This is the `unplaced_h` case.

## The production app: `make parity`, `make behaviour`, `make egress`

```sh
make parity                    # every state, design fixture then empty fixture; writes docs/parity-report.md
make parity STATE=workspace    # Playwright --grep on the state id (a regex)
cd parity && PARITY_TARGET=remi PARITY_STATES=today,notes npx playwright test --project=remi   # exact ids
make parity STATE='setup-wizard|empty-|settings' PARITY_APPROVE=1 PARITY_APPROVER="<who>"   # approve Remi-only captures
make parity-confirm STATE=. BY="<your name>"                  # a person signs off the approved ones
make test-harness              # node --test parity/tests: states, approvals, README and docs (no browser)
make behaviour [FLOW=Notes]    # the behaviour flows, one worker
make egress                    # the stay-local crawl on a fresh production build
```

A Playwright invocation is a **Remi run** when `PARITY_TARGET=remi` or it selects `--project=remi|behaviour|egress`. Its globalSetup (`remi/servers.ts`):

1. refuses to start while another run on the same ports is alive (the owning Playwright runner is recorded in `.remi-run/<api>-<web>/state.json`), kills what a crashed earlier run on those ports left (only a backend or Vite whose command line has that port), and checks that 127.0.0.1:**8804** (api) and **5304** (web) are free (`REMI_PARITY_API_PORT` / `REMI_PARITY_WEB_PORT` override them). A run that includes the parity project also takes `report/.parity.lock`: `baselines/remi/`, `report/` and `docs/parity-report.md` are shared by every parity run, so only one parity run at a time (behaviour and egress runs on other ports can run beside it);
2. starts the backend (with no `REMI_*` setting or API key from the calling shell, so a developer's own environment cannot change a capture): `uv run python -m app.main --no-browser --port 8804` with `REMI_ENV=test REMI_TODAY=2026-10-05 REMI_NOW=2026-10-05T09:30:00+01:00 REMI_DEFAULT_TIMEZONE=Europe/London REMI_DATA_DIR=<fresh temp dir> REMI_WEB_PORT=5304`, then `POST /api/dev/fixtures {fixture}` (`PARITY_FIXTURE=design|empty`). `REMI_NOW` stands the server's clock still at the browser's pinned instant (a note jotted in a run is stamped 09:30), and `REMI_DEFAULT_TIMEZONE` makes the first-run wizard pre-fill Europe/London instead of the machine's zone, so every capture is the same on any Mac;
3. starts the frontend: Vite (`REMI_API_PORT=8804 REMI_WEB_PORT=5304`), warmed up so dependency optimisation never reloads a test page. With `PARITY_SERVE=build` (egress) it runs `vite build` into `.remi-run/<api>-<web>/dist` and serves that from the backend when the backend serves the SPA, otherwise with `vite preview` on 5304; if the build fails it falls back to Vite and the egress bundle test fails with the build log;
4. starts the fake AI provider (`remi/fake-ai.ts`) on an OS-assigned loopback port.

globalTeardown stops all of it, deletes the data dir, and (after a parity run) rewrites `docs/parity-report.md` and releases the lock. Logs stay in `.remi-run/<api>-<web>/logs/`; Playwright's own output goes to `test-results/remi-<api>-<web>/` and `playwright-report/remi-<api>-<web>/` (the prototype's to `…/prototype/`), because Playwright empties its output folder when a run starts. The context options are the prototype project's.

### Scoring (`compare.ts`)

- **Tier A (must pass).** For each labelled region visible in the prototype, Remi must have a visible region with the same `data-screen-label`, the same **Tier A lines** and a box within ±2px. The lines are the region's own text (`ownLines` in the capture JSON), read as a reader sees it: Material Symbols glyphs and screen-reader-only text (absolute, clipped or 1px, such as Roll's `.srOnly` copy) are left out, and each **Roll reads as its value** (its full-text sizer, "Wed 2 Dec") instead of its reels ("0 1 2 … 9"); nested labelled regions (each is compared on its own) and opacity-0 content (a closed drawer or palette, hover-only controls) are left out too. After the text come the region's own **form fields** (`ownFields`): `[field] <value>`, or `[field placeholder] <placeholder>` while empty, so a wrong hours-a-day or work-left value fails. A region the prototype has but hides must not be shown by Remi (`shown`). Every `[data-parity]` anchor in the prototype capture must exist in Remi within ±2px (repeated names pair with the nearest; a missing one fails); the baseline spec tags the prototype's equivalents (`drivers/prototype.ts` `tagPrototypeAnchors`: the Timeline rows, bars, rotation lane and segments, the two Home cards). Foundations (no labelled regions in the prototype) compares the page text. Documented divergences (`divergences.ts`: ADR-0007, ADR-0009 and critique corrections) rewrite the prototype's lines first; a row matches inside one line, or a whole line (`wholeLine`, for a bare Roll value).
- **Live charts (part of Tier A).** Tier B cannot see a chart (a chart is about 1% of the frame, and blanking the full-screen one moved Tier B by only 0.2%), and innerText stops at the iframe. So `charts.ts` crops each chart frame's box (the prototype capture's box, in both screenshots) and requires: ink (pixels more than 16 levels off the crop's most common colour) of at least 0.1% of the box and 0.5–2× the prototype's; and a cosine similarity of at least 0.9 between the two 32-column grids of ink per cell. Remi scores 0.99–1.00 against the prototype; a blank chart scores ink ≈ 0 and similarity ≈ 0, and a mirrored, flipped, shifted or axes-only chart 0.67 or less. Two self-tests run with every `make parity`: blank, mirrored and axes-only copies of the prototype's own charts must fail, and so must a chart emptied inside Remi's running Textbook (whose Tier B stays within budget, which is why the check exists).
- **Tier B.** pixelmatch at threshold 0.1 over the whole screenshot against `maxDiffRatio` (1% chrome, 2% dense). Masked in both images: only time-dependent content, i.e. `[data-parity-mask]` elements, clock times in the Notes region and "Just now" stamps; the caret is hidden at capture. Live-chart iframes are compared like everything else, so the side-by-side sheets show them.
- A driver error (a state that cannot be reached yet) still captures the page where it stopped and is reported.
- Output: `baselines/remi/<state>.png|json`, `report/<state>.side-by-side.png` (prototype | Remi | diff, half size), `report/<state>.diff.png`, `report/results/<state>.json`, and `docs/parity-report.md`. Each result carries its run (`PARITY_RUN_ID`, one per `make parity` for both fixtures) and capture time; the report counts only the current run and lists older rows as stale, so `make parity STATE=…` does not mix old rows into the totals.
- **Remi-only states** run against the `empty` fixture: `setup-wizard` on the fresh install (full page, all four steps), then, after a minimal `POST /api/setup`, `empty-home`, `empty-today` … `empty-transition`, `empty-textbook` and `settings` (full page). They are scored, with the same tiers, against `baselines/remi-approved/` (committed). Such a state fails when it has no approved baseline, when its page is taller or wider than the viewport but not captured in full (`fullPage` in `states.ts`), or when its PNG is not the one recorded in `approvals.json`.
- **Approving and signing off** (`approvals.ts`). After looking at a capture in `baselines/remi/`, `make parity STATE=<id> PARITY_APPROVE=1 PARITY_APPROVER="<who>"` copies it into `baselines/remi-approved/` and records the approver, the time and the PNG's sha256 (`PARITY_APPROVAL_NOTE="…"` adds what still needs work); it refuses a capture with a driver error or a partial page, and it clears any earlier sign-off. A person then looks at the approved PNGs and runs `make parity-confirm STATE=<regex> BY="<name>"`, which records the sign-off against the same sha256. The report shows both for each state and lists the sign-offs still pending. An agent approval is recorded as the agent's; only a person should run `parity-confirm`.
- **Readiness.** The Remi driver waits until no request has been in flight for 300ms. Requests are tagged with the document that made them: a navigation request takes the frame's next document number, every other request its *committed* document (between a navigation request and its commit only the old document can make requests, so a fetch it fires in that window, such as Home's `GET /api/textbook/home` after the `2` key while `page.goto` is already under way, stays with the old document). When the frame commits the new document, whatever the old ones left open is dropped (those requests never finish), and so is anything in a detached frame. `ready()` therefore never waits out its 20s limit on a request nobody is waiting for. If it ever does reach the limit it logs the open requests and carries on, and `quietTimeouts(page)` records it: the egress and behaviour specs fail any test with a timed-out readiness wait (egress crawls every parity state on the production build, so this covers the parity states too).

The prototype baselines carry the same capture fields (`ownLines`, `ownFields`, `pageLines`, `anchors`, masks). They were re-captured when Roll values, fields and the prototype anchors joined Tier A (`make parity-baseline`; `PARITY_PROTOTYPE_PORT` moves its http.server off 4800).

### Remi driver contract

`drivers/remi.ts` uses deep links where they exist (C1-platform §4): `/app/today/<iso>`, `/app/calendar/<YYYY-MM>?day=<iso>`, `/app/projects/<id>`, `/app/routines?focus=<id>`, `?drawer=<projectId|new>`, `?palette=`, and `?frame=1920x1080` on every app URL (the prototype's frame prop). Everything else needs these hooks in the screens:

| Hook | Where | Used for |
| --- | --- | --- |
| `data-screen-label` values and nesting as in the prototype | every screen | Tier A regions |
| `data-parity="timeline-bar:<projectId>"` | Timeline, each project's forecast bar | `timeline-tip-ret` hover |
| `data-parity="timeline-row:<projectId>"` | Timeline, each project row (click opens the side panel) | `timeline-panel-ret` |
| `data-parity="timeline-rotation"`, `data-parity="timeline-rotation-segment"` | Timeline, the rotation lane and each segment | `timeline-tip-rotation` hover |
| `data-parity="home-card:plan"`, `data-parity="home-card:textbook"` | Home, the two launcher cards | `home-hover-*` |
| `data-phase="compose|thinking|review|error"` on an element inside `[data-screen-label="Check-in drawer"]` | check-in drawer content | `drawer-*` states |
| `button[title="Change the start date"]`, `button[title="Change the target date"]` | Workspace (prototype titles) | `workspace-ret-datepicker` |
| `button[title="Full screen"]` | Textbook chart block (prototype title) | `textbook-chart-full` |
| `data-block-type="formula"` on formula blocks | Textbook | waits for KaTeX |
| the palette placeholder `Jump to a screen or project…`, ⌘K opens it and focuses the input | shell | `palette-*` |
| the drawer focuses its textarea after opening; "Use a simple reading" button in the error phase | check-in drawer | `drawer-*` |
| `data-parity-mask` on anything time-dependent (the Notes clock, "Just now" stamps) | any | Tier B masks |

### The check-in AI states

The prototype stubs `window.claude`; Remi's AI runs on the server. The AI states therefore point the backend at `remi/fake-ai.ts`, a fake **Ollama** server (the Ollama provider's `POST /api/chat` and `GET /api/tags`): `fixture` answers `golden/claude-fixture.mjs` `CLAUDE_FIXTURE_REPLY` (already in the backend's change schema), `error` answers prose with no JSON (502 `AI_BAD_REPLY`), `pending` never answers. `remi/api.ts` `useAiStub()` switches Settings to `ollama` at that URL, with recent notes sent (the prototype's reader gets them, as its Notes copy says), or to `none`.

Settings are global, so **only a state that names its stub (`claude` in `states.ts`) touches them**: every drawer state (`drawer-compose` and `drawer-review-simple` name `none`) and `notes` (`fixture`, because Remi's Notes copy follows the AI setting, ADR-0004, and the prototype's copy describes an AI reader that is sent recent notes). Those states run in order in one worker; every other state leaves Settings alone and none of them reads the AI setting, so the parallel workers cannot flip the provider under a drawer state. The backend also has a test-only fake (`REMI_AI_FAKE`, a reply file); the harness keeps the Ollama fake because the drawer's provider dot and the Notes copy follow Settings, which must name a provider anyway.

### Behaviour and egress

- `specs/behaviour.spec.ts` (`@p4`): palette `+6h returns` (preview == applied forecast; on the Timeline's ret row, the moved chip with the preview's `+3 BD`, the row now `Mon 7 Dec, +6 BD` against the target and `was 2 Dec`; the feed body); simple reading with one change unticked (the Projects row reads Today); check-in keys (⌘↵ retries from the error phase; Esc with the focus in the textarea closes the drawer, as the prototype's window-level listener does); Esc during a reading (the thinking phase) closes the drawer, aborts the `POST /api/checkins/parse` and sends its `DELETE /api/checkins/parse/<id>`, with a soft check that the provider call ends too; Today checklist and task ticks; Workspace target snap, rate replan and delete; a routine rule change on Today, the loads and the Timeline's routine row (BD8 → BD10); Transition verdict states; Calendar Esc; Notes tagging and the entry's own 09:30 stamp (`Note at 09:30`, from the backend's `REMI_NOW` clock); Home `1`/`2`; Textbook slash menu, formula and chart upload; the first-run wizard to empty states; persistence into a fresh browser context. Each flow starts from a fresh design fixture, in one worker.
- `specs/egress.spec.ts`: a context route aborts and records anything that is not `127.0.0.1`, `data:`, `blob:` or `about:`; `request` and `websocket` events are a second net across every page and frame; every frame's `securitypolicyviolation` events are the third (when the backend serves the build, its CSP stops an external fetch before any request exists, and the attempt still fails the test). Two self-tests prove the nets: on the real page (caught by CSP when the backend serves it) and on `about:blank` (no CSP: caught by the route). It crawls every design state plus the key flows (quick add and apply, the fake provider's error phase, Notes, Today ticks, the NavRail's screen buttons, Home keys, the Textbook chart, a first run on an empty install), and runs `frontend/scripts/check-dist-urls.mjs` over the fresh build. A crawl step that fails (a control that is gone, a screen that does not open) fails its test: a crawl that stopped half way proves nothing about the screens it never reached. The NavRail step clicks each `button` in `nav[aria-label="Screens"]` and checks the URL, `aria-current` and the screen.
