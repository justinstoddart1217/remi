# S-routines: routines, rotation, notes, aliases, feed, events

Services: `app/services/{routines,rotation,notes,aliases,feed,events}.py`. Every write goes
through `run_mutation` and records exactly one event (`tests/routines/test_one_event_per_mutation.py`).

## Contract changes (`make openapi` run)
1. **`NoteDayOut` gains calendar facts:** `w`, `bd`, `bdm`, `hol`, `weekOf` (the Monday, for
   the "This week" / "Week of D Mon" headers) and `today`.
2. **`NoteDaysOut.rail`** is the Notes rail, newest first: every business day from today back
   27 days, plus every day with notes at any date (future days too; the prototype hid them).
   Days without notes have `count: 0` and `latestPreview: ""`. The rail ignores `from`/`to`;
   `days` still honours them. On the seed it matches the baseline rail (20 rows, 5 Oct to 8 Sep).
3. **`DayTextOut.text`** starts with a date line (`"Fri 2 Oct"`) when the day is not today
   (the critique's fix). `count` is the number of notes.

## For the Routines / Today / Notes screen agents
- **Short names.** A rename keeps a curated `short`. A short that is blank, or that mirrored the
  old name, follows the new name. A blank `short` in a PATCH falls back to the name.
- **Hours** are clamped to `0..capacity` on the server. The client still parses "1,5".
- **Runs and ticks are independent.** `PUT …/runs/{iso}` works on any occurrence and records
  `completedOn` = today. Ticks work on today's run only (409 `RUN_NOT_EDITABLE`). A day the
  routine does not run on is 422 `NOT_AN_OCCURRENCE`. `done` = completed, or every item ticked.
  For today's returns run, Today should call the set-all ticks route, not `runs/{iso}`.
- **Stage feed items:** `Handover status X → Y.`, plus ` It drops off your plan.` at stage 3.
  Deleting a named routine adds `Routine removed from the plan.`. Both have `kind: edit` and
  `delta: BAU`.
- **Note writes return the plan**, so they answer 409 `SETUP_REQUIRED` before setup and save
  nothing. Note reads, `POST /notes/tags`, `GET /aliases`, `/feed` and `/events` work before
  setup. `/notes/recent` needs setup.
- **The tag labels** are the project short, or `"{routine short} · BAU"`. `mentions` is sorted
  by count, and ties keep their first appearance.

## Behaviour notes
- `PUT /rotation/segments` keeps the ids you send. An id that is unknown or repeated is a 422
  (`segments.N.id`). The new layout is checked against the calendar before it is saved, so a
  rotation past the ten-year horizon is 422 `OUT_OF_RANGE` and leaves the stored one unchanged.
  `PATCH /rotation {startDate}` rolls forward to a business day; `null` follows the move again.
- `GET /feed` breaks timestamp ties by insertion order (`FeedRepository.page`). A check-in that
  writes several items in one transaction therefore pages stably. An unknown `before` cursor is
  a 422.
- `GET /routines/{id}/occurrences` needs `from` and `to` together (at most three years).
  Otherwise it lists the next `limit` occurrences on or after `after` (default today).

## Requests
- **Parity report owner:** there are no new divergences. On the seed, notes, routines and
  rotation data match the prototype baseline text: the rail, week headers, previews, "6 notes
  across 3 days", tags and mention counts, next three runs with BD offsets, "61 BD to go", and
  tile dates.
- **Check-in / AI context owner:** `services.notes.tagger(uow)` and `recent_business_days(cal,
  today, n)` can be reused for `recent_notes` in the AI context.
