# F4-screens: screen fixes (Phase 4)

F4-screens owns `frontend/src/screens/**` except `screens/foundations`. Every screen item in
`phase3-verifier-notes.md`, `UI-*.md` and `F4-platform.md` is either resolved below or listed
under "Left as is" with the reason.

## Parity (design seed, api 8832 / web 5332, 1920×1080, reduced motion, en-GB, Europe/London, clock 2026-10-05T09:30+01:00)
The run used the harness's own drivers, `captureRegions`, `scoreTierA` and `scoreTierB`, with the output written to the scratchpad. Every state I ran passes Tier A. That covers all 38 prototype states except `notes`, the four AI drawer states and `foundations`, none of which I touched. No requests left loopback, and there were no page or console errors.
- `workspace-ret`, `-manco`, `-play`, `-fion` and `-ret-datepicker` now pass Tier A. They were the five "Plan as of" failures. Tier B: ret 0.064%, datepicker 0.055%, play 0.013%, fion 0.013%, manco 0.001%.
- `textbook-home` now marks "Rates primer" in the sidebar, as the prototype does.
- The Tier B figures for the other states are unchanged: home 0.27% and 0.32%, timeline, calendar and projects 0.000%, today 0.002%, transition 0.065%.

## Resolved
- **Workspace "Plan as of"** (`workspace/scrubber.ts`): the live stop now keeps the last check-in's date, as `Workspace.dc.html:437` does. With no check-ins it is dated today ("One check-in so far"). No divergence row is needed.
- **Workspace**: the ghost bar keeps its width while it fades out. The save toast now writes the server's reason as a sentence (`asSentence`).
- **Roll**: `TodayRoll`, `LocalRoll` and `HomeRoll`, and their CSS, are deleted, and every screen now uses `components/Roll`. `StaleTag` is replaced by `StaleBadge`.
- **Timeline**:
  - `data-parity` now sits on `TimelineBar` and `RotationSegment`; the `.barAnchor` element and the wrapper span are gone.
  - Row labels come from `RoutineOut.label ?? name`, so `ROUTINE_ROW_LABELS` is gone.
  - On an empty plan the slivers stop above the footnote, and the footnote drops the "Hover a row…" clause. The design states keep the prototype's overlap, because the baseline has it.
- **Home Textbook card** (`home/textbookExcerpt.ts`):
  - With no pages it shows a designed empty page with "No pages yet.".
  - With pages it shows a real excerpt of the first page: numbered headings, text, the formula as Unicode with `<sub>`/`<sup>`, and the next heading typed on hover.
  - Formulas never show a TeX command's name. Font commands (`\mathbb`, `\mathcal`, `\mathfrak`, `\mathsf`, `\boldsymbol`, `\bm`, and others) print only their argument. Accents (`\bar`, `\hat`, `\tilde`, `\vec`, `\dot`, `\ddot`, `\overline`, `\underline`, `\widehat`, `\widetilde`) add a combining mark to a one-character argument. `\sqrt[n]` is drawn as a root sign (∛, ∜, or the index raised), and any other unknown command is dropped. Checked live: `s_{t+1} = s_t + \beta (\bar{s} - s_t) + \sigma^2` reads as "s₍t+1₎ = s_t + β(s̄ − s_t) + σ²" on the card.
  - The design's sample page ("Rates primer", id `fi-rates`) keeps the prototype's hand-set excerpt only while everything the card would show is exactly as seeded: the title, the section, the first `MAX_LINES` lines and the next heading. After an edit to any of those, including the paragraph or formula under "Price and yield", the card shows the real blocks. Edits the card never shows (the chart, the callout, anything after "Convexity") keep the sample. The home states still pass.
- **Calendar**:
  - A link past the server's range lands in one step. `/app/calendar/2099-01` makes 2 `/loads` requests where it used to make 746.
  - When a link's day and month disagree, the day wins; a day outside the range is dropped.
  - `min-height` is now `max(880px, 100%)`.
  - The ink rule above the plan rows is drawn on a free day, as `Calendar.dc.html:95` does.
  - `LINKED_DIM` is replaced by the `dimmed` and `itemDimmed` props.
- **Transition**: `ReadinessList` is replaced by `InlineList row="line"`. Tick, add and clear-to-remove were checked live.
- "Set up the rotation" on Routines and Transition goes to `paths.settings('rotation')`.
- **Settings**: `ACCENT_PAIRS` and `appearanceFromSettings` are now built on `app/appearance`.
- **Textbook**:
  - `uiPrefs.ts` is deleted; the screen uses `useUpdateUiPrefs`.
  - Opening a page saves `lastTextbookPageId`, and Textbook home marks that page in the sidebar, with `aria-current` only on a real page.
- **Today**: a Saturday now shows the next week in the strip. Past days read "Looking back; the plan as it stands now".

## Checks on an empty install (setup done through the API, no fixture)
Home, Today, Notes, Timeline, Calendar with its day panel, Projects, Routines, Transition, Textbook and Settings all render designed empty states. None scrolls sideways, and there are no console errors. On a new project the workspace reads "Plan as of Mon 5 Oct · One check-in so far".

## Left as is
- **Transition flag at the strip's end** (E2-engine §5): a PC forecast at or after the move keeps its label hanging to the left. The prototype's label would run off the strip. Recorded as a deliberate fix in `transition/model.ts`.
- **Routines `projectLink` sentence case**: it matches the prototype and the baseline.
- **Today's hidden `<h1>Today</h1>`** stays while nothing else is shown: it gives the loading and error states a heading.
- **The dev-only Routines flash** is fixed by F4-platform's `useTimers` change. Checked under Vite: the flash is on at 0.4 s and off by 3 s.

## Requests
- **P-harness / parity report**: nothing to add for the workspace states. Please note the new copy: the Home empty Textbook preview, the empty Timeline footnote, and the past-day plan note.
