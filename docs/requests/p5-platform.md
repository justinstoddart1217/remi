# P5 platform fixer (round 1): what changed, and requests to other owners

This fixer owns `frontend/src/{app,shell,stores,lib,api,test,components}/**`,
`frontend/src/screens/foundations/**`, `frontend/vite.config.ts`, `frontend/src/main.tsx` and
`frontend/package.json`. Everything under "What changed" is done and tested. The requests are
for the owners named in each heading. Items marked **blocking** leave `make check` red until they
are done.

## What changed

1. **Browser zoom enlarges text in the app shell and the Textbook** (`lib/stage.ts`,
   `shell/Stage`). 'Fit window' is never scaled now. Below `MIN_FIT` the canvas keeps its
   minimum size at scale 1, and the letterbox scrolls over the rest. The old fallback scaled the
   1920×1080 canvas below 1440×810, and that scale cancelled zoom exactly.
   - The floor is **1440×720** (it was 1440×810). Below 1440 wide, the Timeline's day columns
     and the Workspace stats overlap. At 1440×720 every screen, the drawer and the palette hold,
     and the rail needs about 690px. So a 1440×900 MacBook window (about 1440×790 inside the
     browser) now lays out without scrolling instead of at 0.73 scale.
   - Measured in Chromium, with zoom emulated at 1440×900: the Today h1 is 52, 57.2, 65, 78 and
     104 device px at 100%, 110%, 125%, 150% and 200%. The Textbook title is 48 to 96. It was
     52 at 100%, then 39 at every other level.
   - `?frame=` (every parity state) and Home's fixed 1920×1080 canvas are unchanged. Home is
     still an art-directed canvas scaled to the window, as PLAN.md requires, so browser zoom does
     not reach it.
2. **Settings has a visible entry point.** The NavRail has a Settings link (the ADR-0010
   `settings` icon, `aria-label`/`title` "Settings") above ⌘K.
   - It is a link, not a screen button, so the egress crawl's rail step (which clicks buttons)
     is unaffected.
   - It is icon only, like ⌘K, so the rail's Tier A text does not change.
3. **Pinned business date.** In a built app, the header shows a "Pinned date" flag (the stale
   badge's risk ring) after the BD while `plan.today.overridden` is true. Its tooltip says what
   to do. The Vite dev server (`make dev`, parity, behaviour) pins the date on purpose, so it
   keeps the prototype's header. See `flagsPinnedDate` in `shell/HeaderBar/headerModel.ts`.
4. **Focus after the palette.**
   - Opening a project from ⌘K now focuses the workspace h1.
   - A drawer opened from ⌘K (Tell Remi rows, quick add) returns focus on close to what was
     focused before ⌘K.
   - How: `openPalette`/`openDrawer` record their trigger (`focusReturnTarget` in
     `stores/overlays.ts`), and the palette hands its trigger to the drawer
     (`openDrawer(…, { returnFocusTo })`).
5. **Roll reads as text, not as an image.** There is no `role="img"` any more. The sizer is the
   value's text node, painted transparent. The strip stays `aria-hidden` and is now
   unselectable. Screen readers get "5 of 12 funds" as one run, date buttons are named by
   their date, and copying a Roll gives the value once.
   - A `label` is read from a visually hidden span; the parity harness drops sr-only text.
   - The DOM order (sizer, then strip) is what the harness reads, and it is unchanged. Pixels
     are unchanged.
6. **`document.title` per route** (`app/documentTitle.ts`, from RootLayout).
   - Screens: "Today · Remi", "Timeline · Remi".
   - The workspace: "<project name> · Remi".
   - The Textbook: "Remi · Textbook" (the prototype's), or "<page> · Remi · Textbook" on a page.
   - Other pages: "Settings · Remi", "Set up · Remi", "Remi · Foundations".
7. **Stale writes catch up.** When a write fails because another tab deleted or changed the
   thing (404, 409, 412), `usePlanMutation`, the check-in apply and the Textbook section, page
   and chart mutations now refetch the plan and every read on screen. Before, the deleted item
   stayed on screen and every retry failed the same way.
   - New exports from `api`: `isStaleWrite`, `staleWriteMessage` and `STALE_WRITE_MESSAGE`
     ("That was changed in another tab. Showing the latest.").
8. **Boot.**
   - A slow `GET /api/setup` shows nothing for 300ms, then "Starting Remi…" (`BootFallback`,
     which is also the lazy routes' `HydrateFallback`), instead of a blank page.
   - When the server cannot be reached, the notice says how to start Remi (launch.command, or
     launch.bat on Windows). The browser's own words ("Failed to fetch") are folded under
     Details.

## Requests

### UI-today (**blocking**): `screens/today/Today.test.tsx`
Roll is no longer `role="img"` (change 5). There are two assertions to update, at lines 226
and 249:
```ts
expect(within(runCount).getByRole('img', { name: '1' })).toBeInTheDocument();
// becomes
expect(within(runCount).getByText('1')).toBeInTheDocument();
```
Make the same change for `'2'` at line 249. Nothing else in the frontend suite depends on the
old role.

### Screen owners (today, workspace, notes, routines, transition): stale-write copy
The view now refreshes itself after a stale write (change 7). The toast still says "Couldn’t
save that. Try again." Use the shared copy first:
- `workspace/useSave.ts` `saveErrorCopy`: `return staleWriteMessage(e) ?? (existing logic)`.
- `today/Today.tsx`, `notes/model.ts` / `Notes.tsx`, `routines/model.ts`,
  `transition/model.ts`: wherever `SAVE_FAILED` is shown for a caught error, show
  `staleWriteMessage(error) ?? SAVE_FAILED`.

### UI-home-textbook: Home
- **Settings entry (finding 4).** Home has no way to reach Settings, and it does not mount the
  ⌘K palette. Add a quiet Settings link: an icon link to `paths.settings()` with
  `aria-label="Settings"`, drawn like the NavRail's (`shell/NavRail/NavRail.module.css`
  `.settings`). The footer or the header row is the natural place. Re-approve `empty-home` if
  its pixels move.
- **Main landmark (finding 9).** Wrap the hero and the cards grid in `<main>`. axe reports
  `region` for `._hero` and `._grid`.
- **Pinned date.** If Home shows today's date, show the same flag as the header, with
  `flagsPinnedDate`, `PINNED_DATE_TEXT` and `pinnedDateTitle` from
  `shell/HeaderBar/headerModel.ts`.

### UI-setup-settings: Settings
`SettingsScreen` reads `useHeaderModel()`. Show the pinned-date flag there in the same way
(`flagsPinnedDate(header)`), because Settings is where a user would go to check the date.

### Backend (finding 1): charts can still reach the network
The frontend cannot close these paths. The iframe `sandbox` is already `allow-scripts` only,
and CSP has no WebRTC control in Chromium.
- `GET /api/charts/{id}`: refuse a top-level document load. Unless `Sec-Fetch-Dest` is
  `iframe`, answer 403 or `text/plain`. Keep answering requests that have no `Sec-Fetch-*`
  headers (tests, curl).
- Before the chart's HTML, inject a prelude `<script>` that deletes and freezes
  `RTCPeerConnection`, `webkitRTCPeerConnection`, `RTCDataChannel` and
  `RTCRtpSender`/`RTCRtpReceiver` on `window`. Also add `webrtc 'block'` to `CHART_CSP` (CSP3;
  it does no harm where unsupported).
- `upload_warnings`: warn on `RTCPeerConnection`, `stun:` and `turn:`.
- Correct the "no network at all" wording in `app/api/endpoints/charts.py` (and in the OpenAPI
  description, which flows into `schema.d.ts` through `make openapi`).
- Harness owner: add a UDP listener case to `parity/specs/egress.spec.ts`. Upload the RTC chart
  from the finding and expect no datagram. Also add a case that opens `/api/charts/<id>` as a
  top-level page and expects no navigation off 127.0.0.1.
- UI-home-textbook: fix the same wording in ChartBlockView if it repeats it.

### Backend (finding 2): REMI_TODAY in prod
The UI now flags a pinned date in a built app (change 3). The backend should also log a
warning at startup when `REMI_ENV=prod` and `REMI_TODAY` is set, for example "REMI_TODAY
pins the business date to 2025-03-03; every count and timestamp follows it. Unset it for
normal use." Adding `today` to `DEV_ONLY` would reverse a documented choice (README, docs/api.md
and the test docstring), so a warning is the smaller step. If you do move it to `DEV_ONLY`, the
flag simply never shows in prod.

### Harness and docs (findings 3, 11, 12): launchers
These are in `launch.command` and `launch.bat`:
- Rebuild when any frontend input is newer than `dist/index.html`: all of `frontend/`
  except `node_modules` and `dist`, which covers `vite.config.ts`, `tsconfig*.json`,
  `package-lock.json` and `scripts/`.
- Run `npm ci` when `package-lock.json` is newer than `node_modules/.package-lock.json`.
- In `launch.bat`, apply the same staleness check (for example, compare a stored hash of
  `package-lock.json` and `src`), rather than rebuilding only with `REMI_REBUILD=1`.
- In the already-running branch, skip `open`/`start` when `--no-browser` is among the
  arguments.
- Before starting, check that the port is free. If another program holds it, fail with "Port
  8765 is used by another app; run REMI_PORT=8766 ./launch.command". The `exec` hand-off also
  skips the "Press Return to close" prompt.

### Harness and docs: record the stage change
`docs/design-spec/arch-frontend-core.md` §9 says "Below a 1440×810 viewport, fall back to the
scaled 1920×1080 canvas so layouts never crush." Change 1 replaces that with "never scale 'Fit
window'; below 1440×720 the canvas keeps that size and the window scrolls, so browser zoom
works (WCAG 1.4.4)". Record it wherever the spec's deviations are listed. The prototype's Fit
window had no floor at all, so this is not a divergence from the prototype.

### Timeline and workspace owners (optional, later)
The 1440 floor comes from two layouts that crush when narrower: the Timeline's day and
business-day header row, and the Workspace stats row. If they wrap or scroll inside their own
column below 1440, `MIN_FIT.w` can drop, and small or zoomed windows would scroll less.
