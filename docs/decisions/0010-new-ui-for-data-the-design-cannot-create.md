# ADR-0010: New UI for data the design cannot create

- Status: Accepted
- Date: 2026-09-24
- Plan: binding decision 10

## Context
Starting empty (ADR-0006) means the user must be able to create data that the prototype only
hard-codes.

## Decision
Add, in the Foundations design language and with the same components:
- A **first-run wizard**: the move (date picker with a live Roll countdown), working day (hours,
  holiday region, timezone), Fixed Income rotation (ordered RotationTiles with BD lengths and
  Build/Refresh), and the Tell Remi provider (default None).
- A **Settings page**: move, hours, holidays, timezone, rotation editor, key project/run, AI
  provider and appearance (accent, serif, motion).
- **Inline add-item lists** reusing the Charter list pattern: routine checklists on Routines and
  FI onboarding items on Transition.

## Consequences
- The icon subset adds `settings` and `tune` for this UI (30 icons in total).
- Empty states use the design's copy where it exists and new copy otherwise.
