# Redesign (Ninety One): requests from Today and Home

From the Today and Home port of the 2026-09-25 redesign (`frontend/src/screens/today/**`,
`frontend/src/screens/home/**`). Each item names the area that owns the change.

## 1. Components: the capacity bar's over-capacity marker is brand-deep

Today.dc.html:45 draws the day bar's capacity line (shown while a day is over capacity) in
`var(--brand-deep)`, not `var(--ink)`. It lives in `components/CapacityBar/CapacityBar.module.css`
(the `marker` class). It shows on the overload day (`today-preview-2026-11-04`), 1px wide, so the
parity budget hides it, but it is the wrong colour.

## 2. Components or styles: share the brand marks

The dark-teal panels of the redesign draw the same three marks: the drifting 'bars' graphic, the
flowing dashed strip along the bottom edge, and the REMI logo mark (five bars growing up). Home
and Today use them now from `frontend/src/screens/home/Brand.tsx` (`BrandBars`, `BrandFlow`,
`LogoMark`, with the design's `n1-drift-a`, `n1-drift-b`, `n1-flow` and `bar-up` keyframes local
to `Brand.module.css`, and all three at rest under reduced motion).

- The shell's top bar (Remi.dc.html:77, the logo mark at 38px) and the Textbook's hero (Remi
  Textbook.dc.html:132, the bars at 44% width) draw the same marks. `BrandBars` takes a `width`
  and `LogoMark` a `height` for them.
- If components would rather own them, move `Brand.tsx` and its module to `components/` and
  Today and Home will import from there; or add the `n1-*` keyframes to `styles/keyframes.css`.

## 3. Styles: the redesign has no italics

Every design file sets `[style*="font-style: italic"]{font-style:normal !important;}` (Remi.dc.html:22,
Remi Home.dc.html:22): the Ninety One faces have no italic, so text the templates write in italic
shows upright. The app's CSS modules set `font-style: italic` in classes, which that rule never
matched in the design; each screen has to drop it (Today's focus-block goal and Home's formula
are upright now). A global rule in `styles/base.css` could do this for every screen at once.

## 4. Shell: Today's toast sits under the 66px top bar

Today's toast layer is now `position: fixed; left: 0; top: 66px` (Remi.dc.html:73, the top bar
replacing the 88px rail). Routines and Transition have the same layer at `left: 88px; top: 72px`
for their owners to move.
