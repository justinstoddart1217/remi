# Requests from F-api-layer (frontend data layer)

F owns `frontend/src/api/**` (not `schema.d.ts`), `src/app/useSetupStatus.ts`,
`src/shell/HeaderBar/headerModel.ts` (+ test) and `src/test/msw/**`. No schema changed, so
`make openapi` was not needed.

## How screens use it (for the P3 screen agents)

Import from `src/api` (barrel):
- **Plan reads:** `usePlan()` returns the whole query. The selectors are `useProject(id)`,
  `useProjects(domain?)`, `useRoutines()`, `useRoutine(id)`, `useRotation()`, `useVerdict()`,
  `useLoads()`, `useToday()`, `useMove()`, `usePlanSettings()`, `useCounts()`, `useFlags()`
  and `usePlanAliases()`.
  - They return **`undefined` until the plan has been read**. That covers loading, before setup
    (409) and a failed read (500, `NETWORK_ERROR` …). `[]` or `null` (`useProject` with an
    unknown id) always means the plan really has none.
  - **Screens must check `usePlanStatus()`** (or `usePlan()`) before showing start-empty copy
    such as "No Private Credit projects yet". It returns `{status, error, refetch}`, where
    `status` is `'ready' | 'loading' | 'setup' | 'error'`, and it does not re-render when the
    plan changes. Show the empty-state copy only for `ready` with an empty list; `error` gets an
    error state with `refetch` as Retry. A failed background refetch keeps the last plan, so it
    stays `ready`.
- **Calendar index:** `useCalendarIndex(range?)` is a memoised `CalendarIndex` over
  `plan.calendar.days`, or `undefined` until the plan is read. Pass `{from, to}` for months
  outside the plan window; it fetches `GET /calendar` in the plan's region and merges the
  result.
- **Other reads:**
  - `useDay(iso)` and `useNotes(day)` keep the previous data while the next loads.
  - `useMonthSnapshot(month?)`, `useHome()`, `useSnapshots(projectId)`.
  - Notes: `useNoteDays`, `useRecentNotes`, `useNoteDayText` / `fetchNoteDayText`.
  - `useNoteTagPreview(text)` is debounced.
  - Textbook: `useTextbookTree`, `useTextbookHome`, `useTextbookPage`, and `useTextbookSearch`
    (debounced).
  - Settings and setup: `useSettings`, `useAiStatus`, `useAiAudit`, `useSetupCountdown`,
    `useHealth`.
  - Calendar ranges: `useCalendarRange`, `useLoadsRange`, `useHolidays`, `useLeave`.
  - Everything else: `useFeed`, `useEvents`, `useAliases`, `useProjectsQuery`,
    `useProjectQuery`, `useRoutinesQuery`, `useRoutineQuery`, `useRoutineOccurrences`,
    `useRotationQuery`.
- **Previews** are debounced 150 ms with `keepPreviousData`: `useCheckinPreview(changes | null)`
  and `useReplanPreview(projectId, input | null)`.
- **Mutations:** there is one hook per endpoint, named `use<Verb><Thing>`, e.g.
  `useUpdateTask`, `usePutRunTick`, `useReplanProject`, `useCreateNote`, `useSavePageBlocks`.
  - Variables are objects, e.g. `{ projectId, patch }` or `{ routineId, iso, itemId, done }`.
  - Fields that have a server default are optional.
  - Plan mutations commit the returned plan themselves and play `planMoves`. Screens must not
    call `setQueryData` or `planMoves.start` again.
  - Creating, updating or deleting a project or routine also refreshes every notes read and the
    aliases (`NAMED_ENTITY_READS`), because note tags are resolved from names when notes are
    read.
  - `usePutAiKey()` has `gcTime: 0`, so the key leaves the mutation cache on unmount. A form
    that stays mounted should call `reset()` once it has shown the outcome.
- **Check-in drawer:**
  - `useCheckinParser()` returns `{parse, cancel, current}`.
  - `parse()` resolves to `null` only for a superseded or cancelled session (the drawer ignores
    it). It rejects with `RemiApiError` for a failure, including `BAD_RESPONSE` when the reply
    echoes another `parseId`. The session is over either way. `mode: 'simple'` uses
    `/parse-simple`.
  - `useApplyCheckin()` closes the drawer itself and applies after
    `Promise.all([request, sleep(220)])`. When it rejects, reopen in review and show the toast.
- **Errors:** every failure is a `RemiApiError {status, code, message, field}`. Test for
  specific codes with `isRemiApiError(e, 'VERSION_CONFLICT')`. A network failure is
  `NETWORK_ERROR` with status 0.
- **Charts:** `chartUrl(assetId)` gives the iframe `src` for `GET /api/charts/{assetId}`. That
  route is the only one without a hook, since only the iframe loads it.
- **Tests:** in a test file, call `setupMockApi()` from `src/test/msw`. It serves the fixture
  plan with ETag and 304, setup, settings, AI status and home, and answers 501 for anything
  else. Add handlers with `server.use(...)`. `renderWithClient(hook, {initialProps})` wraps a
  hook in a fresh QueryClient.
  - The fixture's business-day figures come from its own calendar: the countdown (61), the
    verdict buffer (19), the project's `bufferBd` (-3) and `lateBd` (3), and the Transition
    strip (`move.remaining` and the flag slots). None of them is typed in by hand, so screen
    tests can assert them.

## 1. Backend (owner of `GET /plan`): make the ETag change at midnight
`ETag` is `"<revision>"`, and the revision only changes on mutations. After midnight a
conditional request would get 304 and keep yesterday's `today`. The client works around this:
once `today.nextRolloverAt` has passed, it sends no `If-None-Match` and uses
`cache: 'no-store'`. Please still make the ETag include the day (for example
`"<revision>-<today>"`) or compare `If-None-Match` against both, so that any other client is
safe too. The client stores whatever ETag string the server sends.

## 2. C1 (owner of `src/shell/HeaderBar/HeaderBar.tsx`): placeholders
`useHeaderModel()` now reads the plan. Before setup, while loading, or on an error it returns
calm placeholders: `today: ''`, `bd: ''`, countdown `'—'`, and an empty verdict word with a
`transparent` dot. `HeaderModel` gained `status: 'ready'|'loading'|'setup'|'error'`,
`countdownBd`, `verdict.short` and `verdictState`, and `countdown` is now a string.
- Please hide the `·` separator when `model.bd === ''`. That happens on a weekend or holiday
  and for placeholders.
- Please consider rendering nothing for the verdict while `model.status !== 'ready'`.
- Two optional polish items: `aria-busy` on the header while loading, and `Roll` for the
  countdown.

## 3. Copy decision to confirm (critique owner)
The design has no header word for `no_pc` (no Private Credit projects yet). I used
**"Move not planned yet"** with a faint dot (`var(--ink-faint)`). `short` is "Not yet", from
the empty-state catalogue, and the sentence is exported as `NO_PC_SENTENCE`. Change these in
`VERDICT_CHROME` if the critique says otherwise.

## 4. Contract / codegen (owner of `make openapi`)
openapi-typescript marks request fields that have a server default as required. Examples are
`CharterItemCreate.text`, `RoutineCreate.domain` and `name`, `TaskCreate.hours` and `text`,
`ApplyRequest.rawText` and `DevFixturesIn.fixture`. The hooks work around this: they take
those fields as optional and fill in the same default (`WithDefaults<T, K>` in
`src/api/types.ts`). No action is required. Running codegen with
`--default-non-nullable=false` would make the generated request types match the API.

## 5. C1 tests (owner of `src/test/renderApp.tsx`)
`stubSetupApi()` still works: the client looks up `globalThis.fetch` on every request. It
stubs every URL with the same body, though, so a stubbed `{required:false}` would also be
returned as the plan. `usePlan` rejects that as `BAD_RESPONSE`, so nothing crashes. Consider
moving the shell tests to `setupMockApi()`, which serves the real shapes.

## 6. C1 (owner of `src/app/SetupGate.tsx`): setup status failures
`useSetupStatus()` no longer turns every failure into "setup not required".
- Only 404 and 501 fall back to `{required: false, source: 'fallback'}`, as C1-platform.md §3
  says. That fallback is stale at once, so the next mount or window focus asks again.
- Every other failure is an error: 500, 403, a proxy's 502/504, no answer (`NETWORK_ERROR`),
  or a 2xx in an unknown shape (`BAD_RESPONSE`). Missing answers and 5xx are retried twice
  (1s, then 2s), and `isPending` stays true meanwhile, so the gate still renders nothing.
- When the retries run out, the query is in error with no data. SetupGate then renders its
  children, because `status.data?.required` is undefined. The app is let through, but nothing
  is cached: the next focus or mount asks again.
- Please consider rendering an error state with Retry (`status.refetch()`) for
  `status.isError`, rather than the empty app. On a fresh install that would stop a transient
  outage from showing the start-empty screens. I have not changed SetupGate.
