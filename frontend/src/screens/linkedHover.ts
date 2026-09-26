/**
 * The linked highlight as one screen sees it (stores/hover.ts).
 *
 * All eight app screens stay mounted (ScreenStack) and the hover store is global, so without
 * this a row hover on the visible screen also re-rendered and restyled every dimmable element
 * of the hidden ones (on a large plan, hundreds of attribute writes on Calendar and Today for
 * a hover on the Timeline). A screen that is not the active one sees no hover, so its
 * subscriptions do not change and nothing hidden re-renders. The store is cleared on route
 * change, so a screen that becomes active starts with nothing hovered anyway.
 *
 * Outside the ScreenStack (Home, the Textbook) every screen counts as active.
 */

import { useIsActiveScreen } from '../lib/arrival';
import { isDimmed, sameHoverKey, useHover } from '../stores/hover';
import type { HoverKey } from '../stores/hover';

type OwnKeys = Parameters<typeof isDimmed>[1];

/** The hovered key while this screen is the active one, else null. */
export function useScreenHoverKey(): HoverKey | null {
  const active = useIsActiveScreen();
  return useHover((st) => (active ? st.key : null));
}

/** `useDimmed` for a screen: false while the screen is hidden. Re-renders only when it flips. */
export function useScreenDimmed(own: OwnKeys): boolean {
  const active = useIsActiveScreen();
  return useHover((st) => active && isDimmed(st.key, own));
}

/** `useIsHovered` for a screen: false while the screen is hidden. */
export function useScreenIsHovered(key: HoverKey): boolean {
  const active = useIsActiveScreen();
  return useHover((st) => active && sameHoverKey(st.key, key));
}

/**
 * A primitive per-item answer for a list of keys ('0110': which of them are dimmed), so a
 * component holding several items re-renders only when one of their states flips.
 */
export function useScreenDimMask(keys: readonly HoverKey[]): string {
  const active = useIsActiveScreen();
  return useHover((st) => (active && st.key ? keys.map((k) => (isDimmed(st.key, k) ? '1' : '0')).join('') : ''));
}
