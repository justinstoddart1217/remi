# Requests from UI-notes-checkin (Notes, the Tell Remi drawer, the ⌘K palette content)

UI-notes-checkin owns `frontend/src/screens/notes/**`, `frontend/src/screens/checkin/**` and
`frontend/src/shell/CommandPalette/items/**`.

- The drawer content registers by convention: `screens/checkin/index.tsx` is the default export
  that DrawerHost loads.
- The palette content registers the same way: `screens/checkin/palette.ts` re-exports
  `paletteProviders` from `shell/CommandPalette/items`.

## Parity (round 2, 20:10, harness drivers from `parity/states.ts` on my ports)

| State | Tier A (own text) | Tier B |
| --- | --- | --- |
| `notes` (the harness now runs it with the fake AI reader and recent notes on) | pass | 0.000% |
| `drawer-compose`, `drawer-thinking`, `drawer-review-simple`, `drawer-review-claude` | pass | 0.001–0.003% |
| `palette-empty`, `palette-quick-add`, `palette-no-match` | pass | 0.001% |
| `drawer-error` | text differs, §1b | 0.34% |
| `drawer-review-offline` | text differs, §1c | 0.70% |

"Own text" leaves out two diffs that the in-progress harness change (20:07–20:09) adds to every
state until the prototype baselines are re-captured: the new `[field] …` lines (the baselines
from 17:47 have no `ownFields`), and the Today region's Roll digit strips.

## 1. P-harness (`parity/divergences.ts`) and the ADR owners: two deliberate differences remain
Each one needs a divergence row, and the ADR that `divergences.ts` asks for.

**a. `notes`: resolved.** `parity/states.ts` now runs `notes` with the fake AI reader and
recent notes on (ADR-0004), where Remi's copy matches the prototype exactly. For the record,
with provider `none` the rail note says notes stay on this computer, and the CTA note drops
"Remi currently has N recent notes as background."

**b. `drawer-error`: the error message is shown.**
- The prototype's `renderVals` never returns `err`, so its panel renders an empty message.
- The critique (:250) gives the text, and Remi shows it: "The assistant didn’t answer cleanly
  (Remi replied without a plan.). Try again, or use a simple reading that picks out hours,
  blockers and names."
- Suggested text row for the `Check-in drawer` region:
  - prototype: `Remi couldn’t read that just now Try again`
  - Remi: `Remi couldn’t read that just now The assistant didn’t answer cleanly (Remi replied without a plan.). Try again, or use a simple reading that picks out hours, blockers and names. Try again`

**c. `drawer-review-offline`: the backend's simple reading adds no note beside a `task_done`.**
- This is a documented quirk fix in `services/engine/simple_reading.py`, but it is not yet in
  ADR-0007's table.
- As a result, "NOTE Finished parsing the security-level extract." is missing, and the apply
  button reads "Apply 6 changes" instead of "Apply 7 changes".
- Engine owner: please add the ADR-0007 row. P-harness: please add the matching text rows.

## 2. C1: resolved, nothing needed
- The quick-add provider now returns no empty text while the plan is unread, so the frame's
  default copy ("…or “+4h manco”.") stays and `CommandPalette.test.tsx` passes unchanged.
- With a read plan, the copy names a real project, or drops the example when no project is
  planned (arch-frontend-screens §5).

## 3. Clock owner (already asked by P-harness §2)
- Note stamps come from the server clock. With only `REMI_TODAY` set, a note jotted in the
  browser, whose clock is pinned to 09:30, is stamped with the real time of day (for example
  18:26).
- `REMI_NOW` would make the "Notes stamps 09:30" behaviour flow deterministic.

## 4. Notes on behaviour (for P4)
- **Notes:**
  - A jot, edit or delete updates the day's cache at once. A failure restores the cache and
    shows "Couldn’t save that. Try again."
  - A blanked note sends `DELETE`.
  - Escape in an entry reverts it and stops propagation.
- **Future days** (from the week spark or `/app/notes/<iso>`) are labelled "Next business day"
  or "In N business days", and you can jot on them (the server accepts days within the
  horizon).
- **The composer** grows with `field-sizing: content`, with a `scrollHeight` fallback for
  browsers without it (crit Notes risk).
- **Tell Remi's provider indicator** is a 6px dot after the title. It is named in the dot's
  tooltip and `aria-label`, and follows `GET /ai/status`: faint for the simple reading, ink
  for an AI reader that is available, risk for one that is unavailable.
- **Checked end to end in the browser (scratch script):**
  - jot, edit, revert, blank-delete;
  - day picks from the rail, the spark and the Today button;
  - tag and mention links;
  - the CTA opening the drawer, prefilled with the caret at the end;
  - simple reading, untick, typing back to compose, "Edit update", and ⌘↵ applying;
  - the drawer closing at once and the forecast moving;
  - palette quick add prefill, "Edit setup", dev reset, and New Fixed Income project → its
    workspace.

## 5. Decisions made in round 2
- **The review's "now N BD past target"** is the preview's `pastTargetBd` (engine
  `checkin.py`); the client no longer counts business days.
- **The week spark skips bank holidays** (arch-frontend-screens §2 notes/). Christmas week
  shows four bars, M 21 to T 24. A holiday's notes do not set the scale. The prototype
  plotted Monday to Friday; the design week (5 to 9 Oct) has no holiday, so the parity
  states are unchanged.
