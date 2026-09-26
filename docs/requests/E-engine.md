# Requests from E-engine (pure engine)

The engine lives in `backend/app/services/engine/`. The package docstring lists the entry points, and `tests/engine/seed.py` shows how to build the inputs. ADR-0007 now ends with an "Engine findings" section.

## For the API and services owners
1. **Error mapping.**
   - `forecast.InvalidEdit` (a `ValueError`) comes from `refit` on a rate of 0 or below for a planned project, or on negative work left. Map it to 422.
   - `calendar.OutOfCalendar` has `.day` and `.year`. When it is raised, extend the holiday years and the calendar, then retry. Past the supported horizon, return 422 `OUT_OF_RANGE`.
2. **One path for preview and apply.** `/checkins/preview` and `/checkins/apply` must both call `checkin.preview(changes, plans, ctx)`. Apply saves each outcome's `after` plan as it is: target, rate, rate_after, BAU-day hours, overrides, forecast, prev and `unplaced_h`. Build the check-in record from `checkin.summarise_checkin`, and the movements from `checkin.diff_movements`.
3. **Replan.** `POST /projects/{id}/replan` calls `forecast.refit(plan, RateEdit | WorkLeftEdit | StartEdit, ctx)` and saves `Refit.plan`.
4. **Validation floor.** Please require rates, rate_after, BAU-day hours and overrides to be either 0 or at least 0.05h. Values of 0.01h or less break the `finish_for` invariant (see ADR-0007, "Invariant precondition").
5. **Read model.**
   - `loads.plan_window(ctx, plans)` gives the day window.
   - `derive.derive_project` returns the sentence as `Sentence(case, …)` with its figures already rounded.
   - `verdict.move_strip` gives the Transition strip.
   - The `Change` dataclasses in `engine/model.py` mirror the nine AI change types field for field.

## For the frontend owners
- Rotation load items use the segment id as `refId` (default `rot-<order>`). To keep the prototype's behaviour of highlighting the whole rotation on hover, group hover by `refType === "rotation"`.

## For the parity report owner (`docs/parity-report.md`)
- ADR-0007's divergence table has new rows: the play and fion need rate (0.9 to 1.0), ret scope previews one BD later (Thu 3 Dec is a 0h BD3), the stall rule (manco +40h, play +16h/+40h, low rate edits and the play 66.5h work-left edit all land Mon 4 Jan with unplaced hours instead of the prototype's later date or its 30 Apr 2027 clamp), and the simple reading's single joined note (`september-reconciled`). Please carry them into the parity report and expect them in Tier A.
