# Requests from UI-calendar (Calendar screen)

UI-calendar owns `frontend/src/screens/calendar/**`. The screen is built. Against the three
prototype baselines (`calendar`, `calendar-day-2026-10-05`, `calendar-day-2026-11-04`) it gives
0 differing pixels (pixelmatch threshold 0.1) and an exact Tier A text match. No ADR-0007
divergence touches these states.

## 1. Parity driver (owner: `parity/drivers/remi.ts`): no change needed
- `setScreen('calendar')` → `/app/calendar` and `openCalendarDay(iso)` →
  `/app/calendar/<YYYY-MM>?day=<iso>` work as written.
- A scratch run of `@p4 Calendar: Esc closes the day panel` (behaviour.spec.ts) passes. The
  panel's content leaves about 440ms after Escape, and `?day=` leaves the URL.
- The screen writes its month and day back to the URL with `replace`, keeping other
  parameters such as `frame`. The capture's `url` field therefore reads, for example,
  `/app/calendar/2026-10?frame=1920x1080`.

## 2. Optional (owner: C2, `components/`)

**Status: the first item is resolved** (`BauChip dimmed` and `CapacityBar itemDimmed`,
`F4-platform.md` §1; the Calendar's copy of `--linked-dim` is gone, `F4-screens.md`). The
second needed no change.
- `BauChip` and `CapacityBar` take a numeric opacity for the linked highlight. The screen
  therefore repeats `--linked-dim` as `LINKED_DIM = 0.28` in `model.ts`. A `dimmed` boolean
  styled by `[data-dim]` would remove the copy.
- The prototype's 30px panel buttons keep Chrome's default button padding (`1px 6px`). Their
  18px and 20px glyphs overflow the content box and are aligned to its start, so each glyph
  sits 1px right of centre. `IconButton` pads 0, so the panel passes `style={{padding:'1px 6px'}}`
  for pixel parity. No change is needed unless other screens hit the same thing.

## 3. Notes for P4 / P5 (no action unless you disagree)
- **Month range.** The first month is today's month, where prev dims to 0.35 as in the
  prototype. The range is open-ended forward. If `GET /loads` answers 422 `OUT_OF_RANGE` for a
  month, the month before it becomes the last one and next dims.
- **Navigation** (arch-frontend-screens, Calendar "Tricky"):
  - The header uses functional updates, so two quick clicks move two months.
  - The swap is debounced to 130ms after the last click.
  - A month change clears the selection.
  - Panel prev/next and deep links switch the month at once.
  - "This month" goes to today's month.
- **Data.** The plan supplies calendar days and loads.
  - Months past `plan.calendar` use `useCalendarIndex(range)` → `GET /calendar`, with a week
    either side so the panel can step over a long weekend into the next month.
  - They also use `GET /loads` for the month.
  - The month being faded to is fetched during the fade.
- **Panel tasks.** These come from `GET /day/{iso}` (`focusBlocks[].tasks`) for business days
  from today on. Past days show no tasks, as in the prototype. The neighbouring business days
  are prefetched.
- **Escape.** The panel registers the `calendar-panel` layer only while the Calendar is the
  active screen. Escape on another screen therefore never closes the hidden panel. The panel
  (and `?day=`) stays open when you go to Today and come back, as the prototype's `sel` did.
- **Generalised copy.**
  - "Public holiday" replaces "Bank holiday" outside GB-ENG, as the Timeline footnote does.
  - "1 business day" is singular.
  - The capacity label and bar widths use `load.capacity`, not 8.
- **Free business day.** The capacity bar shows 0h, followed by "Nothing planned. A free day."
  The empty rows list and its 1px ink rule are not drawn.
- **Layout.** The frame is content-height with an 880px floor, like the prototype. The panel
  spans the whole frame and, with no scrim, covers the month navigation and the right of the
  Friday column (as in the prototype). Close it to change month.
- **Keyboard.** One day holds the tab stop: the selected day, else today, else the 1st. The
  arrow keys move by day and by week, Home and End go to the ends of the week, and Enter or
  Space opens or closes the day.
