# ADR-0011: The Ninety One redesign

- Status: accepted, 2026-09-25
- Supersedes the visual parts of: ADR-0002 (fonts), ADR-0010 (the look of the new UI)

## Context

The user redesigned Remi in Claude Design as a Ninety One rebrand and re-exported it into the same
folder, `Remi Dashboard Design Review/`. The original export is kept byte-for-byte in its
`Remi v1/` subfolder; its manifest is `docs/design-spec/design-manifest-v1.sha256`.

The redesign is visual. The engine, the sample data and every golden number are unchanged:
`parity/golden/*.json` re-extracted identically, apart from the restyled sample chart.

## Decision

Port the redesign exactly, as the new reference for parity:

- **Tokens:** `frontend/src/styles/tokens.css` is the new `:root`, verbatim. It covers the brand
  palette (`--brand-deep` #134848 and its family), `--pc-accent` #009D80, `--fi-accent` #2F6B9A
  and square corners (`--radius-*: 0`).
  - One addition: `--brand-teal: #009D80`. The prototype hard-codes that colour for accent bars,
    the nav underline and the shell CTA, so Appearance accents must not recolour them.
- **Fonts:** the Ninety One Visuelt family ('N1Visuelt' UI, 'N1Display' display) is self-hosted
  as WOFF2 in `frontend/src/assets/fonts/ninetyone/`, converted from the export's TTFs.
  - Numbers use the platform monospace.
  - Albert Sans, Libre Caslon Text and JetBrains Mono are removed.
  - The Visuelt files are proprietary: fine locally, but never publish them.
- **Shell:** a 66px dark-teal top bar replaces the left nav rail. It holds the logo, screen tabs,
  date and verdict, countdown, a live clock in the business timezone, search and Tell Remi.
  - `nav[aria-label="Screens"]` still holds the tab buttons.
- **Appearance:** three brand accent pairs (teal, deep, mint; default #009D80 / #2F6B9A) and the
  "Display face for goals" switch.
  - Migration 0004 moves stored settings off the old stand-in pairs.
- **Icons:** the subset grows to 33, adding `close_fullscreen` and `right_panel_close/open` for the
  new Notes rails and the expanded note.
- **New UI** (setup wizard, Settings, empty states) is restyled in the new language and its Remi-only
  baselines are re-approved. A person's sign-off is still pending (`make parity-confirm`).

## Deliberate additions beyond the design

- **A Settings button in the top bar.** Settings used to be reachable from the rail; the design
  has no rail. This costs about 78px of Tier B difference, within budget.
- **Tabs drop to icons below 1680px of bar width.** The design's bar needs about 1670px, and the
  'Fit window' layout goes down to 1440px.
- **Notes' expanded note autosaves after a 1-second pause, and traps Tab inside the card.** This
  makes the design's "saves as you go" footer true.

## Result

`make parity`: 38 of 38 design states pass Tier A and Tier B against the new baselines, and
11 of 11 Remi-only states pass against the re-approved ones.
