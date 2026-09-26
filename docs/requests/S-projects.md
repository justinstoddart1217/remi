# S-projects: project mutations and the check-in pipeline

Services: `backend/app/services/projects.py` (project CRUD, replan, hour rules),
`project_items.py` (charter, milestones, tasks, readiness items) and `checkins.py` (parse,
preview, apply). The test double is `services/ai/fake_provider.py`. Tests are in
`backend/tests/projects/` and `backend/tests/checkins/`, with shared helpers in
`tests/projects/helpers.py`. Every mutation goes through `run_mutation`: one transaction, one
event, and a `MutationOut`.

## Behaviour other owners should know
- **A blank edit deletes (contract change, `make openapi` run).** `PATCH` with an empty or
  all-space `text` (charter item, task, readiness item) or `name` (milestone) removes the item,
  like `DELETE`. A milestone goes with its tasks. The response `entity` is the item as it was.
  `CharterItemPatch.text`, `MilestonePatch.name`, `TaskPatch.text` and
  `ReadinessItemPatch.text` lost `min_length=1`.
- **Hours floor.** A rate, `rateAfterMove`, BAU-day hours, an override, or a check-in
  `hours_per_day` must be 0 or at least 0.05. The same 422 applies when a rate rescale would
  push a BAU-day rule or override below 0.05, e.g. ret at 0.05h a day. The `field` names the
  input, such as `rate` or `changes.0.value`.
- **Check-in preview** runs the apply itself in a dry-run unit of work, so it answers the same
  404 and 422 errors as apply. Its `projects` list only projects whose target or forecast the
  changes touch. A note-only or confidence-only change set returns `[]`.
- **Check-in apply errors.**
  - 404 (with `field`) for an unknown project, task or routine, or an unknown
    `focusProjectId`. Parse also answers 404 for an unknown `focusProjectId`.
  - 422 for a task that belongs to another project.
  - 422 `NOT_AN_OCCURRENCE` for `bau_done` on a routine that does not count today.
- **`bau_done`** ticks every checklist item of today's run. For a routine with no checklist it
  records the run as complete.
- **Milestone sync (the prototype's `msSync`).** Renaming, re-dating or removing a Now/Next
  milestone (`PATCH /milestones/{id}` with `name`/`dueDate`, a blank-name delete, or
  `DELETE`) does the same to the project's explicit milestones with the old name, in the same
  event (`payload.effects.syncedIds`). `done` does not sync. The Workspace needs no extra call.
- **Check-in snapshots** (`GET /projects/{id}/snapshots`) hold the derived milestones
  (`derivedMs`, as `derived.milestones` shows them), not the raw rows.
- **Fake AI with a missing file.** When `REMI_AI_FAKE` names a file that does not exist yet,
  the configured provider answers (normally `none`: the simple reading); nothing is audited as
  the fake.
- **Override `DELETE` is idempotent.** It answers 200 and still records an event.
- **`PUT /projects/{id}/milestones/order`** takes the ids of the horizons it touches (Now, Next
  or both), each exactly once. Each horizon is numbered separately.
- **`PATCH /projects/{id}` with `null`** clears a nullable field. On `name`, `targetDate`,
  `phase` and similar fields, `null` is a 422. A phase change logs "Phase moved A → B." (data
  only; no forecast is invented). Exit routes on a Fixed Income project are a 422.

## Requests
1. **R-read (`services/views.py`): make `_project_derived_out` public.** `preview_replan` calls
   it with `# pyright: ignore[reportPrivateUsage]`, because `ReplanPreviewOut.derived` needs the
   same DTO the plan uses.
2. **Owner of `api/deps.py` / `endpoints/plan.py`: move `WiringDep` into `deps.py`.** My
   endpoints import `WiringDep` from `endpoints/plan.py`. It is the lazy unit-of-work
   dependency that keeps 422 ahead of 501 in the unwired `tests/api` app.
3. **Parity-report owner: record one new divergence.** When an hours-a-day check-in moves a
   forecast, the feed body says "Checked in. {note}. Forecast moved 11 Dec → 25 Nov." with the
   real delta (e.g. −12 BD). The prototype said "Forecast holds at 25 Nov" with ±0 BD. The scope
   feed item uses the unified slip: "Scope added (fx attribution, +6h). Forecast moved 2 Dec →
   7 Dec.", +3 BD. The feed is data only.
4. **Parity / behaviour harness (optional).** The harness already stubs the AI with a fake
   Ollama server. As an alternative, Remi has a built-in double: start the backend with
   `REMI_ENV=test` and `REMI_AI_FAKE=/path/fake.json`. The file is re-read on every parse, so
   write it between states:
   - `{"mode":"raw","raw":"<CLAUDE_FIXTURE_RAW>"}` for drawer-review-claude;
   - `{"mode":"raw","raw":"<CLAUDE_ERROR_RAW>"}` for drawer-error (502 `AI_BAD_REPLY`, "Remi
     replied without a plan.");
   - `{"mode":"pending"}` for drawer-thinking;
   - `{"mode":"none"}` for the simple reading.

   The double answers as provider `anthropic` with model `fake` and `source: "ai"`. It cannot be
   selected outside `REMI_ENV=test`. `settings.ai_provider='fake'` is not possible, because the
   `ai_provider` CHECK constraint and the `AiProvider` literal allow only none, anthropic and
   ollama, so the switch is the environment variable only.
5. **UI-notes-checkin: `ProjectPreviewOut.pastTargetBd` (contract change, `make openapi` run).**
   `POST /checkins/preview` now sends `pastTargetBd` per project: business days from
   `targetAfter` to `to` when `late`, else `null` (the golden ret +6h gives 6). It is a required
   key, per the "Out models declare every key" rule, so the hand-built fixture in
   `frontend/src/screens/checkin/model.test.ts:121` (`preview()`) needs `pastTargetBd: null`
   added. `tsc -b` reports that one error until it is added. `effectChip` can then read
   `preview.pastTargetBd` for "now N BD past target" instead of `calendar.bdDiff`.
