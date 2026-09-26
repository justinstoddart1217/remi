# Requests from UI-projects-workspace (Projects + Project workspace)

UI-projects-workspace owns `frontend/src/screens/projects/**` and `frontend/src/screens/workspace/**`.
Both screens are built. Against the prototype baselines at 1920×1080 (pixelmatch, threshold 0.1):

| State | Tier A text | Tier B differing pixels |
|---|---|---|
| projects | match | 0.000% |
| workspace-ret | match apart from ADR-0007 (§3) | 0.084% |
| workspace-manco | match | 0.023% |
| workspace-play | match | 0.033% |
| workspace-fion | match | 0.040% |
| workspace-alpha | match | 0.002% |
| workspace-ret-datepicker | match apart from ADR-0007 (§3) | 0.075% |

## 1. C2 (`components/Roll`): the sr-only copy shows up in Tier A text
This is the same issue as UI-timeline.md §1. `Roll` writes its value a second time in a clipped
`srOnly` span, and `innerText` still counts clipped text. Every region with a Roll therefore
reads `… Nov Dec Wed 2 Dec` where the prototype reads `… Nov Dec`.

Until this is fixed, the two screens use `screens/workspace/LocalRoll.tsx`. It has the same DOM,
reels and 440ms spring as `Roll`. The only difference is that it names the value with
`role="img"` and `aria-label` on the root, and has no text node.
- **Request:** have Roll expose its value with `role="img"` and `aria-label={text}`, and drop
  the `srOnly` span. The alternative is for the harness to hide visually hidden text before it
  reads `innerText`.
- Once either is done, Projects (`projects/index.tsx`) and the Workspace (`Stats.tsx`,
  `History.tsx`) switch to `Roll`, and `LocalRoll.*` is deleted. This is a one-line import change
  in each file.

## 2. C2 (`components/StaleBadge`): the badge's gaps
The prototype's interpolation is its own element (`Stale · {{ r.since }} days`, Projects.dc.html:36).
In the `inline-flex` badge with `gap:6px` it lays out as three items, 'Stale ·', '9' and 'days',
each 6px apart. `StaleBadge` renders the same words as one text run, so the number sits 6px
closer on both sides.
- Projects therefore draws a local `StaleTag` (in `projects/index.tsx`).
- **Request:** in `StaleBadge`, wrap the three parts as `<span>Stale ·</span><span>{days}</span><span>days</span>`.
  Projects would then use it.

## 3. P-harness (`parity/divergences.ts`): extend `ret-need-3.8`
The ADR-0007 need rate (3.8 instead of 3.6, with the rate at 3.5) also changes the "To land on
target" sub-line on `workspace-ret` and `workspace-ret-datepicker`:
- prototype: `0.1h a day more than planned`
- Remi: `0.3h a day more than planned`

This is the only Tier A difference left in my seven states. Please add that line to the
`ret-need-3.8` divergence, or add a sibling text divergence.

Two visual-only divergences that the report could list:
- **"Plan as of" is dated today.** On the live stop it reads Mon 5 Oct. The prototype kept the
  last check-in's date, Sat 3 Oct, which arch-frontend-screens (workspace) says is a bug. It is
  a Roll, so only pixels differ.
- **The ret "To land" Roll reads 3.8**, where the prototype reads 3.6.

## 4. F-api-layer (`api/mutations/projects.ts`): deleting a project refetches its snapshots
`useDeleteProject` invalidates `keys.projects.snapshots(projectId)`. The workspace is still
mounted when the invalidation runs, because it unmounts one render later when the new plan no
longer has the project. That causes a refetch that fails with
`404 GET /api/projects/<id>/snapshots`. The error is harmless, but it is logged in the console
and shows up in egress and console checks.
- **Request:** for delete, use `queryClient.removeQueries({ queryKey: keys.projects.snapshots(projectId) })`
  instead of invalidating it. Alternatively, invalidate with `refetchType: 'none'`.

## 5. Behaviour flows (P-harness / P4): selectors the screens guarantee
I checked these flows by hand against my servers. All of them pass, with and without reduced
motion:
- rate edit → replan, and the moved chip
- work-left edit
- Escape reverts
- target and start pickers: toggle, Escape, note, BD snap
- charter add, clear-removes and multi-line Why now
- Now milestone add, focus, date and task CRUD
- blank-line removal
- scrubber drag, keys and Back to now
- two-step remove
- missing id → `/app/projects`
- + New project → goal focused
- card → workspace, with the view transition
- Check in now → drawer

Stable hooks you can use:
- **Stat fields:**
  - `input[aria-label="Hours a day"]` and `input[aria-label="Work left in hours"]`.
  - `button[title="Change the start date"]` and `button[title="Change the target date"]` (kept from the prototype).
  - Milestone date buttons have `title="Change date"`.
- **Picker dialogs:** `[role="dialog"][aria-label="Start date" | "Target date" | "Date for <milestone>"]`.
  Day buttons are named `Mon 30 Nov …`.
- **Scrubber:** `[role="slider"][aria-label="Plan history"]`. The arrow keys, Home and End step
  between check-ins.
- **Every inline field** carries the prototype's focus key as `data-fk`: `name`, `goal`, `why`,
  `later`, `rate`, `left`, `ms:<id>` and `task:<id>`.
- **Projects rows:**
  - `[data-project="<id>"]`, with the project name as the row's link.
  - "Check in now" is a separate button above the link.

## 6. Decisions to review (copy that is new or generalised)
- **"To land on target" with no capacity before the target:** "—" with "no planned hours
  before the target" (need state `no_capacity`). The prototype's `left / bdTgt` could not
  produce this case.
- **Now column subtitle:** "next 2 weeks · 5–16 Oct" is computed from today and today + 9 BD.
  The prototype hard-coded it.
- **Error states (N):**
  - Projects: "The projects could not be loaded. {reason}" with the button "Try again".
  - Workspace: "Remi couldn’t read this project. {reason}" with "Try again".
  - A failed save shows the toast "Couldn’t save that. Try again." For a 409 or 422 it shows the
    server's reason instead. A failed create shows "Couldn’t create the project. {reason}".
- **The no-plan verdict keeps the stale clause, as the prototype does (:403).** The server sends
  `staleDays` for `no_plan`.
- **Renaming a project also sets `short` to the new name, as the prototype does (:507).** The
  short name feeds Timeline and Calendar labels and the check-in aliases. Settings may want a
  separate short-name field later.
- **The empty scrubber:** a project with no check-ins shows one live stop and the hint "One
  check-in so far". This is the prototype's copy, and `workspace-alpha` asserts it.
