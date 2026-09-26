# ADR-0008: Build what the design renders; hidden features are data only

- Status: Accepted
- Date: 2026-09-24
- Plan: binding decision 8

## Context
The prototype computes several things it never shows.

## Decision
These are stored (and exposed by the API where useful) but get **no UI**: the phase stepper,
exit routes, the scope log list, risks, feed / attention / prompt, and the structured check-in
form. Data-only routes include feed, aliases, BAU-day hours, overrides and `ai/audit`.

## Consequences
- The P5 review audits for UI that the design does not render.
- New UI is limited to ADR-0010.
