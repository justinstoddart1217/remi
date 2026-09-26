/**
 * Routines (Routines screen), their runs and checklist ticks (Today), and routine checklist
 * items (the inline list on the Routines row).
 */

import { api, unwrap } from '../client';
import type { Schemas } from '../client';
import { keys } from '../keys';
import { NAMED_ENTITY_READS, RUN_READS, usePlanMutation } from './core';

/** `POST /routines`: monthly, BD5, 1h, Manual, blank name. `entity` is the new routine. */
export function useCreateRoutine() {
  return usePlanMutation({
    mutationFn: ({ domain = 'pc', name = '' }: Partial<Schemas['RoutineCreate']> = {}) =>
      unwrap(api.POST('/routines', { body: { domain, name } })),
    invalidate: NAMED_ENTITY_READS,
  });
}

/** `PATCH /routines/{id}`: name, rule, hours, handover stage, notes. */
export function useUpdateRoutine() {
  return usePlanMutation({
    mutationFn: ({ routineId, patch }: { routineId: string; patch: Schemas['RoutinePatch'] }) =>
      unwrap(api.PATCH('/routines/{routineId}', { params: { path: { routineId } }, body: patch })),
    invalidate: NAMED_ENTITY_READS,
  });
}

/** `DELETE /routines/{id}`. The routine's own reads are removed rather than refetched (404). */
export function useDeleteRoutine() {
  return usePlanMutation({
    mutationFn: ({ routineId }: { routineId: string }) =>
      unwrap(api.DELETE('/routines/{routineId}', { params: { path: { routineId } } })),
    invalidate: NAMED_ENTITY_READS,
    remove: ({ routineId }) => [keys.routines.detail(routineId), ['routines', 'occurrences', routineId]],
  });
}

export interface RunRef {
  routineId: string;
  /** The occurrence date. */
  iso: string;
}

/** `PUT /routines/{id}/runs/{iso}`: mark one occurrence complete or not. */
export function usePutRoutineRun() {
  return usePlanMutation({
    mutationFn: ({ routineId, iso, completed }: RunRef & { completed: boolean }) =>
      unwrap(api.PUT('/routines/{routineId}/runs/{iso}', { params: { path: { routineId, iso } }, body: { completed } })),
    invalidate: RUN_READS,
  });
}

/** `PUT /routines/{id}/runs/{iso}/items`: tick or untick every checklist item of one run. */
export function usePutRunTicks() {
  return usePlanMutation({
    mutationFn: ({ routineId, iso, done }: RunRef & { done: boolean }) =>
      unwrap(api.PUT('/routines/{routineId}/runs/{iso}/items', { params: { path: { routineId, iso } }, body: { done } })),
    invalidate: RUN_READS,
  });
}

/** `PUT /routines/{id}/runs/{iso}/items/{itemId}`: tick or untick one item (today's run only). */
export function usePutRunTick() {
  return usePlanMutation({
    mutationFn: ({ routineId, iso, itemId, done }: RunRef & { itemId: string; done: boolean }) =>
      unwrap(
        api.PUT('/routines/{routineId}/runs/{iso}/items/{itemId}', {
          params: { path: { routineId, iso, itemId } },
          body: { done },
        }),
      ),
    invalidate: RUN_READS,
  });
}

/** `POST /routines/{id}/checklist-items`. */
export function useCreateRoutineChecklistItem() {
  return usePlanMutation({
    mutationFn: ({ routineId, label }: { routineId: string; label?: string }) =>
      unwrap(
        api.POST('/routines/{routineId}/checklist-items', {
          params: { path: { routineId } },
          body: { label: label ?? '' },
        }),
      ),
    invalidate: RUN_READS,
  });
}

/** `PUT /routines/{id}/checklist-items/order`. */
export function useReorderRoutineChecklistItems() {
  return usePlanMutation({
    mutationFn: ({ routineId, ids }: { routineId: string; ids: string[] }) =>
      unwrap(api.PUT('/routines/{routineId}/checklist-items/order', { params: { path: { routineId } }, body: { ids } })),
    invalidate: RUN_READS,
  });
}

/** `PATCH /routine-checklist-items/{id}`: rename. */
export function useUpdateRoutineChecklistItem() {
  return usePlanMutation({
    mutationFn: ({ itemId, label }: { itemId: string; label: string }) =>
      unwrap(api.PATCH('/routine-checklist-items/{itemId}', { params: { path: { itemId } }, body: { label } })),
    invalidate: RUN_READS,
  });
}

/** `DELETE /routine-checklist-items/{id}` (and its ticks). */
export function useDeleteRoutineChecklistItem() {
  return usePlanMutation({
    mutationFn: ({ itemId }: { itemId: string }) =>
      unwrap(api.DELETE('/routine-checklist-items/{itemId}', { params: { path: { itemId } } })),
    invalidate: RUN_READS,
  });
}
