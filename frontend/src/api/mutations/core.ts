/**
 * How a mutation's answer reaches the screen (docs/api.md, "Mutations return the plan").
 *
 * Every plan mutation answers `{plan, movements, entity?}`. On success, in this order:
 * 1. `cancelQueries(plan)`, so an in-flight refetch cannot overwrite the new plan;
 * 2. one `setQueryData(plan)`: the whole derived bundle lands in a single commit, and
 *    structural sharing keeps untouched subtrees, so only the affected bars glide;
 * 3. `planMoves.start(movements)`: the ghost-bar flash (1100ms) and moved chip (5200ms);
 * 4. remove the reads of an entity the mutation deleted (its snapshots, its detail), so the
 *    invalidation below cannot refetch them while their screen is still mounted (a 404);
 * 5. invalidate the read models the plan does not carry (day, month snapshot, home, notes …).
 *
 * On failure, a write the server refuses because this tab is out of date (the entity was
 * deleted or changed elsewhere: 404, 409, 412) refetches everything on screen, so the view
 * catches up at once instead of offering a retry that can only fail again. The screen's toast
 * can say so with `staleWriteMessage`.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient, QueryKey, UseMutationResult } from '@tanstack/react-query';

import { usePlanMoves } from '../../stores/planMoves';
import { RemiApiError } from '../client';
import { keys } from '../keys';
import type { PlanMutationOut, PlanOut } from '../types';

/** Query keys to invalidate after a mutation, or `'all'` for every query except the plan. */
export type Invalidation = readonly QueryKey[] | 'all';

/** The read models that are derived from the plan state but served separately. */
export const PLAN_READS: readonly QueryKey[] = [
  keys.day.all,
  keys.monthSnapshot.all,
  keys.home,
  keys.loads.all,
  keys.projects.all,
  keys.routines.all,
  keys.rotation,
  keys.checkins.all,
  keys.feed.all,
  keys.events.all,
];

/** Charter and readiness lists: text only, no forecast. */
export const PROJECT_TEXT_READS: readonly QueryKey[] = [keys.projects.all, keys.feed.all, keys.events.all];

/** Checklist ticks and run completion: the day's rows, the month snapshot and routines. */
export const RUN_READS: readonly QueryKey[] = [
  keys.day.all,
  keys.monthSnapshot.all,
  keys.routines.all,
  keys.feed.all,
  keys.events.all,
];

/** Notes change counts on Home and the notes reads themselves. */
export const NOTE_READS: readonly QueryKey[] = [keys.notes.all, keys.home, keys.feed.all, keys.events.all];

/**
 * Creating, renaming or deleting a project or routine. Note tags and mentions are resolved
 * from project and routine names and aliases when notes are read (schemas/note.py), so every
 * notes read (a day's notes, recent notes, the composer's tag preview) is stale too, and a
 * deleted entity takes its aliases with it.
 */
export const NAMED_ENTITY_READS: readonly QueryKey[] = [...PLAN_READS, keys.notes.all, keys.aliases];

/** A check-in touches projects, routines, runs, notes and snapshots at once. */
export const CHECKIN_READS: readonly QueryKey[] = NAMED_ENTITY_READS;

/** Invalidates `what`; never waits for the refetches. */
export function invalidate(queryClient: QueryClient, what: Invalidation | undefined): void {
  if (what === undefined) return;
  if (what === 'all') {
    void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== keys.plan[0] });
    return;
  }
  for (const queryKey of what) void queryClient.invalidateQueries({ queryKey });
}

export interface CommitOptions {
  invalidate?: Invalidation;
  /**
   * Queries to drop from the cache before invalidating (each key and everything under it):
   * the reads of a deleted entity. A screen that still observes one unmounts on the next
   * render, when the new plan no longer has the entity; it must not refetch before that.
   */
  remove?: readonly QueryKey[];
  /**
   * Write the plan even when its revision is older than the cached one (a fixture reset or
   * setup may restart revisions). Otherwise an out-of-order answer never rolls the plan back.
   */
  force?: boolean;
}

/** Applies a `MutationOut` to the cache and starts the plan-moves choreography. */
export async function commitPlanMutation(
  queryClient: QueryClient,
  out: PlanMutationOut,
  options: CommitOptions = {},
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: keys.plan, exact: true });
  const cached = queryClient.getQueryData<PlanOut>(keys.plan);
  if (options.force === true || cached === undefined || out.plan.revision >= cached.revision) {
    queryClient.setQueryData<PlanOut>(keys.plan, out.plan);
  }
  if (out.movements.length > 0) usePlanMoves.getState().start(out.movements);
  for (const queryKey of options.remove ?? []) queryClient.removeQueries({ queryKey });
  invalidate(queryClient, options.invalidate);
}

// ------------------------------------------------------------------------------ stale writes

/** Statuses that mean this tab's copy is out of date: gone (404) or changed elsewhere (409, 412). */
const STALE_WRITE_STATUSES: ReadonlySet<number> = new Set([404, 409, 412]);

/** Toast copy for a write refused because the thing is gone or changed elsewhere. */
export const STALE_WRITE_MESSAGE = 'That was changed in another tab. Showing the latest.';

/** True when a failed write means the tab is stale (see STALE_WRITE_STATUSES). */
export function isStaleWrite(error: unknown): error is RemiApiError {
  return error instanceof RemiApiError && STALE_WRITE_STATUSES.has(error.status);
}

/**
 * The toast for a failed write when the thing no longer exists or changed under this tab
 * (404 `NOT_FOUND`, 412, 409 `VERSION_CONFLICT`), else null. Other 409s are refused values
 * whose server message says more ("Ticking opens on the day of the run").
 */
export function staleWriteMessage(error: unknown): string | null {
  if (!isStaleWrite(error)) return null;
  return error.status === 409 && error.code !== 'VERSION_CONFLICT' ? null : STALE_WRITE_MESSAGE;
}

/**
 * After a stale write, refetches the plan and every read on screen (inactive ones refetch when
 * next shown). Returns whether it did. Never waits.
 */
export function refreshAfterStaleWrite(queryClient: QueryClient, error: unknown): boolean {
  if (!isStaleWrite(error)) return false;
  void queryClient.invalidateQueries();
  return true;
}

export interface PlanMutationConfig<TVars, TOut extends PlanMutationOut> {
  mutationFn: (vars: TVars) => Promise<TOut>;
  invalidate?: Invalidation | ((vars: TVars, out: TOut) => Invalidation);
  /** The reads of an entity the mutation deletes (see CommitOptions.remove). */
  remove?: (vars: TVars, out: TOut) => readonly QueryKey[];
  force?: boolean;
  /** Extra cache writes after the commit (e.g. the settings entity). */
  after?: (queryClient: QueryClient, out: TOut, vars: TVars) => void;
}

/**
 * A mutation whose answer carries the plan: commits it as described above. A stale write
 * (404, 409, 412) refetches the plan and the reads on screen.
 */
export function usePlanMutation<TVars, TOut extends PlanMutationOut>(
  config: PlanMutationConfig<TVars, TOut>,
): UseMutationResult<TOut, RemiApiError, TVars> {
  const queryClient = useQueryClient();
  return useMutation<TOut, RemiApiError, TVars>({
    mutationFn: config.mutationFn,
    onSuccess: async (out, vars) => {
      const what = typeof config.invalidate === 'function' ? config.invalidate(vars, out) : config.invalidate;
      await commitPlanMutation(queryClient, out, { invalidate: what, remove: config.remove?.(vars, out), force: config.force });
      config.after?.(queryClient, out, vars);
    },
    onError: (error) => {
      refreshAfterStaleWrite(queryClient, error);
    },
  });
}
