# Requests from UI-routines-transition (Routines and Transition screens)

UI-routines-transition owns `frontend/src/screens/routines/**` and `frontend/src/screens/transition/**`.
Both screens are built. Against the prototype baselines (1920×1080, reduced motion, clock pinned
at Mon 5 Oct 2026 09:30):
- `routines`: Tier A pass, 0.001% differing pixels;
- `routines-open-r-ret`: Tier A pass, 0.001%;
- `transition`: Tier A pass, 0.065%. That covers the ADR-0007 buffer divergence (7, not 8) already
  listed in `docs/parity-report.md`, plus sub-pixel anti-aliasing on "Mon 8 Mar ↗".

## 1. InlineList cannot draw the Transition onboarding rows (owner: C2 `components/InlineList`)
Decision 10 asks for the onboarding readiness list to be an inline list. The design already draws
that block: a fi-accent eyebrow with "2 of 5 ready" on the right, 42px rows, 15px text, a 16px
checkbox and a mono due note. `InlineList` cannot match it, for three reasons:
- its head always shows '+ Add', which puts extra text in the Tier A capture;
- the eyebrow is always ink-muted, and there is no slot on the right for the count;
- its rows are textareas on the Charter grid, not the design's 42px rows.

Until that changes, `screens/transition/ReadinessList.tsx` builds the same pattern from the same
primitives (`InlineField`, `Checkbox`/`CheckboxMark`, `AddButton`):
- a line reads as text, and a click turns it into an inline field;
- Enter or blur saves, Escape reverts, and clearing a line removes it;
- '+ Add' shows only on hover or focus, or while the list is empty.

To let Transition use `InlineList` directly, it would need:
- `addVisibility: 'always' | 'hover'`;
- `headTone` or `headClassName`;
- a `headAside` slot for the count;
- a `row="line"` variant (42px, the text shown as a button until it is clicked).

The Routines checklist uses `InlineList` as it is.

## 2. Which Fixed Income project holds the onboarding items? (owner: P4 / Settings, backend)
Readiness items belong to a project. Transition lists the items of `onboardingHost()`:
1. the first FI project that has items;
2. otherwise the first FI project forecast to land by the move;
3. otherwise the first FI project.

With no FI project, '+ Add' is hidden and the list reads "No onboarding items yet." If a user
should be able to name the onboarding project, add a setting next to the key project and routine.
`PlanOut.move` or the settings could then carry `onboardingProjectId`, and the screen would read
that instead.

## 3. Routine deep links (owner: parity driver, C1)
The screen accepts both `?focus=<routineId>` (`paths.routines`) and `?routine=<routineId>`. The
row scrolls to 120px below the top of the screen and flashes for 1600ms, then the parameter is
dropped with `replace`. `?focus=rot`, `?focus=rotation` and `#rotation` scroll to the Fixed
Income block instead (crit Shell:581). The Transition "Whole rotation" link uses
`paths.routines({ rotation: true })`.
