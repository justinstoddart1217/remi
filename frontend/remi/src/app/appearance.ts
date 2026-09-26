/**
 * The saved appearance (`GET /settings`: accent pair, serif, motion) as the ui store's
 * `Appearance`. Kept here, at the app root, so hydrating :root never pulls the Settings screen
 * into the first chunk.
 *
 * The accent pairs are the redesign's `accents` tweak options (Remi.dc.html, section "Brand"),
 * in its order, with the names the Settings picker reads out. The ids are the
 * `:root[data-accent]` values in styles/derived.css; the first pair is tokens.css's own, so the
 * first render already matches the design. The hex values keep the design's upper case, which
 * is also what the backend stores by default (`DEFAULT_ACCENT_PC/FI`).
 */

import type { SettingsOut } from '../api/types';
import type { AccentId, Appearance } from '../stores/ui';

export type { AccentId };

export interface AccentPair {
  id: AccentId;
  /** `--pc-accent`. */
  pc: string;
  /** `--fi-accent`. */
  fi: string;
  /** What the picker reads out. */
  name: string;
}

export const ACCENT_PAIRS: readonly [AccentPair, ...AccentPair[]] = [
  { id: 'teal', pc: '#009D80', fi: '#2F6B9A', name: 'Teal and blue' },
  { id: 'deep', pc: '#026E62', fi: '#5B7FA8', name: 'Deep teal and slate' },
  { id: 'mint', pc: '#34C1A3', fi: '#1F4E79', name: 'Mint and navy' },
];

/** The default pair: tokens.css's own accents and the backend's `DEFAULT_ACCENT_PC/FI`. */
export const DEFAULT_ACCENT_PAIR: AccentPair = ACCENT_PAIRS[0];

/**
 * The pair a stored hex pair names (case-insensitive): the pair, else the PC accent alone, else
 * the default. A pair saved before the redesign (the olive and indigo stand-ins) reads as the
 * default; migration 0004 also rewrites those rows.
 */
export function accentIdFor(pc: string | null | undefined, fi: string | null | undefined): AccentId {
  const p = (pc ?? '').toLowerCase();
  const f = (fi ?? '').toLowerCase();
  const match =
    ACCENT_PAIRS.find((a) => a.pc.toLowerCase() === p && a.fi.toLowerCase() === f) ??
    ACCENT_PAIRS.find((a) => a.pc.toLowerCase() === p);
  return match?.id ?? DEFAULT_ACCENT_PAIR.id;
}

/** The pair with this id; the default pair for an unknown one. */
export function accentById(id: AccentId): AccentPair {
  return ACCENT_PAIRS.find((a) => a.id === id) ?? DEFAULT_ACCENT_PAIR;
}

/** The pair a stored hex pair names (see `accentIdFor`). */
export function accentFor(pc: string | null | undefined, fi: string | null | undefined): AccentPair {
  return accentById(accentIdFor(pc, fi));
}

export type AppearanceSettings = Pick<SettingsOut, 'accentPc' | 'accentFi' | 'serifDisplay' | 'motionPreference'>;

const MOTIONS: readonly string[] = ['system', 'full', 'reduced'];

/** True for a settings answer that carries the appearance fields (guards a stubbed or odd reply). */
export function hasAppearance(value: unknown): value is AppearanceSettings {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.accentPc === 'string' &&
    typeof v.accentFi === 'string' &&
    typeof v.serifDisplay === 'boolean' &&
    typeof v.motionPreference === 'string' &&
    MOTIONS.includes(v.motionPreference)
  );
}

export function appearanceFromSettings(settings: AppearanceSettings): Appearance {
  return {
    accent: accentIdFor(settings.accentPc, settings.accentFi),
    serif: settings.serifDisplay,
    motion: settings.motionPreference,
  };
}
