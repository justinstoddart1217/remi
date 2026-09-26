/**
 * A Notes rail's two toggles swap places when pressed, and the pressed one becomes inert. When
 * a focused toggle is pressed, focus moves to its counterpart once the rail has flipped, so the
 * keyboard never loses its place.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';

export interface ToggleFocus {
  /** The toggle shown while the rail is open ("Hide …"). */
  hideRef: RefObject<HTMLButtonElement | null>;
  /** The toggle on the folded strip ("Show …"). */
  showRef: RefObject<HTMLButtonElement | null>;
  /** Call with the pressed toggle, then flip the rail. */
  toggled: (button: HTMLButtonElement) => void;
}

export function useToggleFocus(open: boolean): ToggleFocus {
  const hideRef = useRef<HTMLButtonElement>(null);
  const showRef = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);

  useEffect(() => {
    if (!pending.current) return;
    pending.current = false;
    (open ? hideRef : showRef).current?.focus({ preventScroll: true });
  }, [open]);

  const toggled = useCallback((button: HTMLButtonElement) => {
    pending.current = document.activeElement === button;
  }, []);

  return { hideRef, showRef, toggled };
}
