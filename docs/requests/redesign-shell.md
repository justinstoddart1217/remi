# Redesign: requests from the shell

From the app-shell port of the Ninety One redesign (`Remi Dashboard Design Review/Remi.dc.html`).
Owner of `frontend/src/shell/**` (not `CommandPalette/items/**`), `frontend/src/app/**`, the global
`derived/motion/keyframes/view-transitions` styles, `lib/stage.ts`, the msw fixtures, the settings
model and migration `0004`.

## 1. Setup and Settings: the accent pairs moved to `app/appearance.ts`

The four olive/indigo "stand-ins" are gone. The redesign's `accents` tweak has three Ninety One
pairs, default first. `frontend/src/app/appearance.ts` now owns the pairs **with their names**:

```ts
import { ACCENT_PAIRS, DEFAULT_ACCENT_PAIR, accentById, accentFor, accentIdFor, appearanceFromSettings } from '../../app/appearance';
import type { AccentPair } from '../../app/appearance';
import type { AccentId } from '../../stores/ui'; // 'teal' | 'deep' | 'mint'

interface AccentPair { id: AccentId; pc: string; fi: string; name: string }

ACCENT_PAIRS = [
  { id: 'teal', pc: '#009D80', fi: '#2F6B9A', name: 'Teal and blue' },        // default
  { id: 'deep', pc: '#026E62', fi: '#5B7FA8', name: 'Deep teal and slate' },
  { id: 'mint', pc: '#34C1A3', fi: '#1F4E79', name: 'Mint and navy' },
];
accentIdFor(pc, fi): AccentId   // case-insensitive; the pair, else the PC hex, else 'teal'
accentById(id): AccentPair      // the default pair for an unknown id
accentFor(pc, fi): AccentPair   // accentById(accentIdFor(pc, fi))
```

- Removed: the old stand-in list and its type, and the ids `standin-1..4`.
- `stores/ui.ts` `AccentId` is now `'teal' | 'deep' | 'mint'`, and `DEFAULT_APPEARANCE.accent` is
  `'teal'`. That is a two-line edit outside the shell's paths. No other area owns `stores/`,
  and the type has to follow the pairs.
- `styles/derived.css` sets `:root[data-accent='deep'|'mint']`. `teal` is `tokens.css`'s own pair.
- Settings has adopted this: `screens/settings/model.ts` re-exports the pairs, and at the time of
  writing `tsc -b` is clean and all 797 frontend tests pass. The saved pair keeps the design's
  upper-case hex, so the PATCH body is for example `{ accentPc: '#34C1A3', accentFi: '#1F4E79' }`.
- The redesign labels the serif switch **"Display face for goals"** (the `serif` tweak's `label`).
  If Settings shows the serif toggle, that is its label now.
- Backend: `DEFAULT_ACCENT_PC/FI` are `#009D80` / `#2F6B9A`. Migration `0004` moves the server
  defaults and rewrites any row that still holds an old stand-in pair to the new default pair,
  and `fixtureSettings()` (msw) now returns the new pair.

## 2. Everyone: global keyframes

`styles/keyframes.css` now also has the redesign's six global keyframes, verbatim:
`bar-up`, `n1-flow`, `n1-drift-a`, `n1-drift-b`, `n1-draw` and `n1-ping`. In a CSS module, reference
them as `animation: global(n1-flow) 3.2s linear infinite` (as `CapacityBar` does with
`global(remi-pulse)`), or keep a local copy, as `screens/home/Brand.module.css` does. The shell stops
its own loops (the flow strip, the verdict ping and the logo's bar-up) under
`:root[data-motion='reduced']`.

## 3. Everyone: no italics

Every redesigned file carries `[style*="font-style: italic"]{font-style:normal !important;}`, so
nothing renders in italic. The Ninety One faces have no italic. That rule only catches inline styles,
so each area should drop `font-style: italic` from its own modules. `base.css` does not carry the
rule.

## 4. Home and Settings: the Settings entry point moved

The left rail is gone, and its Settings link went with it. The shell's top bar now has a round
Settings link. It is icon only, `aria-label="Settings"`, `href="/settings"`, and sits at the left of
the status cluster, before the countdown, so the spacer absorbs it and nothing in the design's
cluster moves. Nothing is needed from other areas for this.

## 5. Settings and Home: `VERDICT_CHROME` is unchanged

`shell/HeaderBar/headerModel.ts` keeps `VERDICT_CHROME`, `NO_PC_SENTENCE`, `useHeaderModel`,
`flagsPinnedDate`, `PINNED_DATE_TEXT` and `pinnedDateTitle`. The header model adds `tz` (the plan's
business timezone, `plan.today.tz`). `dateLine(model)` / `dateLineParts(model)` give the small-caps
line. `shell/HeaderBar/clock.ts` exports `clockCity(tz)` ('London', which CSS upper-cases),
`formatClock(date, tz)` ('09:30:00'), `clockZone(...)` and `useNow()` for anyone who wants the same
clock.

## 6. Screens with a fixed toast layer: 66px, not 88/72

The shell is one column now: the top bar is 66px tall and there is no 88px rail. Any layer that
was placed at `left: 88px; top: 72px` to clear the old chrome should be at `left: 0; top: 66px`.
Today already moved. Per `redesign-today-home.md` §4, Routines and Transition still have such a
layer.

## 7. Orchestrator and harness

- **Remi-only parity baselines need re-approval.** All seven `empty-<screen>` states fail against
  `parity/baselines/remi-approved/`, which still show the old rail and header. The design states
  pass. Once every area has landed, re-approve after looking at the captures:
  `make parity STATE=' (empty-.*|setup-wizard|settings)$' PARITY_APPROVE=1 PARITY_APPROVER=…`.
- **`--brand-teal`** (asked in `redesign-components.md` §2a) belongs in `tokens.css`, which the
  shell does not own. The top bar writes `#009D80` / `#026E62` literally, as the design does.
- Done here for `redesign-components.md` §2b: `derived.css` `--button-primary-hover` now points at
  `var(--brand-deeper)`.
- Files outside the shell's paths that this change had to touch:
  - `frontend/src/stores/ui.ts`: the `AccentId` union and `DEFAULT_APPEARANCE.accent`.
  - `contracts/openapi.json`: regenerated. Only the `HexColour` example changed (`#009D80`), and
    `schema.d.ts` is unchanged.
  - `backend/tests/core/test_models.py`: the default pair.
  - `backend/tests/integration/test_migrations.py`: head is `0004`, plus the new `0004` tests.
  - `backend/tests/core/test_backups_and_startup.py`: now reads the real head instead of
    hard-coding `0003`.
- **Stale prose**, not code: `docs/PLAN.md` (§styles says the accent defaults are
  `#526e2a`/`#47619c`; §shell names `NavRail`), `docs/design-spec/arch-frontend-core.md`, and the
  `NavRail` comment in `parity/specs/egress.spec.ts:234`. The egress step still works: the tabs
  are buttons in `nav[aria-label="Screens"]`.
- **Narrow windows.** The design's bar needs about 1670px. Below 1680px of bar width (a small
  'Fit window'; `MIN_FIT` is 1440) the tabs drop to icons, with the labels kept as their names
  and tooltips. That is a container query on the header, so a scaled `?frame=` canvas is never
  affected.
