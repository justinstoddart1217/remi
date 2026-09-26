/**
 * Arrival staggers (arch-frontend-core §5, motionSystem §3).
 *
 * A screen's arrival plays once per shell mount, on its first activation (not hidden at app
 * load, as the prototype did). After a double requestAnimationFrame it sets `data-arrived`;
 * 900ms later `data-settled`, which zeroes the stagger delays so later changes (data
 * refreshes, zoom) move without them. Under reduced motion it is settled immediately.
 *
 * Usage:
 *   const arrival = useArrival();
 *   <div {...arrival.attrs}>  … children use `--i` and
 *   `transition-delay: calc(var(--i) * 40ms * var(--stagger))` (styles/motion.css sets
 *   --stagger to 0 once settled).
 */

import { createContext, useContext, useEffect, useState } from 'react';

import { useReducedMotion } from './reducedMotion';
import { afterTwoFrames } from './timers';

export const SETTLE_MS = 900;

/** Provided by ScreenStack around each section. */
export interface ScreenActivity {
  screen: string | null;
  active: boolean;
}

/** Outside the ScreenStack (Home, Textbook) everything counts as active. */
export const ScreenActivityContext = createContext<ScreenActivity>({ screen: null, active: true });

/** True while this screen is the visible one (always true outside the app shell). */
export function useIsActiveScreen(): boolean {
  return useContext(ScreenActivityContext).active;
}

type Phase = 'idle' | 'arrived' | 'settled';

export interface Arrival {
  arrived: boolean;
  settled: boolean;
  /** Spread on the arrival root. */
  attrs: { 'data-arrived'?: ''; 'data-settled'?: '' };
}

/**
 * Arrival state for the calling screen. `active` overrides the ScreenStack context (for
 * example a panel that arrives when it opens).
 */
export function useArrival(active?: boolean): Arrival {
  const contextActive = useIsActiveScreen();
  const isActive = active ?? contextActive;
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('idle');

  useEffect(() => {
    if (!isActive || phase !== 'idle' || reduced) return;
    return afterTwoFrames(() => {
      setPhase('arrived');
    });
  }, [isActive, phase, reduced]);

  useEffect(() => {
    if (phase !== 'arrived') return;
    const id = setTimeout(() => {
      setPhase('settled');
    }, SETTLE_MS);
    return () => {
      clearTimeout(id);
    };
  }, [phase]);

  const arrived = reduced || phase !== 'idle';
  const settled = reduced || phase === 'settled';
  return {
    arrived,
    settled,
    attrs: { ...(arrived ? { 'data-arrived': '' } : {}), ...(settled ? { 'data-settled': '' } : {}) },
  };
}
