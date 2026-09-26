# Requests from C2 (component library + Foundations)

Changes outside `frontend/src/components/**` and `frontend/src/screens/foundations/**` that C2 needs.

## 1. Register the dev-only `/foundations` route (router owner)
- `src/screens/foundations/index.tsx` default-exports `FoundationsPage` (also a named export).
- Register it only when `import.meta.env.DEV`, as a lazy import, outside the AppShell (it is a
  scrolling page with its own 1480px layout, like the prototype; it must not sit in the scaled
  1920×1080 stage).
- The page needs document scroll: nothing on this route should set `overflow: hidden` on
  `html`/`body`.

## 2. `styles/derived.css` variable names (C1)
Components read these with inline fallbacks, so they work before derived.css lands. Please
define them with exactly these names (values below are the fallbacks in use):

| Variable | Value |
|---|---|
| `--risk-chip-bg` | `color-mix(in oklch, var(--risk) 22%, var(--paper))` |
| `--risk-chip-fg` | `color-mix(in oklch, var(--risk) 40%, var(--ink))` |
| `--risk-text` | `color-mix(in oklch, var(--risk) 45%, var(--ink))` |
| `--stale-ring` | `color-mix(in oklch, var(--risk) 45%, var(--paper))` |
| `--overload-chip-bg` | `color-mix(in oklch, var(--overload) 14%, var(--paper))` |
| `--overload-chip-fg` | `color-mix(in oklch, var(--overload) 75%, var(--ink))` |
| `--overload-fill` | `color-mix(in oklch, var(--overload) 20%, var(--paper))` |

## 3. Reduced motion
Components switch off their CSS motion (checkbox pop, moved-chip scale, overload pulse) under
`:root[data-motion='reduced']` and `@media (prefers-reduced-motion: reduce)`, matching
tokens.css. The appearance hook only needs to set `data-motion` on `<html>`.
