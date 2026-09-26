# Ninety One redesign: Timeline, Calendar, Projects, Workspace, Routines, Transition

From the agent porting the six smaller screen diffs (owner of
`frontend/src/screens/{timeline,calendar,projects,workspace,routines,transition}/**`), 2026-09-25.
Source: each `.dc.html` in "Remi Dashboard Design Review/" diffed against "Remi v1/".

## 1. What the six screens now rely on from other areas

These screens take the new looks from the shared components rather than re-styling them
locally. If a component change below is reverted, these screens fall out of parity.

- **Eyebrow** default tone: 11px / 500 at 0.09em in `--brand-dark` (Calendar day panel
  kicker, "Capacity" and "Due this day"; Projects and Routines page eyebrows; the Workspace
  Charter list labels through InlineList). The coloured tones keep 600 at 0.08em, which the
  Calendar plan-row kinds and Transition's "Onboarding readiness" need.
- **SectionTitleRow** (accent): the Workspace "Plan" heading now renders through it.
- **Button** `primary` and `outline` in `--brand-deep`: the Timeline panel "Open workspace", the
  Calendar "Open the day's plan in Today" and the Workspace "Tell Remi".
- **SegmentedControl** `pill` (Timeline zoom), **TargetMarker** (Timeline lanes) and the
  **RotationTile** flag (Routines, Transition) in `--brand-deep`.
- **InlineList** empty text set upright (Workspace Charter lists).

## 2. Open request

### 2a. tokens.css: `--brand-teal` (owner: tokens; same as redesign-components.md 2a)
The accent bar before the Timeline title and the Transition column headings reads
`var(--brand-teal, #009d80)`, as SectionTitleRow does. The prototype hard-codes `#009D80` here, so
the Appearance accents must not recolour it. Once `--brand-teal: #009D80` is in tokens.css, the
fallback can go.

## 3. Done here (for the record)

- The Routines and Transition toast layers were anchored for the 88px rail (`left: 88px;
  top: 72px`). They now cover the full-width content area below the 66px top bar (`left: 0;
  top: 66px`), as Today's does.
- Workspace "Later" is set upright. The redesign's `[style*="font-style: italic"]` rule
  overrides the inline italic that Workspace.dc.html still carries.
- Routines: with the Visuelt metrics, the checklist chevron made the rule line 17.5px tall. That
  pushed everything below the Managing Committee row down 1px (Tier B 0.47%). Its block margins
  are now -4px, so the line stays 17px and the diff is back to 0.006%.

## 4. For the harness owner: the empty-state baselines need re-approval

The approved `empty-{timeline,calendar,projects,routines,transition}` baselines show the old brand,
the 88px rail and the 72px header, so all five fail against them. The new captures in
`parity/baselines/remi/` look right in the new brand. `empty-transition` also has a text change
that predates this port: the onboarding empty copy now reads "No onboarding items yet. They
belong to a Fixed Income project, so start one first." with a "Start a Fixed Income project"
link. The approved baseline has "No onboarding items yet."
