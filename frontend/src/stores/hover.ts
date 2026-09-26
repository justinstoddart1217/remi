/**
 * Linked highlight: hovering a project, routine or the rotation anywhere dims everything
 * unrelated (synthesis.motionSystem §5). Keys are `{type, id}` so a routine and a project
 * with the same id never collide.
 *
 * Elements subscribe through `useDimmed`, a boolean selector, so only elements whose dim
 * state flips re-render. Style: `[data-dim="true"] { opacity: var(--linked-dim) }` with an
 * `opacity var(--dur-fast) var(--ease-out)` transition (styles/motion.css).
 * The hover is cleared on route change and on window blur (app/RootLayout.tsx).
 */

import { create } from 'zustand';

export type HoverType = 'project' | 'routine' | 'rotation' | 'milestone' | 'day';

export interface HoverKey {
  type: HoverType;
  id: string;
}

export function hoverKey(type: HoverType, id: string): HoverKey {
  return { type, id };
}

/** The rotation has no id of its own. */
export const ROTATION_KEY: HoverKey = { type: 'rotation', id: 'rotation' };

export function sameHoverKey(a: HoverKey | null | undefined, b: HoverKey | null | undefined): boolean {
  if (!a || !b) return a == b;
  return a.type === b.type && a.id === b.id;
}

interface HoverState {
  key: HoverKey | null;
  /** No-op when the key is unchanged (the prototype's setHover guard). */
  set: (key: HoverKey | null) => void;
  clear: () => void;
}

export const useHover = create<HoverState>()((set, get) => ({
  key: null,
  set: (key) => {
    if (!sameHoverKey(get().key, key)) set({ key });
  },
  clear: () => {
    if (get().key !== null) set({ key: null });
  },
}));

type OwnKeys = HoverKey | readonly HoverKey[] | null | undefined;

function matches(own: OwnKeys, key: HoverKey): boolean {
  if (!own) return false;
  if (Array.isArray(own)) return (own as readonly HoverKey[]).some((k) => sameHoverKey(k, key));
  return sameHoverKey(own as HoverKey, key);
}

/** Pure form of `useDimmed`, for lists that compute many rows at once. */
export function isDimmed(hovered: HoverKey | null, own: OwnKeys): boolean {
  return hovered !== null && !matches(own, hovered);
}

/**
 * True when something is hovered and it is none of `own` (the element's own keys: its
 * project, its routine, and so on). Re-renders only when the answer flips.
 */
export function useDimmed(own: OwnKeys): boolean {
  return useHover((s) => isDimmed(s.key, own));
}

/** True while exactly this key is hovered. */
export function useIsHovered(key: HoverKey): boolean {
  return useHover((s) => sameHoverKey(s.key, key));
}

/** Handlers for an element that sets the hover: spread onto it. */
export function hoverHandlers(key: HoverKey): { onMouseEnter: () => void; onMouseLeave: () => void } {
  return {
    onMouseEnter: () => {
      useHover.getState().set(key);
    },
    onMouseLeave: () => {
      useHover.getState().clear();
    },
  };
}
