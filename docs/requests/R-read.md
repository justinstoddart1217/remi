# R-read: repositories, read models, setup/settings, holidays, the design seed

## For every P2b service author: how to write a mutation

Every mutating service goes through `app.services.mutations.run_mutation`. It computes the plan before the change (from the cache), runs your function in one write unit of work, computes the plan after, and diffs the two into `Movement`s.

```python
from app.core.uow import ref
from app.repositories.registry import PROJECTS
from app.schemas.mutation import ProjectMutationOut
from app.services.adapters import save_plan
from app.services.engine.forecast import RateEdit, refit
from app.services.mutations import MutationScope, run_mutation

def replan_rate(uow_factory, clock, project_id: str, rate: float) -> ProjectMutationOut:
    def change(m: MutationScope) -> None:
        before = m.require_before()            # PlanState: .ctx, .plans, .projects, .loads ...
        plan = before.plan(project_id)         # engine ProjectPlan (None if unknown)
        row = m.uow.repo(PROJECTS).require(project_id)   # 404 NotFound if unknown
        save_plan(row, refit(plan, RateEdit(rate), before.ctx).plan)
        m.uow.record("project.replanned", [ref("project", project_id)], {"rate": rate})

    result = run_mutation(uow_factory, clock, change, "rate")   # default cause for movements
    return result.with_entity(ProjectMutationOut, result.project(project_id))
```

- **The event.** `fn` must call `m.uow.record(...)` exactly once whenever it changes state. Without it the unit of work raises `MissingEventError` and rolls back.
- **Causes.** `causes` is either one `MovementCause` for every movement, or a `{project_id: cause}` map. `fn` can also tag a project itself with `m.cause(pid, "scope")`; the first tag for a project wins.
- **Return value.** `run_mutation` returns `Mutation[T]` with these members:
  - `value`: what `fn` returned;
  - `plan`: the new `PlanOut`;
  - `movements`;
  - `state`: the new `PlanState`;
  - `out()`: a `MutationOut` for deletes;
  - `with_entity(XMutationOut, entity)`;
  - `project(id)` and `routine(id)`: the entity as the new plan shows it, derived fields included.
- **Setup.** `require_setup=True` is the default and raises 409 `SETUP_REQUIRED` before setup. Notes and the Textbook work before setup, so pass `require_setup=False` for them. `m.before` can then be `None`, and `result.plan` is `None` until setup is done. `out()` and `with_entity()` raise `SETUP_REQUIRED` in that case, because `MutationOut.plan` is required.
- **Errors.**
  - `forecast.InvalidEdit` becomes 422 `VALIDATION_FAILED`.
  - On `OutOfCalendar` inside `fn`, the calendar is widened (holidays generated) and `fn` runs again, up to a 10-year horizon; past it the call raises 422 `OUT_OF_RANGE`. Because `fn` may run again, it must have no side effects outside the unit of work. Use `uow.after_rollback` to clean up files.
- **Other options.** `actor=` sets the event actor (e.g. `"ai-proposal-accepted"`). `track_movements=False` skips the diff.
- **Movements are never dropped.** The diff needs a calendar covering both plans. When the plan after the change covers fewer years than the one before, `movements_between(uow_factory, clock, before, after, causes)` builds the calendar over both spans in memory, widening it on `OutOfCalendar` up to 2100. `plan_movements(before, after, cal, …)` no longer swallows `OutOfCalendar`.
- **Changes the clock must see.** Use `m.uow.after_commit(...)` for anything that must happen before the plan after the change is built. Setup, `PATCH {timezone}` and the dev fixtures register `timezone_changed` this way, so the returned plan's `today` and `nextRolloverAt` are already in the new zone.
- **Previews** (check-in preview, replan preview) do not go through `run_mutation`. Read `views.get_plan_state(uow_factory, clock)` and call the engine on `state.plans` and `state.ctx`.

## Repositories (`app/repositories/`)

- **Registry.** Import typed keys from `app.repositories.registry`. The keys are:
  - `SETTINGS`, `HOLIDAYS`, `LEAVE`, `PROJECTS`, `ROUTINES`, `ROTATION`, `NOTES`;
  - `ALIASES`, `FEED`, `EVENTS`, `TEXTBOOK`, `CHART_ASSETS`, `AI_AUDIT`.

  Use them as `uow.repo(PROJECTS)`. Importing the registry also registers the untyped names (`uow.projects`, …). The structural types are in `repositories/protocols.py`, and pyright checks that each class conforms.
- **`ProjectRepository`** loads the whole aggregate with `selectinload` through `get`, `require` and `list` (PC first, then by `sort_order`). It also has:
  - lookups: `get_task`, `get_milestone`, `get_charter_item`, `get_readiness_item`, `get_checkin`;
  - hour rules: `set_override`, `clear_override`, `set_bau_day_hours`;
  - history: `snapshots(pid)`;
  - `next_sort_order`.
- **`RoutineRepository`** has `list`/`require`, `runs_between`, `ticks_between`, `get_run`, `upsert_run`, `set_tick`, `set_all_ticks`, `ticked_item_ids`, `get_checklist_item` and `next_item_sort_order`.
- **The others:**
  - `RotationRepository.replace_segments(rotation, [SegmentSpec…])` keeps the ids you send and numbers the loops.
  - `TextbookRepository.replace_blocks(page, blocks, base_version)` raises `VersionConflict`.
  - `ChartAssetRepository.unreferenced()`.
  - `AiAuditRepository`: `add`, `list(limit, before)`, `purge_before`. **AI-providers:** you can point `services/ai/audit.py` at it if you like.
- **Read units of work roll back on exit, and that expires every ORM object.** Copy what you need out of the session inside the `with uow_factory.read()` block (views uses small dataclasses such as `RunRow` and `SettingsInfo`). Touching an attribute after the block raises `DetachedInstanceError`.
- **Adapters.** `services/adapters.py` has `plan_of`, `project_of`, `routine_of`, `rotation_of` and `engine_ctx` (ORM to engine), plus `save_plan(row, plan)` (engine to ORM: dates, rates, unplaced hours, overrides and BAU-day hours, synced in place).

## Read models (`app/services/views.py`)

- **`get_plan_state(uow_factory, clock)`** returns a `PlanState`. The cache key is `(revision, today)`, where the revision is the latest `remi_events.seq`. The state holds `out` (`PlanOut`), `ctx`, `plans`, `projects`, `derived`, `loads`, `window`, `routines`, `span` and `project_out(id)`.
  - `build_plan` returns just the `PlanOut`.
  - `invalidate_plan_cache` is for the rare change that records no event, such as the AI key.
- **The other reads:**
  - `day_view`, `month_snapshot_view`, `home_view`;
  - `calendar_view`, `loads_view`, `holidays_view`, `leave_view`;
  - `settings_out(row, key_configured=)`;
  - `run_out(...)`: `RoutineRunOut` for any occurrence, for the routines agent.
- **Projects agent:** `GET /projects/{id}/snapshots` can simply return `views.project_snapshots(uow_factory, project_id)`, which is oldest first and raises 404 for an unknown id. `GET /projects` and `GET /projects/{id}` can return `get_plan_state(...).out.projects` or `state.project_out(id)`.
- **Holiday and leave mutations** are in `services/settings.py`: `add_holiday`, `remove_holiday`, `put_leave`, `delete_leave`. Setup and settings are in `services/setup.py` and `services/settings.py`. `apply_setup(uow, SetupIn, today=)` is setup without the event.

## Contract changes (schemas I own; `make openapi` run)

1. **`MoveFlagOut` gains `slot`, `index`, `liftPx` and `stickPx`** (E2-engine's request). `MoveOut.flags` is now in the engine's order: by slot, with the prototype's tie order. The read model no longer sorts flags by date.
2. **`DayOut.focusBlocks` is in plan order** (PC first, then FI, each by `sortOrder`), not sorted by hours. The design lists them that way; for example, Thu 24 Dec shows FI onboarding 1h before Alpha engine 2h. The golden test compares all 145 day plans.
3. **The `GET /plan` ETag is now `"<revision>-<today>"`** (F-api-layer's request 1). Before, `If-None-Match` could return 304 after midnight.

Only descriptions and fields changed. No route or status changed.

## Requests

1. **Resolved. F-api-layer (owner of `frontend/src/test/msw/fixtures.ts`): the frontend typecheck failed.** The owner has updated the fixture, and `tsc -b` passes. Change 1 above adds required fields, so the fixture's three `move.flags` entries (lines 305-307) need them too. With `remaining: []`, use `slot: 0` for all three, with `index` 0/1/2, `liftPx` 2/18/2 and `stickPx` 10/26/10.
2. **Owner of `app/api/deps.py` / `tests/api/conftest.py`: the unwired-deps 501 hides validation errors.** `tests/api` builds the app without its lifespan, so no database is wired. FastAPI resolves `Depends` before it validates path, query and body parameters. So `UowFactoryDep`/`ClockDep` answer 501 where the request is invalid and should get 422. I worked around it for `GET /day/{iso}` and `GET /month-snapshot`, which `test_errors.py` checks: those routes resolve the unit of work lazily through a small `_Wiring` dependency in `endpoints/plan.py`. Other owners will hit the same problem, for example with `POST /projects` and a bad body. Either make those deps lazy, or have `tests/api/conftest.py` wire a database.
3. **Contract owner: `POST /dev/fixtures {"fixture":"empty"}` answers 204 with no body.** There is no plan before setup, so it cannot return a `MutationOut`. This is documented in the route description only. The contract test allows exactly one 2xx per route, so it is not listed as a response.
4. **Textbook/charts owner: the design seed writes the sample chart itself.** `app/services/chart_store.py` did not exist yet, so the fixture writes the chart to `<data_dir>/charts/<h[:2]>/<sha256>.html`, with `storage_relpath = "charts/<h[:2]>/<sha256>.html"` relative to the data dir, and adds a `chart_assets` row with id `chart-price-yield`. The Google Fonts `<link>` is stripped from the HTML (PLAN.md note). Your `GET /charts/{id}` should read `data_dir / storage_relpath`. Once `chart_store` exists, I can switch the fixture to it.
5. **AI-providers: nothing to do.** The settings endpoints call `keys.set_api_key("anthropic", …)`, `keys.clear_api_key("anthropic")` and `keys.api_key_configured("anthropic")`. They return `status.ai_status(AiSettings.from_row(row))`, run from sync code through `settings_keys_bridge.ai_status`, and `PATCH ollamaBaseUrl` validates with `normalise_loopback_url`.

## Behaviour notes

- **Holidays.** Holidays come from `holidays` 0.105, offline. Weekend holidays are not stored, and `(observed)` becomes `(substitute)`. A year generated by another package version is regenerated for the current and future years; manual and suppressed rows are kept.
  - Before setup, reads never write: holidays for the wizard's calendar are generated in memory.
  - After setup, a read that needs more years generates them in a `system` unit of work, which records one `holidays.generated` event and so bumps the revision.
- **The read horizon.** A read may ask about any day from ten years before today's year to ten years after it (`calendar.read_span`; 2016-2036 on the design date).
  - `/day`, `/month-snapshot` and `/loads` answer 422 `OUT_OF_RANGE` outside it. So do `GET /day/2099-06-01`, `/day/1990-01-02` and `/month-snapshot?month=2099-06`, which store nothing and leave the ETag unchanged.
  - Walks from a day inside the horizon may widen the stored calendar by one more year (`walk_span`) and no further.
  - `/calendar` and `/holidays` serve years outside the horizon from memory: stored rows where there are any, generated otherwise, never written.
  - Inside the horizon, a read that needs new years still stores them and records one `holidays.generated` event, as before.
  - The plan's own dates (e.g. an imported project from 2012) may take the stored calendar past the horizon. That is data, not a request.
- **The move date.** `POST /setup` and `PATCH {moveDate}` refuse a date before today with 422 `VALIDATION_FAILED` (field `moveDate`); today itself is fine (countdown 0). `PATCH` without `moveDate` does not check it, so settings still change after the move has passed. `GET /setup/countdown` stays a preview and accepts any date in range.
- **The clock** gets its timezone from settings through `SettingsTimezone` (`main.py`). The value is cached for 5 s and dropped once setup, `PATCH timezone` or a fixture load commits (an `after_commit` hook), so the plan they return is already in the new zone.
- **The design seed.** `app/services/dev_fixtures.py` loads it (`load_design`), and `POST /dev/fixtures` uses the same loader. `tests/fixtures/design_seed.py` gives tests `load(...)` and `golden(name)`. Nothing under `app/` mentions `design_seed`.
  - It keeps the prototype's ids: `ret` …, `r-ret`, `man-0`, `ret-now-0`, `rot-0`, `fi-rates`, `chart-price-yield`.
  - The Transition screen's hard-coded text is stored as data: the routines' Transition notes (`r-ret`, `r-man`) and Alpha's `afterDayOneNote`, "In Define, charter half-written. Planning starts once the rotation is under way." (`Transition.dc.html:177`). `test_transition_notes_are_data` checks both.
  - `r-ret` co-tags with its project in notes.
