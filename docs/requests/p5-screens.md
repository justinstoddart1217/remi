# P5 screens fixer (round 1): what changed, and requests to other owners

This fixer owns `frontend/src/screens/**` except `screens/foundations`.

## What changed
1. **Workspace verdict when late with no need rate** (`workspace/copy.ts` `lateRemedy`). Once the
   target has passed, or no day before it takes planned hours, the sentence no longer says
   "plan 0h a day". It says what does land it: move the target, or cut work when cutting some
   of it would help. It reads `derived.need.state`, the same state as the "To land on target"
   stat.
2. **Projects Private Credit note** (`projects/model.ts` `pcNote`, `projectsHelper`). The note
   only states what forecasts show. With no PC projects it has no status clause. It says
   "no plan yet" when every PC project is in Define, and "none past target" when some are.
   The header drops "click a project to open its workspace" when there is nothing to click.
3. **Textbook save status** (`textbook/usePageSaver.ts` `SAVE_COPY`). The resting line is now
   "Saved locally" (arch-frontend-screens §4), not "Saved in this browser".
   - A 409 no longer throws the tab's typing away. The saver fetches the latest copy and merges
     per block (`textbook/merge.ts`). A block both tabs changed keeps both versions, and the
     toast says which case applied.
   - Leaving the page while a save is waiting or failing sends it and asks first
     (`beforeunload`).
4. **Home formula excerpt** (`home/textbookExcerpt.ts`, `home/TextbookPreview.tsx`).
   - The common symbol commands (ℏ, †, ‡, ⊕, ⊗, ∉, ∅, ∴, ⟹, ⟺, ¬ and more) are in `SYMBOLS`.
     Unknown commands are still dropped, as F4-screens.md decided.
   - A superscript or subscript minus maps to ⁻ or ₋.
   - The formula line is `role="img"` with its plain Unicode reading as its name.
5. **Home Control Panel preview** (`home/ControlPanelPreview.tsx`, `Home.module.css`).
   - The preview has its own arrival, which waits for the card and for its data, so the
     grows run even when `/plan` lands late.
   - Under reduced motion it has arrived from the start, so the diamonds never scale-pop.
   - A day with nothing planned is a hairline stub (`[data-empty]`), not an accent dash.
6. **Setup rotation rail** (`setup/rotation/model.ts` `rotationSummary`). It counts only
   finished stops and names the unfinished ones ("1 unfinished stop"), as the editor does.
7. **Rotation editor list** (`setup/rotation/RotationEditor.tsx`). The `role="list"` holds only
   the stops. The add button sits beside the list in the same grid; the list is
   `display: contents`.
8. **Linked highlight.** Today, Projects, Routines and Transition now use `--linked-dim` through
   `[data-dim]`, `itemDimmed` or `dimmed`, instead of their own 0.3, 0.25, 0.55 and 0.35.
   - Hidden screens no longer react to a hover on the visible one (`screens/linkedHover.ts`,
     used by every screen's dims).
   - Each Timeline capacity column subscribes to its own dim mask
     (`timeline/CapacityStrip.tsx`).
   - The Timeline tip is placed once per animation frame, never inside the mouse event
     (`timeline/tip.ts`).
9. **Transition.**
   - Flag labels that would print over each other move to the nearest clear row, and one that
     would leave the strip hangs left (`placeFlagLabels`). The design's own layout is
     unchanged.
   - The legend names the region's holidays (`legendNote`).
   - With no Fixed Income project, onboarding says where items live and links to Projects.
   - "Set up the rotation" has its ↗ arrow, like Routines.
10. **Copy.**
    - Platform-neutral wording: "this computer", "secure key store", "Your system asks for
        reduced motion".
    - The privacy note under the AI provider depends on the provider (`PROVIDER_NOTE` is now
      a record).
    - Notes' simple-reading note says that sending notes is a separate opt-in.
    - Settings › Appearance has a user-facing note in place of the "stand-ins" line.
    - Today's empty month drops its extra "Nothing due yet".
11. **Accessibility.**
    - The workspace date picker gives focus back to its trigger (`workspace/picker.ts`).
    - Start, Target and milestone date buttons, task checkboxes and hours fields name what
      they belong to.
    - The Textbook full-screen chart is a non-modal dialog. The page under it is inert, and
      closing it gives focus back to "Full screen".
    - Escape in a formula refocuses the formula.
    - The slash menu is wired to its text field (aria-controls and aria-activedescendant).
    - Section names can be renamed with Enter, Space or F2, and moved with Alt+↑ and Alt+↓.
    - The Timeline BAU rows are named groups, described by their tip text in a `hidden` span.
    - The Timeline side panel leaves the Escape stack while another screen shows.

## Requests
### 1. Harness (`parity/**`, `docs/**`): re-approvals
- The Textbook save-status text row is already in `parity/divergences.ts`, and `textbook-home`
  passes with "Saved locally". `docs/requests/UI-home-textbook.md` §3 can be marked resolved.
- **Re-approve the Remi-only states whose copy changed**, after looking at them. A run of the
  harness (empty fixture) fails five states on Tier A text only; Tier B passes:
  - `setup-wizard`: "your Mac" → "this computer" (provider note).
  - `settings`: the appearance note, "Your system asks/allows…", and "this computer" in the
    provider and done notes.
  - `empty-today`: the month header no longer adds "Nothing due yet".
  - `empty-transition`: the onboarding line and the "Start a Fixed Income project" link.
  - `empty-notes`: the simple-reading note.
- `empty-home` (hairline stubs), `empty-projects` and `empty-textbook` pass as approved.
- `docs/requests/UI-today.md` line 64 describes the old "Nothing due yet" header.

### 2. Shell (`frontend/src/shell/**`)
- **`no_pc` verdict word** (`HeaderBar/headerModel.ts` `VERDICT_CHROME.no_pc.word`,
  "Move not planned yet"). The move date is set; what is missing is Private Credit work to judge.
  Suggestion: "Nothing to plan yet" (H4-harness.md) or "No Private Credit work yet". Today's day
  line reads the same word, and repeating it follows the design (Today.dc.html:24), so only the
  word needs to change.
- **Focus after in-screen navigation** (`ScreenStack/ScreenStack.tsx`). A screen control that
  navigates (a Projects row, Workspace back, a Notes mention chip, Routines "Via …", a
  Transition row, Timeline "Open workspace") is blurred when its section turns inert, and focus
  falls to `<body>`. Please have ScreenStack focus the new screen's h1 when the active screen
  changes and focus is on `<body>` or inside the leaving section, not only after the palette's
  `requestHeadingFocus()`.
- **Rail palette button** (`NavRail`). Its accessible name is "⌘K", because the title is ignored
  when the button has content. Please give it `aria-label="Search or add"`.
- **Hidden screens and layout** (Timeline hover cost at scale). Screens no longer re-render on
  a hover they cannot show, but the eight sections are still laid out while hidden
  (`visibility: hidden`). `content-visibility: hidden` (or `display: none` after the fade)
  would take them out of style and layout.

### 3. Components (`frontend/src/components/**`)
- **InlineList names.**
  - The four charter lists' add buttons are all named "Add". Please name them by their list,
    for example `aria-label={`Add to ${label}`}` or "Add success measure".
  - In the line form, the checkbox and the edit button share the item's text as their name.
    Please name the button `Edit ${text}` or the checkbox `Done: ${text}`.
- **CapacityBar.** Please put the item's hover key on each segment (for example
  `data-item="project:ret"`). A screen could then dim with one CSS rule instead of an attribute
  per segment.
- **Tooltip `placeTooltip`.** It reads the container's rect on every call. The Timeline now
  calls it at most once a frame; a cached rect for other callers would help too.

### 4. Backend
- `services/ai/keys.py` `KeychainUnavailable` says "The macOS Keychain". The Ollama validation
  message says "Remi only talks to Ollama on this Mac." Remi also ships `launch.bat`, so please
  use platform-neutral wording ("the system key store", "this computer"), as the screens now do.

### 5. Decisions (`docs/decisions/`)
- ADR-0007 divergence rows, for whoever owns the ADRs:
  - The Textbook resting save status is "Saved locally".
  - The linked-highlight dim is one value (`--linked-dim`, 0.28) on every screen. The
    prototype used 0.3 and 0.25 on Today, 0.55 on Projects and 0.35 on Routines and
    Transition.
  - No parity state captures a hover, so only the report lists the dim change.
