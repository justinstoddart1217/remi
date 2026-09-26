/**
 * Reduced motion has one source of truth (synthesis.motionSystem): the in-app setting, or,
 * when the setting is 'system', the OS `prefers-reduced-motion` query. This fixes the
 * prototype, where `model.reduced` only read the tweak prop.
 *
 * The result drives `:root[data-motion]` (see app/useAppearance.ts), which turns
 * `--spring-soft` into `steps(1, jump-start)`. Opacity fades stay; JS-driven translates,
 * pulses and scale pops should check `useReducedMotion()` and skip.
 */

import { useSyncExternalStore } from 'react';

import { useUi } from '../stores/ui';

export type MotionSetting = 'system' | 'full' | 'reduced';

const QUERY = '(prefers-reduced-motion: reduce)';

function mediaQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(QUERY);
}

/** The OS preference right now. */
export function osPrefersReducedMotion(): boolean {
  return mediaQuery()?.matches ?? false;
}

function subscribe(onChange: () => void): () => void {
  const mq = mediaQuery();
  if (!mq) return () => undefined;
  mq.addEventListener('change', onChange);
  return () => {
    mq.removeEventListener('change', onChange);
  };
}

/** Live OS preference. */
export function useOsReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, osPrefersReducedMotion, () => false);
}

/** Combines the setting with the OS preference. */
export function resolveReducedMotion(setting: MotionSetting, osReduced: boolean): boolean {
  return setting === 'reduced' || (setting === 'system' && osReduced);
}

/** True when motion should be reduced (setting or OS). */
export function useReducedMotion(): boolean {
  const setting = useUi((s) => s.appearance.motion);
  const os = useOsReducedMotion();
  return resolveReducedMotion(setting, os);
}

/** Non-hook read for event handlers and imperative code. */
export function isReducedMotion(): boolean {
  return resolveReducedMotion(useUi.getState().appearance.motion, osPrefersReducedMotion());
}
