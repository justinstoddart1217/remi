# Redesign (Ninety One): requests from Notes, Tell Remi and the palette content

From the port of the 2026-09-25 redesign of `Notes.dc.html`, `CheckIn.dc.html` and the palette rows
of `Remi.dc.html` (`frontend/src/screens/notes/**`, `frontend/src/screens/checkin/**`,
`frontend/src/shell/CommandPalette/items/**`). Each item names the area that owns the change.

## 1. Shell (palette frame): the group header is the new kicker

The only change to the palette's rows in `Remi.dc.html` is the group header (line 151). The item
rows (dot, label, hint, 40px, selected tint) are unchanged. The header lives in
`shell/CommandPalette/CommandPalette.module.css` `.groupLabel`, which the frame owns:

```css
.groupLabel {
  padding: 12px 12px 6px;
  font-size: 11px;
  font-weight: 500;          /* was 600 */
  letter-spacing: 0.09em;    /* was 0.08em */
  text-transform: uppercase;
  color: var(--brand-dark);  /* was var(--ink-muted) */
}
```

The providers in `items/` only supply labels, hints and dots, so nothing there changes.

## 2. Shell (drawer frame): nothing needed

The `CheckIn.dc.html` changes are all inside the content: Send and "Try again" are
`var(--brand-deep)` (Apply stays `var(--ink)`), the three kickers use the new kicker style, the
thinking bar and the group rules are `var(--brand-deep)`, and the italics are upright. The frame
(scrim, 1160px panel, slide) did not change in the design.

## 3. Everyone: Notes adds an Escape layer

The expanded note registers `notes-expanded` with `useOverlayLayer` while it is open and Notes is
the active screen. It sits in the stack like the Calendar and Timeline side panels: Escape closes
the palette or drawer first if they opened later.
