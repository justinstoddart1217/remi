/**
 * The cursor-following tooltip (Timeline.dc.html:231-241, 168-176).
 *
 * The content lives in a small store owned by the screen, so showing, swapping and hiding a
 * tip re-renders only the tooltip, never the chart. Position is written straight to the
 * element's `transform` (no React render, no transition), exactly as the prototype, including
 * the scale correction for the fitted stage.
 *
 * Placing reads the wrapper's rect, which forces a layout when the page has pending style
 * changes (and a row hover has just restyled the linked highlight). So the pointer is kept and
 * placed once per animation frame, never inside the mouse event itself: at most one layout
 * read a frame, however many enter and move events arrive.
 */

import { createStore } from 'zustand';
import type { StoreApi } from 'zustand';

import { placeTooltip } from '../../components';
import type { Tip } from './model';

export interface PointerLike {
  clientX: number;
  clientY: number;
}

export interface TipState {
  tip: Tip | null;
}

export interface TipController {
  store: StoreApi<TipState>;
  /** The wrapper (the tip's coordinate space) and the tooltip element, from callback refs. */
  setElements: (els: { wrap?: HTMLElement | null; tip?: HTMLElement | null }) => void;
  /** Shows `tip` (a no-op when the same key is already shown), and places it if a point is given. */
  show: (tip: Tip, at?: PointerLike) => void;
  /** Follows the cursor. */
  move: (e: PointerLike) => void;
  /** Places the tip beside an element (keyboard focus). */
  placeAt: (el: Element) => void;
  hide: () => void;
}

/** Cursor offset and the flip thresholds of the 300px tip (Timeline.dc.html:235-237). */
const PLACE = { width: 310, flipX: 332, height: 140, flipY: 150, offset: 16 } as const;

export function createTipController(): TipController {
  const store = createStore<TipState>()(() => ({ tip: null }));
  let wrapEl: HTMLElement | null = null;
  let tipEl: HTMLElement | null = null;
  let at: PointerLike | null = null;
  let frame: number | null = null;
  const place = () => {
    frame = null;
    if (!at || !wrapEl || !tipEl) return;
    placeTooltip(tipEl, wrapEl, at.clientX, at.clientY, PLACE);
  };
  const move = (e: PointerLike) => {
    at = { clientX: e.clientX, clientY: e.clientY };
    frame ??= requestAnimationFrame(place);
  };
  return {
    store,
    setElements: (els) => {
      if (els.wrap !== undefined) wrapEl = els.wrap;
      if (els.tip !== undefined) tipEl = els.tip;
    },
    show: (tip, at) => {
      if (at) move(at);
      if (store.getState().tip?.key !== tip.key) store.setState({ tip });
    },
    move,
    placeAt: (el) => {
      const r = el.getBoundingClientRect();
      move({ clientX: r.left + Math.min(r.width / 2, 120), clientY: r.top + r.height / 2 });
    },
    hide: () => {
      if (store.getState().tip !== null) store.setState({ tip: null });
    },
  };
}
