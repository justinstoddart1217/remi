/**
 * Ticks answer at once, as in the prototype (its model flipped a boolean in place). The server
 * stays the source of truth: an overlay holds the ticked value from the click until every read
 * the mutation invalidates (the day and the month snapshot) has been fetched again, then it
 * drops out. A failed mutation reverts at once.
 *
 * Reads are tracked by fetch counts (TanStack's `dataUpdateCount`), not timestamps, so the
 * overlay behaves the same under a pinned clock (tests, parity).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface OverlayEntry {
  value: boolean;
  /** The reads' fetch counts when the mutation succeeded, or null while it is in flight. */
  settledAt: readonly number[] | null;
}

export type Overlay = Readonly<Record<string, OverlayEntry>>;

/** A settled entry drops out after this long even if no refetch arrives. */
export const OVERLAY_MAX_MS = 4000;

/** Pure: whether an entry still decides what is shown, given the reads' fetch counts now. */
export function isLive(entry: OverlayEntry | undefined, versions: readonly number[]): entry is OverlayEntry {
  if (!entry) return false;
  const at = entry.settledAt;
  if (at === null) return true;
  return !versions.every((v, i) => v > (at[i] ?? Number.POSITIVE_INFINITY));
}

export interface OptimisticDone {
  /** The shown value for `key`: the overlay while one is live, else the server's. */
  get: (key: string, server: boolean) => boolean;
  /** Shows each key's value at once and runs `action`; on failure the keys revert. */
  run: (values: Readonly<Record<string, boolean>>, action: () => Promise<unknown>) => void;
}

/** Pure: `o` without the entries that still hold the given values. */
export function withoutValues(o: Overlay, values: Readonly<Record<string, boolean>>): Overlay {
  const kept = Object.entries(o).filter(([k, entry]) => values[k] === undefined || values[k] !== entry.value);
  return kept.length === Object.keys(o).length ? o : Object.fromEntries(kept);
}

/**
 * `versions`: the fetch count of each read the ticks live in. `onError` runs when a mutation
 * fails (the keys have reverted by then).
 */
export function useOptimisticDone(versions: readonly number[], onError: (error: unknown) => void): OptimisticDone {
  const [overlay, setOverlay] = useState<Overlay>({});
  const versionsRef = useRef(versions);
  const onErrorRef = useRef(onError);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    versionsRef.current = versions;
    onErrorRef.current = onError;
  });
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const versionKey = versions.join(',');
  const get = useCallback(
    (key: string, server: boolean) => {
      const entry = overlay[key];
      return isLive(entry, versionKey.split(',').map(Number)) ? entry.value : server;
    },
    [overlay, versionKey],
  );

  const run = useCallback((values: Readonly<Record<string, boolean>>, action: () => Promise<unknown>) => {
    setOverlay((o) => {
      const next: Record<string, OverlayEntry> = { ...o };
      for (const [k, value] of Object.entries(values)) next[k] = { value, settledAt: null };
      return next;
    });
    action().then(
      () => {
        const at = [...versionsRef.current];
        setOverlay((o) => {
          const next: Record<string, OverlayEntry> = { ...o };
          for (const [k, value] of Object.entries(values)) {
            if (next[k]?.value === value && next[k].settledAt === null) next[k] = { value, settledAt: at };
          }
          return next;
        });
        const id = setTimeout(() => {
          timers.current.delete(id);
          setOverlay((o) => withoutValues(o, values));
        }, OVERLAY_MAX_MS);
        timers.current.add(id);
      },
      (error: unknown) => {
        setOverlay((o) => withoutValues(o, values));
        onErrorRef.current(error);
      },
    );
  }, []);

  return { get, run };
}
