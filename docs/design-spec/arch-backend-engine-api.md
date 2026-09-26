## 1. Engine: pure modules with no I/O, database or FastAPI imports

**`backend/utils/dates.py`**
- `business_today(tz: str, override: date | None, now: datetime | None = None) -> date`
- `iso(d: date) -> str`, `parse_iso(s: str) -> date`, `iso_week(d: date) -> int`

**`backend/utils/holidays_gen.py`**
- `generate(region: str, years: Iterable[int]) -> dict[date, str]`
- Uses `holidays.country_holidays('GB', subdiv='ENG', years=...)` (`holidays>=0.60`, pinned in the lockfile). The package works offline.
- The result is stored in the `holiday` table. It adds 31 Aug 2026, which the prototype missed and the UI does not render.

**`services/engine/model.py`** (frozen dataclasses)
- `ProjectPlan(id, domain, start, target, forecast, prev, rate, rate_after, bau_day_hours: Mapping[str, float], overrides: Mapping[date, float], unplaced_h)`
- `RoutineDef(id, domain, kind, bd, weekday, hours, stage, project_id, has_checklist)`
- `EngineCtx(today, move, capacity, cal, routines, rotation, key_project_id, key_routine_id, stale_days=7, lookahead_bd=10, eps=0.01)`

**`services/engine/calendar.py`**: `BusinessCalendar`
- `.build(start, end, holidays, leave=frozenset())`
- `.is_bd(d)`, `.bdm(d)`, `.holiday(d)`, `.next_bd(d)`, `.prev_bd(d)`
- `.add_bd(d, k)`: raises `OutOfCalendar` instead of clamping.
- `.bd_diff(a, b)`, `.bd_between(a, b)` (strictly between), `.bds(a, b)`, `.month_bds(y, m)`, `.extend_to(d)`
- Horizon runs from today − 8 weeks to today + 3 years and is extended lazily.

**`services/engine/routines.py`**
- `occurs(r, d, cal) -> bool`
- `counts_on(r, d, ctx) -> bool`: true when stage < 3, the routine occurs, and the domain window matches (PC routines count before the move, FI routines from the move on).
- `next_occurrences(r, ctx, after, limit=3)`
- `last_occurrence_before(r, ctx, before) -> date | None`
- `monthly_effort_h(r, ctx)`

**`services/engine/rotation.py`**
- `layout(segments, start, hours_per_day, cal) -> RotationPlan`
- `current(plan, today, cal) -> RotationStatus`

**`services/engine/forecast.py`**
- `day_hours(p, d, ctx, scale=1.0)`, `work_between(p, a, b, ctx, scale=1.0)`
- `finish_for(p, start, hours, ctx) -> Finish(day, short_h)`
- `work_left(p, ctx) -> float | None`, `rescale(p, rate) -> ProjectPlan`
- `refit(p, RateEdit | WorkLeftEdit | StartEdit, ctx) -> Refit`
- `slip_for_scope(p, hours, ctx) -> Finish`
- `solve_need_rate(p, ctx) -> Need(rate, state)`
- `absorb_h(p, ctx)`, `cut_to_target_h(p, ctx)`, `cut_before_move_h(p, ctx)`

**`services/engine/loads.py`**
- `day_load(d, projects, ctx) -> DayLoad | None`
- `build_loads(a, b, projects, ctx) -> dict[date, DayLoad]`

**`services/engine/derive.py`**
- `derive_project(p, ctx, loads) -> DerivedProject`
- `derived_milestones(p, today)`
- `workspace_metrics(p, ctx, loads) -> Metrics` (includes a `sentence_case` enum)

**`services/engine/verdict.py`**
- `key_run(ctx) -> date | None`, `verdict(projects, ctx) -> Verdict`, `countdown(ctx) -> int`

**`services/engine/flags.py`**
- `upcoming_overloads(loads, ctx)`, `attention(projects, overloads)`, `checkin_prompt(projects)`

**`services/engine/allocation.py`**
- `focus_tasks(p, day, loads, ctx, done_on)`, `month_snapshot(y, m, ...)`, `next_run_after(day, routines, ctx)`

**`services/engine/checkin.py`**
- `plan_project_changes(p, changes, ctx) -> ProjectOutcome`
- `preview(changes, projects, ctx) -> list[ProjectOutcome]`
- `diff_movements(before, after, causes) -> list[Movement]`

**`services/engine/aliases.py`**
- `build_index(projects, routines, aliases) -> AliasIndex`: casefolded, matched with the word-boundary pattern `(?<!\w)alias(?!\w)`, aliases of length ≥ 3.
- `tags_for(text, idx)`, `match_project(sentence, idx)`. Notes and the simple reading share this one tagger.

**`services/engine/simple_reading.py`**
- `parse_simple(text, focus_id, ctx, idx, open_tasks) -> RawProposal`

**`services/engine/validate.py`**
- `validate(raw, state: ValidationState) -> ValidatedProposal`

## 2. One set of forecast formulas

**Hours for a project on a day: `day_hours(p, d, s)`, first match wins**
1. Not a business day → 0.
2. There is an override for d → `s·ov[d]`. An explicit 0 counts.
3. d ≥ MOVE → `s·rate_after`.
4. Some routine that has a rule on this project counts on d → `s·min(bau_day_hours[r] for r in R(d))`, where `R(d) = {r ∈ keys(p.bau_day_hours) : counts_on(r, d)}`.
5. Otherwise → `s·rate`.

**What replaces the BD3/BD8 hooks**
- A new table, `project_bau_day_hours(project_id, routine_id, hours)`, keyed by routine occurrence.
- Test fixture values:
  - ret: r-ret 0, r-man 2
  - manco: r-ret 2, r-man 1.5
  - play: r-ret 0, r-man 0.5
  - fion: r-ret 0, r-man 0
  - alpha: r-ret 0, r-man 0
- If several routines fall on the same day, the lowest value applies.
- Rules only apply when the routine really counts that day, so a routine that has been handed over gives the project back its full rate.
- New projects start with no rules, which means they get their full rate on routine days.
- The design does not render these rules, so they are stored as data only and edited through the API or fixtures.
- Load BAU items follow the same `counts_on` rule, so FI routines count after the move. Rotation hours per day and capacity come from Settings. `over = total > capacity`.

**Rescaling when the rate changes: `rescale(p, r′)`**
- If rate > 0: multiply rate, rate_after, the BAU-day hours and the overrides by `r′/rate`. The prototype's check-in path forgot to scale the overrides; this fixes it.
- If rate = 0: just set the rate.
- Every path that computes a forecast uses `rate or 1`, and saves 1 when the forecast moves. This removes the prototype's rate-0 mismatch between preview and apply.

**Work and finish date**
- `from(p) = max(today, start)`.
- `work_between(p, a, b)` = sum of `day_hours` over business days a..b, both ends included.
- `work_left(p) = work_between(p, from, forecast) + unplaced_h`. It is not rounded internally; only the display rounds to 0.5.
- `finish_for(p, a, H)`:
  - If H ≤ ε, return `next_bd(a)`.
  - Otherwise return the first business day d ≥ a where the running total ≥ H − ε.
  - If the running total stalls (for example a PC project with rate_after 0), return `day` = the business day after the last day with positive hours, and `short_h` = the hours that could not be placed. These are stored as `unplaced_h` and count as landing after the move.
- **Invariant:** `finish_for(from, work_left(p)) == forecast`. A forecast is never stored on a zero-hour day, so refits are idempotent.

**Refit (edits in the Workspace)**
- Rate edit: `L = work_left(p)`, `p′ = rescale(p, r)`, `F′ = finish_for(p′, from, L)`.
- Work-left edit: `F′ = finish_for(p, from, H)`.
- Start edit: `s′ = next_bd(s)`, keep `L` from before the edit, `F′ = finish_for(p[start = s′], max(today, s′), L)`.
- `prev = old forecast` if `F′` differs from it, otherwise `prev` is unchanged.

**Scope slip**
- `F′ = finish_for(p, from, work_left + H)`, which is the same as `finish_for(p, next_bd(F + 1), H)`.
- `delta = bd_diff(F, F′)`. This replaces `ceil(H/rate)`.

**Hours-a-day change in a check-in**
- It runs exactly the rate-edit refit above. The prototype's flat `rate × bdLeft` with a ceiling is removed.

**Need solver**
- `W(r) = work_between(rescale(p, r), from, target)` is a straight-line function of r, so solve directly: `r* = (L − W(0)) / (W(1) − W(0))`. When rate > 0 this is `rate·L/W(rate)`.
- The value shown and applied is `ceil(10·r*)/10`, so applying it always lands on or before the target.
- States: `ok`, `target_passed`, `no_capacity` (W(1) = W(0)), and `over_capacity` (stored as data only).

**Other Workspace figures**
- `absorb_h = max(0, W(from, target) − L)`.
- `cut_h = max(0, L − W(from, target))`.
- Cut to land before the move: `L − W(from, prev_bd(MOVE))`.

**Preview == apply**
- `plan_project_changes` is the only code path. Both `/preview` and `/apply` call it, and apply saves its `ProjectOutcome` exactly as returned.
- Order of operations:
  1. `target_move`: the last one wins, snapped to the next business day.
  2. `hours_per_day`: the first value > 0, applied as a refit.
  3. `scope_add`: the hours are summed and the slip is computed on the plan after step 2.
  4. `task_add`, `task_done`, `note`, `blocker` and `confidence` never move the forecast.
- A Hypothesis property test asserts `preview.to == applied forecast == derived forecast in GET /plan`.

**Key project and key run for the verdict**
- Settings hold `key_project_id` and `key_routine_id`. The routine defaults to the key project's linked checklist routine.
- `key_run = last_occurrence_before(routine, MOVE)`.
- Rule 2 is skipped if either key is missing.
- Verdict states: `off_track` (a PC forecast ≥ MOVE, or unplaced hours) → `at_risk` (key forecast ≥ key run) → `on_track_narrowly` (any project at risk) → `on_track`. There is also `no_pc`.
- `buffer = bd_between(lastPC, MOVE)`, `to_run = bd_diff(key.forecast, key_run)`, `countdown = bd_between(today, MOVE)`.

**Seed values that must still hold** (checked in memory; test file `tests/engine/test_golden.py`, today = 2026-10-05)
- Countdown **61**. The internal `bd_diff` is 62.
- Business days per month: Oct 22, Nov 21, Dec 21, Jan 20.
- Mon 5 Oct is 8h (Returns 6 + ManCo 2). An ordinary day is 7h. Mon 12 Oct is 8h.
- **Wed 4 Nov is 9.5h, the only overload.**
- Mon 4 Jan is 8h (Germany 4 + fion 1 + alpha 3).
- Rotation: 49 BD, loop of 46 BD ending Mon 8 Mar, refresh Tue 9–Thu 11 Mar.
- Work left: ret 144h, manco 74.5h, play 50.5h, fion 57h. `finish_for` reproduces every stored forecast.
- ret is +3 BD and at risk. Key run is Thu 3 Dec, `to_run` is 1. **The verdict is "Move on track, narrowly".**
- ret needs a 10.5h cut.
- Hours-a-day check-ins: ManCo at 2h lands Wed 25 Nov, and ret at 4h lands Wed 25 Nov, the same as the prototype.
- Attention list: ret +3 BD, 4 Nov +1.5h, ManCo stale 9d; the prompt goes to ManCo.
- ManCo's tasks today: 0.5 / 0.75 / 0.75h.
- Month snapshot: "2 of 17 done · 1 overdue".

**Prototype numbers that change**
- **Verdict buffer goes from 8 to 7.** It now matches the Transition strip's 7 hollow blocks.
- ret "plan X h a day" goes from 3.6 to **3.8**. Applying 3.8 lands on Fri 27 Nov, the target.
- Adding 6h of scope to ret goes from +2 BD (Fri 4 Dec) to **+3 BD, Mon 7 Dec**, because Thu 3 Dec is a BD3 with 0h for ret. The new overloads are **Fri 4 Dec 9h and Mon 7 Dec 9h**, where the prototype only had Fri 4 Dec. It still misses the key run.
- An hours-a-day check-in now scales overrides. ret at 4h/day turns its 4 Nov override into 4h, so 4 Nov becomes 10h.
- New projects start with a null forecast (the Define state) instead of forecast = target at 0h a day.

## 3. Read model

**`GET /api/plan` → `PlanOut`**, cached by `(revision, today)` with ETag = revision.
- `revision`
- `today{iso, tz, overridden, is_bd, bdm, month_bds}`
- `settings{move_date, capacity_h, tz, region, key_project_id, key_routine_id, ai{provider, model, sends_notes}}`
- `calendar{from, to, days[{iso, w, bd, bdm, hol, week}]}`. The window runs from the Monday before today − 1 week to the latest of: MOVE + 2 weeks, the end of the month after MOVE, the rotation end, and the last project end.
- `loads{iso: {items[{ref_type: routine|rotation|project, ref_id, domain, h, name}], bau, proj, total, free, capacity, over}}`
- `projects[]`: stored fields, `bau_day_hours`, `overrides`, and `derived{status, delta_bd, since_days, stale, added_h, growth_pct, work_left, work_left_display, bd_left, bd_to_target, need{rate, state}, avg_plan, buffer_bd, absorb_h, cut_h, progress_pct, over_days[], sentence{case, params}, milestones[], next_milestone, day_hours{iso: h}}`
- `routines[]{..., rule{kind, bd, weekday}, next[{iso, after_move, today}], monthly_effort_h, runs_today, checklist?{items[], ticks_today}}`
- `rotation{start, hours_per_day, segments[{order, country, code, len, pass, start, end}], loop_bd, loop_end, refresh{start, end}, current{status, order?, bd_to_start}}`
- `move{date, countdown_bd, remaining[{iso, bdm, pc_running}], flags[{kind: project|key_run|move, project_id?, iso, at_risk}]}`
- `verdict{state, buffer_bd, last_pc_exit, key_project_id, key_run, to_run_bd, any_risk}`
- `flags{upcoming_overloads[{iso, bdm, total, over_by}], attention[{kind, project_id?, iso?, chip}], prompt_project_id, next_due_project_id}`
- `aliases`, `counts{notes_total, notes_today, recent_notes}`

The server supplies all numbers. The client formats all copy from `sentence.case` and its params.

**Every mutation returns `MutationOut{plan, movements[], entity?}`**
- `Movement{project_id, from_forecast, to_forecast, delta_bd, from_target?, to_target?, cause: scope|rate|work_left|start|target|checkin|routine, label ("+3 BD" / "±0 BD"), flash: forecast changed, moved: delta_bd ≠ 0}`.
- The service derives the plan before the change (from cache), applies the change inside one transaction, bumps the revision, derives the plan after, and runs `diff_movements` using the cause tags it recorded.
- The client waits 220ms after the drawer closes, then plays flash for 1100ms and the moved chip for 5200ms.

## 4. REST endpoints (FastAPI, `/api`)

**Setup and settings**
- `GET /health`
- `GET /setup` returns `needs_setup` and defaults. `POST /setup {move_date, timezone, holiday_region, capacity_h}` generates holidays and sets the revision to 1.
- `GET /settings`, `PATCH /settings`
- `PUT /settings/ai-key` and `DELETE /settings/ai-key`. Keys are never returned; the client only sees `key_set`.
- `GET /ai/status`

**Read**
- `GET /plan`
- `GET /day/{iso}`: BAU rows, checklist run, focus-block allocation, next milestone, `next_run_after`.
- `GET /month-snapshot?month=YYYY-MM`
- `GET /home`
- `GET /projects/{id}/snapshots`

**Projects**
- `POST /projects {domain}` (also used by the ⌘K "New … project" items)
- `PATCH /projects/{id} {name, goal, why_now, later, target_date}`
- `POST /projects/{id}/replan {rate | work_left | start}`
- `DELETE /projects/{id}`
- `POST /projects/{id}/charter/{list}`, `PATCH /charter-items/{id}`, `DELETE /charter-items/{id}`
- `POST /projects/{id}/milestones {horizon}`, `PATCH /milestones/{id} {name, due, done}`, `DELETE /milestones/{id}`
- `POST /milestones/{id}/tasks`, `PATCH /tasks/{id} {text, hours, done}`, `DELETE /tasks/{id}`

**Routines**
- `POST /routines`, `PATCH /routines/{id}`, `DELETE /routines/{id}`
- `PUT /routines/{id}/runs/{iso} {completed}`
- `PUT /routines/{id}/runs/{iso}/items/{item_id} {done}`
- `PUT /routines/{id}/runs/{iso}/items {done}` (set all)

**Check-in**
- `POST /checkins/parse {text, focus_project_id, parse_id}`
- `POST /checkins/parse-simple`
- `DELETE /checkins/parse/{parse_id}` (cancel)
- `POST /checkins/preview {changes}` → per-project `{from, to, delta_bd, late, label, target_after, new_over[], misses_key_run}`. The last two fields are data only.
- `POST /checkins/apply {changes, raw_text, focus_project_id, source, parse_id}` → `MutationOut`

**Notes**
- `GET /notes/days?from&to`, `GET /notes?day=`
- `POST /notes`, `PATCH /notes/{id}`, `DELETE /notes/{id}`
- `GET /notes/day-text?day=`: the prefill for "Turn this day into an update".

**Textbook**
- `GET /textbook`, `GET /textbook/home`, `GET /textbook/search?q`
- Sections: `POST`, `PATCH`, `DELETE`, and `PUT /textbook/sections/order`
- Pages: `POST`, `GET`, `PATCH`, `DELETE`, and `PUT /textbook/pages/{id}/blocks {blocks, base_version}` (returns 409 on a version conflict)
- `POST /textbook/charts`: multipart upload, 4 MB limit, deduplicated by hash.
- `GET /textbook/charts/{id}/content`: served with the CSP `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'`.
- `DELETE /textbook/charts/{id}`

**⌘K palette**
- Search runs in the client over the plan and its aliases.
- Quick-add (`+6h returns`) opens the drawer prefilled, then goes through `/checkins/parse`.

**Data only, with no UI**
- `GET /feed`, `GET /ai/audit`
- `/aliases` CRUD
- `PUT /projects/{id}/bau-day-hours`
- `PUT /projects/{id}/overrides/{iso}` and `DELETE` for the same path
- `POST /dev/fixtures`, only when `REMI_DEV=1`

## 5. AI (`services/ai/`)

**`base.py`**
- `class ParseProvider(Protocol): name: str; async def propose(self, req: ParseRequest) -> RawProposal`
- `ParseRequest(system, context: CheckinContext, text, schema, timeout_s, max_tokens=1800)`
- Change types are a Pydantic discriminated union: `Change = Annotated[TaskDone | TaskAdd | ScopeAdd | Blocker | Confidence | TargetMove | HoursPerDay | Note | BauDone, Field(discriminator='type')]`.
- `PROPOSAL_SCHEMA` is `ProposalModel.model_json_schema()` with refs inlined and `additionalProperties: false`.

**`none.py`**
- Raises `AIDisabled`. `/parse` then returns the simple reading with `source='simple'`. This is the default provider.

**`anthropic_provider.py`**
- Client: `anthropic.AsyncAnthropic(api_key=keyring/env, timeout=settings.ai_timeout_s (30), max_retries=1)`.
- Call: `messages.create(model=settings.ai_model or "claude-opus-5", max_tokens=1800, system=SYS, tools=[{"name": "propose_changes", "strict": True, "input_schema": PROPOSAL_SCHEMA}], tool_choice={"type": "auto"}, output_config={"effort": "low"}, messages=[{"role": "user", "content": "CONTEXT\n…\n\nUPDATE\n…"}])`.
- The system prompt says to answer only by calling `propose_changes` once.
- The request does not force the tool: newer models (Opus 5.5, Fable 5.1) reject forced `tool_choice` with a 400. `strict: True` still guarantees the arguments match the schema.
- Check `stop_reason` first. `refusal`, `max_tokens`, or no `tool_use` block all mean 502 `AI_BAD_REPLY`.
- Typed errors: `AuthenticationError` → 502 `AI_AUTH`; `RateLimitError` → 503; `APITimeoutError` → 504; `APIConnectionError` → 502.
- Optional server-side fallback with `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`), controlled by a Settings toggle.

**`ollama_provider.py`**
- Client: `httpx.AsyncClient(base_url=settings.ollama_url (default http://127.0.0.1:11434, must be a loopback address), timeout=httpx.Timeout(90, connect=2))`.
- Call: `POST /api/chat {model, messages, format: PROPOSAL_SCHEMA, stream: false, options: {temperature: 0}}`, then `json.loads(message.content)` and validate with Pydantic.

**`context.py`: `build_context(session, today, focus_id, settings) -> CheckinContext`**
- Always sent: today as "YYYY-MM-DD (Monday 5 October, BD3)", `focus_project`, `capacity_h` (the prompt says "a day = {capacity}h"), and `move_date`.
- `projects[{id, name, short, aliases, domain, forecast, target, hours_per_day, confidence, open_tasks[{id, text, hours}], milestones}]`
- `routines[{id, name, rule, runs_today, aliases}]`
- `recent_notes` covers the last 5 business days and is sent only when `ai_send_notes` is on.
- Goals, charters and risks are never sent.
- Egress: only the Anthropic provider sends anything off the machine.

**`validate()` rules**
- Drop anything without a type, with an unknown type, or pointing at an unknown project, task or routine. Dropped items are recorded in `dropped[]` for the audit only.
- `task_done`: the task must be open and belong to that project.
- `task_add` / `scope_add`: text up to 120 characters; hours clamped to 0.25–80, and `task_add` defaults to 1.
- `blocker` / `note`: text up to 160 characters. Keep only the first note per project.
- `confidence`: rounded, 1–5, and different from the current value.
- `target_move`: must be an ISO date and fall inside the extendable horizon; snapped to the next business day.
- `hours_per_day`: 0 < v ≤ capacity.
- `bau_done`: the routine must count today.
- Remove duplicates using canonical JSON. Keep at most 4 `unplaced` strings, and guard against it not being a list.

**Simple reading, generalised**
- Projects and routines are matched through the shared `AliasIndex` instead of the hard-coded tables.
- `bau_done` fires when a sentence names a routine alias together with `(done|finished|ran|complete)` and that routine counts today.
- Fixes to the prototype's quirks:
  - blocker text keeps its original case;
  - no note is added next to a `task_done`;
  - `scope_add` and `hours_per_day` can both come from the same sentence.
- The output then goes through `validate()`.

**Cancellation**
- Each drawer session generates a `parse_id`. The server runs the provider call as an `asyncio.Task` in a `ParseRegistry`.
- `DELETE /checkins/parse/{parse_id}` cancels it, and so does client disconnect (`request.is_disconnected()` checked every 250ms), which covers the browser's AbortController.
- The client ignores any reply whose `parse_id` is not the current one, so a late reply cannot land in a newly opened drawer.

**Timeouts**
- The call is wrapped in `asyncio.wait_for(settings.ai_timeout_s)`: 30s for Anthropic, 90s for Ollama. Timeout returns 504 `AI_TIMEOUT`.
- The UI shows its existing error panel with "Try again" and "Use a simple reading".

**Audit log**
- Table `ai_audit(id, parse_id, created_at, provider, model, context_json (exactly what was sent), text, response_raw, proposal_json, dropped_json, latency_ms, status, error_code, input_tokens, output_tokens)`, kept for 90 days by default.
- Each check-in row also stores the accepted changes, `raw_text`, `source` and `parse_id`.

### Critical Files for Implementation
- /Users/justinstoddart/Desktop/Ninety One/remi/Remi Dashboard Design Review/Remi.dc.html (lines 179–216 constants and seed; 330–350 `dayLoad`; 470–500 `applyUpdate`; 530–571 verdict and `previewShift`)
- /Users/justinstoddart/Desktop/Ninety One/remi/Remi Dashboard Design Review/Workspace.dc.html (lines 357–405 `dayH`, `workBetween`, `finishFor` and metrics; 510–522 `refit`)
- /Users/justinstoddart/Desktop/Ninety One/remi/Remi Dashboard Design Review/CheckIn.dc.html (lines 127–145 system prompt; 267–299 review rows and EffectChip)
- /private/tmp/claude-501/-Users-justinstoddart-Desktop-Ninety-One-remi/622aff35-855d-49a3-a808-4e619d697863/tasks/ws5i1wijn.output (sections `engineAlgorithms`, `aiIntegration`, `hardcodedToGeneralise`, `critique`)
- Planned new files: `backend/services/engine/forecast.py`, `backend/services/engine/checkin.py`, `backend/services/ai/anthropic_provider.py`