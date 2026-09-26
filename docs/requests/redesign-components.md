# Ninety One redesign: component library notes and requests

From the component-library agent (owner of `frontend/src/components/**` and
`frontend/src/screens/foundations/**`), 2026-09-25. Source: the redesigned `.dc.html` files in
"Remi Dashboard Design Review/" diffed against "Remi v1/".

Every API change below is additive; no prop was removed or renamed, and existing call sites keep
compiling. Several components look different with no change at the call site.

## 1. What changed for screen agents (read this before hand-rolling a style)

### 1a. New looks, same props
- **Eyebrow**: the default tone (`muted`) is now the brand label, 11px / 500 at 0.09em in
  `--brand-dark`. That is every ink-muted caps label in the redesign (44 of them). The coloured
  tones (`ink`, `pc`, `fi`) keep 11px / 600 at 0.08em, as the prototype does.
- **SectionTitleRow**: by default, the redesigned heading. A hairline rule (it was ink), and the
  title in display 21 / 400 `--brand-deep` behind a 3×18 brand-teal bar, 10px gap (Today plan,
  week and month; Workspace Plan; Textbook Sections; Transition). The markup copies the
  prototype's own, so the baseline alignment with the note matches. If you hand-rolled these
  headings, `<SectionTitleRow title=… note=… as="h2" />` renders them.
- **Button**: `primary` is a `--brand-deep` fill (hover `--brand-deeper`, press scale 0.98);
  `outline` has a `--brand-deep` border and fills `--brand-deep` on hover. This covers CheckIn
  Send / Update, Calendar "Open day", Timeline panel "Open", Foundations Replay and Workspace
  "Tell Remi". The shell's teal "Check in" CTA is shell-specific; it is not a Button variant.
- **--brand-deep instead of ink** (from the design): TargetMarker, the CapacityBar capacity line,
  the SegmentedControl `pill` indicator (Timeline zoom), Toast, and the RotationTile flag.
- **Upright text**: the redesign sets every inline italic upright
  (`[style*="font-style: italic"] { font-style: normal !important }`; Visuelt has no italic).
  EmptyState `italic` and `serif`, the InlineList empty text and the ErrorBoundary title no longer
  slant. The variant names stay.

### 1b. New optional props
- `Eyebrow tone="brand"`: the same as the default. `tone="mint"` (`--brand-mint-2`) and
  `variant="mono"` (numeric 12px at 0.1em, regular) give the hero eyebrow on the deep panels
  (Today.dc.html:52, Remi Home.dc.html:146): `<Eyebrow tone="mint" variant="mono">`.
- `SectionTitleRow variant="plain"`: the 20 / 600 ink title with no bar, over a hairline
  (Workspace "Charter", Textbook "Recently edited").
- `ProgressRule tone="brand"`: the `--brand-deep` fill (Today funds, the check-in drawer's
  thinking rule). `tone="ink"` still works and now renders the same brand fill, because the
  redesign has no ink progress fill left.
- `RotationTile currentTone`: `'ink'` (default) or `'brand'`. The prototype draws the current
  tile's 1.5px border in ink on Routines (:226) and Transition (:171) and in `--brand-deep` only
  on Foundations, so the default stays ink. The flag is `--brand-deep` everywhere.

### 1c. Deliberately unchanged (the prototype's scripts still use `var(--ink)`)
Checkbox (checked fill), ConfidenceControl (selected), ConfidencePips, WeekdayPicker (selected),
HandoverStepper, SegmentedControl `compact` and `mini` (selected), and the
BusinessDayDatePicker's selected day. Keep them ink if you draw the same thing by hand.

### 1d. Radii
The redesign changed only the tokens (`--radius-s` and `--radius-m` are 0). It kept every explicit
radius: 2px bars and segments, 1px ticks, the 4px zoom pill, 50% dots, and the new 999px accent
bar. The component CSS already used the tokens wherever the prototype does, so the corners went
square with no edits. Where a screen's CSS hard-codes 3px or 6px for a prototype
`var(--radius-s)` or `var(--radius-m)`, switch to the token.

## 2. Requests to other owners

### 2a. tokens.css: a brand-teal token (open)
The prototype hard-codes `#009D80` (not `--pc-accent`) for the section accent bar, the nav
underline, the shell CTA and the Notes expand frame, so the Appearance accents do not recolour
them. SectionTitleRow reads `var(--brand-teal, #009d80)`. Please add `--brand-teal: #009D80` to
the brand line of tokens.css, so the literal lives in one place. Screens that need the same teal
can then read the token.

### 2b. derived.css: the primary-button hover (open)
`--button-primary-hover` is still ink 86% into paper, and nothing reads it now. Button hovers to
`--brand-deeper`. Either point the variable at `var(--brand-deeper)` or delete it.

## 3. Foundations dev page
`/foundations` matches the redesigned "Remi Foundations.dc.html": `make parity STATE='foundations$'`
gives Tier A pass and Tier B 0.000% of 2.00%. The page dropped its own oklch accent scope; the
prototype's :root is tokens.css now. `/foundations/library` has a new specimen for the heading
variants and the Eyebrow tones.
