# Requests from B-parity (P1 parity harness)

Changes outside `parity/**` and the `goldens` / `parity-baseline` Make targets that the harness needs or suggests.

## Makefile (owner: scaffold / integration)

1. **`setup` should also install the parity project.** Add `cd parity && $(NPM) ci`, so that `make parity-baseline` works on a fresh clone. For now, `parity-baseline` runs `npm ci` itself when `parity/node_modules` is missing.

2. **`check` should verify the goldens, not regenerate them.** `check` depends on `goldens`, and `goldens` rewrites `parity/golden/*.json`. CI should run a check-only target instead:

   ```make
   goldens-check: ## Fail if parity/golden is stale
   	cd parity && node golden/extract.mjs --check
   ```

   Then use `goldens-check` in `check` in place of `goldens`.

3. **`browsers` installs through the frontend.** It runs `cd frontend && npx playwright install chromium`. That works today because both packages pin Playwright 1.63.0, so they share the `chromium-1243` build. If the versions ever diverge, switch it to `cd parity && npx playwright install chromium`.

## frontend (owner: frontend platform / screens)

4. **The icon font is shared with the harness.** The prototype baselines render with `frontend/src/assets/fonts/material-symbols-remi.woff2`. Re-running `npm run subset-icons` changes the icon glyphs in both apps, so re-capture the baselines afterwards with `make parity-baseline`.

5. **Tier A compares `textNoIcons`.** The prototype writes icons as ligature names (`chevron_left`). Remi can use codepoints. The harness therefore hides every element whose computed `font-family` contains "Material Symbols" before reading the text. Icon elements must be leaf elements that use that family.

6. **Keep the prototype's `data-screen-label` values**, including the region nesting: "Remi app" contains the screen sections and "Check-in drawer". Also keep the palette input placeholder `Jump to a screen or project…`, because `drivers/remi.ts` selects it.

## P3 screen agents

7. **Complete `parity/drivers/remi.ts`.** It is a stub with the same interfaces as the prototype driver. Deep links are listed in its header. The methods that currently throw are:
   - `hoverTimelineProject`
   - `hoverTimelineRotation`
   - `openTimelinePanel`
   - `openDatePicker`
   - `HomeDriver.hoverCard`
   - `TextbookDriver.fullscreenChart`

   Add a `remi` Playwright project, and a webServer entry that runs with `REMI_ENV=test REMI_TODAY=2026-10-05` and the fixture DB from `parity/golden/prototype_seed.json`.
