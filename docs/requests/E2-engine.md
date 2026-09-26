# Requests from E2-engine (engine follow-ups)

## What changed in the engine
`verdict.move_strip` now orders the Transition flags the way `Transition.dc.html` does. It sorts them by position with a stable sort over the prototype's insertion order: PC projects in project order, then the key run, then the move. For the fixture that gives ret (2 Dec), key run (3 Dec), manco (11 Dec), play (18 Dec), move. The engine used to give ret, manco, play, key run, move.

Each `StripFlag` now carries four more fields:
- `slot`: the block boundary the flag stands on, from 0 to `len(remaining)`. A project stands at the right edge of its forecast day's block (`posEnd`), the key run at the left edge of its block (`pos`), and the move at `len(remaining)`. The left position is `slot / len(remaining)`.
- `index`: the flag's place in the sorted list.
- `lift_px`: the label's bottom margin, 2 on an even index and 18 on an odd one.
- `stick_px`: the stick's height, 10 on an even index and 26 on an odd one.

## For the owner of `app/schemas/plan.py` (`MoveFlagOut`, `MoveOut`)
1. **Add the geometry to `MoveFlagOut`.** Add `slot: int`, `liftPx: int` and `stickPx: int`, and optionally `index: int`. Without `slot`, the client would have to repeat `pos` and `posEnd` itself. They differ by flag kind, which is easy to get wrong: a project on the key run's own day stands one slot after the run. Then run `make openapi`.
2. **Fix the `MoveOut.flags` docstring.** It currently says "sorted by date (ties keep that order)". That is not the prototype's order. It should say: "sorted by `slot`; ties keep PC projects in project order, then the key run, then the move". For example, a PC forecast on the key run's day sorts after the run, and a past forecast and a past key run both sit at slot 0.

## For the plan read-model / service owner
3. **Pass `move_strip(...).flags` through in the order given.** Do not re-sort by date.

## For the Transition screen owner (frontend)
4. **Flag geometry.** Take the lift and stick height from the server once they are in the schema. Until then, use `i % 2 ? 18 : 2` and `i % 2 ? 26 : 10` over the server order.
5. **Alignment.** Right-align only the Move flag (`kind === "move"`). In the prototype, a PC flag at the end gets `x = '100.000%'`, which is not `'100%'`, so it stays left-aligned. The quirk note in `design-spec/files/transition.json` is wrong on this point.
6. **Heights: keep two lanes.** `arch-frontend-screens.md` suggests "collision-avoid flag heights over 3 or more lanes". That would diverge from the design. The engine gives the prototype's two-lane alternation.

## For the parity report owner (`docs/parity-report.md`)
7. **Carry over the new ADR-0007 rows.** The divergence table has five new rows:
   - ret scope +4h new-overload chips: 4 and 7 Dec (the prototype has 4 Dec);
   - ret scope +8h new-overload chips: 4, 7 and 8 Dec (the prototype has 4 and 7 Dec);
   - play scope +8h: Mon 4 Jan, +8 BD, with 1h unplaced;
   - play scope +16h and +40h shift labels: +8 BD (the prototype has +16 and +40 BD);
   - `routine-r-man-bd10`: the upcoming overloads are 4 Nov 9.5h only. The prototype has 14 Oct 11h, 4 Nov 9.5h and 13 Nov 11h.

   `tests/engine/test_golden.py` asserts all five.
