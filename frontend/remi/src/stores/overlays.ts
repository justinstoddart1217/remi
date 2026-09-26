/**
 * Overlays and the Escape order (arch-frontend-core §8).
 *
 * The palette and the check-in drawer live here. Other layers (the Calendar day panel, the
 * Timeline side panel, Textbook's fullscreen chart and slash menu) register with
 * `useOverlayLayer`. Every open layer sits on one stack in the order it was opened, and Escape
 * closes only the top one, which fixes the prototype's Calendar double-close.
 *
 * Things that handle Escape before this stack, by stopping propagation: InlineEditable fields
 * (revert) and the Workspace date picker (capture phase).
 */

import { useEffect, useRef } from 'react';
import { create } from 'zustand';

/** What the palette's quick-add or Notes hands the check-in composer. */
export type DrawerPrefill = { scopeH: number } | { text: string };

export interface DrawerState {
  open: boolean;
  /** The focus project, or null for "About anything". */
  projectId: string | null;
  /** Bumped on every open so the drawer content resets its composer. */
  session: number;
  prefill: DrawerPrefill | null;
}

export interface PaletteState {
  open: boolean;
  query: string;
  /** Selected row; clamped against the item count when rendered. */
  index: number;
}

export const PALETTE_LAYER = 'palette';
export const DRAWER_LAYER = 'drawer';

export interface OpenDrawerOptions {
  /** Where focus returns when the drawer closes (see `openDrawer`). */
  returnFocusTo?: HTMLElement | null;
}

export interface OverlaysState {
  /** Open layer ids, oldest first. */
  stack: readonly string[];
  palette: PaletteState;
  drawer: DrawerState;

  openPalette: (query?: string) => void;
  closePalette: () => void;
  togglePalette: () => void;
  /** Typing resets the selection to the first row. */
  setPaletteQuery: (query: string) => void;
  setPaletteIndex: (index: number) => void;

  /**
   * Opens the drawer (new session) and closes the palette, as the prototype's openCheckIn.
   * `returnFocusTo` is where focus goes when the drawer closes; by default whatever is focused
   * now. The palette passes the element that was focused before ⌘K (its own input is about to
   * close, and becomes inert).
   */
  openDrawer: (projectId?: string | null, prefill?: DrawerPrefill | null, options?: OpenDrawerOptions) => void;
  /** Keeps projectId, session and prefill, as the prototype. */
  closeDrawer: () => void;

  /** Puts a layer on top of the stack (moving it if already there). */
  pushLayer: (id: string, close: () => void) => void;
  removeLayer: (id: string) => void;
  /** Closes the topmost layer. Returns false when nothing was open. */
  closeTop: () => boolean;
}

/** Close callbacks for registered layers; kept outside the state so they never re-render. */
const closers = new Map<string, () => void>();

/**
 * The palette's and the drawer's triggers: where focus returns when each closes
 * (arch-frontend-core §8). Recorded when the layer opens, before the shell goes inert, and kept
 * outside the state (DOM nodes never render anything).
 */
const focusReturns = new Map<string, HTMLElement | null>();

function focusedElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const el = document.activeElement;
  return el instanceof HTMLElement && el !== document.body ? el : null;
}

/** The element focus returns to when `layer` (PALETTE_LAYER or DRAWER_LAYER) closes. */
export function focusReturnTarget(layer: string): HTMLElement | null {
  return focusReturns.get(layer) ?? null;
}

function without(stack: readonly string[], id: string): readonly string[] {
  return stack.includes(id) ? stack.filter((x) => x !== id) : stack;
}

export const useOverlays = create<OverlaysState>()((set, get) => ({
  stack: [],
  palette: { open: false, query: '', index: 0 },
  drawer: { open: false, projectId: null, session: 0, prefill: null },

  openPalette: (query = '') => {
    closers.set(PALETTE_LAYER, () => {
      get().closePalette();
    });
    if (!get().palette.open) focusReturns.set(PALETTE_LAYER, focusedElement());
    set({
      palette: { open: true, query, index: 0 },
      stack: [...without(get().stack, PALETTE_LAYER), PALETTE_LAYER],
    });
  },
  closePalette: () => {
    const { palette, stack } = get();
    if (!palette.open && !stack.includes(PALETTE_LAYER)) return;
    set({ palette: { ...palette, open: false }, stack: without(stack, PALETTE_LAYER) });
  },
  togglePalette: () => {
    if (get().palette.open) get().closePalette();
    else get().openPalette();
  },
  setPaletteQuery: (query) => {
    set({ palette: { ...get().palette, query, index: 0 } });
  },
  setPaletteIndex: (index) => {
    const { palette } = get();
    if (palette.index !== index) set({ palette: { ...palette, index } });
  },

  openDrawer: (projectId = null, prefill = null, options = {}) => {
    closers.set(DRAWER_LAYER, () => {
      get().closeDrawer();
    });
    const { drawer, palette, stack } = get();
    // A new session in an open drawer keeps the trigger that first opened it.
    if (!drawer.open) {
      focusReturns.set(DRAWER_LAYER, options.returnFocusTo !== undefined ? options.returnFocusTo : focusedElement());
    }
    set({
      drawer: { open: true, projectId, session: drawer.session + 1, prefill },
      palette: { ...palette, open: false },
      stack: [...without(without(stack, PALETTE_LAYER), DRAWER_LAYER), DRAWER_LAYER],
    });
  },
  closeDrawer: () => {
    const { drawer, stack } = get();
    if (!drawer.open && !stack.includes(DRAWER_LAYER)) return;
    set({ drawer: { ...drawer, open: false }, stack: without(stack, DRAWER_LAYER) });
  },

  pushLayer: (id, close) => {
    closers.set(id, close);
    const { stack } = get();
    if (stack[stack.length - 1] === id) return;
    set({ stack: [...without(stack, id), id] });
  },
  removeLayer: (id) => {
    const { stack } = get();
    if (stack.includes(id)) set({ stack: without(stack, id) });
  },
  closeTop: () => {
    const { stack } = get();
    const top = stack[stack.length - 1];
    if (top === undefined) return false;
    set({ stack: without(stack, top) });
    closers.get(top)?.();
    return true;
  },
}));

/**
 * Registers a layer (side panel, fullscreen view, menu) in the Escape order while `open` is
 * true. `onClose` is called when Escape reaches it; it should set `open` to false.
 */
export function useOverlayLayer(id: string, open: boolean, onClose: () => void): void {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open) return;
    useOverlays.getState().pushLayer(id, () => {
      closeRef.current();
    });
    return () => {
      useOverlays.getState().removeLayer(id);
    };
  }, [id, open]);
}

/** True while the given layer is the topmost one. */
export function useIsTopLayer(id: string): boolean {
  return useOverlays((s) => s.stack[s.stack.length - 1] === id);
}
