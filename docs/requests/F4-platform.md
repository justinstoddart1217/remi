# F4-platform: platform, component and API-layer clean-up (Phase 4)

F4 owns `frontend/src/{app,shell,stores,lib,api,test}/**` (not `api/schema.d.ts`),
`frontend/src/components/**`, `frontend/src/screens/foundations/**`, `frontend/vite.config.ts`
and `frontend/src/main.tsx`. Everything below is done and tested. The **"Screens: swap"** items
are for the screen owners: each one removes a local copy that a component now covers.

## 1. Components: new APIs, and what each screen can drop

**Status (P5 review, 2026-09-25): resolved.** The screen owners made every swap below
(`F4-screens.md`, "Resolved"): the local Roll copies, `StaleTag`, the Timeline anchor stand-ins
and the Calendar opacity constant are gone. The subsections still describe the component APIs.

### Roll (`components/Roll`): no screen-reader span
`Roll` no longer writes its value a second time. The root is `role="img"` with
`aria-label={label ?? value}`, the sizer is `visibility: hidden` (so `innerText` skips it), and
the strip is `aria-hidden`. The DOM order (sizer, then strip) is unchanged, so the parity
harness reads it as before. This is the same DOM as `TodayRoll`, `LocalRoll` and `HomeRoll`.

```tsx
<Roll value="Wed 2 Dec" />                               // name: "Wed 2 Dec"
<Roll value="+3 BD" label="3 business days later" />     // a fuller accessible name
<Roll value="Wed 2 Dec" decorative />                    // aria-hidden; the row already names it
<Roll value="Wed 2 Dec" className={s.x} style={…} title="…" data-parity="…" />
```

Screens: swap (a one-line import change each; the pixels are identical):
- **UI-today**: import `Roll` in `PlanList.tsx` and `MonthSnapshot.tsx`, delete `TodayRoll.tsx`
  and the `.roll*` rules in `Today.module.css`.
- **UI-projects-workspace**: use `Roll` in `projects/index.tsx`, `workspace/Stats.tsx` and
  `workspace/History.tsx`, delete `LocalRoll.tsx` and `LocalRoll.module.css`.
- **UI-home-textbook**: use `Roll` in `ControlPanelPreview.tsx`, delete `HomeRoll.tsx`, the
  `.roll*` rules and the unused `.srOnly` rule in `Home.module.css`.

### StaleBadge: three items
The words are three flex items, `<span>Stale ·</span> <span>{days}</span> <span>days</span>`,
as the prototype's interpolation lays them out (the 6px gap sits on both sides of the number).
The spaces between the spans are not laid out; they keep the text "Stale · 9 days" for
assistive tech. `joined` keeps one text run (the Foundations specimen).
- **UI-projects-workspace**: replace the local `StaleTag` in `projects/index.tsx` with
  `<StaleBadge days={row.sinceDays} />`, and delete `.stale` and `.staleDot` from
  `Projects.module.css`. The styles are identical.

### TimelineBar and RotationSegment: HTML attributes pass through
Both components take any other HTML attribute (`data-*`, `aria-*`, handlers). `TimelineBar`
puts them on the bar itself, not the risk overrun. `RotationSegment` puts them on the stop.
- **UI-timeline**: put `data-parity={\`timeline-bar:${p.id}\`}` on the main `TimelineBar` and
  drop the `.barAnchor` element and rule. Put `data-parity="timeline-rotation-segment"` on
  `RotationSegment`, and move the wrapper's positioning onto it:
  `className={s.segment}` (position absolute, top 11px, the left glide) and `style={{ left: x0 + 1, transition: … }}`.
  Merge the width transition into the same `transition` value. Then drop the wrapping span.

### BauChip and CapacityBar: `dimmed`
The linked highlight is now a flag, styled with `[data-dim]` → `opacity: var(--linked-dim)`
over `--dur-fast`:
- `BauChip dimmed` (an explicit `opacity` still wins);
- `CapacityBar itemDimmed={(item) => boolean}` for segments, and `dimmed` for the whole bar.
- **UI-calendar**: `MonthGrid.tsx` can pass `dimmed={dim}` to `BauChip`, and `DayPanel.tsx` can pass
  `itemDimmed={(item) => isDimmed(hovered, itemHoverKey(item))}`. Then drop `LINKED_DIM` from `model.ts`.
  Today (0.3 / 0.25) and Transition and Routines (0.35) keep their prototype values through
  `opacity` / `itemOpacity`.

### InlineList: the Transition onboarding block
New props, all optional. The defaults keep the Charter lists exactly as they were.

| Prop | Values | Use |
|---|---|---|
| `row` | `'field'` (default), `'line'` | `line`: 42px rows with a hairline, text shown as a button until it is clicked, a 12px mono note always laid out, 15px text |
| `addVisibility` | `'always'` (default), `'hover'` | `hover`: '+ Add' hangs 12px after the label and shows on hover or focus, or while the list is empty (opacity 0 otherwise, so it is out of Tier A) |
| `labelTone` | Eyebrow tones (`'fi'`) | eyebrow colour |
| `labelAs` | `'span'`, `'h2'`, `'h3'` | eyebrow element |
| `headAside` | node, or `(shown) => node` | right side of the head, e.g. the count. The function form gets the rows as displayed (pending ticks, edits and removals applied), so a count updates the moment a box is ticked |
| `headClassName`, `emptyClassName` | class | extra styling |
| `InlineListItem.meta` | string, or `(done) => string` | the row's trailing note. The function form is called with the row's displayed tick (pending-aware), so a note such as `(done) => dueLabel(done, x.dueDate)` flips to 'done' the moment a box is ticked, and back to the due date the moment it is unticked |
| `footer` | node | inside the list after the rows (the forecast note) |
| `onAdd` | now optional | without it there is no '+ Add' (no FI project to hold items) |
| `onToggle` | may return a promise | the box shows the new state until it settles |

With `row="line"`, `onChange` and `onRemove` promises show the new text, or hide the removed
row, until they settle. An async add shows a muted ghost row until the item arrives. This
matches `ReadinessList`: its DOM and CSS were copied rule for rule.

- **UI-routines-transition**: `ReadinessList` can become
  ```tsx
  <InlineList row="line" addVisibility="hover" label={COPY.onboarding} labelTone="fi" labelAs="h3"
    headAside={(shown) => shown.length > 0 ? <span className={s.blockCount}>{readyCount(shown)}</span> : null}
    placeholder={COPY.onboardingPlaceholder} emptyText={COPY.noOnboarding}
    items={items.map((x) => ({ id: x.id, text: x.text, done: x.done, meta: (done) => dueLabel(done, x.dueDate) }))}
    onAdd={canAdd ? onAdd : undefined} onChange={onRename} onRemove={onRemove} onToggle={onToggle}
    footer={note ? <div className={s.onbNote}>{note}</div> : null} className={s.onb} />
  ```
  Use the function form of `headAside`, as above: it is called with InlineList's pending-aware
  rows, exactly like ReadinessList's `readyCount(shown)` today. A static node built from `items`
  would lag behind a tick until its save settles and would still count a row being removed.
  Use the function form of `meta` for the same reason: ReadinessList renders
  `dueLabel(x.done, x.dueDate)` from its pending-aware row today, and a string built from the
  saved `items` would keep the due date next to a ticked box (or 'done' next to an unticked
  one) until the save settles.
  `InlineListItem.done` is optional, so widen `readyCount`'s parameter to
  `readonly { done?: boolean }[]` (the body is unchanged).
  Then delete `ReadinessList.tsx` and the `.headLabel`, `.headAdd`, `.item*` and `.empty` rules
  it alone uses. The Library page (`/foundations/library`) shows this form live.

## 2. API layer
- **`useUpdateUiPrefs()`** (`api/mutations/settings.ts`) sends `PATCH /settings {uiPrefs}` with no
  invalidation. It updates the cached settings optimistically and stores the answer's settings,
  unless a later preferences save is still in flight. A failure refetches the settings.
  `mergeUiPrefs` mirrors the server's merge, where `null` resets a key.
  - **UI-home-textbook**: `screens/textbook/uiPrefs.ts` can call it and drop its own PATCH and cache mirroring.
- **`useDeleteProject`** removes the project's snapshots, detail and replan-preview queries before
  it invalidates, so a mounted Workspace no longer refetches them (no more 404). `useDeleteRoutine`
  does the same for the routine's detail and occurrences.

## 3. App platform
- **Appearance at the root.** `app/useAppearance.ts` hydrates the accent pair, serif and motion from
  `GET /settings` on first load and after every save or refetch. Every screen follows the saved
  choice without opening Settings. `app/appearance.ts` holds `appearanceFromSettings` and
  the accent pairs, `ACCENT_PAIRS` since the Ninety One redesign (it does not import the Settings screen).
  - **UI-setup-settings**: `screens/settings/model.ts` can re-export them from `app/appearance`.
- **`paths.settings(section?)`** gives `/settings`, or `/settings#move|day|rotation|ai|appearance`.
  - **UI-routines-transition**: "Set up the rotation" can use `paths.settings('rotation')`.
- **Code splitting.** The Textbook (with KaTeX in its own chunk), Setup, Settings and the dev-only
  Foundations pages are lazy routes. Home, the shell and the eight app screens stay in the entry
  chunk. React with the router, and the data layer, are separate vendor chunks that the entry
  preloads. The largest chunk is 286 kB (it was 647 kB). A root `HydrateFallback` renders
  nothing while a lazy first page loads, as SetupGate does.
- **SetupGate** shows "Remi couldn’t reach its server on this computer." with Try again when
  the setup status cannot be read (F-api-layer §6). A missing route (404/501) still lets the app through.
- **HeaderBar**: the `·` shows only beside a BD number (no stray separator on a weekend or holiday).
  The verdict is drawn only when the plan is ready. The header has `aria-busy` while loading.
- **`useTimers` is StrictMode-safe.** Effect cleanup suspends the timers and setup re-arms them for the
  remaining time. A real unmount never fires them. This fixes the dev-only Routines deep-link
  flash that stayed on (phase-3 notes, UI-routines-transition), with no change to the screen.

## 4. Foundations
`/foundations` is now the prototype's page, section for section: 1920×4944, Tier A pass, Tier B
0.003% (it was 7009px and 29%). Three changes:
- the component library moved to its own dev route, `/foundations/library` (also `/dev/foundations/library`);
- the intro reads "Open Remi.dc.html for the working screens" (the link goes to `/app/today`);
- the page scopes the prototype's own oklch accents, because that page had no accents tweak.

## 5. Tests
- `ScreenStack.test.tsx` now uses the msw mock API and replaces the screens with probes. It asserts the
  keep-mounted cross-fade (8 sections, one mount each, `inert`/`data-state`, latched workspace params)
  and the gate (a first run goes to the lazy `/setup`, 501 lets the app through, an error shows Retry).
- `CommandPalette.test.tsx` waits for the header, no longer for Today's heading.
  - **UI-today**: the visually hidden `<h1>Today</h1>` placeholder is no longer needed by the shell tests.
- **B4-backend Requests #1 (done)**: `test/msw/fixtures.ts` `fixtureRoutine()` sets `label: null` to
  match the regenerated `RoutineOut.label: string | null`, so `tsc -b` and `npm run build` pass again.
