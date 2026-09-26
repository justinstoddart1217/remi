/** FI onboarding readiness items (Transition's inline list). */

import { api, unwrap } from '../client';
import type { Schemas } from '../client';
import type { WithDefaults } from '../types';
import { PROJECT_TEXT_READS, usePlanMutation } from './core';

/** `POST /projects/{id}/readiness-items`. */
export function useCreateReadinessItem() {
  return usePlanMutation({
    mutationFn: ({ projectId, body }: { projectId: string; body: WithDefaults<Schemas['ReadinessItemCreate'], 'text'> }) =>
      unwrap(
        api.POST('/projects/{projectId}/readiness-items', {
          params: { path: { projectId } },
          body: { ...body, text: body.text ?? '' },
        }),
      ),
    invalidate: PROJECT_TEXT_READS,
  });
}

/** `PUT /projects/{id}/readiness-items/order`. */
export function useReorderReadinessItems() {
  return usePlanMutation({
    mutationFn: ({ projectId, ids }: { projectId: string; ids: string[] }) =>
      unwrap(api.PUT('/projects/{projectId}/readiness-items/order', { params: { path: { projectId } }, body: { ids } })),
    invalidate: PROJECT_TEXT_READS,
  });
}

/** `PATCH /readiness-items/{id}`: edit, tick or re-date. */
export function useUpdateReadinessItem() {
  return usePlanMutation({
    mutationFn: ({ itemId, patch }: { itemId: string; patch: Schemas['ReadinessItemPatch'] }) =>
      unwrap(api.PATCH('/readiness-items/{itemId}', { params: { path: { itemId } }, body: patch })),
    invalidate: PROJECT_TEXT_READS,
  });
}

/** `DELETE /readiness-items/{id}`. */
export function useDeleteReadinessItem() {
  return usePlanMutation({
    mutationFn: ({ itemId }: { itemId: string }) =>
      unwrap(api.DELETE('/readiness-items/{itemId}', { params: { path: { itemId } } })),
    invalidate: PROJECT_TEXT_READS,
  });
}
