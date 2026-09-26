# Requests from UI-home-textbook (Home launcher + Textbook)

UI-home-textbook owns `frontend/src/screens/home/**` and `frontend/src/screens/textbook/**`.

- **Home** reads `GET /home` and the plan (loads, calendar, projects), plus
  `POST /projects/{id}/replan/preview` for the hover demo (the key project with 6 more hours).
- **Textbook** reads `GET /textbook`, `/textbook/home`, `/textbook/pages/{id}` and
  `/textbook/search`. It writes through the textbook mutation hooks, `useUploadChart`, and
  `PATCH /settings {uiPrefs}`.
- **Parity** (scored with the current capture code against the prototype baselines re-captured
  at 20:13, where each Roll reads as its value):
  - `home`, `home-hover-textbook`, `textbook-home`, `textbook-katex` and `textbook-chart-full`
    match the prototype's Tier A text exactly.
  - `home-hover-plan` matches only with two documented ADR-0007 text divergences (§6). Remi shows
    'Mon 7 Dec' and '+6 BD' where the prototype shows 'Fri 4 Dec' and '+5 BD'. My earlier claim
    of an exact match held only under the old capture, which read the Roll reels as text.
  - Tier B is 0.27 / 0.32 / 0.27 / 0.012 / 0.002 / 0.002 %.
  - Home's pixel difference lies entirely in the Control Panel preview, which draws real data
    instead of the prototype's `CAP` / `rowsDef` arrays.
- **Behaviour:** the `@p4` Home keys flow and the Textbook slash / formula / chart flow from
  `parity/specs/behaviour.spec.ts` pass against my ports. So do markdown shortcuts,
  Enter/Backspace, drag reorder, new page, sub-page via `/page`, two-step delete, search, ⌘\,
  full screen with Escape, S/M/L, drag resize, and section add and rename.

## 1. F-api-layer (owner of `src/api/**`): a hook for UI preferences
`useUpdateSettings` is a plan mutation with `invalidate: 'all'`. That refetches every query,
including the open Textbook page, on each fold or sidebar toggle. The Textbook therefore writes
`PATCH /settings {uiPrefs}` itself, in `screens/textbook/uiPrefs.ts`, and mirrors the change into
the cached settings.

Request: add `useUpdateUiPrefs()` with no invalidation (set `keys.settings` from the response)
and I will switch to it.

## 2. C2 (owner of `components/Roll`): same as UI-today §1
Home still uses a local copy, `screens/home/HomeRoll.tsx`, because `Roll`'s screen-reader span
adds a token to the Tier A text. To switch once that is fixed: import `Roll` in
`ControlPanelPreview.tsx`, then delete `HomeRoll.tsx` and the `.roll*` rules in
`Home.module.css`.

## 3. Copy decisions to confirm (critique owner)
- **Save status.** The resting line is the prototype's "Saved in this browser", which Tier A
  needs. arch-frontend-screens §4 proposes "Saved locally", which is more accurate now that pages
  live on the server. To change it, edit `SAVE_COPY.idle` in `screens/textbook/usePageSaver.ts`.
- **Toasts that are new (N):**
  - "Couldn’t add {name}. Try again." (upload failed)
  - "Couldn’t add a page. Try again."
  - "Couldn’t add a section. Try again."
  - "Couldn’t delete that page. Try again."
  - "That page no longer exists."
- **Toast that changed:** the 4 MB toast now says "…charts that large cannot be saved." The
  server's own copy replaces the prototype's "…will not save in the browser".
- **Upload warnings:** an upload `warning`, such as a chart that loads from the web, is shown as
  the toast in place of "{name} is live on this page."

## 4. Deliberate differences from the prototype (not failures)
- **Textbook home no longer highlights a page.** In the prototype, Textbook home highlights the
  first page ("Rates primer") as current, because `page()` falls back to `pages[0]`. Remi
  highlights only the Home row. This costs about 0.01% of pixels.
- **The slash menu is placed from the main column's real box.** The prototype subtracts a fixed
  288px sidebar width. Remi also re-anchors the menu on scroll and flips it above the block near
  the bottom.
- **Backspace on an empty paragraph after a formula** opens that formula for editing. In the
  prototype, the focus was lost.
- **Search:** Escape clears the search box.
- **Formulas:** Escape leaves formula editing.
- **The ⌘\ shortcut and the search rail button** also persist the sidebar state (`uiPrefs`).
- **Home's Fixed Income soft colour.** `Home.module.css` `.preview` mixes `--fi-accent-soft` from
  `oklch(0.5 0.1 265)`. Remi Home.dc.html has no `accents` tweak, so it keeps the oklch accent.
  Mixed from the token's hex, the hue turns the other way round and gives a pinkish #ece0d6
  instead of #e3e4d5. The token itself is right for the app screens, so no change to it is needed.

## 5. P-harness (owner of `parity/**`): harness noise
Every sandboxed chart frame logs `SecurityError: Failed to read the 'serviceWorker' property`.
This comes from the context option `serviceWorkers: 'block'`, whose check reads
`navigator.serviceWorker` in an opaque-origin frame. Remi's code does not trigger it. Please
filter it out of `pageErrors`.

## 6. P-harness (owner of `parity/divergences.ts`): text divergences for `home-hover-plan`
Region 'Remi home', state `home-hover-plan`, source ADR-0007 row "ret +6h scope"
(docs/decisions/0007-unified-forecast-maths.md:61):
- 'Fri 4 Dec' → 'Mon 7 Dec' (the key project's forecast Roll, whole line);
- '+5 BD' → '+6 BD' (the delta pill Roll, whole line).

Hovering the Control Panel card asks the server to replan ret with 6 more hours
(`POST /projects/ret/replan/preview`). The prototype hard-codes the old maths (Remi Home.dc.html:214).
Status: both rows are in `parity/divergences.ts` (`home-demo-ret-6h`, `home-demo-ret-6h-delta`,
added 20:19), and `home-hover-plan` passes Tier A with them. Nothing else is needed.
