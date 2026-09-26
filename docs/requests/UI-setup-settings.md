# UI-setup-settings: requests and notes

UI-setup-settings owns `frontend/src/screens/setup/**` and `frontend/src/screens/settings/**`.

## What is there

- **`/setup`**, the first-run wizard. It uses Home's frame: the 88px header with the serif wordmark, the same facts as Home, and no nav rail. It has one 720px column with four numbered steps, and a sticky step rail at x=984 (where Home's second card starts). The rail holds the "Start with an empty plan" button (⌘↵).
  - The step 1 countdown is a live Roll that reads `GET /setup/countdown`.
  - The date picker reads `GET /calendar?holidayRegion=` for the region being chosen.
  - The start button sends `POST /setup`, then goes to Home.
  - Once setup is complete, `/setup` redirects to `/settings`.
- **`/settings`** ("Edit setup") has the same frame and five sections, and each section saves as you go:
  - The move: the date, the key project, the key routine, and the verdict as a read-only line.
  - Your working day: hours, region and time zone.
  - Fixed Income rotation: hours a day, the start (read-only), and the countries. Every change that leaves the list valid is saved as one `PUT /rotation/segments`.
  - Tell Remi: provider, model, the Anthropic key (write-only; the page only ever shows "Key set"), the Ollama address, and the recent-notes toggle.
  - Appearance: the four accent stand-ins, serif or sans, and System/Full/Reduced motion.

  Each section header shows a quiet "Saving… / ✓ Saved (· N forecasts moved) / Not saved · …" on one line (it never wraps, so nothing below moves). A failed save that belongs to a field says only "Not saved" in the header, and gives the reason under that field. Esc or "Done" goes back.
- `/settings#rotation` (also `#move`, `#day`, `#ai` and `#appearance`) opens the page at that section.

## Requests

### 1. App root (C1, `app/useAppearance.ts` / `RootLayout`): hydrate appearance from settings

Nothing applies the saved appearance at startup. After a reload, the accent, the serif setting and motion fall back to the defaults until the user opens Settings, which syncs the ui store. Please read `GET /settings` at the root, for example:

```ts
const settings = useSettings().data;
useEffect(() => {
  if (settings) useUi.getState().setAppearance(appearanceFromSettings(settings));
}, [settings?.accentPc, settings?.accentFi, settings?.serifDisplay, settings?.motionPreference]);
```

`appearanceFromSettings` is exported from `screens/settings/model.ts`. It maps the stored hex pair to `standin-1..4`.

### 2. `app/screens.ts` owner: let paths reach a Settings section

"Set up the rotation" on Routines and Transition navigates to `paths.settings()`, the top of the page. Please add `paths.settings(section?: 'move' | 'day' | 'rotation' | 'ai' | 'appearance')`, which returns `/settings#rotation` and so on, and use `paths.settings('rotation')` for those links.

### 3. Timeline (UI-timeline): empty-state footnote

- In the empty plan (first run), the day-column slivers are drawn over the footnote. At 1920×1080 it reads "Hover a ro w to trace it throu gh the capacity  trip; click for det ils".
- The footnote hard-codes "UK bank holidays". With the South Africa region it should name that region's holidays, or just say "public holidays".

### 4. Home (UI-home-textbook): Textbook card on an empty install

On a fresh install, the Textbook card still shows the sample "Rates and duration" preview while its footer says "0 pages · 0 live charts". Consider showing the §5 empty copy ("No pages yet.") instead. (`/textbook` itself now shows a designed empty state.)
