## 1. Tree and tooling
- **Tooling:** this Mac has only `/usr/bin/python3` 3.9.6 and no `uv`. Install uv with `brew install uv`, then run `uv python install 3.12`. Write `3.12` to `.python-version`. Dev work uses `uv sync`, `uv run pytest`, `uv run ruff check`/`ruff format` and `uv run pyright`.
- **Tree:**
```
backend/
  pyproject.toml uv.lock .python-version alembic.ini
  alembic/ env.py script.py.mako versions/0001_initial.py
  app/
    __init__.py            # __version__
    main.py                # create_app(config=None, clock=None) -> FastAPI ; cli()
    api/ deps.py router.py middleware.py static.py errors.py
         routes/{health,bootstrap,setup,settings,calendar,projects,milestones,tasks,charter,
                 routines,rotation,checkins,notes,aliases,feed,textbook,charts,events,views}.py
    core/ config.py paths.py db.py migrations.py uow.py clock.py ids.py errors.py security.py logging.py
    schemas/ base.py settings.py setup.py calendar.py project.py routine.py rotation.py
             checkin.py note.py textbook.py views.py events.py
    services/ engine/{types,calendar,routines,forecast,loads,flags,verdict,rotation,
                      snapshots,month,transition,adapters}.py      # pure, no I/O
              ai/{base,simple,context,validate,anthropic_provider,ollama_provider,registry}.py
              setup.py settings.py holidays.py calendar.py projects.py routines.py rotation.py
              checkins.py notes.py mentions.py textbook.py chart_store.py views.py events.py
    repositories/ models/{__init__,base,settings,calendar,project,routine,rotation,notes,feed,events,textbook}.py
                  protocols.py settings_repo.py holiday_repo.py project_repo.py routine_repo.py
                  rotation_repo.py note_repo.py alias_repo.py feed_repo.py event_repo.py
                  textbook_repo.py chart_asset_repo.py
    utils/ dates.py text.py numbers.py hashing.py fs.py diff.py
  tests/ conftest.py
         fixtures/{__init__,design_seed,design_seed_data}.py fixtures/assets/price-yield.html
         unit/{engine/*,test_clock,test_holidays,test_uow}.py
         integration/{test_migrations,test_setup,test_projects_api,test_checkin_apply,
                      test_routines_api,test_notes_api,test_textbook_api,test_serving,test_security}.py
         golden/{test_design_parity.py,*.json}
```
- **`pyproject.toml`:**
  - `[project]`: `name="remi"`, `requires-python=">=3.12"`.
  - `dependencies`: `fastapi>=0.115`, `uvicorn[standard]>=0.32`, `sqlalchemy>=2.0.36,<2.1`, `alembic>=1.14`, `pydantic>=2.10`, `pydantic-settings>=2.6`, `holidays>=0.60`, `platformdirs>=4.3`, `python-multipart>=0.0.18`, `httpx>=0.28` (Ollama on loopback and TestClient), `tzdata>=2024.2`.
  - Optional extras: `anthropic=["anthropic>=0.40"]`, `keyring=["keyring>=25"]`.
  - `[project.scripts] remi="app.main:cli"`.
  - `[dependency-groups] dev=["pytest>=8.3","pytest-cov>=6","hypothesis>=6.118","ruff>=0.8","pyright>=1.1.390"]`.
  - Build with hatchling, packages `["app"]`. Pin exact versions through `uv.lock`, because holiday rules change between `holidays` releases.
- **Ruff:** `target-version="py312"`, `line-length=100`, `select=["E","F","I","B","UP","SIM","RUF","S","PTH","DTZ"]` (DTZ catches naive datetimes).
- **Pyright:** `typeCheckingMode="strict"`, `include=["app","tests"]`.
- **Pytest:** `testpaths=["tests"]`, `addopts="-ra --strict-markers"`, markers `golden` and `slow`.

## 2. ORM tables (`app/repositories/models/`, SQLAlchemy 2.x `Mapped[]`)
- **`base.py`:**
  - `class Base(DeclarativeBase)` with a `MetaData(naming_convention=...)`. Alembic batch mode on SQLite needs named constraints.
  - `UUIDPk` mixin: `id: String(36)`, default `core.ids.new_id()` = `str(uuid4())`.
  - `Timestamps` mixin: `created_at`/`updated_at` via a `UTCDateTime` TypeDecorator that stores ISO-8601 UTC text.
  - Business dates use `sa.Date`. JSON columns use `sa.JSON`.
  - Every relationship sets `passive_deletes=True`, so SQLite's FK cascades do the deleting.
- **`settings`**, a one-row table with `id=1` and `CHECK(id=1)`:
  - Plan: `timezone` ('Europe/London'), `holiday_region` ('GB-ENG' | 'ZA'), `move_date` (null until setup), `move_taper` ('hard'), `capacity_hours_per_day` (8, CHECK 1..24).
  - Thresholds: `stale_threshold_days` (7), `overload_lookahead_bd` (10), `new_project_horizon_bd` (30), `now_ms_offset_bd` (9), `next_ms_offset_bd` (20).
  - Key items: `key_project_id` → projects SET NULL, `key_routine_id` → routines SET NULL, `key_run_date_override`.
  - Appearance: `motion_preference`, `accent_pc`, `accent_fi`, `serif_display`.
  - AI: `ai_provider` (CHECK none|anthropic|ollama, default 'none'), `ai_model`, `ai_send_recent_notes` (false), `ollama_base_url` ('http://127.0.0.1:11434').
  - `ui_prefs` JSON holds the sidebar state, `timeline_zoom` and `last_textbook_page_id`.
  - `setup_completed_at` and timestamps.
  - The table never holds API keys.
- **`holidays`** (`calendar.py`): PK (`region`, `date`), `name`, `source` ('generated'|'manual'), `suppressed` bool.
- **`holiday_years`**: PK (`region`, `year`), `package_version`, `generated_at`.
- **`leave_days`**: `date` PK, `hours` (null = full day), `note`. Data only.
- **`projects`** (`project.py`):
  - Text and identity: `domain` (CHECK pc|fi), `name`, `short`, `goal`, `why_now`, `later_intent`, `end_name` ('Done').
  - Dates: `start_date`, `target_date`, `target_label`, `forecast_date` (null = Define), `prev_forecast_date`.
  - Forecast inputs: `rate_hours_per_day`, `rate_after_move`, `baseline_hours`.
  - Status: `confidence` (1..5 null), `last_checkin_date`, `blocker`, `readiness` (0..1 null), `after_day_one_note`.
  - Data only: `phase` (0..3), `exit_routes` JSON.
  - `sort_order` and timestamps.
- **Project children.** All of these CASCADE when the project is deleted:
  - **`charter_items`**: `project_id`, `list` (CHECK success|inScope|outScope|constraints), `text`, `sort_order`.
  - **`milestones`**: `project_id`, `horizon` (now|next|explicit), `name`, `due_date`, `sort_order`, `done`, `done_at`.
  - **`tasks`**: `project_id` and `milestone_id` (both CASCADE), `text`, `hours`, `due_date`, `sort_order`, `done`, `done_at`.
  - **`hour_overrides`**: PK (`project_id`, `date`), `hours`.
  - **`project_bau_day_hours`**: PK (`project_id`, `routine_id`), both CASCADE, plus `hours`. This generalises bd3/bd8: "on days routine R runs, project P gets h".
    - Precedence: override > on or after the move → `rate_after_move` > min over matching routine days > `rate`.
    - `refit` scales these rows, like the overrides.
  - **`scope_changes`**: `project_id`, `checkin_id` (SET NULL), `date`, `what`, `hours`, `slip_bd`, `from_forecast`, `to_forecast`.
  - **`checkins`**:
    - `project_id`, `batch_id`, `date`, `note`.
    - `forecast_date` and `target_date`, recorded as they were at the time.
    - `confidence`, `blockers`, `raw_text`, `source` (ai|simple|system).
    - JSON columns `changes`, `done_task_ids` and `milestone_snapshot` `[{milestoneId,name,date}]`.
  - **`readiness_items`**: `project_id`, `text`, `done`, `due_date`, `done_at`, `sort_order`.
  - **`risks`**, **`checklists`** and **`checklist_items`** are data only. `checklist_items` CASCADE from their checklist.
- **`routines`** (`routine.py`):
  - `domain`, `name`, `short`, `detail`.
  - Schedule: `kind` (CHECK monthly|weekly|daily), `bd` (1..20), `weekday` (1..5), `hours`.
  - Handover: `stage` (0..3), `status_note`, `transition_note`.
  - Link: `project_id` → SET NULL, `co_tag_with_project`.
  - `sort_order` and timestamps.
- **Routine children**, CASCADE from the routine:
  - **`routine_checklist_items`**: `label`, `sort_order`.
  - **`routine_runs`**: PK (`routine_id`, `occurrence_date`), `completed_on`, `completed_at`.
  - **`run_ticks`**: PK (`routine_id`, `occurrence_date`, `item_id`), `done_at`. A row existing means the item is ticked. `item_id` also CASCADEs.
- **`rotations`** (`rotation.py`): `domain` 'fi', `title`, `start_date` (null → `settings.move_date`), `hours_per_day`.
- **`rotation_segments`**: `rotation_id` (CASCADE), `sort_order`, `country`, `code`, `length_bd`, `pass` (CHECK Build|Refresh), `loop`.
- **`notes`** (`notes.py`): `day`, `text`, `seq`, timestamps, index (`day`, `seq`). Tags are computed when read, in `services/mentions.py`.
- **`entity_aliases`**: nullable `project_id` and `routine_id` (both CASCADE), `CHECK(exactly one)`, `alias` stored lower-case, unique per entity.
- **`feed_events`** (`feed.py`, data only):
  - `project_id` CASCADE; `routine_id` SET NULL, so "Routine removed" survives the delete.
  - `kind`, `title`, `body`, `delta`, `tone`, `created_at`.
  - Stale and overload items are computed, never stored.
- **`remi_events`** (`events.py`):
  - `seq` INTEGER PK autoincrement, used as the cursor; `id` uuid unique.
  - `at` (UTC), `business_date`, `type`, `actor` (user|ai-proposal-accepted|simple-proposal-accepted|setup|system).
  - `refs` JSON `[{type,id}]`, `payload` JSON, `schema_version`.
  - No FKs, so it stays append-only across deletes.
- **Textbook** (`textbook.py`):
  - **`textbook_sections`**: `label`, `accent`, `sort_order`, `collapsed`.
  - **`textbook_pages`**:
    - `section_id` is RESTRICT. The service returns 409 unless the section is empty and not the last one.
    - `parent_id` is a self-FK with CASCADE.
    - `title`, `sort_order`, `version` (optimistic lock), timestamps.
  - **`textbook_blocks`**:
    - `page_id` CASCADE, `sort_order`, `type` CHECK(10 types), `text`.
    - `target_page_id` SET NULL. The page-delete service also strips link blocks.
    - `chart_asset_id` RESTRICT, `height` (CHECK 200..900, default 380), `caption`.
  - **`chart_assets`**: `content_hash` (unique sha256), `filename`, `size_bytes`, `storage_relpath`, `uploaded_at`.
- **Project delete** also sets `routines.project_id` and `settings.key_project_id` to null. It is allowed when it removes the last project; there is no 409.

## 3. Event log and unit of work (`core/uow.py`)
- **The rule:** one mutating request = one service command = one `UnitOfWork` = one SQLite transaction = exactly one `remi_events` row. State tables stay the source of truth for reads, and the events give history and audit.
- **`UnitOfWork`:**
  - Constructor: `UnitOfWork(session_factory, clock, actor="user")`.
  - Context manager: `__enter__` opens the session with `BEGIN IMMEDIATE`, and `__exit__` commits or rolls back.
  - It exposes the repos as attributes: `uow.projects`, `uow.routines`, `uow.notes` and so on.
  - `uow.record(type: str, refs: list[Ref], data: dict, *, capture_diff=True)` sets the command's event type and payload.
  - `uow.after_commit(fn)` and `uow.after_rollback(fn)` register filesystem side effects.
- **Automatic diff capture:**
  - A `before_flush` listener collects `{table,id,op,before,after}` from `session.new`, `dirty` and `deleted`, using `inspect(obj).attrs[x].history`.
  - At commit the UoW writes `RemiEvent(payload={"input":…, "effects":…, "diff":[…]})`.
  - Textbook block autosave sets `capture_diff=False` and stores only `{pageId, version, blockCount}`.
- **Guard:** if a flush touched state but no `record()` was called, commit raises `MissingEventError`. This is always on, and `test_uow_events.py` sends every mutating route to check it.
- **Rollback** writes no event and runs the `after_rollback` hooks, for example deleting a chart file that was just written.
- **Composite commands:** `checkins.apply` updates several projects, routine runs, scope and feed in one UoW. It writes one `checkin.applied` event, and each check-in row shares `batch_id` with the event id.

## 4. Database path, WAL and migrations
- **Location:** `core/paths.py` uses `platformdirs.user_data_dir("Remi", appauthor=False, ensure_exists=True)`, which gives `~/Library/Application Support/Remi/`. It holds `remi.db`, `charts/` and `backups/`.
  - `REMI_DATA_DIR` overrides the directory.
  - The directory is chmod 700 and the database file 600.
  - Logs go to `platformdirs.user_log_dir("Remi")`.
- **Connection setup** (`core/db.make_engine(url)`):
  - URL `sqlite:///<path>` with `connect_args={"check_same_thread":False}`, using sync SQLAlchemy and sync `def` routes that FastAPI runs in its threadpool.
  - The `connect` event sets `dbapi.isolation_level=None` and runs `PRAGMA journal_mode=WAL; synchronous=NORMAL; foreign_keys=ON; busy_timeout=5000; temp_store=MEMORY`.
  - The `begin` event runs `BEGIN IMMEDIATE` when `conn.get_execution_options().get("sqlite_begin")=="IMMEDIATE"` (the UoW sets this through `session.connection(execution_options=…)`), and a plain `BEGIN` for reads.
  - On shutdown, the lifespan runs `PRAGMA wal_checkpoint(TRUNCATE)`.
- **Migrations** (`core/migrations.upgrade_to_head(engine)`):
  - Builds an Alembic `Config` with `script_location = paths.alembic_dir()` (repo `backend/alembic`) and `cfg.attributes["connection"]=conn`, then calls `command.upgrade(cfg,"head")`.
  - Before upgrading a database that is behind head, it copies it with the sqlite3 backup API to `backups/remi-<rev>-<ts>.db` and keeps the last 10.
  - `env.py` uses `render_as_batch=True` and `compare_type=True`.
  - `0001_initial` creates every table and inserts the `settings` row (id 1) with its defaults.
- **Startup order** (lifespan):
  1. Resolve paths.
  2. Create the engine.
  3. Back up if a migration is pending.
  4. Upgrade to head.
  5. Make the holidays cover `[today.year-1, today.year+2]`.
  6. Build the clock and the AI registry.
  7. Mount static files.

## 5. Settings, setup, holidays and clock
- **Environment config:** `core/config.RemiConfig(BaseSettings, env_prefix="REMI_")` reads:
  - `data_dir`, `port=8765`, `env` (prod|dev|test), `today` (date override), `frontend_dist`, `chart_max_bytes=4_194_304`, `open_browser=True`.
  - `host` is fixed at 127.0.0.1 and any other value is rejected.
- **User settings:** served by `services/settings.py` through `SettingsRepository.get()/update()`.
  - `timezone` is validated against `zoneinfo.available_timezones()`, `holiday_region` against its enum, `move_date` is snapped to the next business day, and capacity must be 1..24.
  - GET returns `aiKeyConfigured: bool` and never the key itself.
  - The key comes from `REMI_ANTHROPIC_API_KEY` or `ANTHROPIC_API_KEY`, or from macOS Keychain via the `keyring` extra.
- **First run:**
  - `GET /api/setup/status` → `{required, missing:[moveDate…]}`, where `required = setup_completed_at is null`. The same object is embedded in `/api/bootstrap`.
  - `POST /api/setup {timezone, holidayRegion, moveDate, capacityHoursPerDay}` does this in one UoW:
    - generates holidays;
    - creates the three default Textbook sections (FI, PC, General; structure, not sample data);
    - sets `setup_completed_at`;
    - records the `setup.completed` event with `actor=setup`.
  - The timezone default comes from the `/etc/localtime` symlink.
  - Until setup is done, read models that need `move_date` return 409 `SETUP_REQUIRED`.
- **Holidays** (`services/holidays.py`):
  - `ensure_years(region, years)` generates the years missing from `holiday_years` using `holidays.country_holidays("GB", subdiv="ENG", years=y)` or `("ZA", …)`.
  - Rows are inserted with ON CONFLICT DO NOTHING, and suppressed rows are respected. This runs offline.
  - Checks: 2026-08-31 is included and 2026-12-28 is "Boxing Day (observed)".
  - If `holidays.__version__` differs from the stored `package_version`, future generated years are regenerated. Manual and suppressed rows are kept.
  - Removing a generated holiday sets `suppressed`; removing a manual one deletes the row.
- **Range auto-extension:**
  - `services/calendar.py` builds `engine.calendar.BusinessCalendar(holidays, covered=(y0,y1))`.
  - The engine raises `CalendarExhausted(year)` instead of clamping.
  - The service then calls `ensure_years` in a short system UoW and retries, within a 10-year horizon and the supported years 1990–2100. Beyond that it returns 422 `OUT_OF_RANGE`.
- **Clock** (`core/clock.py`):
  - `class Clock(Protocol): now()->datetime` (aware UTC) and `today()->date` (in the business timezone).
  - `SystemClock(tz_getter)` reads the timezone from settings on each call.
  - `FixedClock(today, now)` is for tests.
  - `OffsetClock(real, target_date)` is used when `REMI_TODAY` is set. Wall-clock time keeps moving and only the date shifts, which avoids the prototype's mix of real time with a fake date.
  - Bootstrap exposes `clock.overridden`.
  - Routes and tests get it through the `api/deps.get_clock` dependency, which tests override.

## 6. Repositories and service boundaries
- **Repository shape:** one repo per aggregate, taking a `Session`. Their Protocols live in `repositories/protocols.py`, and services depend on the Protocols. Tests use the real SQLite database rather than fakes.
- **Repositories and their methods:**
  - `SettingsRepository`: `get()`, `update(**f)`.
  - `HolidayRepository`: `list(region, frm, to)`, `covered_years(region)`, `insert_generated(rows)`, `add_manual(...)`, `suppress(region, d)`, `delete_manual(region, d)`. `LeaveRepository` has the same shape.
  - `ProjectRepository`, the aggregate root with all children:
    - `get(id, *, full=True)` (uses `selectinload`), `list(domain=None)`, `add(p)`, `delete(id)`, `next_sort_order(domain)`.
    - Child lookups: `get_task(id)`, `get_milestone(id)`, `get_charter_item(id)`, `get_readiness_item(id)`.
    - `set_override(pid, d, h)`, `clear_override(pid, d)`, `snapshots(pid)`.
  - `RoutineRepository`:
    - `list()`, `get(id)`, `add`, `delete`.
    - `runs_between(frm, to)`, `ticks_between(frm, to)`, `upsert_run(rid, d, completed_on|None)`, `set_tick(rid, d, item_id, done)`, `set_all_ticks(rid, d, done)`.
  - `RotationRepository`: `get_active()`, `replace_segments(rid, segs)`.
  - `NoteRepository`: `list_days(frm, to)`, `day_index(frm, to)`, `recent(days)`, `add`, `update`, `delete`, `next_seq(day)`.
  - `AliasRepository`: `list`, `add`, `delete`.
  - `FeedRepository`: `add`, `list(limit, before)`.
  - `EventRepository`: `append(evt)`, `list(since_seq, limit)`, `for_ref(type, id)`. It has no update or delete methods.
  - `TextbookRepository`:
    - `tree()`, `get_page(id)`.
    - `replace_blocks(page_id, blocks, base_version)`, which raises `VersionConflict` (409).
    - `search(q)`, `section_is_empty(id)`.
  - `ChartAssetRepository`: `get_by_hash`, `add`, `unreferenced()`.
- **Layers:**
  - `api/routes` parse requests with `schemas` (camelCase aliases), call one service function, and map `DomainError(code, message, field, status)` to `{error:{code,message,field?}}`. All `/api/*` misses return JSON 404.
  - Services own the transaction, use repos, call the pure engine through `engine/adapters.py` (ORM → frozen dataclasses) and call `uow.record`. They never commit or open nested UoWs.
  - Reads (`services/views.py`: bootstrap, today, month-snapshot, move, home) use a read-only session and write no events. The one exception is lazy holiday extension, which runs its own UoW.
  - **Preview equals apply:** `checkins.preview` and `checkins.apply` both call `engine.forecast.refit()`. Preview runs inside a UoW that always rolls back. Golden tests compare the two results.

## 7. Production serving, CLI and charts
- **`create_app()`:**
  - Includes `api_router` under `/api`.
  - `/assets` is served with `StaticFiles(frontend/dist/assets)` and `Cache-Control: public,max-age=31536000,immutable`. Fonts, KaTeX and the React bundles are all hashed assets.
  - A catch-all `GET /{path:path}` (excluding `api/` and `charts/`) serves the file from `dist` if it exists, guarded by `resolve().is_relative_to(dist)`. Otherwise it serves `index.html` with `no-cache`.
  - If `dist` is missing, it returns a plain 503 "run npm run build".
  - `dist` resolves to `REMI_FRONTEND_DIST`, or else `Path(app.__file__).parents[2]/"frontend/dist"`.
- **Security middleware** (`api/middleware.py`). There is no auth, so these are the guards:
  - `TrustedHostMiddleware(["127.0.0.1","localhost"])` protects against DNS rebinding.
  - Mutating `/api` calls must carry `Origin ∈ {http://127.0.0.1:<port>, http://localhost:<port>}` (plus `:5173` in dev) and the header `X-Remi-Client: 1`. There is no CORS middleware.
  - The app CSP is `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`. `'unsafe-inline'` in `style-src` is needed because KaTeX emits inline styles.
- **Chart storage:**
  - Files are content-addressed at `<data>/charts/<h[:2]>/<sha256>.html`.
  - Upload accepts `.html`/`.htm` only, must be valid UTF-8 and at most 4 MB, and is deduplicated by hash.
  - The file is written atomically (`utils/fs.atomic_write` then `os.replace`) before commit. `after_rollback` deletes files created by the failed command, and `after_commit` garbage-collects unreferenced assets.
- **Chart serving:** `GET /charts/{asset_id}` returns a `FileResponse` of type `text/html` with these headers:
  - `Content-Security-Policy: sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'`
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`.
  - The client iframe uses `sandbox="allow-scripts"` without `allow-same-origin`.
- **CLI** (`remi = app.main:cli`, argparse):
  - `remi [--port N] [--no-browser] [--data-dir P]`:
    - If the port already answers `/api/health` with `{"app":"remi"}`, it just opens the browser and exits.
    - Otherwise it runs `uvicorn.Server(Config(create_app(cfg), host="127.0.0.1", port, workers=1, server_header=False))`.
    - Once `server.started` is true, a thread calls `webbrowser.open`.
  - Other subcommands: `remi db path|upgrade|backup` and `remi doctor`.
  - Install with `uv tool install --editable ./backend`.
- **Dev mode:** `uvicorn app.main:create_app --factory --reload`, with the Vite dev server proxying `/api` and `/charts` to 127.0.0.1:8765.

## 8. Test strategy
- **Fixtures in `conftest.py`:**
  - `migrated_template` (session scope): runs Alembic head once into `tmp_path_factory/template.db`.
  - `db_path` (function scope): copies the template file. Tests use a real file with WAL and FKs, not `:memory:`.
  - `config`: `RemiConfig(data_dir=tmp_path, env="test")`.
  - `clock`: `FixedClock(date(2026,10,5), now=2026-10-05T08:00Z)`.
  - `uow_factory`, `app = create_app(config, clock)`, and `client = TestClient(app, headers={"X-Remi-Client":"1","Origin":"http://127.0.0.1:8765"})`.
- **`design_seed`** (opt-in, never autouse):
  - `tests/fixtures/design_seed_data.py` is a literal Python port of the prototype data:
    - `BASE_PROJECTS`, `ROUTINES`, `FUNDS`, `ROT_DEF`, `BASE_NOTES` and `BASE_DONE_ON`;
    - the `BASE_FEED` entries other than stale and overload;
    - the seeded task `man-0` and the aliases, with the two alias tables merged;
    - the Textbook `SEED`;
    - bd3/bd8 turned into `project_bau_day_hours` rows: ret {r-ret: 0, r-man: 2}, manco {r-ret: 2, r-man: 1.5}, play {r-ret: 0, r-man: 0.5}, fion {both 0}.
  - `design_seed.load(uow_factory, clock) -> SeedIds`:
    - runs setup (London, GB-ENG, move 2027-01-04, capacity 8, key project ret, key routine r-ret);
    - then creates everything through the services, so events and invariants hold;
    - ticks funds 1–5 for the 2026-10-05 run;
    - copies `charts/price-yield.html` into the chart store.
  - Ids are deterministic `uuid5(NS, "ret")`, patched in through `core.ids.new_id`.
- **Isolation from production:** `tests/` is not in the wheel. `test_security.py` checks that nothing under `app/` mentions `design_seed`, and that a fresh startup has 0 projects and needs setup.
- **Golden tests** (`golden/test_design_parity.py`):
  - Countdown 61 and buffer.
  - Loads: BD3 = 8h; 2026-11-04 = 9.5h and over.
  - Month snapshot "2 of 17 done · 1 overdue".
  - Rotation: DE 4–11 Jan … FI 3–8 Mar, loop 46 BD.
  - Attention: ret +3 BD, the 4 Nov overload, ManCo stale 9d.
  - These tests export `golden/*.json` for the frontend's Vitest suite, so the Python and TypeScript engines are checked against each other.
- **Other tests:** migrations (upgrade to head, `compare_metadata` is empty, downgrade to base), UoW (exactly one event per mutation, none on rollback), serving (SPA fallback, `/api` 404 JSON, CSP headers, Host and Origin rejection) and holidays (years get extended, suppressed holidays persist).

## Gaps for the lead
- **Entities with no UI that the design still renders.** With the app starting empty, several things the design shows have no way to be created: routine checklist items, readiness items, aliases, the rotation, hour overrides, BAU-day hours and key project/routine. One option is an optional setup step plus `POST /api/import/plan` or `remi import plan.yaml` for user-written JSON or YAML; the tables stay data-only.
- **Chart fonts:** the sample chart loads Google Fonts. The chart CSP blocks it, so it falls back to system fonts. Warn at upload when a chart references `http(s)` URLs.

### Critical Files for Implementation
- /Users/justinstoddart/Desktop/Ninety One/remi/backend/app/core/uow.py
- /Users/justinstoddart/Desktop/Ninety One/remi/backend/app/core/db.py
- /Users/justinstoddart/Desktop/Ninety One/remi/backend/app/repositories/models/project.py
- /Users/justinstoddart/Desktop/Ninety One/remi/backend/app/main.py
- /Users/justinstoddart/Desktop/Ninety One/remi/backend/tests/fixtures/design_seed.py