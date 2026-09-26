# Requests and notes from A1-persistence

## Done outside my paths (allowed by the task): `backend/app/main.py`
I added a lifespan hook only. `create_app` now passes `lifespan=_lifespan`. On startup the hook calls `core.migrations.prepare_database(cfg.data_dir)`: it makes the data dir 0700, backs up and migrates to head, and makes `remi.db` 0600. It then sets `app.state.db` (a `core.db.Database`) and `app.state.uow_factory` (a `core.uow.UnitOfWorkFactory`). On shutdown it checkpoints the WAL and disposes the engine. If a test has already set `app.state.db`, the hook leaves it alone.
A2's request (`install_api`) still needs doing by the owner of `main.py`.

## Requests
1. **`backend/tests/conftest.py` owner:** move the DB fixtures from `tests/core/conftest.py` (`migrated_template`, `db_path`, `engine`, `session_factory`, `uow_factory`) into the shared conftest, so API and service tests can use a migrated per-test SQLite file.
2. **`tests/integration/__init__.py`:** I did not create it because it is not in my paths. Add it if other agents put tests in `tests/integration/`, to avoid basename clashes.
3. **`main.py` / CLI owner:** `remi db path|upgrade|backup` can call `core.paths.db_path`, `core.migrations.upgrade_to_head` and `core.migrations.backup_database(path, backups_dir, label="manual")`.
4. **Settings service owner:** `build_clock(cfg.today, tz_getter)` accepts a zero-argument `tz_getter` that returns `settings.timezone`. It is not wired yet, so the clock currently defaults to Europe/London.

## Model names that differ from arch-backend-data §2 (for repository and service authors)
- `CharterItem.list_name` maps to the column `list`, and `RotationSegment.pass_kind` maps to the column `pass`.
- Business-date completion fields are named `done_on` (`Date`), not `done_at`. This applies to tasks, milestones, readiness_items and checklist_items. `routine_runs` has `completed_on` (date) and `completed_at` (timestamp).
- `checkins.snapshot` (JSON) replaces `milestone_snapshot`. It holds `{target, forecast, milestones:[{milestoneId,name,date}], ...}`. There are also first-class `forecast_date`/`target_date` columns, plus `parse_id` and `batch_id`.
- The table is `routine_run_ticks`, and the model is `RoutineRunTick`.
- Added fields:
  - `projects.unplaced_hours`;
  - `settings.ai_timeout_s` (null means the provider default);
  - `settings.ai_server_fallback`;
  - `settings.ai_audit_retention_days` (90).
- Enum-like columns are typed as `Literal[...]` with matching CHECKs (`Domain`, `RoutineKind`, `BlockType`, ...).

## Unit of work usage
- Register each repository once: `PROJECTS = register_repository("projects", ProjectRepository)`. Then call `uow.repo(PROJECTS)`, which is typed, or use `uow.projects`, which is untyped.
- Call `uow.record(type, refs, data, capture_diff=True, effects=None)` exactly once. Use `uow.add_effects({...})` to add effects, and `uow.event_id` for the check-in `batch_id`.
- Modes:
  - `uow_factory(actor)` writes.
  - `uow_factory.dry_run()` is for preview. It always rolls back.
  - `uow_factory.read()` refuses writes.
- Never call `session.commit()` or `session.rollback()` inside a unit of work. Both raise `UnitOfWorkError`.
- Writes to `ai_audit` need no event.
- `remi_events` is append-only, enforced by triggers.
