# ADR-0006: Start empty; the design's sample data is only a test fixture

- Status: Accepted
- Date: 2026-09-24
- Plan: binding decision 6

## Context
The prototype hard-codes sample projects, routines, a rotation, notes and "today"
(Mon 5 Oct 2026).

## Decision
- A fresh install has zero projects and needs setup. A first-run wizard (ADR-0010) collects the
  move date, working day, rotation and AI provider. Reads that need the move date return
  409 `SETUP_REQUIRED` until setup completes.
- Every screen has a real empty state (the design's copy where it exists).
- The design's sample data exists only as test fixtures (`prototype_seed.json`), loadable only
  when `REMI_ENV=test` (`POST /dev/fixtures`). `REMI_TODAY` pins the business date for tests.

## Consequences
- Parity runs start Remi with `REMI_ENV=test REMI_TODAY=2026-10-05` and the fixture database.
- A test asserts that a fresh start has 0 projects and needs setup.
