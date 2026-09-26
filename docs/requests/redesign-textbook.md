# Requests from redesign-textbook (Ninety One rebrand of the Textbook)

redesign-textbook owns `frontend/src/screens/textbook/**`. It ported `Remi Dashboard Design Review/Remi Textbook.dc.html` (the new design) over the v1 port.

- **What changed:**
  - Sidebar: the dark-teal header with the bars mark, "REMI" and "‹ Home · Textbook", and the round hide button. The collapsed rail sits under the 66px teal band.
  - Home: the dark-teal hero with its drifting bars and flowing rule. "Sections" and "Live charts" have the teal tick and the display face.
  - Hairline rules, brand-dark eyebrows (section labels, sidebar foot, slash menu, "On this page", "Shortcuts") and the teal toast.
  - The callout, chart caption and full-screen caption are now upright. The design turns every inline italic off.
  - Under reduced motion, the bars, drift and flow animations are off. Their end state is the same as the prototype's.
- **Parity** (8915/5415): `textbook-home`, `textbook-katex` and `textbook-chart-full` pass Tier A, Tier B (0.093 / 0.078 / 0.073 %) and the chart check.

## 1. Harness owner (`parity/`): `STATE` example does not match

`make parity STATE='^(textbook-home|…)$'` runs nothing. Playwright's `--grep` matches `"<project> <file> <describe> <title>"`, so a `^` anchor never matches. Use `STATE=' (textbook-home|textbook-katex|textbook-chart-full)$'` instead.

## 2. Harness owner: `empty-textbook` approved baseline is the old design

`parity/baselines/remi-approved/empty-textbook.png` still shows the v1 look. It now fails Tier A (the header text is "REMI ‹ Home · Textbook") and Tier B (9.35 %). I checked the fresh-install Textbook by hand (POST /api/setup, then /textbook): three empty sections, "No pages yet", and the hero reading 0 pages · 3 sections · 0 live charts · 0 words. It looks right.

Please re-approve it: `PARITY_APPROVE=1 PARITY_APPROVER=… make parity STATE=' empty-textbook$'`, then `make parity-confirm`.

## 3. Harness owner: `textbook-saved-locally` divergence source line

The new design still shows "Saved in this browser" (`savedNote`, now `Remi Textbook.dc.html:670`, was `:657`). Remi keeps the documented divergence "Saved locally", because pages are saved on the local server, not in the browser. No copy was invented.

Please update the divergence's `source` line in `parity/divergences.ts`.

## 4. Components owner (`src/components/Toast`), optional

The redesigned pill is `var(--brand-deep)` in Textbook, CheckIn, Calendar, Timeline, Routines, Workspace and Foundations. Until the shared `Toast` changes, the Textbook overrides it through `className` (`.toastDock .toast`).

## 5. Shell / components owner, optional: one brand mark

The bars mark (5 rects, `bar-up` 700ms, delays 120-480ms) lives locally in `Sidebar.tsx` (`BrandMark`) because no shared one existed. If a shared mark component lands, the Textbook can switch to it.
