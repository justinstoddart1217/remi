/**
 * The stage: how the app canvas maps onto the window (arch-frontend-core §9).
 *
 * - Default is 'Fit window' (the prototype's third frame option): the canvas is the viewport
 *   at scale 1, so a 1920×1080 window reproduces the design frame exactly and 2560×1440
 *   widens the layout while row heights hold.
 * - 'Fit window' is never scaled, so browser zoom always enlarges the text (WCAG 1.4.4). Below
 *   `MIN_FIT` (1440×720 CSS px, where the layouts would start to crush) the canvas keeps that
 *   minimum size and the window scrolls instead. An earlier scaled fallback (the 1920×1080
 *   canvas scaled to the window below 1440×810) cancelled zoom exactly: zooming in shrank the
 *   viewport, so the scale fell by the same factor and the text got smaller, never larger.
 * - `?frame=1920x1080` or `?frame=2560x1440` turns on the prototype's scaler for tests:
 *   s = min(vw/W, vh/H), centred and rounded, over the letterbox colour. Home passes its own
 *   fixed frame (an art-directed 1920×1080 canvas).
 *
 * Everything inside the stage is laid out in design pixels. Pointer maths goes through
 * `toLocal`, which undoes the scale the way the prototype did (k = offsetWidth / rect.width).
 */

import { createContext, useContext, useSyncExternalStore } from 'react';
import type { CSSProperties, RefObject } from 'react';

export interface Frame {
  w: number;
  h: number;
}

export const FRAME_1920: Frame = { w: 1920, h: 1080 };
export const FRAME_2560: Frame = { w: 2560, h: 1440 };

/**
 * The smallest canvas 'Fit window' lays out. Narrower than 1440, the Timeline's day columns and
 * the Workspace stats overlap; every screen, the drawer and the palette hold at 720 tall. The
 * top bar fits from about 1250 (below 1680 its tabs drop to icons). A smaller window (or a
 * zoomed one) scrolls to reach the rest.
 */
export const MIN_FIT: Frame = { w: 1440, h: 720 };

export interface StageGeometry {
  /** Canvas size in design pixels. */
  w: number;
  h: number;
  /** CSS scale applied to the canvas. */
  s: number;
  /** Canvas offset inside the window (letterbox). */
  x: number;
  y: number;
  /** 'fit': scale 1, at least MIN_FIT, scrolls when larger than the window. 'frame': scaled to fit. */
  mode: 'fit' | 'frame';
}

/** Parses `?frame=1920x1080` (also accepts `×` and spaces). Only the two design sizes are allowed. */
export function parseFrameParam(search: string): Frame | null {
  const raw = new URLSearchParams(search).get('frame');
  if (!raw) return null;
  const m = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i.exec(raw);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (w === FRAME_1920.w && h === FRAME_1920.h) return FRAME_1920;
  if (w === FRAME_2560.w && h === FRAME_2560.h) return FRAME_2560;
  return null;
}

/**
 * The prototype's frame maths. `frame` null means 'Fit window': always scale 1, never smaller
 * than MIN_FIT (the Stage lets the window scroll over the rest).
 */
export function computeStage(vw: number, vh: number, frame: Frame | null): StageGeometry {
  if (!frame) return { w: Math.max(vw, MIN_FIT.w), h: Math.max(vh, MIN_FIT.h), s: 1, x: 0, y: 0, mode: 'fit' };
  const s = Math.min(vw / frame.w, vh / frame.h);
  return {
    w: frame.w,
    h: frame.h,
    s,
    x: Math.round((vw - frame.w * s) / 2),
    y: Math.round((vh - frame.h * s) / 2),
    mode: 'frame',
  };
}

/**
 * The canvas box. A frame is placed and scaled in design pixels. 'Fit window' fills the
 * letterbox (inset 0, so a scrollbar is allowed for) and never shrinks below MIN_FIT: in a
 * smaller or zoomed-in window the canvas overflows and the letterbox scrolls, so browser zoom
 * enlarges the text instead of being cancelled by a scale.
 */
export function canvasStyle(g: StageGeometry): CSSProperties {
  if (g.mode === 'fit') {
    return { inset: 0, minWidth: MIN_FIT.w, minHeight: MIN_FIT.h, transform: 'scale(1)' };
  }
  return { left: g.x, top: g.y, width: g.w, height: g.h, transform: `scale(${String(g.s)})` };
}

export interface ViewportSize {
  vw: number;
  vh: number;
}

let cachedSize: ViewportSize = { vw: 1920, vh: 1080 };

function readSize(): ViewportSize {
  if (typeof window === 'undefined') return cachedSize;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw !== cachedSize.vw || vh !== cachedSize.vh) cachedSize = { vw, vh };
  return cachedSize;
}

function subscribeResize(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
  };
}

/** The window size, live. */
export function useViewportSize(): ViewportSize {
  return useSyncExternalStore(subscribeResize, readSize, () => cachedSize);
}

export interface StageInfo extends StageGeometry {
  /** The canvas element (for the go-home fade). */
  ref: RefObject<HTMLDivElement | null> | null;
}

export const StageContext = createContext<StageInfo>({ w: 1920, h: 1080, s: 1, x: 0, y: 0, mode: 'fit', ref: null });

export function useStage(): StageInfo {
  return useContext(StageContext);
}

/**
 * A pointer position in `el`'s own (unscaled) pixels. `k` is the inverse of the visual scale,
 * so it is also right for elements inside a scaled canvas.
 */
export function toLocal(e: { clientX: number; clientY: number }, el: HTMLElement): { x: number; y: number; k: number } {
  const rect = el.getBoundingClientRect();
  const k = rect.width > 0 ? el.offsetWidth / rect.width : 1;
  return { x: (e.clientX - rect.left) * k, y: (e.clientY - rect.top) * k, k };
}

/** Fades an element to opacity 0 over `ms` (180ms ease-out for going Home), then runs `then`. */
export function fadeOutThen(el: HTMLElement | null | undefined, then: () => void, opts: { ms?: number; reduced?: boolean } = {}): void {
  const ms = opts.ms ?? 180;
  if (!el || opts.reduced) {
    then();
    return;
  }
  el.style.transition = `opacity ${String(ms)}ms var(--ease-out)`;
  el.style.opacity = '0';
  setTimeout(then, ms);
}
