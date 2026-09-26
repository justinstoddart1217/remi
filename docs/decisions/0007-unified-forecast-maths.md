# ADR-0007: Unified forecast maths, so preview == apply

- Status: Accepted
- Date: 2026-09-24
- Plan: binding decision 7 and "Unified forecast maths"

## Context
The design forecasts per project from work left and hours a day, but the prototype computes it
several ways that disagree: `ceil(H/rate)` in `previewShift`, a `bdDiff+1` refit in
`saveCheckIn`, a flat `rate × bdLeft` for hours-a-day check-ins, and hard-coded `bd3`/`bd8`
hooks, `ret`/`r-ret`/`DEC_RUN` and an 8h day. Preview and apply can therefore land on different
dates.

## Decision
One set of pure functions in `services/engine/forecast.py` (no I/O), used by every path.

**`day_hours(p, d)`**, first match wins:
1. Not a business day → 0.
2. An override for that day → the override hours (an explicit 0 counts).
3. On or after the move → `rate_after`.
4. Any routine with a rule on this project counts on `d` → the minimum of those rules'
   `bau_day_hours` (table `project_bau_day_hours(project, routine, hours)`, replacing bd3/bd8).
5. Otherwise → `rate`.

**`finish_for(p, from, H)`** is the first business day where the running total reaches H − ε.
If the hours run out first, the leftover is recorded as `unplaced_h` and counts as landing after
the move. **Invariant:** `finish_for(from, work_left) == forecast`.

**Edits reuse the same functions:**
- Rate, work-left and start edits all go through `refit`.
- A rate change goes through `rescale`, which scales `rate_after`, the BAU-day hours and the
  overrides together (the prototype forgot the overrides).
- Scope slip is `finish_for(work_left + H)`, replacing `ceil(H/rate)`.
- An hours-a-day check-in runs the same refit as a rate edit.
- The need solver is linear in the rate and rounds up to 0.1, so applying it always lands on or
  before the target.

**Preview == apply:** `/checkins/preview` and `/checkins/apply` both call
`plan_project_changes`; a Hypothesis property test asserts preview == apply == `GET /plan`.

**Verdict:** `off_track` → `at_risk` → `on_track_narrowly` → `on_track` (plus `no_pc`: no
Private Credit project, or one still in Define; see round 5). The key project and routine come
from Settings; the key run is the routine's last occurrence before the move. Capacity and the
rotation come from Settings instead of constants.

## Golden values that must hold
Fixture seed, today 2026-10-05:
- Countdown **61** (ADR-0009).
- Business days per month: Oct 22, Nov 21, Dec 21, Jan 20.
- Loads: 5 Oct 8h; **4 Nov 9.5h**, the only overload.
- Rotation: 49 BD in total; loop 1 is 46 BD ending Mon 8 Mar.
- Returns pipeline (`ret`) +3 BD and at risk.
- Verdict "Move on track, narrowly".
- Month snapshot "2 of 17 done · 1 overdue".
- ManCo focus tasks today: 0.5 / 0.75 / 0.75h.

## Deliberate divergences from the prototype
| Figure | Prototype | Remi | Why |
| --- | --- | --- | --- |
| Verdict buffer | 8 | **7** | Business days strictly between the last PC exit and the move (ADR-0009); matches the Transition strip's 7 blocks |
| ret "need" rate | 3.6 | **3.8** | Linear need solver rounded up to 0.1; applying 3.8 lands on the target |
| ret +6h scope | Fri 4 Dec (+2 BD) | **Mon 7 Dec (+3 BD)**, new overloads on 4 and 7 Dec | `finish_for` counts Thu 3 Dec (a BD3 with 0h for ret) instead of `ceil(H/rate)` |
| New project | forecast = target at 0h/day | **Define state, no forecast** | No invented numbers |
| 31 Aug 2026 | Business day | **Summer bank holiday** | Prototype holiday list bug; holidays come from the `holidays` package |
| play and fion "need" rate (Workspace "To land") | 0.9 ("within your 1h a day") | **1.0** | Linear need solver rounded up to 0.1 (the same rule as ret) |
| ret scope +0.5h to +2h (check-in preview) | Thu 3 Dec (+1 BD) | **Fri 4 Dec (+2 BD)**, new overload on 4 Dec | `finish_for` skips Thu 3 Dec (a BD3 with 0h for ret) |
| ret scope +4h / +8h / +16h / +40h | 4 Dec / 7 Dec / 9 Dec / 18 Dec | **7 Dec / 8 Dec / 10 Dec / 21 Dec** (each +1 BD) | As above |
| ret scope +4h, new-overload chips | 4 Dec | **4 and 7 Dec** | One BD later, so ret's 3.5h also lands on Mon 7 Dec, on top of 5.5h (manco 1.5, play 1, fion 1, alpha 2): 9h |
| ret scope +8h, new-overload chips | 4 and 7 Dec | **4, 7 and 8 Dec** | As above, one BD later. The chips for +16h (4, 7, 8, 9 Dec) and +40h (4, 7, 8, 9, 11 Dec) match the prototype |
| manco scope +40h | Fri 22 Jan (+27 BD) | **Mon 4 Jan (+13 BD), 22h unplaced** | Private Credit hours stop at the move (stall rule); the prototype kept planning PC work after it |
| play scope +8h | Mon 4 Jan (+8 BD) | **Mon 4 Jan (+8 BD), 1h unplaced** | Stall rule: only 7 BD with play hours are left before the move (21 to 31 Dec; 25 and 28 Dec and 1 Jan are bank holidays), so the eighth hour is unplaced. Same date, label and off-track verdict; the Workspace sentence becomes `after_move` with a 1h cut |
| play scope +16h / +40h | 14 Jan / 17 Feb | **Mon 4 Jan, 9h / 33h unplaced** | Stall rule |
| play scope +16h / +40h, shift label | +16 BD / +40 BD | **+8 BD / +8 BD** | The forecast stops at the stall day (Mon 4 Jan, 8 BD after Fri 18 Dec); the unplaced hours carry the rest |
| Rate edits of 0.5 to 2h a day on ret, 0.5 and 1h on manco, 0.5h on play | Fri 30 Apr 2027 (the calendar-end clamp) | **Mon 4 Jan plus unplaced hours** (ret 114.6 / 85.3 / 55.9 / 26.6h, manco 43.7 / 12.8h, play 21.75h) | Stall rule; the calendar raises instead of clamping |
| play work-left edit to 66.5h | Fri 30 Apr 2027 | **Mon 4 Jan, 9h unplaced** | Stall rule |
| Simple reading, several note sentences for one project (`september-reconciled`) | Two notes | **One note with both sentences** | `validate()` keeps one note per project, so the simple reading joins them |
| Moving a routine's business day (`routine-r-man-bd10`: ManCo pack BD8 → BD10) | Project BAU-day hours stay on BD8; upcoming overloads **14 Oct 11h, 4 Nov 9.5h, 13 Nov 11h** | BAU-day hours move with the routine to BD10; upcoming overloads **4 Nov 9.5h** only (14 Oct and 13 Nov are 8h) | Deliberate. `project_bau_day_hours` is keyed by routine, not by a fixed business day (the prototype's `bd8` hook), so the projects ease off on whichever day the pack runs. Forecasts and work left are unchanged (144 / 74.5 / 50.5 / 57h), because each moved day stays inside every forecast window |
| Simple reading of a sentence that finishes a task (`drawer-review-offline`: "Finished parsing the security-level extract.") | A `task_done` **and** a note with the same sentence: 7 changes, "Apply 7 changes" | **The `task_done` only**: 6 changes, "Apply 6 changes" | Deliberate quirk fix (arch-backend-engine-api.md, simple reading: "no note is added next to a `task_done`"). The note only repeated the sentence the ticked task already records, and applying both logged it twice. Every other row of that review is unchanged |
| Feed item after an hours-a-day check-in that moves the forecast (ManCo at 2h a day) | "Checked in. {note}. Forecast holds at 25 Nov.", ±0 BD | **"Checked in. {note}. Forecast moved 11 Dec → 25 Nov."**, −12 BD | The prototype re-fitted before it compared, so it always reported the new date as held. Remi's feed reports the movement the apply made (the same one the review previewed). "Forecast holds at X." is kept when the forecast does not move. Data only: the design never renders the feed |
| Feed item after new scope on ret (+6h) | "Scope added (fx attribution, +6h). Forecast moved 2 Dec → 4 Dec.", +2 BD | **"… Forecast moved 2 Dec → 7 Dec."**, +3 BD | Follows the ret +6h row above (`finish_for` instead of `ceil(H/rate)`) |
| Hours a day set to 0 (or cleared, or unreadable) on a project with a forecast | Saved as 0 (NaN becomes 0, `Workspace.dc.html:334`) | **422** "Hours a day must be more than 0 for a project with a forecast." The field keeps its old value | A zero rate never finishes (see "Zero rates" below). A project without a forecast (Define) still takes 0 |
| Notes rail (`GET /notes/days` `rail`) | Today and earlier days only | The same, **plus every future day that has notes** (newest first, so with today Mon 21 Dec a note for Wed 23 Dec sits above "Today") | A note can be written for a future day, and the rail is the only way back to it. The seed has no future notes, so the `notes` baseline is unchanged |

Goldens are compared from 2026-09-01 onward, so the 31 Aug fix does not disturb them. Any other
divergence found later is added to this table and to `docs/parity-report.md`.

## Consequences
- Engine functions are pure over frozen dataclasses and fully unit-testable.
- The calendar raises when a range runs out instead of clamping.

## Engine findings (P2, `services/engine`)
Every golden above holds under the unified maths with the fixture's BAU-day hours
(ret {r-ret 0, r-man 2}, manco {r-ret 2, r-man 1.5}, play {r-ret 0, r-man 0.5}, fion and alpha
{0, 0}) and GB-ENG holidays; none needed adjusting. `tests/engine/test_golden.py` asserts them,
plus: 12 Oct 8h, 4 Jan 8h (Germany 4 + fion 1 + alpha 3), work left 144 / 74.5 / 50.5 / 57h,
ret cut 10.5h, key run Thu 3 Dec with `to_run` 1, ManCo and ret at 2h/4h a day both landing
Wed 25 Nov, and the 4 Nov override scaling to 4h (10h day).

Decisions the engine had to make that this ADR did not spell out:
- **Zero rates.** A rate edit to 0 on a project with a forecast raises `InvalidEdit` (the API
  should answer 422); on a Define project it only sets the rate, without the prototype's lossy
  scaling of everything to 0. A work-left edit on a zero rate plans and saves 1h a day.
- **Stall rule.** `finish_for` stops only on or after the move, when `rate_after` is 0 and no
  later positive override exists. Anything else that outruns the calendar raises
  `OutOfCalendar` for the service to extend and retry.
- **Invariant precondition.** `finish_for(from, work_left) == forecast` needs every positive
  day's hours to exceed `eps` (0.01h). A rescale to a very small rate can break it (8h to 0.25h
  a day turns 0.25h BAU-day hours into 0.008h). The property tests assume the precondition.
  Validation should keep rates and BAU-day hours at 0.05h or more.
- **`new_over`** counts days that become overloaded where the project's own hours rose, from
  today to the later of the old and new forecast. So an hours-a-day check-in can report new
  overloads before the forecast: ManCo at 2h a day raises its BD3/BD8 hours and newly
  overloads 5 Oct, 12 Oct and 11 Nov. The prototype never previewed this. It is data only.
- **Tagging.** With word boundaries and a 3-character minimum, `bd8` becomes a live alias of
  the ManCo pack routine (the prototype's `> 3` filter dropped it). Plurals no longer match a
  singular alias (`entitlement` does not match `entitlements`).
- **Simple reading `bau_done`.** A routine mention closes today's run only when a completion
  word follows within three words (`Returns BAU is done`) or comes right before it
  (`finished the returns`), and not when the routine word sits inside a project mention
  (`Returns pipeline is done`). A looser rule closes the Returns run on the placeholder's
  "Finished mapping the last four funds", because `funds` is a Returns alias.
- **Counts vs offsets.** Countdown, buffer and the rotation's "N BD to go" (61) use
  `bd_between`. The Routines row's "N BD away" (22, 43) and "starts in N BD" stay `bd_diff`
  offsets, as in the prototype. P5 settled this: ADR-0009 ("Scope") lists counts, offsets and
  the Workspace's inclusive working-day spans.
- **Smaller generalisations.** The month snapshot counts a BAU run as done when it was recorded
  or its checklist is fully ticked (replacing the r-ret funds special case). `next_run_after`
  only counts routines that take time (stage and domain window), so after the last PC run it
  returns none ("after the move"). Today's focus block keeps tasks done today and drops tasks
  done earlier. Rotation load items carry the segment id (default `rot-<order>`), so client
  hover should group them by `refType == "rotation"`.

Engine findings, round 2 (verifier review):
- **Stall day.** When the hours run out, `finish_for` now returns the stall day itself: the
  first business day on or after the move with no hours and no later positive override. The
  earlier rule (the business day after the last day with hours, as in
  arch-backend-engine-api.md) could land before the move when the last days before it had 0h,
  for example a day off on Thu 31 Dec. The Workspace then said "late" while the verdict said off
  track. Every day between the last day with hours and the stall day has 0h, so the invariant
  and refit idempotence still hold. With the fixture's move (Mon 4 Jan, after the 1 Jan bank
  holiday) both rules give the same dates, so the rows above are unchanged. `derive` also treats
  a Private Credit plan with unplaced hours as `after_move`, whatever its stored forecast.
- **Unplaced PC hours are visible.** Every stall row above shows the forecast at the move with
  unplaced hours. The verdict is `off_track` and `crosses_move` is set. The Workspace sentence
  is `after_move`, with `cut_h` = the work to cut to finish before the move.
- **One note per project.** `validate()` keeps only a project's first note, a rule from
  arch-backend-engine-api.md that the prototype's validate did not have. It fits the AI prompt
  ("at most one note per project"). The simple reading now joins a project's note sentences into
  that one note, so no sentence is dropped. The joined note is still cut to 160 characters. A
  second note from the AI is dropped and recorded in `dropped` with a reason.
- **Milestone order.** A Now/Next item that repeats a name replaces the earlier item in its
  original position, like the prototype's `Map.set`. This decides the order of milestones on
  the same date.

Engine findings, round 3 (Phase 1 cross-check):
- **Transition strip flag order.** `verdict.move_strip` now sorts its flags like
  `Transition.dc.html`: by position, with a stable sort over the prototype's insertion order
  (Private Credit projects in project order, then the key run, then the move). A project stands
  at the right edge of its forecast day's block (`posEnd`), the key run at the left edge of its
  block (`pos`) and the move at the end, so each flag carries a `slot` from 0 to the number of
  blocks. The sorted `index` picks the label lift and stick height: 2px and 10px on an even
  index, 18px and 26px on an odd one. The fixture's order is ret (2 Dec), key run (3 Dec),
  manco (11 Dec), play (18 Dec), move, because ret and the key run share slot 42 of 61; the
  engine had them in insertion order before. A forecast on the key run's own day stands one
  slot after the run. When the strip is empty (on or after the move) every flag is at slot 0 and
  keeps the insertion order, which is what the prototype's NaN positions give.
- **Only the move flag is right-aligned.** The prototype right-aligns a flag when its `x` is the
  string `'100%'`, and only the Move flag has that string: a project at the end gets
  `'100.000%'` and stays left-aligned. The quirk list in `design-spec/files/transition.json`
  says a Private Credit flag at the end is drawn like the Move flag; the prototype code does
  not do that, and the code wins.
- **Routine day moves.** Moving a routine to another business day moves the projects' BAU-day
  hours with it (the new last row of the divergence table).

Engine findings, round 4 (Phase 4 clean-up):
- **Loop 1 is the first Build pass.** `layout` summed every Build segment into `loop_bd` and
  `loop_end`, so a Build pass added after the refresh (for example Greece, 3 BD, after the
  Germany refresh) moved loop 1 to 49 BD ending 16 Mar, after the refresh itself. Loop 1 is now
  the Build segments before the first Refresh (the prototype's `ROT.slice(0, 10)`), and the
  refresh is the first run of Refresh segments. The fixture keeps 46 BD ending Mon 8 Mar and the
  9-11 Mar refresh; a rotation that opens with a Refresh has no loop 1 (0 BD, no end).

Engine findings, round 5 (P5 review):
- **Edits that reshape the hours keep the work left** (`forecast.carry_work_left`). The move
  date, the holiday region, holidays, a routine's rule, stage or domain (or removing it), and a
  project's BAU-day hours, overrides and after-move rate change which days have how many hours
  without touching any work left. They used to leave the stored forecast (and `unplaced_h`)
  where it was, so the work left changed silently (an earlier move cut ret from 144h to 137h,
  and the next refit made the loss permanent), unplaced hours went stale after a later move,
  and a forecast could sit on a new holiday or a routine day with 0h, which broke refit
  idempotence. Now every stored forecast is placed again in the same transaction from the work
  left it had before (`mutations.refit_keeping_work_left`), and the movements are reported.
  Like a rate edit, the carried work left counts the forecast day in full, so it can grow by up
  to one day's hours. The invariant holds for every stored forecast after every mutation
  (`tests/projects/test_plan_shaping_edits.py`). The "Routine day moves" row is unchanged:
  those days stay inside every forecast window, so nothing moves.
- **Fixed Income carries on after the move.** A project is created with no rates (Define). A
  Fixed Income project's first rate or work left now sets its after-move rate to the same
  figure; the prototype and Remi both created it with `rateAfter` 0, and Remi's stall rule then
  left every Fixed Income hour on or after the move unplaced while the Workspace said "on". An
  after-move rate set to 0 explicitly is kept (Fixed Income stalls like Private Credit then).
  Migration 0003 repairs Fixed Income rows saved with a rate and a zero after-move rate.
- **Unplaced hours are never on track, in either domain.** `derive` gives status `risk` and the
  `after_move` sentence to any plan with unplaced hours (the stall rows above were Private
  Credit only). The check-in preview's `late` still means "lands after the target", now
  counted with `bd_diff` like the status, so a target a new holiday left on a day off counts
  as the next business day and the chip, the status and the verdict agree.
- **Stored hour figures are 0 or 0.05h..24h.** A rescale could push the after-move rate, BAU-day
  hours or overrides past the database's 24h limit (a 500); replan, its preview and hours-a-day
  check-ins now refuse it with a 422 on the rate, and `validate()` drops such proposals (and any
  below 0.05h) instead of letting them fail the whole preview.
- **The verdict waits for every Private Credit plan.** A Private Credit project in Define has no
  exit, so while one exists the verdict is `no_pc` ("Move not planned yet"), never
  `on_track`: it used to say "Yes … 0 business days to spare" the moment a Private Credit
  project was added. A planned exit on or after the move still makes it `off_track`.
- **A routine starts on the day it is created** (`RoutineDef.starts_on`, migration 0003).
  `counts_on` skips earlier days, so the month snapshot, loads and BAU-day hours never count
  runs from before the routine existed. The prototype counted every run of the month, which
  only its sample data hid.
- **Simple reading blockers.** The blocker words must start a word and not be negated:
  "unblocked now" or "no longer blocked by Finance" becomes a note, not a blocker ("now",
  "Finance"). The prototype's regex had the same flaw.

