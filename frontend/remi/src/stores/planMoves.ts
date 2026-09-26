/**
 * "The plan moves" (arch-frontend-core §5, synthesis.motionSystem §4).
 *
 * After a mutation the server returns `movements[]`. `start(movements)` then, per project:
 * - sets `flash[pid]` for 1100ms when the forecast changed (the ghost bar goes to opacity 1);
 * - sets `moved[pid]` for 5200ms when it moved by at least one business day (the delta chip
 *   and the Workspace "moved" badge).
 * Timers are held per project; a repeat check-in on the same project clears and restarts
 * them. The drawer-close → 220ms → apply sequencing belongs to the check-in flow.
 */

import { create } from 'zustand';

import { deltaBD } from '../lib/format';
import { KeyedTimers } from '../lib/timers';

export const FLASH_MS = 1100;
export const MOVED_MS = 5200;

/**
 * One forecast change: the backend's `Movement` (schemas/mutation.py), field for field.
 * `flash` and `moved` are always sent by the server; they default here for tests.
 */
export interface Movement {
  projectId: string;
  fromForecast: string | null;
  toForecast: string | null;
  deltaBd: number;
  fromTarget?: string | null;
  toTarget?: string | null;
  cause?: string;
  label?: string;
  /** The forecast changed. Defaults to `fromForecast !== toForecast`. */
  flash?: boolean;
  /** It moved by at least one business day. Defaults to `deltaBd !== 0`. */
  moved?: boolean;
}

export interface MovedBadge {
  deltaBd: number;
  /** '+3 BD' / '−2 BD' (U+2212). */
  label: string;
  fromForecast: string | null;
  toForecast: string | null;
  /** Start time (ms); lets consumers key a replay. */
  at: number;
}

interface PlanMovesState {
  flash: Readonly<Record<string, true>>;
  moved: Readonly<Record<string, MovedBadge>>;
  start: (movements: readonly Movement[]) => void;
  /** Clears everything (tests, reset). */
  reset: () => void;
}

const flashTimers = new KeyedTimers();
const movedTimers = new KeyedTimers();

function omit<T>(record: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
  if (!(key in record)) return record;
  const next = { ...record };
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- keyed by project id
  delete next[key];
  return next;
}

export const usePlanMoves = create<PlanMovesState>()((set, get) => ({
  flash: {},
  moved: {},

  start: (movements) => {
    let { flash, moved } = get();
    const now = Date.now();
    for (const m of movements) {
      const pid = m.projectId;
      const shouldFlash = m.flash ?? m.fromForecast !== m.toForecast;
      const shouldMove = m.moved ?? m.deltaBd !== 0;
      flashTimers.clear(pid);
      movedTimers.clear(pid);

      flash = shouldFlash ? { ...flash, [pid]: true } : omit(flash, pid);
      moved = shouldMove
        ? {
            ...moved,
            [pid]: {
              deltaBd: m.deltaBd,
              label: deltaBD(m.deltaBd),
              fromForecast: m.fromForecast,
              toForecast: m.toForecast,
              at: now,
            },
          }
        : omit(moved, pid);

      if (shouldFlash) {
        flashTimers.set(pid, FLASH_MS, () => {
          set({ flash: omit(get().flash, pid) });
        });
      }
      if (shouldMove) {
        movedTimers.set(pid, MOVED_MS, () => {
          set({ moved: omit(get().moved, pid) });
        });
      }
    }
    set({ flash, moved });
  },

  reset: () => {
    flashTimers.clearAll();
    movedTimers.clearAll();
    set({ flash: {}, moved: {} });
  },
}));

/** True while the project's forecast-changed flash is on (1100ms). */
export function useFlash(projectId: string | null | undefined): boolean {
  return usePlanMoves((s) => (projectId ? s.flash[projectId] === true : false));
}

/** The project's moved badge while it shows (5200ms), else null. */
export function useMoved(projectId: string | null | undefined): MovedBadge | null {
  return usePlanMoves((s) => (projectId ? (s.moved[projectId] ?? null) : null));
}
