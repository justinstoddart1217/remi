import type { QueryClient } from '@tanstack/react-query';

import type { ScreenId } from '../../app/screens';
import type { DrawerPrefill } from '../../stores/overlays';

/** One palette row. */
export interface PaletteItem {
  /** Unique within its provider. */
  key: string;
  /** Group label, e.g. 'Jump to'. Groups appear in the order of their first item. */
  group: string;
  label: string;
  /** Mono hint on the right (a date, 'check-in', …). */
  hint?: string;
  /** CSS colour of the 7px dot. Defaults to var(--hairline). */
  dot?: string;
  /** Runs on Enter or click. The palette closes first. */
  run: () => void;
}

/** Things a palette item can do. */
export interface PaletteActions {
  /** Go to a screen and focus its heading. */
  go: (screen: ScreenId) => void;
  /** Open a project's workspace (no view transition, as the prototype's palette). */
  openProject: (projectId: string) => void;
  /** Open the check-in drawer (closes the palette). */
  openCheckIn: (projectId?: string | null, prefill?: DrawerPrefill | null) => void;
  navigate: (to: string, options?: { state?: unknown }) => void;
  close: () => void;
}

export interface QuickAdd {
  /** Hours from the first '<n>h' in the query ('+6h returns' → 6). */
  hours: number;
  /** The query with that match removed, trimmed ('returns'). */
  rest: string;
}

export interface PaletteContext {
  /** The raw input. */
  query: string;
  /** Trimmed and lower-cased. */
  q: string;
  /** Set when the query contains '<n>h' (the prototype's quick-add mode). */
  quickAdd: QuickAdd | null;
  /** Read server data with `getQueryData` (items are computed when the palette renders). */
  queryClient: QueryClient;
  actions: PaletteActions;
}

/**
 * A source of palette rows. Providers are plain functions called while the palette is open
 * (on open and on every keystroke), ordered by `order`; the first 16 items across all of them
 * are shown. Built-in: 'jump-to' (order 20). The prototype's groups use Quick add 10,
 * Projects 30, Tell Remi 40, Create 50.
 */
export interface PaletteProvider {
  id: string;
  order: number;
  items: (ctx: PaletteContext) => readonly PaletteItem[];
  /** Empty-state copy; the first provider that returns a string wins. */
  emptyText?: (ctx: PaletteContext) => string | null;
}
