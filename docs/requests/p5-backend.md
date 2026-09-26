# P5 backend fixes: requests for other areas

The backend fixes of the P5 review (docs/decisions/0007 "Engine findings, round 5", 0009
"Scope", docs/api.md behaviour notes) change no route, schema or OpenAPI text:
`contracts/openapi.json` and `frontend/src/api/schema.d.ts` stay as they are. What other areas
may want to pick up:

## 1. Frontend: the "not planned yet" verdict sentence (optional copy)
`verdict.state` is now `no_pc` while any Private Credit project is still in Define (no
forecast), not only when there are none, so the header reads "Move not planned yet / Not yet"
instead of "Move on track / Yes … 0 business days to spare". The Transition and Settings
sentence is still `NO_PC_SENTENCE` ("Add your Private Credit projects and routines, and Remi
works out whether you can move cleanly."), which is accurate but reads oddly once a project
exists. The client can tell the two cases apart without a contract change: some
`plan.projects` have `domain == "pc"` (and `derived.status == "define"`). Suggested copy for that
case: "Give each Private Credit project its hours and work left, and Remi works out whether you
can move cleanly." `bufferBd` is never `null` in the `on_track`, `on_track_narrowly` or
`at_risk` states any more, so the `?? 0` fallback in `transition/model.ts` can no longer print
an invented "0 business days to spare".

## 2. Harness and docs: new divergences for docs/parity-report.md
ADR-0007 round 5 lists three behaviours that differ from the prototype and belong in the parity
report's divergence list (no baseline changes: the design seed never hits them):
- a routine added mid-month is not overdue for its runs before the day it was added (the
  prototype's month snapshot counted every run of the month);
- the simple reading turns "unblocked now" / "no longer blocked by X" into a note, not a
  blocker (the prototype's regex proposed the blocker "now" / "X");
- a Fixed Income project's first rate or work left also sets its after-move rate (the prototype
  created it with `rateAfter` 0 and clamped it at the calendar end).

## 3. Product question: does a routine rule edit restart the routine?
A new routine now starts on the day it is created. Editing an existing routine's rule mid-month
(for example monthly to daily) still counts the new rule's earlier runs in the month as
overdue, as before. Moving `starts_on` to the edit day would hide them (and the routine's past
Calendar chips). Not changed without a decision.
