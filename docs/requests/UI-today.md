# Requests from UI-today (the Today screen)

UI-today owns `frontend/src/screens/today/**`. The screen reads `GET /plan` (loads, calendar,
projects' derived milestones, routines, verdict, capacity), `GET /day/{iso}` and
`GET /month-snapshot`. It writes through `usePutRunTick`, `usePutRunTicks`,
`usePutRoutineRun`, `useUpdateTask` and `useUpdateMilestone`. Parity: the four Today states
(`today`, `today-preview-2026-10-12`, `-2026-11-04`, `-2027-01-04`) match the prototype
text exactly, with a pixel difference of 0.002%.

## 1. C2 (owner of `components/Roll`): the screen-reader span breaks Tier A text
`Roll` writes its value a second time in an `srOnly` span. `innerText` includes clipped
elements, so every region with a Roll reads one extra token. For example, Today's text is
`… 8 9 5 of 12 funds` where the prototype has `… 8 9 of 12 funds`, and Projects, Home and
the header have the same problem.
- Request: drop the `srOnly` span and name the root instead, with
  `<span role="img" aria-label={text}>`. The strip is already `aria-hidden`.
- Until then, Today uses a local copy, `screens/today/TodayRoll.tsx`. It has the same DOM,
  reels and spring, with the value as the root's accessible name. Once Roll is fixed I will
  switch back to it, or the owner of Roll can make the swap: import `Roll` in `PlanList.tsx`
  and `MonthSnapshot.tsx`, then delete `TodayRoll.tsx` and the `.roll*` rules in
  `Today.module.css`.

## 2. C1 (owner of `shell/**` tests): Today's heading
`ScreenStack.test.tsx` and `CommandPalette.test.tsx` wait for
`heading level 1 "Today"`, the old placeholder. The real screen's h1 is the long date
("Monday 5 October") once the plan and the day are loaded. To keep those tests and
palette heading-focus working, Today renders a visually hidden `<h1 tabIndex=-1>Today</h1>`
while it has nothing to show: loading, an unreadable plan (their `stubSetupApi()` body) or an
unreadable day. The suite is green (294 tests). A test that needs the real screen should use
`setupMockApi()` with `/day` and `/month-snapshot` handlers, as `screens/today/Today.test.tsx`
does.

## 3. Backend (routines, tasks, milestones owners): tick endpoints
All five routes still answered 501 on my port during this run. The UI is wired and optimistic:
- a tick shows at once;
- it stays until the day and month reads are fetched again;
- a failure reverts it and shows the toast "Couldn’t save that. Try again.", or "Ticking opens
  on the day of the run." for 409 `RUN_NOT_EDITABLE`.

The calls are:
- a fund tick on today's run: `PUT /routines/{id}/runs/{iso}/items/{itemId} {done}`;
- the month row of today's checklist run: `PUT …/runs/{iso}/items {done}` (set all);
- any other BAU month row: `PUT /routines/{id}/runs/{iso} {completed}`;
- tasks, in a focus block or a month row: `PATCH /tasks/{id} {done}`;
- milestone month rows: `PATCH /milestones/{id} {done}`.

P4 should run these end to end.

## 4. Parity report / critique owner: new copy and deliberate choices on Today
None of these appear in the four captured states.
- **Past days:** the kicker is "Yesterday · looking back" or "<Weekday> · N business days ago",
  replacing the prototype's "-N business days ahead". A past checklist run shows the note
  "Past run · the ticks are kept as they were".
- **Weekend or holiday today (non-business day):**
  - the meta line shows "Weekend" or the holiday name in place of "BD3 of 22";
  - there is no capacity bar;
  - the plan shows Calendar's copy, "Weekend. Nothing is planned." or "{hol}. Nothing is
    planned, and business-day numbers skip it.", plus " The next run is Mon 12 Oct." when
    there is one.
- **Start-empty:**
  - "No BAU on this day." has no next-run clause when there are no routines;
  - "No focus blocks. Give a project hours a day and it appears here." comes from the
    catalogue (N);
  - the month header reads "Nothing due yet", with no zero-height chart, when nothing is due.
- **Errors:** "Remi couldn’t read your plan." / "Remi couldn’t read this day." with
  "Try again".
- **Generalised hard-coding:**
  - The checklist card applies to any routine with checklist items, not only `r-ret`.
  - Its rule is "BD3, monthly" / "Fri, weekly" / "Every business day".
  - "of N funds" takes N from the checklist and the unit from the routine's `detail`
    ("12 funds" gives "funds"; otherwise "items").
  - The gutter shows the routine's hours, and "8h working day" uses the capacity setting.
- **Kept from the prototype:**
  - The legend swatches stay Private Credit colours after the move.
  - Week-item bars are h/4 wide, uncapped.
  - Hover dims rows to 0.3 and bar segments to 0.25, the prototype's values, not
    `--linked-dim` 0.28.
- **Critique CORRECTION :334:** a holiday in the week keeps its column empty, in place (for
  example Fri 25 Dec).
- **Accessibility:** week day cards are `role="button"` and reachable with Tab, Enter and
  Space, with `aria-pressed`. Month checkboxes are named after their row.
- **ADR-0009 note for P5:** "N business days ahead" is the server's `aheadBd` (`bd_diff`, an
  offset), so the move day reads 62, as in the prototype, and not the 61 of a count.
