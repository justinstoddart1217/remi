/**
 * The day switch (Today.dc.html `pick`). The left column fades out and slides 8px towards
 * the new day over 120ms; then the new day is swapped in and fades back from the same side.
 *
 * The route decides the target day. The swap waits for both the 120ms fade and the target's
 * data, so the column never shows a half-loaded day; a first render shows its day at once.
 */

import { useEffect, useState } from 'react';

export const DAY_SWITCH_MS = 120;

export interface DaySwitch {
  /** The day the left column shows. */
  shown: string;
  /** True while the old day fades out (and until the new day's data is in). */
  fading: boolean;
  /** 1 when moving forward (the column slides left), −1 when moving back. */
  dir: 1 | -1;
}

interface State {
  shown: string;
  /** The target this state last saw, to spot a new one during render. */
  target: string;
  dir: 1 | -1;
  /** The target whose fade-out has finished. */
  faded: string | null;
}

/** `targetReady`: whether the target day's data can be shown (loaded or failed). */
export function useDaySwitch(target: string, targetReady: boolean): DaySwitch {
  const [state, setState] = useState<State>({ shown: target, target, dir: 1, faded: null });

  // A new target: pick the direction from the day on screen (derived state, set in render).
  let current = state;
  if (target !== current.target) {
    current = { ...current, target, dir: target > current.shown ? 1 : -1, faded: null };
    setState(current);
  }
  // The fade has run and the data is in: swap.
  if (current.faded === target && target !== current.shown && targetReady) {
    current = { ...current, shown: target, faded: null };
    setState(current);
  }

  const { shown } = current;
  useEffect(() => {
    if (target === shown) return;
    const id = setTimeout(() => {
      setState((s) => (s.target === target ? { ...s, faded: target } : s));
    }, DAY_SWITCH_MS);
    return () => {
      clearTimeout(id);
    };
  }, [target, shown]);

  return { shown, fading: target !== shown, dir: current.dir };
}
