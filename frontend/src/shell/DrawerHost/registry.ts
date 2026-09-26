/**
 * What the drawer shows. The check-in screen owns the content; the shell only owns the frame.
 *
 * Content is found in one of two ways:
 * 1. By convention: `src/screens/checkin/index.tsx` default-exporting a component that takes
 *    `DrawerContentProps`. It is loaded lazily when that file exists.
 * 2. Explicitly: `registerDrawerContent(Component)`, which wins over the convention.
 */

import { lazy, useSyncExternalStore } from 'react';
import type { ComponentType } from 'react';

import type { DrawerPrefill } from '../../stores/overlays';

export interface DrawerContentProps {
  open: boolean;
  /** Bumped on every open: reset the composer when it changes. */
  session: number;
  /** Focus project, or null for "About anything". */
  projectId: string | null;
  /** From the palette's quick add (`{scopeH}`) or Notes (`{text}`). */
  prefill: DrawerPrefill | null;
  /** Closes the drawer (keeps projectId, session and prefill). */
  onClose: () => void;
}

export type DrawerContent = ComponentType<DrawerContentProps>;

function NoContent() {
  return null;
}

const discovered = import.meta.glob<{ default?: DrawerContent }>('../../screens/checkin/index.tsx');
const loadDiscovered = discovered['../../screens/checkin/index.tsx'];

/** The conventional check-in content, when it exists. */
const DiscoveredContent: DrawerContent | null = loadDiscovered
  ? lazy(async () => {
      const mod = await loadDiscovered();
      return { default: mod.default ?? NoContent };
    })
  : null;

let registered: DrawerContent | null = null;
const listeners = new Set<() => void>();

/** Registers the drawer's content component. Returns an unregister function. */
export function registerDrawerContent(content: DrawerContent): () => void {
  registered = content;
  listeners.forEach((l) => {
    l();
  });
  return () => {
    if (registered !== content) return;
    registered = null;
    listeners.forEach((l) => {
      l();
    });
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): DrawerContent | null {
  return registered ?? DiscoveredContent;
}

export function useDrawerContent(): DrawerContent | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
