/**
 * The day switch (Notes.dc.html `pick`): the page fades out over 120ms, sliding 6px in the
 * direction of the new day; then the new day swaps in and fades back. The route picks the
 * target day; the swap also waits for that day's notes, so the page never shows a half-loaded
 * day. A first render shows its day at once.
 */

import { useEffect, useState } from 'react';

export const DAY_FADE_MS = 120;

export interface DayFade {
  /** The day the page shows. */
  shown: string;
  /** True while the old day fades out (and until the new day's notes are in). */
  fading: boolean;
  /** 1 when moving to a later day, −1 to an earlier one. */
  dir: 1 | -1;
}

interface State {
  shown: string;
  target: string;
  dir: 1 | -1;
  /** The target whose fade-out has finished. */
  faded: string | null;
}

export function useDayFade(target: string, targetReady: boolean): DayFade {
  const [state, setState] = useState<State>({ shown: target, target, dir: 1, faded: null });

  let current = state;
  if (target !== current.target) {
    current = { ...current, target, dir: target > current.shown ? 1 : -1, faded: null };
    setState(current);
  }
  if (current.faded === target && target !== current.shown && targetReady) {
    current = { ...current, shown: target, faded: null };
    setState(current);
  }

  const { shown } = current;
  useEffect(() => {
    if (target === shown) return;
    const id = setTimeout(() => {
      setState((st) => (st.target === target ? { ...st, faded: target } : st));
    }, DAY_FADE_MS);
    return () => {
      clearTimeout(id);
    };
  }, [target, shown]);

  return { shown, fading: target !== shown, dir: current.dir };
}
