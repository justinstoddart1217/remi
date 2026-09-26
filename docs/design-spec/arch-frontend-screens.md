- **Stack:** React 18.3, TypeScript 5.5 and Vite 5, with react-router 6.26 and @tanstack/react-query 5. TS types come from FastAPI's OpenAPI via `openapi-typescript` 7. Other libraries: `react-textarea-autosize` 8.5 (field-sizing is Chromium-only, crit Notes risk), `@floating-ui/react` 0.26, and katex 0.16.11 bundled. Fonts and icons are self-hosted: `@fontsource/albert-sans`, `@fontsource/libre-caslon-text`, `@fontsource/jetbrains-mono`, plus a subset woff2 of Material Symbols. The Python engine is the single source of forecast maths, so the client renders read-models and never recomputes forecasts.
- **Frontend layout (none exists yet):** `frontend/src/{app,ui,screens,features,api,lib,styles}`. `styles/tokens.css` holds the Remi.dc.html `:root` block verbatim. `lib/motion.ts` has one `useReducedMotion()` that merges `prefers-reduced-motion` with the setting; every spec flags the split sources.

### (1) Shared primitives (`frontend/src/ui/`)
- `CapacityBar`: variants `day` 14px, `panel` 12px, `mini` 6px (repeating-gradient, crit Foundations:189), `cell` 5px, `strip` vertical 5px/h, `decor` for Home. It takes `DayLoad{bau[],proj[],total,cap}` and handles the notched BAU, soft project, outlined free, cap marker, overload and a single pulse.
- `CapacityLegend`: shows the hour values (crit Today:44–46).
- `DeltaChip`: one recipe, tones `risk|neutral|none`. Labels: `+N BD`, `−N BD`, `On target`, `no plan`, `+N BD vs target`, `moved +N BD`.
- `Roll`: odometer with an `aria-label` carrying the real value, and a static fallback for values it can't roll.
- `StaleBadge`, `DomainTag`, `DomainDot`, `SectionHeader`, `Eyebrow`, `SectionTitleRow`, `BauChip`, `Pill`/`StagePill`.
- Markers: `MilestoneDiamond`, `ForecastEndDiamond`, `TargetMarker`, `BauTick`.
- `TimelineBar` (on/risk/done/ghost/define-hatched), `RotationSegment`, `RotationTile`, `ConfidencePips` (10×8 and 12×8).
- `Checkbox`: 18/16/15px, `role=checkbox`, `aria-checked`.
- `InlineField`: `<InlineField value onCommit multi? numeric?{max,comma} removeOnBlank? required?>`. Draft/commit: Enter commits except `multi`, Escape reverts and calls `stopPropagation` (crit :8 and Workspace:190). Blurring an untouched blank item removes it (Workspace:332).
- `BusinessDayDatePicker`: 292px popover via floating-ui, BD sub-labels, snaps forward, range-limited arrows, capture-phase Escape (crit Workspace:297, :210–215).
- `Tooltip`: 280–300px. It keeps its last content while fading out (Timeline risk).
- `SidePanel`: 440/460px, no scrim. It keeps its last content mounted during the exit (Timeline:179, Calendar risk). Escape closes it only when it is the topmost layer.
- `Drawer` (scrim, 1160px, focus trap, `aria-modal`), `CommandPalette`, `NavRail`, `HeaderBar`, `ScreenStack` (keep-mounted cross-fade 240/140ms), `LayerManager`. The layer manager owns the Escape order: fullscreen, palette, drawer, then panel. This fixes Calendar:131 double-closing.
- `SegmentedControl` (sliding pill), `BdStepper`, `WeekdayPicker`, `HandoverStepper`, `ProgressRule`.
- Buttons: `Button` primary/outline/ghost/`TextLink↗`/`AddButton`, and `TwoStepConfirmButton` (arms for 3.5–4s).
- `EmptyState`: italic serif or muted. `Toast`: ink pill, 3200ms. `ErrorBoundary`: one per screen and one around the drawer.
- `HoverProvider`: one dim value (0.28, per Foundations), keyed `{type,id}` so routine and project ids never collide (Calendar risk). Clear it on route change.
- `Icon`: `aria-hidden`.

### (2) Screens (`frontend/src/screens/*`)
**Shell (`app/`)**
- Reads `GET /api/shell`: today, bdm, daysToMove, verdict{word,short,sentence,tone} and setupComplete.
- Global ⌘K; the Tell Remi focus comes from the workspace route.
- ⌘K is `features/palette`. It reads `/api/projects` (lite) and `/api/routines`. Items: Quick add, which opens the drawer prefilled. Tell Remi about X. Create `POST /api/projects`. 'Reset to sample data' is `DEV` only.
- Opening from the palette also uses the view transition (crit Shell:599).

**home/**
- Components: `HomeHeader`, `Hero`, `LauncherCard`×2, `ControlPanelPreview`, `TextbookPreview`, `ExpandOverlay`.
- Reads `/api/home/summary`, which returns keyProject{name, forecastS, deltaLabel} or null.
- Tricky:
  - The 1/2 keys need guards for editable targets and modifiers (crit :17).
  - Plurals, and no `||5` fallback.
  - The overlay should use the view transition. Reduced motion navigates immediately (Home:167).

**today/**
- Components: `DayHeader`, `CapacityBar(day)`, `PlanList{BauRunCard(checklist), BauRow, NoBauRow, FocusBlock}`, `WeekStrip/WeekDayCard`, `MonthSnapshot{CumulativeBars, Group, Row}`.
- Reads `GET /api/today?date=`, which returns kicker, bdm, load, bauRows with checklistRun{runDate, items, editable}, focusBlocks with task slice and nextMilestone, and nextRunAfter. Also `GET /api/week?date=` and `GET /api/month-snapshot`.
- Mutations: `PUT /routines/:id/runs/:date/items/:item`, `PUT …/items` (set all), `PUT …/runs/:date`, `PATCH /tasks/:id {done}`, `PATCH /milestones/:id {done}`.
- Tricky:
  - Checklists are keyed by run date, not a global array (Today risk).
  - The task slice keeps tasks done today and drops ones done earlier.
  - Holiday weeks render a gap in place (crit :36 CORRECTION).
  - A non-BD `?day` falls back to today (:301).
  - Past-day kicker.
  - Arrival animation plays once on first reveal, not on mount.
  - The feed, attention and prompt panels are data-only and not built (decision 8).

**notes/**
- Components: `NotebookRail{WeekHeader, DayRow}`, `DayPage{Composer, NoteEntry, TagChip}`, `RemiReadsPanel{MentionsList, WeekSpark}`.
- Reads `/api/notes/days`, `/api/notes?day`, `/api/notes/recent?businessDays=5`.
- Mutations: `POST/PATCH/DELETE /api/notes`. Tags are computed server-side with the unified alias tagger.
- Tricky:
  - Key rows by `note.id`.
  - Store `createdAt`; for backfilled days, sort by time.
  - The Enter hint shows only when there is a draft (crit :54). The clock refreshes every 20s (:114).
  - Future days are either blocked or labelled 'In N business days'.
  - WeekSpark skips holidays.
  - The disabled CTA gets `aria-disabled` (:213).

**timeline/**
- Components: `TimelineHeader`, `Legend` (geometry crit :22–28), `PanControls`, `ZoomControl`, `DateHeader` (4 tiers), `CapacityStrip`, `LaneGroup`, `BauRoutineRow`, `RotationRow`, `ProjectRow` (layers at the geometry in crit :138–152), `OverlayLines`, `HoverTooltip` (5 variants, copy crit :125–135), `ProjectSidePanel`.
- Reads `GET /api/timeline?zoom=3m|2w&week=n`, which returns a window computed from today and the move, days with slivers, loads, lanes, per-project {bar, prev, milestones, target, status}, and `movements` for flash.
- Tricky:
  - In 2w, handed-over ticks read "Handed over" (CORRECTION :121).
  - Define rows show "Not yet" plus "Target X" (CORRECTION :124).
  - The 2w subtitle counts real BDs.
  - The FI stagger uses a running index.
  - The moved chip lasts 5.2s and the ghost lasts 1.1s.
  - Rows are keyboard-focusable.

**calendar/**
- Components: `CalendarHeader`, `WeekdayHeadRow`, `DayCell{BauChip, MilestoneLine, ProjectBar, CellLoadMeter}`, `DayPanel{PanelCapacityBar, PlanRow+allocation, DueList, OpenInToday}`.
- Reads `GET /api/calendar/month?ym=`: cells with load, chips, milestones, forecastEnds, targets, move, and per-day task allocation.
- Tricky:
  - 'This month' comes from today; months are open-ended; comparisons use year+month.
  - Month navigation uses a functional update; debounce the 130ms swap and clear the selection.
  - Panel prev/next crosses months.
  - Weekend and holiday milestones appear in the panel.
  - Capacity comes from settings (Calendar risk). Empty copy is at crit :157–160.

**projects/**
- Components: `PageHeader`, `ColumnHeader`, `DomainGroup+NewProject`, `ProjectRow{GoalSentence(view-transition 'remi-goal'), ForecastCell, ScopeGrowthCell, ConfidencePips, LastCheckInCell}`.
- Reads `/api/projects`, which returns derived status, delta, since, stale and growth.
- Mutations: `POST /api/projects {domain}`, then navigate and focus the goal.
- Tricky:
  - Each row is a real `<a>` and the "Check in now" button sits outside it.
  - Growth shows "—" or "0% · h" (crit :171).
  - Rows transform only (:172).
  - Use `document.startViewTransition`, with a cross-fade fallback.

**workspace/** (`/projects/:id`)
- Components: `WorkspaceHeader`, `GoalHero`, `StatsStrip{StartCell, TargetCell, ForecastCell, HoursCell, WorkLeftCell, ToLandCell}`, `ProgressVerdict`, `HistoryScrubber{PlanBar, HoverLabels, Crosshair, Track, Handle}`, `Charter{WhyNow, CharterList×4, RemoveProject}`, `Plan{NowColumn, NextColumn, LaterIntent}`.
- Reads `/api/projects/:id` and `/snapshots`.
- Mutations: `PATCH /projects/:id`, `POST /projects/:id/replan {rate|workLeftHours|startDate}`, charter/milestone/task CRUD, `DELETE`.
- Tricky:
  - "Why now" is multi-line (CORRECTION :190).
  - Numeric input accepts a comma, and NaN becomes 0 (:334).
  - The scrubber drags only with 2 or more snapshots, and snaps (:590).
  - The live stop dates to today, not the last check-in.
  - Snapshots store the target.
  - `toLand` uses the server's day-weight solver.
  - A missing id redirects to `/projects`.
  - Stub copy is at crit :175–215.

**routines/**
- Components: `PcSectionHeader`, `RoutineRow{InlineName, KindSegmented, BdStepper|WeekdayPicker, EffortInput, NextThree, HandoverStepper, HandoverNote, ProjectLink, Remove}`, `FiRotationTrack{RotationTile×n, Legend}`.
- Reads `/api/routines` and `/api/rotation`.
- Mutations: `POST/PATCH/DELETE /api/routines`.
- Tricky:
  - Deep-linking (#id) scrolls with a 120px offset and flashes. 'rot' deep-links to the FI block (crit Shell:581).
  - The current tile is derived from rotation status.
  - Don't lower-case project names (:216).
  - Keep `short` separate from the name.
  - The hours clamp comes from capacity.
  - The new-row flash (:160).

**transition/**
- Components: `Hero{Countdown, Verdict}`, `BdStrip{FlagLane, TickBar, MonthMarks, StripLegend}`, `PcColumn{WindDownRow, RoutineHandoverRow}`, `FiColumn{OnboardingList, RotationTile×3, WholeRotationLink, AfterDayOneRow}`.
- Reads `GET /api/move`.
- Tricky:
  - Countdown and buffer follow decision 9, so the verdict and strip counts agree.
  - Don't crash when projects are missing.
  - Collision-avoid flag heights over 3 or more lanes.
  - A PC forecast at or after the move gets its own flag.

### (3) Check-in drawer (`features/checkin/`, `useReducer`)
- **Entry:** `OPEN{session,pid,prefill}` resets everything to COMPOSE. After 380ms it focuses the textarea with the caret at the end (crit :81).
- **Transitions:**
  - COMPOSE → SEND (text.trim non-empty) → THINKING. The request is `POST /api/checkins/parse {text, focusProjectId}` with an `AbortController` and a `sessionId` guard. The server picks the provider from settings (`none|anthropic|ollama`); `none` returns a `source:'simple'` result straight away.
  - THINKING: the textarea is readOnly at 0.6 opacity. Progress runs 0→88% over 2600ms and snaps to 100% on resolve. A minimum dwell of 600ms keeps the echo quotes from flashing.
  - THINKING, on `200` → REVIEW. Set `result`, reset `off={}`, set `src`.
  - THINKING, on `502 AI_BAD_REPLY`, `504` or a network error → ERROR, with the design message. 'Try again' re-sends. 'Use a simple reading' posts `/parse {mode:'simple'}`.
  - REVIEW, `TOGGLE(i)` updates `off`. After 150ms debounce it posts `/api/checkins/preview {changes}`. The server runs the same `apply_changes()` in a rolled-back transaction, so preview == apply. It returns perProject{from, to, deltaBD, label} for the `EffectChip`.
  - REVIEW or ERROR, `TYPE` → COMPOSE and discards the result (crit :309). `EDIT` → COMPOSE and refocuses after 30ms (:321).
  - REVIEW, `APPLY` (≥1 selected) closes the drawer. After 220ms it posts `/api/checkins/apply {changes, rawText, focusProjectId, source}`. On `200` it invalidates queries and feeds `movements` into the flash/moved animations. On 4xx it shows the toast "Couldn't apply that. Your update is still here." and reopens in REVIEW.
- **Keys:** ⌘↵ works on the drawer root. COMPOSE and ERROR send (crit :9); REVIEW applies. Apply is `disabled` with 0 selected.
- **Close:** CLOSE, Escape or the scrim aborts any in-flight request. State stays until the next OPEN.
- **Row copy:** KIND labels and row formats are at crit :87–99, placeholder :72, capabilities :73–80, footer notes :104–107.

### (4) Textbook editor (`screens/textbook/`)
- **Block model:** a discriminated union.
  - `{id,type:'p'|'h1'|'h2'|'h3'|'bullet'|'callout',text}`
  - `{type:'formula',tex}`
  - `{type:'page',targetPageId}`
  - `{type:'divider'}`
  - `{type:'chart',assetId|null,name,height:200..900,caption}`
  - IDs are UUIDs.
- **Editor state:** `editorReducer` handles insert, split, merge, convert, move, remove, setText and setChart. A `pendingFocus{blockId,pos}` is applied in `useLayoutEffect`.
- **Derived values:** numbering (a single c1/c2/c3 pass), outline and word count.
- **Blocks:** each text block is an autosize textarea, plain text. Heading metrics are at crit :311–314.
- **Slash menu:**
  - It opens when the text starts with `/` and has no whitespace.
  - There are 10 items (crit :284–294). The filter matches the label or the type id. The header is "Blocks"; no match shows "No block called that."
  - Arrow keys and Enter work; items are picked on mousedown.
  - It is anchored to the textarea with floating-ui, which fixes the hard-coded 288 offset and the scroll bug.
- **Markdown shortcuts:** on `p` blocks only (CORRECTION :298), and only when the whole value equals `# `, `## `, `### `, `- `, `* `, `> `, `$$ ` or `---`.
- **Enter:**
  - On an empty bullet or callout it converts the block to `p`.
  - Otherwise it splits: a bullet continues as a bullet, anything else becomes `p`. Shift+Enter inserts a newline.
  - In formula edit it exits and focuses the next text block, or inserts one.
  - In the title, Enter or ArrowDown goes to the first block (crit :10–15).
- **Backspace at 0:**
  - A heading, bullet or callout converts to `p`.
  - An empty `p` is deleted and focus moves to the previous block's end or the title.
  - A non-empty `p` merges into the previous text block.
  - When the previous block is a formula, open it in edit mode first (risk).
- **Drag reorder:** native DnD from the gutter handle. The drop index uses the row midpoint and shows a 2px accent line. Iframes get `pointer-events:none` during drag and resize (crit :307). Sections can also be dropped after the last one.
- **KaTeX:** `katex.renderToString(tex||'\\;',{displayMode:true,throwOnError:false,trust:false})` behind a memo. The fallback HTML-escapes everything, which fixes the XSS path. Apply `.katex{font-size:1.3em}`.
- **Charts:**
  - Upload with `POST /api/textbook/charts` (multipart; size cap `MAX_CHART_BYTES` in `core/config`; 413 on overflow).
  - Render as `<iframe src="/api/textbook/charts/{id}/content" sandbox="allow-scripts" referrerpolicy="no-referrer">`, never `allow-same-origin`.
  - Use `src` rather than `srcdoc`: a srcdoc frame inherits the app's CSP, while `src` lets the server attach `Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; sandbox allow-scripts` plus `nosniff`.
  - Rewrite the fixture price-yield chart to use system fonts.
  - Replay bumps the key. Replace keeps the caption.
- **Resize and fullscreen:** presets S/M/L are 280/380/560. Drag-resize uses pointer capture, clamps to 200–900, and has no transition while dragging. Fullscreen covers the main column with a Close button and the caption; Escape exits fullscreen first.
- **Save status:**
  - Autosave is debounced 350ms: `PUT /pages/:id/blocks {blocks,baseVersion}`.
  - Status reads "Saving…", then "Saved" for 5s (on a timer), then "Saved locally". Errors show "Not saved · retrying".
  - A 409 shows the toast "This page changed in another tab. Showing the latest."
  - Drop the localStorage quota toasts.

### (5) First-run setup and empty states
- **Setup route:** `/setup` (`screens/setup/`). It is gated by `setupComplete=false` from `/api/shell` and redirects every route there. It uses the Home frame: 88px header with the wordmark, no nav rail.
  - Hero: an Eyebrow "First run", then the serif 52px H1 "Set up your plan".
  - A single column, max 720px, with three `SectionTitleRow` steps and a HandoverStepper-style progress.
  - **1 The move:** `BusinessDayDatePicker`. A live `Roll` shows "{n} business days to Fixed Income", from `GET /api/calendar/countdown?move=`.
  - **2 Your working day:** an hours `InlineField` (default 8, 1–24); a holiday region `SegmentedControl` (England & Wales / Scotland / Northern Ireland, from `holidays` subdivisions); timezone shown as text (Europe/London).
  - **3 Tell Remi:** `SegmentedControl` None|Anthropic|Ollama, default None. The note (muted 13px) reads "Simple reading works offline. Keys stay in the server's config." The server's status is shown with a DomainDot.
  - Primary button "Start with an empty plan", which sends `PATCH /api/settings {…,setupComplete:true}` and goes to Home.
  - ⌘K gets a new "Edit setup" item.
  - The three default Textbook sections are created as structure only (no pages).
- **Gaps that start-empty creates (flag for a decision):**
  - Routine checklist items, onboarding readiness items and rotation segments have no UI.
  - Proposal: reuse the Charter `CharterList` pattern for "Checklist" (Routines row) and "Onboarding readiness" (Transition, add/toggle).
  - Add an optional setup step 4 "Fixed Income rotation" (ordered RotationTiles plus BD length).
  - Derive readiness % from task hours.
- **Empty-state copy** (D = from the design, N = new):
  - **Header verdict (N):** short "Not yet"; sentence "Add your Private Credit projects and routines, and Remi works out whether you can move cleanly."
  - **Home:**
    - Keyproject row (N): "No projects yet" · Roll "Not yet" · chip "no plan".
    - "0 projects · 0 routines · 0 notes today" and "0 pages · 0 live charts", correctly pluralised.
  - **Today:**
    - D: "No BAU on this day." (the "next run" clause is dropped when there are no routines).
    - D: "No tasks planned in Now yet. Add them in the workspace."
    - D: "Nothing due this month."
    - N: "No focus blocks. Give a project hours a day and it appears here."
  - **Notes (all D):** "A blank page. Jot anything: a number that looked off, who you are waiting on, what you finished." / "Nothing was jotted on this day." / "No projects or routines named yet. Mention one and it is linked here." / CTA "Nothing to send yet". The rail reads "No notes yet" (N).
  - **Timeline:**
    - N (lanes): "No Private Credit projects yet." / "No Fixed Income projects yet." / "No routines yet." / "No rotation set up."
    - D (panel): "No milestones yet. They arrive once the charter is finished and the plan is drafted."
  - **Calendar (D):** "Nothing planned. A free day." / "Weekend. Nothing is planned." / "{hol}. Nothing is planned, and business-day numbers skip it."
  - **Projects:**
    - N (per group): "No Private Credit projects yet. Start one with + New project."
    - D: "No goal yet. Open the workspace to write what will be true when it is done."
  - **Workspace (D):**
    - "No plan yet. Enter the work left and hours a day, and Remi works out when it lands."
    - "Nothing scheduled for the next two weeks yet."
    - Charter empties (crit :195–200).
  - **Routines:**
    - N (none ever): "No routines yet. Add the BAU that repeats, and Remi reserves its time first."
    - D (all handed over): "No Private Credit routines. Everything recurring has been handed over or stopped."
    - N: "No rotation yet. Set it up to see where each country falls after the move."
  - **Transition:**
    - D: "No Private Credit projects left to wind down."
    - N: "No routines to hand over." / "No onboarding items yet." / "Nothing planned after day one yet."
  - **Drawer (D):** "Remi didn’t find anything to change. Try naming a project, a task, hours or a date."
  - **Palette (D):** "Nothing matches that. Try a project name, a screen, or “+4h manco”." Swap "manco" for a real project's short name, or drop the example when there are no projects (N).
  - **Textbook (D):** "No pages yet." / "No live charts yet. Drop an HTML chart from Claude onto any page." / "Open a page to see its numbered outline." Deleting the last page returns to Home and no longer reseeds a help page.

### Critical Files for Implementation
- /Users/justinstoddart/Desktop/Ninety One/remi/Remi Dashboard Design Review/Remi.dc.html
- /Users/justinstoddart/Desktop/Ninety One/remi/Remi Dashboard Design Review/CheckIn.dc.html
- /Users/justinstoddart/Desktop/Ninety One/remi/Remi Dashboard Design Review/Remi Textbook.dc.html
- /Users/justinstoddart/Desktop/Ninety One/remi/Remi Dashboard Design Review/Workspace.dc.html
- /Users/justinstoddart/Desktop/Ninety One/remi/Remi Dashboard Design Review/Remi Foundations.dc.html