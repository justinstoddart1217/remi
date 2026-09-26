# Requests and notes from AI-providers

All of this lives in `backend/app/services/ai/`. The package docstring lists the entry points.
Tests are in `backend/tests/ai/`.

## For the `pyproject.toml` owner
1. **Pin `anthropic>=1.8,<2` in the optional extra**: `backend/pyproject.toml:22` currently reads
   `anthropic = ["anthropic>=0.40"]`. The provider needs the 1.x SDK:
   - `anthropic.omit`;
   - `anthropic.CredentialsError`;
   - the beta `fallbacks=` parameter;
   - `httpx2`, which the tests' mock transport uses.

   A 0.x install has none of these, so the resolver could pick a release that breaks the
   provider at runtime.
2. **Add the same pin, `anthropic>=1.8,<2`, to the `dev` dependency group.** The Anthropic
   tests and `pyright` need the SDK. `make setup` runs a plain `uv sync`, which removes the
   extra. I installed it locally with `uv sync --extra anthropic --inexact` (anthropic 1.8.0,
   already in `uv.lock`). Without it, `tests/ai/test_anthropic.py` skips and pyright reports a
   missing import in `anthropic_provider.py`.
   `keyring` does not need to be in `dev`: the tests use a fake.

## For the check-ins endpoint/service owner (`/checkins/parse`, `parse-simple`, `DELETE parse/{id}`)
- `POST /checkins/parse`: build the inputs, then call:
  ```python
  await registry.parse(body.text, body.focus_project_id, ctx_input, ai_settings,
                       uow_audit_sink(uow_factory, retention_days=ai_settings.audit_retention_days),
                       engine=EngineInputs(ctx, projects, alias_index), parse_id=body.parse_id,
                       is_disconnected=request.is_disconnected)
  ```
  - `ai_settings = AiSettings.from_row(settings_row)`.
  - `ctx_input` is a `context.CheckinContextInput`. Fill it from the DB and the engine:
    today and its BD-of-month, capacity, move date, the projects (Now open tasks, milestones,
    aliases, domain display name), the routines (rule text, `runs_today`, aliases) and the
    notes from the last 5 business days. Always fill `recent_notes`.
    `ctx_input.send_notes` is **ignored**: `parse` sends notes only when
    `ai_settings.send_notes` (Settings `ai_send_recent_notes`) is on, which is what
    `GET /ai/status` reports as `sendsNotes`.
  - Call it outside any unit of work. It opens its own unit of work only to write `ai_audit`.
  - `parse` keeps blocking I/O off the event loop: provider selection (the Keychain read) and
    the audit write run in worker threads, so an audit sink must be thread-safe
    (`uow_audit_sink` is). If you pass a custom `provider_factory`, it also runs in a
    thread.
  - `none` (the default) returns the simple reading straight away.
  - Errors are `DomainError`s:
    - 409: `AI_NOT_CONFIGURED`, `PARSE_CANCELLED`
    - 502: `AI_AUTH`, `AI_BAD_REPLY`, `AI_UNAVAILABLE`
    - 503: `AI_RATE_LIMITED`
    - 504: `AI_TIMEOUT`
  - Name clash: `app.services.ai.base.ParseRequest` is the provider request. It is not the
    API model `app.schemas.checkin.ParseRequest`.
- `POST /checkins/parse-simple` calls `registry.parse_simple(text, focus_id, engine, parse_id)`.
  It is synchronous and writes no audit row.
- `DELETE /checkins/parse/{parseId}` calls `registry.PARSE_REGISTRY.cancel(parse_id)` and
  returns 204 either way. A cancel that arrives before the parse starts is remembered for
  10 s, and the next start under that id is refused.
- An unknown `focusProjectId` is treated as no focus. If you want a 404 for it, check it
  yourself.

## For the settings owner (R)
- `PUT /settings/ai-key` calls `keys.set_api_key("anthropic", body.api_key)`. It raises 409
  `KEYCHAIN_UNAVAILABLE` without keyring, or 422 `VALIDATION_FAILED` (field `apiKey`).
- `DELETE /settings/ai-key` calls `keys.clear_api_key("anthropic")`. Environment keys stay.
- Both then return `await status.ai_status(AiSettings.from_row(row))`.
- Set `SettingsOut.ai_key_configured` from `keys.api_key_configured("anthropic")`.
- `set_api_key`, `clear_api_key` and `api_key_configured` block: a Keychain read or write can
  wait on a macOS access prompt. Call them from a plain `def` endpoint, which FastAPI runs in
  its thread pool. From an `async def`, wrap them in `run_in_threadpool`. `ai_status` already
  does its own key lookup in a thread.
- For `PATCH ollamaBaseUrl`, validate with `ollama_provider.normalise_loopback_url(url)`. It
  raises `NotLoopback` (a `ValueError`), which should become a 422, and it returns the URL
  without a trailing slash.
- I did not write an `ai_audit` repository. `services/ai/audit.py` writes through the ORM
  model (`uow_audit_sink`) and reads with `list_audit(session, limit, before)`. If you add a
  repository, feel free to point these at it.
- Keys are read in this order: Keychain first, then `REMI_ANTHROPIC_API_KEY`, then
  `ANTHROPIC_API_KEY`. Under pytest (`PYTEST_CURRENT_TEST`) an in-memory store replaces the
  real Keychain, so tests never touch it. Tests can also install a store with
  `keys.use_key_store(...)`.

## Decisions worth knowing
- Model default: `claude-opus-5`, the claude-api skill's current general model;
  `settings.ai_model` overrides it.
- The tool is strict, and `tool_choice` is `{"type": "auto", "disable_parallel_tool_use": true}`.
  Opus 5.5 and Fable 5.1 reject a forced tool. Disabling parallel tool use makes the API
  enforce the prompt's "call the tool exactly once". The call sends `effort: low`, except to
  Haiku and Sonnet 4.5, which reject it.
- The base URL is pinned, so `ANTHROPIC_BASE_URL` is ignored.
- `server-side-fallback-2026-07-01` with `fallbacks: "default"` is used only when
  `settings.ai_server_fallback` is on.
- `max_tokens` goes from the prototype's 1800 to 8000. Current models think before they call
  the tool, and 1800 risks `max_tokens` cut-offs. It is a ceiling, and only generated tokens
  are billed.
- Ollama:
  - The URL must be loopback, with no credentials or query.
  - `trust_env=False`, so proxy variables are ignored, and redirects are not followed.
  - The request sends `format` = `PROPOSAL_SCHEMA`, `stream: false` and
    `options: {temperature: 0, num_ctx: 8192}`.
  - `num_ctx` is fixed because Ollama's default context window can silently cut the start
    of the prompt, system prompt included. It is not sized per request, because a changed
    `num_ctx` reloads the model.
  - The default model is `llama3.1`.
- `ai_audit.context_json` stores `{"system": <prompt>, "context": <CONTEXT>}`. With `text`,
  that is exactly what was sent. There is one row per provider call, with status `ok`,
  `error`, `timeout` or `cancelled`. `none` and the simple reading write no rows. Rows older
  than `ai_audit_retention_days` are pruned on each write.
- Notes are sent only when Settings `ai_send_recent_notes` is on (and the provider is not
  `none`). The caller's `ctx_input.send_notes` cannot override it.
- A running provider call is cancelled whenever `ParseRegistry.run` exits early, for any
  reason: timeout, `DELETE` cancel, disconnect, request cancellation, or an error while
  waiting (e.g. a raising `is_disconnected`).
- `GET /ai/status` never calls off the machine. Anthropic counts as available when the SDK is
  installed and a key is set. Ollama is probed with `GET /api/tags` on loopback, and the
  configured model must be listed. `sendsNotes` is false for `none`.

## Shared file I touched
- `backend/tests/api/test_stubs.py`: I added an `IMPLEMENTED` set holding my two routes,
  `GET /ai/status` and `GET /ai/audit`. Other owners can add one line per route there.
