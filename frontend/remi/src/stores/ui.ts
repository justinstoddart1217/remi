/**
 * Client-only UI state that outlives a single screen (the prototype kept all of this in the
 * shell's component state). Server data never lives here: it is in the TanStack Query cache.
 */

import { create } from 'zustand';

import type { ScreenId } from '../app/screens';
import type { MotionSetting } from '../lib/reducedMotion';

/** Ninety One accent pairs (Remi.dc.html `accents` options, app/appearance.ts ACCENT_PAIRS). teal is the default. */
export type AccentId = 'teal' | 'deep' | 'mint';

export interface Appearance {
  motion: MotionSetting;
  /** false: `--font-display` falls back to the UI face (the prototype's `serif` tweak). */
  serif: boolean;
  accent: AccentId;
}

/** Where a screen was last shown: kept so hidden screens hold their params and the rail can return there. */
export interface ScreenLocation {
  pathname: string;
  search: string;
  hash: string;
  params: Readonly<Record<string, string | undefined>>;
  /** react-router's location key: changes on every navigation, even to the same URL. */
  key: string;
}

export type VtPhase = 'from' | 'to' | null;

/** Timeline zoom (Timeline.dc.html: '3m' default, '2w' with week paging). */
export type TimelineZoom = '3m' | '2w';

export interface UiState {
  /** The workspace's project. Updated whenever the route has `:projectId`; kept while hidden. */
  lastWorkspaceId: string | null;
  /** Card → workspace view transition (lib/viewTransition.ts). */
  vtPhase: VtPhase;
  vtId: string | null;
  /** Disables the section cross-fade (during the view transition). */
  instant: boolean;
  zoom: TimelineZoom;
  /** Week offset while zoomed to two weeks. */
  zoomWeek: number;
  appearance: Appearance;
  /** Last location of each app screen (see ScreenLocation). */
  screenLocations: Partial<Record<ScreenId, ScreenLocation>>;
  /** Set by palette and keyboard navigation: ScreenStack focuses the next screen's h1. */
  headingFocusPending: boolean;

  setLastWorkspaceId: (id: string | null) => void;
  setVt: (phase: VtPhase, id?: string | null) => void;
  setInstant: (instant: boolean) => void;
  setZoom: (zoom: TimelineZoom, week?: number) => void;
  setAppearance: (patch: Partial<Appearance>) => void;
  recordScreenLocation: (screen: ScreenId, location: ScreenLocation) => void;
  requestHeadingFocus: () => void;
  /** Returns true (and clears the flag) when a heading focus was pending. */
  takeHeadingFocus: () => boolean;
}

export const DEFAULT_APPEARANCE: Appearance = { motion: 'system', serif: true, accent: 'teal' };

export const useUi = create<UiState>()((set, get) => ({
  lastWorkspaceId: null,
  vtPhase: null,
  vtId: null,
  instant: false,
  zoom: '3m',
  zoomWeek: 0,
  appearance: DEFAULT_APPEARANCE,
  screenLocations: {},
  headingFocusPending: false,

  setLastWorkspaceId: (id) => {
    if (get().lastWorkspaceId !== id) set({ lastWorkspaceId: id });
  },
  setVt: (phase, id) => {
    set(phase === null ? { vtPhase: null, vtId: null } : { vtPhase: phase, vtId: id ?? get().vtId });
  },
  setInstant: (instant) => {
    if (get().instant !== instant) set({ instant });
  },
  setZoom: (zoom, week = 0) => {
    set({ zoom, zoomWeek: zoom === '3m' ? 0 : week });
  },
  setAppearance: (patch) => {
    set({ appearance: { ...get().appearance, ...patch } });
  },
  recordScreenLocation: (screen, location) => {
    const prev = get().screenLocations[screen];
    if (prev?.key === location.key && prev.pathname === location.pathname) return;
    set({ screenLocations: { ...get().screenLocations, [screen]: location } });
  },
  requestHeadingFocus: () => {
    set({ headingFocusPending: true });
  },
  takeHeadingFocus: () => {
    if (!get().headingFocusPending) return false;
    set({ headingFocusPending: false });
    return true;
  },
}));
