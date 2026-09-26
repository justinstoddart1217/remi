# P5 harness and docs fixer (round 1): what changed, and requests to other owners

This fixer owns `parity/**`, `Makefile`, `README.md`, `docs/**` (except `docs/api.md` and
`docs/decisions/`), `launch.command` and `launch.bat`.

## What changed
1. **Remi-only parity covers every screen and page** (`parity/states.ts`). There are 11
   Remi-only states: `setup-wizard`, `empty-home`, the seven `empty-<screen>` states,
   `empty-textbook` and `settings`. The spec's acceptance gate (arch-delivery-parity §2: "its
   empty state has an approved baseline") now covers Home and the Textbook.
   - `setup-wizard` and `settings` are captured full page (1855px and 2878px), so wizard steps
     03–04 and every Settings section have pixels in the reference, not only text.
   - `specs/parity.spec.ts` fails a Remi-only state in three cases: it has no approved
     baseline (before, it passed silently), its page is taller or wider than the viewport
     without `fullPage`, or its PNG is not the approved one.
   - `parity/tests/states.test.ts` (`make test-harness`) checks five things: every app screen
     but the workspace has an `empty-<screen>` state; Home, the Textbook, the first run and
     Settings each have a state; every approved baseline holds the whole page; each approved
     baseline was captured with the state's current `fullPage`; and each PNG matches
     `approvals.json`.
2. **Approvals are recorded** (`parity/approvals.ts`,
   `parity/baselines/remi-approved/approvals.json`).
   - Approving needs a name (`PARITY_APPROVE=1 PARITY_APPROVER="<who>"`, with an optional
     `PARITY_APPROVAL_NOTE`). The ledger records the approver, the time and the PNG's sha256.
   - A person's sign-off is a separate step: `make parity-confirm STATE=<regex> BY="<name>"`,
     recorded against the same sha256.
   - A new approval clears the sign-off. `docs/parity-report.md` shows both for each state and
     lists the sign-offs still pending.
3. **`make dev` has its own data folder.** The folder is `REMI_DEV_DATA_DIR`, by default
   `<Remi data>/dev`; `make dev-data-dir` prints it.
   - An exported `REMI_DATA_DIR` no longer reaches `make dev`, so ⌘K "Reset to sample data"
     can no longer wipe the real `remi.db`.
   - `make dev API_PORT=… WEB_PORT=…` now moves Vite and the backend's allowed origin too.
   - `parity/tests/docs.test.ts` checks the recipe and the folder it resolves.
4. **README** has a "Launching Remi" section before "Getting started". It covers both
   launchers, their prerequisites, what the first run does, the port, `REMI_PORT` and
   `REMI_REBUILD`, how to stop Remi, where the data lives on macOS and Windows, the Gatekeeper
   and SmartScreen prompts, and the AI key extras.
   - The repository layout now lists the launchers.
   - A table covers the tooling-only variables.
   - `docs.test.ts` fails if the section goes missing, if a root entry is left out of the
     layout, or if a `REMI_*` variable read by the launchers, the Makefile or `RemiConfig` is
     undocumented.
5. **Stale request docs.**
   - `UI-timeline.md` items 1–3 and its intro are marked resolved, with where each was done.
   - The same goes for the finished items in `F4-platform.md` §1, `B4-backend.md` "Requests",
     `P-harness.md` §2 and `UI-calendar.md` §2.
   - `H4-harness.md` now names the right flaky tests (not `nav.test.ts`).
   - `docs.test.ts` fails a request that names an UPPER_SNAKE constant or a CSS-module class
     that no longer exists anywhere in the source, unless the item or its heading says
     "resolved".
6. **Harness backend environment** (`parity/remi/servers.ts`). The backend no longer inherits
   `REMI_*` settings or `*_API_KEY` variables from the calling shell. For example,
   `ANTHROPIC_API_KEY` would add the key row to the `settings` capture.

## Requests
### 1. A person (P5 visual reviewer, or Justin): sign off the Remi-only baselines
The 11 baselines in `parity/baselines/remi-approved/` were approved by this fixer (an agent)
after looking at each capture. Every approval is recorded as the agent's in `approvals.json`,
and none is signed off. Look at the PNGs, then run
`make parity-confirm STATE=. BY="<your name>"`, or pass a narrower regex. `make parity` shows
the pending ones.
Known issues visible in them, filed below and not blocking layout:
- the `no_pc` header copy (§2);
- "all inside target" on an empty Projects (§2);
- the stray "1.1" under "No pages yet" on Home's Textbook card (§2).

### 2. Frontend screens and shell: first-run copy
When any of these changes, the affected Remi-only states fail Tier A until they are
re-approved. Ask the harness owner, or run
`make parity STATE='setup-wizard|empty-|settings' PARITY_APPROVE=1 PARITY_APPROVER="<who>"`
after looking at the captures.
- `shell/HeaderBar/headerModel.ts` `no_pc: { word: 'Move not planned yet' }`. With the move date
  set and an empty plan, the header reads "61 business days to Fixed Income · Move not planned
  yet". It does so on all seven app screens, twice on Today, and in the Settings verdict row.
  The move *is* planned; what is missing is Private Credit work to judge. Suggestion (from
  `H4-harness.md`): "Nothing to plan yet".
- `screens/projects/model.ts` "Wind down by 4 Jan: automate or hand over · all inside target"
  appears with zero projects. It is the design's copy, true only because there is nothing
  there. Drop the clause when there are no projects.
- `screens/home` Textbook card on an install with no pages: a lone "1.1" numeral sits under
  "No pages yet…" (`empty-home` capture).

### 3. Backend (`services/dev_fixtures.py`) and frontend (`shell/CommandPalette/items/providers.ts`): the fixture load
`make dev` no longer points at the real data, but the route itself still destroys data without
a copy:
- **Backend:** `load_fixture` replaces every table and chart without calling `backup_database`.
  Please take `backup_database(..., label="pre-fixture")` first.
- **Backend:** `FIXTURE_ENVS` is `{dev, test}`. ADR-0006 and PLAN.md ("only when
  REMI_ENV=test") and the README say `test` only; `docs/api.md` says `dev|test`. Either
  restrict it to `test` (then `devResetProvider` goes too), or record `dev` in an ADR and fix
  the README row (the harness owner will).
- **Frontend:** "Reset to sample data" runs on one click, with only the hint "clears your
  edits". Please add a confirm step.

### 4. Frontend platform (`frontend/vite.config.ts`): a test timeout for the jsdom screen tests
Under CPU contention (three `vitest run`s at once, or `make check` next to other work), 3–6
screen tests time out at vitest's 5 s default. The failures are in Settings, Setup, Today,
Timeline and CommandPalette (list in `H4-harness.md` Requests §1). Alone, the slowest take
about 0.5 s. Please set `test.testTimeout: 15_000` (and `hookTimeout` to match) in the vitest
block, or cut the setup cost of those files. The Makefile does not override it, so that the
config stays in one place.

### 5. Optional, backend (`services/ai/keys.py`)
Under `REMI_ENV=test`, the key lookup still reads the machine's Keychain when the `keyring`
extra is installed. A developer with a saved key would see the key row in the `settings`
capture. The report notes this as host-dependent. A test-only in-memory key store would pin
it.

### 6. ADR owner (`docs/decisions/0007`): list the Textbook "Saved locally" divergence
A screen fixer changed the Textbook's resting save status from the prototype's "Saved in this
browser" (`Remi Textbook.dc.html:657`) to the spec's "Saved locally"
(arch-frontend-screens §4, `screens/textbook/usePageSaver.ts`). The prototype's line would be
false, because Remi saves to the local server's database. `textbook-home` then failed Tier A,
so `parity/divergences.ts` now has a text row, `textbook-saved-locally`, that cites the spec.
Please add the matching row to ADR-0007's table, as `divergences.ts` asks for every row.
