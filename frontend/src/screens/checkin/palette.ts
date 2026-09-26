/**
 * The ⌘K palette's content (Quick add, Projects, Tell Remi, Create, Edit setup and the dev-only
 * reset). The providers live in shell/CommandPalette/items; the palette registry picks up any
 * `src/screens/<name>/palette.ts` that exports `paletteProviders`, so this file registers them.
 */
export { paletteProviders } from '../../shell/CommandPalette/items';
