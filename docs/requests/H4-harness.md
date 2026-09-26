# H4-harness: harness hardening and a green `make check` (Phase 4)

H4 owns `parity/**`, `Makefile`, `README.md` and `docs/parity-report.md`. It takes over from
P-harness: the items in `docs/requests/P-harness.md` §2, §4 and §5 and every P-harness note in
`phase3-verifier-notes.md` are resolved below.

## What changed
1. **Live charts are checked** (`parity/charts.ts`, part of Tier A). Each chart frame's box is
   cropped from both screenshots. Remi's ink must be real (at least 0.1% of the box, and 0.5 to 2
   times the prototype's), and the cosine similarity of the two 32-column ink grids must be at
   least 0.9. Remi scores 0.992 to 0.999. Blank, mirrored and axes-only charts score 0.67 or less
   and fail.
   - Two self-tests run on every `make parity`: synthetic blank, mirrored and axes-only copies of
     the prototype's charts, and a chart emptied inside Remi's running Textbook. Both fail the
     check, while the blanked page's Tier B stays within budget.
   - Chart frames now draw at a pinned animation moment in both apps (`pinChartClock`), so the
     Textbook states are pixel-identical from run to run. The prototype baselines were
     re-captured; only the 3 chart PNGs changed.
   - `compare.ts` and the parity README no longer claim that Tier B catches a blank chart.
2. **NetTracker** (`drivers/remi.ts`) tags each request with the document that made it. A
   navigation request takes the frame's next document number. Every other request takes the
   frame's *committed* document, because between a navigation request and its commit only the old
   document can make requests. A committed cross-document navigation drops the requests the old
   document left open, and a frame that detaches drops its requests. Same-document route changes
   drop nothing.
   - Round 1 fix: other requests used to take the *requested* number. On the production build,
     Home's `GET /api/textbook/home` (fired by the `2` key) went out 3 ms after `page.goto` sent
     its navigation request. It was tagged as the new document's, survived the commit and never
     finished. `quiet()` then hit its 20 s limit 3 times, and the egress "home keys and the
     textbook chart" flow took 66 s. It now takes 5 to 6 s on the build (5.1 to 5.8 s in 3
     standalone `PARITY_SERVE=build` runs, 6.2 s inside `make check`), with no "still waiting"
     line.
   - `quiet()` still logs the open requests if it reaches its 20 s limit, and now also records
     it. `quietTimeouts(page)` exposes the record, and the egress and behaviour specs fail any
     test with a timed-out readiness wait. Egress crawls every parity state on the build, so this
     also covers the parity states.
   - The Routines behaviour flow went from about 70 s to 4 s.
3. **Egress navigation** clicks the `button`s in `nav[aria-label="Screens"]` and asserts the URL,
   `aria-current` and the screen. Any crawl step that fails now fails its test.
4. **Determinism.** The harness backend runs with `REMI_NOW=2026-10-05T09:30:00+01:00` and
   `REMI_DEFAULT_TIMEZONE=Europe/London`. The Notes stamp assertion is now hard and passes. The
   wizard pre-fills Europe/London on any machine.
5. **Divergences.**
   - Text rows remove the `drawer-review-offline` "NOTE / Finished parsing the
     security-level extract." pair and change "Apply 7 changes" to "Apply 6 changes"; a new
     `wholeLine` rule matches a run of whole lines, and `remi: ''` deletes it.
   - A visual row explains the row shift that drives that state's 0.70% Tier B.
   - `data` rows list every ADR-0007 divergence that no state shows, including the Notes rail's
     future days and the feed texts.
   - The report now has a "New copy (Remi only)" table.
   - No row is needed for the Workspace "Plan as of" line: `workspace-*` now pass as they are.
6. **Remi-only states.** The wizard and the 7 empty states now have approved baselines
   (`parity/baselines/remi-approved/`, committed), so they are scored like the design states.
   They pass 8 of 8 on both tiers at 0.00%.
   - The H4 agent approved them after looking at each capture. **A human should confirm them.**
7. **Makefile and README.** `browsers` installs from `parity/`, and `check` is documented. The
   README covers setup, dev, serve, the `remi` CLI (with the iCloud `.venv` note and the
   `python -m app.main` fallback), AI provider configuration, the stay-local guarantee and how to
   verify it.
   - Round 1: `make typecheck` now also runs `tsc` on the parity harness. The README suggests
     `caffeinate -i make check` on a Mac: one egress run failed only because the machine
     idle-slept for 921 s in the middle of a test (`pmset` log, 13:30:35 to 13:45:56).
   - `parity/README.md` now describes the two check-in key flows correctly: Esc in the text
     *closes* the drawer, and Esc during a reading closes it and cancels the parse.

## Requests (other owners)
**Status (P5 review, 2026-09-25):** item 1 was corrected, item 2 is resolved, and items 3 and
4 moved to `p5-harness_docs.md`.

1. **Frontend (flaky unit tests under load; corrected in P5).** The first note blamed
   `frontend/src/screens/calendar/nav.test.ts`, but that file is a pure reducer test (4 ms) and
   never failed again, alone or in 3 concurrent full runs. What times out at vitest's 5 s
   default under CPU contention are the jsdom screen tests with the heaviest setup: Settings
   ("shows every section with what is saved" failed in all 6 oversubscribed runs; also "saves
   the key project from its menu", "applies an accent…", "puts the appearance back…"), Setup
   ("waits for a move date…"), Today ("shows the day…", "expands and collapses a month group",
   "falls back to today…"), Timeline ("zooms to two weeks…") and, once, CommandPalette ("lists
   the screens…"). Alone the slowest take 0.4–0.5 s, so it is contention, not a hang. The fix
   (a `testTimeout` of 15 s for the frontend tests in `frontend/vite.config.ts`) is requested in
   `p5-harness_docs.md` §4.
2. **Resolved: UI-timeline doc (`docs/requests/UI-timeline.md`).** Its intro and items 1–3 are
   now marked resolved, with where each was done. `parity/tests/docs.test.ts` fails a request
   that names a constant or CSS-module class that no longer exists unless it is marked resolved.
3. **Moved to `p5-harness_docs.md` §1:** the Remi-only baselines now record who approved them
   (`parity/baselines/remi-approved/approvals.json`) and wait for a person's sign-off
   (`make parity-confirm`).
4. **Moved to `p5-harness_docs.md` §2:** the `no_pc` header copy "Move not planned yet".

No app bugs turned up. In the round 1 `caffeinate -i make check` on 8804/5304, behaviour passed
15/15 and egress 46/46 (2.1 min; "home keys and the textbook chart" took 6.2 s), with no
"still waiting" line. Parity has no driver errors, page errors or blocked requests.
