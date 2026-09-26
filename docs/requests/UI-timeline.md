# Requests from UI-timeline (Timeline screen)

UI-timeline owns `frontend/src/screens/timeline/**`. The screen is built and matches the four
prototype baselines on both tiers (Tier A text, boxes and anchors; 0 differing pixels at
pixelmatch threshold 0.1; see `docs/parity-report.md`).

**Status (P5 review, 2026-09-25):** items 1 and 2 are resolved, and so is the component request
at the end of item 3. Each keeps a one-paragraph record of what was asked and where it was done;
item 3's anchor table and the notes in item 4 still describe the current screen. The fixes are
also listed in `F4-screens.md` ("Resolved": Timeline).

## 1. Resolved: Roll's sr-only copy in Tier A text (owner: C2 `components/Roll`, or the parity spec)
The request: `Roll` rendered its value a second time as a clipped `<span class=srOnly>`, which
`innerText` counts, so every region holding a Roll read one extra word group (for example
`… Dec Wed 2 Dec +3 BD …` on the Timeline, where the prototype has `… Dec +3 BD …`).
Done both ways it proposed:
- `components/Roll/Roll.tsx` exposes the value as the root's accessible name (`role="img"`
  plus `aria-label`), with no second text node; `Roll.test.tsx` checks there is no sr-only
  element.
- The harness's capture (`parity/drivers/common.ts` `captureRegions`) leaves screen-reader-only
  text (absolute, 1px, clipped) out of the Tier A lines, and reads each Roll as its value.

## 2. Resolved: a display label for routines (owner: backend schemas `RoutineOut`, plus Settings/Routines UI)
The request: the design shortens one routine's Timeline row label, `Fund & security-level
returns` → `Fund & security returns` (Timeline.dc.html:309, critique :309), and `RoutineOut`
had no field for it, so the screen kept a stopgap table in `screens/timeline/model.ts`.
Done: `RoutineOut.label` and `RoutinePatch.label` exist (`backend/app/schemas/routine.py`,
migration `0002_routine_label_blocks_saved_at.py`; `null` means use the name), the design
fixture seeds `Fund & security returns` for `r-ret`, and `routineRowLabel` in
`screens/timeline/model.ts` shows `label ?? name`. The stopgap table is gone.

## 3. Parity anchors for the Timeline states (as `parity/drivers/remi.ts` drives them)
The screen carries the four `data-parity` anchors from the driver contract (parity/README.md,
P-harness.md §1), all inside `[data-screen-label="Timeline"]`:

| Anchor | Element | Used by |
| --- | --- | --- |
| `data-parity="timeline-row:<projectId>"` | the project row (`role="button"`; a click opens the side panel) | `openTimelinePanel` → `timeline-panel-ret` |
| `data-parity="timeline-bar:<projectId>"` | the forecast bar's box: left = start, top 26, width = bar width, height 10, in the row's lane | `hoverTimelineProject` → `timeline-tip-ret` |
| `data-parity="timeline-rotation"` | the rotation row's track (the prototype driver's `row.children[1]`) | `hoverTimelineRotation` |
| `data-parity="timeline-rotation-segment"` | each rotation stop's positioned box (the stop exactly fills it) | `hoverTimelineRotation` → `timeline-tip-rotation` |

With the design seed the anchors give the prototype's hover points: the ret bar's centre is
(820, 514) and the first rotation stop's point is (1729, 739). Through the shipped driver, the
four states give 0 differing pixels (threshold 0.1).

Deep links still work: `/app/timeline?panel=<pid>` opens the panel (the screen consumes the
parameter), and `?zoom=2w&week=<n>` opens the two-week view.

**Resolved: the request to C2 (`components/TimelineBar`, `components/RotationSegment`).** It
asked both components to pass `data-*` attributes through to their root, so the screen could
drop its stand-ins (a transparent anchor element beside the bar, and a positioned wrapper span
around each rotation stop). Both components now spread the rest of their HTML attributes onto
the root (`components/passThrough.test.tsx`), and `screens/timeline/Lanes.tsx` puts
`data-parity` directly on the `TimelineBar` and on each `RotationSegment`. The stand-ins are gone.

## 4. Notes for P4 / P5 (no action needed unless you disagree)
- **The frame is content-height.** In the prototype, `height:100%` resolves against a host that
  sizes to its content. So the chart ends just after the lanes, the footnote follows them, and
  the 460px side panel ends below the footnote (`timeline-panel-ret`). Remi reproduces this with
  `max-height:100%`. The chart and the lanes shrink, and the lanes scroll, only when the screen
  is shorter than the content.
- **The window is derived.** It starts on the Monday of the week before today's week. It ends on
  the later of two dates: the Friday of the week after the move's week, or the Friday 16 weeks
  after the start. Both give Mon 28 Sep to Fri 15 Jan in the design. The two-week pan bounds come
  from the same window ([-1, 13] in the design). The screen asks `useCalendarIndex` for the
  window, so it also works after the plan's calendar ends.
- **Generalised copy.** The 2w subtitle counts real business days: the 21 Dec week shows
  "7 business days", where the prototype hard-coded 10. The following are generated from data
  instead of hard-coded:
  - "FI move · {move}";
  - "Starts {rotation start} with {first country}, first {pass} pass →", shown only while the
    rotation is `waiting` or `none`;
  - "{h}h/day";
  - the rotation tip's order and "First loop complete {loopEnd}.";
  - "Hours per day against {capacity}." (the dashed capacity line moves with it);
  - "UK bank holidays" for GB regions and "public holidays" otherwise.
- **Milestone tip.** As the prototype (Timeline.dc.html:337, critique): on mouse leave the
  milestone tip goes back to the shortened project tip, the delta chip in muted ink and one
  line, "Forecast {forecast} · target {target}" (`projectShortTip`). It shares the project
  tip's key, so it stays until the pointer leaves the row. "N business days away" is
  pluralised, and its offset counts the same way as the Routines row.
- **Keyboard.** Rows are focusable. Keyboard focus sets the linked highlight and shows the tip
  beside the row. Enter or Space opens the project panel, and Escape closes it through the
  overlay stack (`timeline-panel` layer).
