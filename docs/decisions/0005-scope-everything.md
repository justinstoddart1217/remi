# ADR-0005: Scope is every screen the design shows

- Status: Accepted
- Date: 2026-09-24
- Plan: binding decision 5

## Decision
Build all of it: the Home launcher, the 8 app screens (Today, Notes, Timeline, Calendar,
Projects, Workspace, Routines, Transition), the check-in drawer, the ⌘K palette, and the Notes
and Textbook experiences. Foundations is a dev-only route that production builds drop.

## Consequences
- All 8 app screens stay mounted with the prototype's exact cross-fade, so state and scroll
  survive navigation; inactive screens are `inert`.
- `data-screen-label` values match the prototype so visual parity can compare regions.
