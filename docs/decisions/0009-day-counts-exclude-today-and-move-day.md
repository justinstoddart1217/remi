# ADR-0009: Day counts exclude today and the move day

- Status: Accepted
- Date: 2026-09-24
- Plan: binding decision 9

## Context
The prototype counts days inconsistently (some counts include today, some the move day).

## Decision
Every user-facing day count is the number of business days **strictly between** its two ends.
- Countdown to the move: business days strictly between today and the move. With the fixture
  (today Mon 5 Oct 2026, move Mon 4 Jan 2027) it is **61** (the internal `bd_diff` is 62).
- Buffer: business days strictly between the last PC exit and the move (**7** in the fixture,
  ADR-0007).

## Consequences
- The engine exposes `bd_between` for counts and keeps `bd_diff` for signed offsets.
- Goldens for the countdown are re-derived under this rule, not copied from the prototype.

## Scope (settled in P5)
ADR-0007 left open whether this rule covers every figure printed with "BD". It covers counts of
the days **between two events**. Remi prints three kinds of business-day figure, and the same
pair of dates gives a different number in each, on purpose:

| Kind | Rule | Where |
| --- | --- | --- |
| Count between two events | `bd_between`: strictly between, both ends excluded (this ADR) | Countdown to the move (61), verdict buffer (7), the rotation's "N BD to go" |
| Signed offset | `bd_diff`: steps from one day to the other | Routines "N BD away" and "starts in N BD", the Workspace delta ("+3 BD", "−2 BD vs target"), check-in and movement shift labels, "overdue N BD" |
| Working-day span | `bd_diff + 1`: the business days you can work, both ends included | Workspace "N BD from today" (plan start or today through the target), "N BD of work left" (through the forecast), "N BD in of M" (start through the forecast) |

A span counts working days, so the target or forecast day itself is one of them: it is the
divisor of the Workspace average ("averages Xh once BAU days are counted") and of the need
rate, where leaving an end out would be wrong. The prototype prints the same spans
(`Workspace.dc.html`, `bdDiff+1`) and the parity baselines keep them (40 / 43 / 15 of 58 in the
fixture). Example, today Fri 25 Sep 2026 (ZA) and Mon 9 Nov: span 31 ("31 BD from today"),
offset 30 (a BD5 run that day is "30 BD away"), strictly between 29.

