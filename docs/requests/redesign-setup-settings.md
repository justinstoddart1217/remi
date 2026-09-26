# Redesign: requests from Setup and Settings

From the Ninety One restyle of `/setup` and `/settings` (owner of `frontend/src/screens/setup/**`
and `frontend/src/screens/settings/**`). Neither screen is in the design, so both now use the
language of Remi Home.dc.html and Today.dc.html.

## What changed (for everyone)

- **Frame** (`setup/frame/PageFrame.tsx`, `Frame.module.css`). A full-width `--brand-deep` band holds:
  - Home's 96px header: the REMI bar mark, the wordmark and a caps note. Setup's note reads
    "Workflow · Private Credit → Fixed Income". Settings' reads "‹ Home · Settings" and links Home.
    Home's facts are set in white on the right.
  - The hero: a mono `--brand-mint-2` eyebrow over a 72px light display H1.
  - The drifting Ninety One bars on the right 46%, and the dashed mint flow line at the foot.

  Below the band, each numbered step is a white card with the 3px brand-bar heading (Today's "Today's
  plan"). The cards rise 86px over the band, as Home's cards do. Row labels are Workspace's 11/500
  caps in `--brand-dark`. The step rail is a white card at x=984 with Today's drawn 2px green rule
  on top and square markers, which turn brand green once a step is done.
- **Buttons**. The setup's "Start with an empty plan" is the top bar's green "Tell Remi" primary.
  Settings' "Done" and "Save key" are brand-deep outlines.
- **Appearance**. Settings shows the three pairs from `app/appearance.ts`, as square split swatches
  that carry their names. `settings/model.ts` now re-exports `ACCENT_PAIRS`, `accentById`,
  `accentFor` and `AccentPair` from there, as `redesign-shell.md` §1 asked. The serif switch is now
  **Display face for goals** (On/Off), shown beside a live day heading. The rail line reads
  "Teal and blue · display face on · system motion".
- The loops (the bars drift, the flow line, `bar-up`, `n1-draw`) use the global keyframes, and all of
  them stop under `:root[data-motion='reduced']`.

## Requests

### 1. Components (C2): a brand primary and a brand pill, so screens stop overriding

Setup overrides `Button` locally (`.start .startButton` in `Setup.module.css`) to get the green
"Tell Remi" primary from Remi.dc.html:98:

- `#009D80` fill and border, white text at weight 500, and a `0 6px 18px rgba(0,157,128,.25)` shadow;
- on hover, `--brand-dark` and a 1px lift;
- on press, `scale(.97)`.

If `Button` gains this as a variant (for example `variant="brand"`), Setup will switch to it and drop
the override.

In the same way, `.seg [aria-hidden='true']` in `setup/fields/Fields.module.css` repaints the
`SegmentedControl` pill indicator as `--brand-deep` with square corners (Timeline.dc.html:36). The
indicator still hard-codes `border-radius: 4px` and `var(--ink)`. Once the component does this
itself, the override can go.

### 2. Components (C2): brand focus on `InlineField`

The design's `--focus` (#009D80) is the input focus colour. `InlineField` still shows a hairline
inset on focus. Setup and Settings force `inset 0 0 0 1px var(--focus)` on inputs inside their rows
(`Frame.module.css`, `.rowBody input:focus`). Consider making it the component's own focus style.

### 3. Home (UI-home-textbook): one brand mark

`setup/frame/Brand.tsx` has its own `BrandMark` (the REMI bars SVG) and `BarsGraphic` (the drifting
bars), because `screens/home/Brand.tsx` belongs to another area. If a shared
`components/Brand` appears, Setup and Settings will use it.

### 4. `UI-setup-settings.md` is now out of date on the frame

That note still describes the 88px serif-wordmark header and the ink-ruled sections. The behaviour,
the API wiring and the section anchors (`/settings#move|day|rotation|ai|appearance`) are unchanged.
