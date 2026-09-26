/**
 * Applies the appearance settings to :root, replacing the prototype's `applyTweaks()`:
 * - `data-motion="full|reduced"` from the motion setting or the OS preference;
 * - `data-serif="off"` makes `--font-display` fall back to the UI face (styles/derived.css);
 * - `data-accent="teal|deep|mint"` picks the Ninety One accent pair (app/appearance.ts
 *   ACCENT_PAIRS, styles/derived.css). teal (#009D80 / #2F6B9A) is what tokens.css already
 *   holds, so the first render matches the design.
 *
 * The values live in the ui store. This hook, mounted once at the app root, hydrates the store
 * from `GET /settings` whenever the saved appearance changes (first load, a save in Settings,
 * a refetch), so every screen follows the saved choice without visiting Settings. Settings'
 * Appearance section also writes the store optimistically while its save is in flight.
 */

import { useEffect } from 'react';

import { useSettings } from '../api/queries/settings';
import { useReducedMotion } from '../lib/reducedMotion';
import { useUi } from '../stores/ui';
import { appearanceFromSettings, hasAppearance } from './appearance';

/** Hydrates the ui store's appearance from the saved settings. */
export function useSavedAppearance(): void {
  const settings = useSettings().data;
  const saved = hasAppearance(settings) ? settings : null;
  const accentPc = saved?.accentPc;
  const accentFi = saved?.accentFi;
  const serifDisplay = saved?.serifDisplay;
  const motionPreference = saved?.motionPreference;

  useEffect(() => {
    if (accentPc === undefined || accentFi === undefined || serifDisplay === undefined || motionPreference === undefined) return;
    useUi.getState().setAppearance(appearanceFromSettings({ accentPc, accentFi, serifDisplay, motionPreference }));
  }, [accentPc, accentFi, serifDisplay, motionPreference]);
}

export function useAppearance(): void {
  useSavedAppearance();
  const reduced = useReducedMotion();
  const serif = useUi((s) => s.appearance.serif);
  const accent = useUi((s) => s.appearance.accent);

  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
  }, [reduced]);

  useEffect(() => {
    const root = document.documentElement;
    if (serif) delete root.dataset.serif;
    else root.dataset.serif = 'off';
  }, [serif]);

  useEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);
}
