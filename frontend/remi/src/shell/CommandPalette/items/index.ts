/**
 * The ⌘K palette's content providers. Registered through the palette registry's convention
 * (`src/screens/checkin/palette.ts` re-exports `paletteProviders`).
 */
export {
  createProject,
  createProvider,
  devResetProvider,
  forecastHint,
  noMatchText,
  paletteProviders,
  planOf,
  projectsProvider,
  quickAddExample,
  quickAddProvider,
  resetToSample,
  setupProvider,
  tellRemiProvider,
} from './providers';
