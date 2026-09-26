/**
 * The palette's provider registry.
 *
 * Providers come from two places:
 * 1. By convention: any `src/screens/<name>/palette.ts` that exports
 *    `paletteProviders: PaletteProvider[]` is picked up at startup (so screens can add rows
 *    without touching the shell);
 * 2. Explicitly: `registerPaletteProvider(provider)`.
 * A provider registered with an existing id replaces it (the built-in 'jump-to' can be
 * overridden this way).
 */

import { useSyncExternalStore } from 'react';

import { jumpToProvider } from './builtins';
import type { PaletteProvider } from './types';

const providers = new Map<string, PaletteProvider>();
let snapshot: readonly PaletteProvider[] = [];
const listeners = new Set<() => void>();

function publish(): void {
  snapshot = [...providers.values()].sort((a, b) => a.order - b.order);
  listeners.forEach((l) => {
    l();
  });
}

/** Adds or replaces a provider. Returns an unregister function. */
export function registerPaletteProvider(provider: PaletteProvider): () => void {
  providers.set(provider.id, provider);
  publish();
  return () => {
    if (providers.get(provider.id) === provider) {
      providers.delete(provider.id);
      publish();
    }
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): readonly PaletteProvider[] {
  return snapshot;
}

export function usePaletteProviders(): readonly PaletteProvider[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Built-ins, then anything the screens contribute by convention.
registerPaletteProvider(jumpToProvider);

const contributed = import.meta.glob<{ paletteProviders?: readonly PaletteProvider[] }>('../../screens/*/palette.{ts,tsx}', {
  eager: true,
});
for (const mod of Object.values(contributed)) {
  for (const provider of mod.paletteProviders ?? []) registerPaletteProvider(provider);
}
