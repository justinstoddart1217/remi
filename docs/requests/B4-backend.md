# B4-backend: backend clean-up (Phase 4)

B4 owns `backend/**`, `docs/api.md` and ADR-0007. Everything below is done and tested
(`uv run pytest`, ruff check and format, pyright strict; `make openapi` run, `openapi-check`
clean). `docs/api.md` has a new "Behaviour notes" section that covers all of it.

## What changed
1. **Clean-up.** `views.project_derived_out` is public (the replan preview no longer suppresses a
   private-usage warning). `WiringDep` lives in `api/deps.py`.
2. **Plan revision.** The revision (and `GET /plan` ETag `"<revision>-<today>"`) is the latest
   event that can change the plan. Note text edits and Textbook edits (`PLAN_NEUTRAL_EVENTS`)
   do not move it, so autosave never forces a plan rebuild or a 200 instead of a 304. A test
   rebuilds the plan after every neutral event type and checks it is unchanged.
3. **Determinism.** `REMI_NOW` (an aware instant) stands the clock still; `REMI_DEFAULT_TIMEZONE`
   replaces `/etc/localtime` in `GET /setup` defaults. Both are refused with `REMI_ENV=prod`.
4. **`RoutineOut.label`** (contract change): the curated Timeline row label, `null` = show `name`.
   The design seed sets `r-ret` to "Fund & security returns". A blank or `null` `label` in a
   PATCH clears it; a rename clears it unless the same PATCH sends one. The `empty` fixture now
   sweeps chart files at once.
5. **Routine hours** take any finite value from 0 and clamp to the settings capacity (99 → 8).
6. **Strict request bodies** (`CamelIn`, `strict=True`): no `"yes"`/`1` for booleans, no
   `true`/`"10"`/`10.0` for integers (including `phase`/`stage`), no strings or booleans for
   numbers; dates are exactly `YYYY-MM-DD`. 422 `VALIDATION_ERROR` with `field`. The OpenAPI
   output is unchanged.
7. **Rotation horizon** is checked before anything is written (`PUT /rotation/segments`,
   `PATCH /rotation {startDate}`, and `POST /setup` with segments, which used to commit setup
   and then fail every read). A refusal is 422 `OUT_OF_RANGE`, `field: "segments"`, and records
   no event at all. A start inside the horizon but past the stored calendar now widens it
   instead of failing.
8. **Loop 1** (`loopBd`, `loopEnd`) is the Build segments before the first Refresh; `refresh` is
   the first run of Refresh segments. After PUT [..., DE Refresh, GR Build 3] loop 1 stays 46 BD
   ending 8 Mar.
9. **ADR-0007** has new divergence rows: simple reading with no note beside a `task_done`
   ("Apply 6 changes"), the hours-a-day check-in feed "Forecast moved 11 Dec → 25 Nov.", the
   ret +6h scope feed, rate 0 refused on a planned project, and future days in the Notes rail.
   There is also a round-4 engine finding on loop 1.
10. The engine's 422 messages are sentences: "Hours a day must be more than 0 for a project with
    a forecast." and "Work left cannot be negative."

## Requests

**Status (P5 review, 2026-09-25): all three resolved.** The msw fixture has `label: null`; the
Timeline shows `label ?? name` and its stopgap table is gone (`F4-screens.md`); the harness
starts the backend with `REMI_NOW` and `REMI_DEFAULT_TIMEZONE` (`parity/remi/servers.ts`).
1. **F4 (`frontend/src/test/msw/fixtures.ts:237`): add `label: null` to the routine fixture.**
   `RoutineOut.label` is a required response key, so `npx tsc -b` reports that one error until
   it is added. It is the only frontend type error the contract change causes.
2. **UI-timeline (`screens/timeline/model.ts`):** drop `ROUTINE_ROW_LABELS` and show
   `routine.label ?? (routine.name || 'Untitled routine')`. The seed gives the same text.
3. **P-harness (`parity/remi/servers.ts` `startBackend`, and the behaviour and egress runs):** start
   the backend with `REMI_NOW=2026-10-05T09:30:00+01:00` and `REMI_DEFAULT_TIMEZONE=Europe/London`
   (with `REMI_ENV=test REMI_TODAY=2026-10-05`). That fixes the Notes "stamped 09:30" behaviour
   flow and makes `setup-wizard` pre-fill Europe/London on any machine. `REMI_NOW` must fall on
   `REMI_TODAY`.
4. **P-harness / parity report owner:** carry the new ADR-0007 rows into `docs/parity-report.md`
   and `parity/divergences.ts`. The one that affects Tier A is `drawer-review-offline`: no
   "NOTE / Finished parsing the security-level extract." row, and "Apply 6 changes" (the
   prototype shows 7).
5. **All frontend owners: requests are strict now.** Send booleans as `true`/`false`, numbers as
   JSON numbers (parse `"1,5"` to 1.5 first) and dates as `YYYY-MM-DD`. The generated types
   already say so; a string that reaches the body at runtime is now a 422, not a silent
   coercion.
6. **UI-setup-settings:** `PUT /rotation/segments`, `PATCH /rotation {startDate}` and
   `POST /setup` can answer 422 `OUT_OF_RANGE` with `field: "segments"` and the message "That
   rotation runs past Remi's calendar, which reaches ten years ahead." Show it on the rotation
   editor.
7. **F4 / API layer (optional):** a note text edit or a Textbook write returns (or leaves) the
   plan at the same `revision`. When a mutation's `plan.revision` equals the cached one, there is
   nothing to invalidate.

## Not done (decision)
- **`onboardingProjectId` setting** (UI-routines-transition §2). Not added. The Transition's
  `onboardingHost()` rule picks the right project on the seed and on any single-FI-project plan,
  and the design has no control for it. Adding the setting would need a migration, a required
  `SettingsOut` key (more hand-built fixtures to update) and new Settings UI. Revisit if a user
  has two Fixed Income projects with onboarding items.
- **Workspace "Plan as of"** is a frontend choice (the snapshots are served); not a backend item.
