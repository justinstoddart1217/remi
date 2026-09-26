/** Charter lists (Workspace): append, reorder, edit and remove items. */

import { api, unwrap } from '../client';
import type { Schemas } from '../client';
import type { CharterList } from '../types';
import { PROJECT_TEXT_READS, usePlanMutation } from './core';

/** `POST /projects/{id}/charter/{list}`: append an item. */
export function useCreateCharterItem() {
  return usePlanMutation({
    mutationFn: ({ projectId, list, text }: { projectId: string; list: CharterList; text?: string }) =>
      unwrap(
        api.POST('/projects/{projectId}/charter/{list}', {
          params: { path: { projectId, list } },
          body: { text: text ?? '' },
        }),
      ),
    invalidate: PROJECT_TEXT_READS,
  });
}

/** `PUT /projects/{id}/charter/{list}/order`: the list's item ids in their new order. */
export function useReorderCharterItems() {
  return usePlanMutation({
    mutationFn: ({ projectId, list, ids }: { projectId: string; list: CharterList; ids: string[] }) =>
      unwrap(
        api.PUT('/projects/{projectId}/charter/{list}/order', {
          params: { path: { projectId, list } },
          body: { ids },
        }),
      ),
    invalidate: PROJECT_TEXT_READS,
  });
}

/** `PATCH /charter-items/{id}`: edit an item's text. */
export function useUpdateCharterItem() {
  return usePlanMutation({
    mutationFn: ({ itemId, patch }: { itemId: string; patch: Schemas['CharterItemPatch'] }) =>
      unwrap(api.PATCH('/charter-items/{itemId}', { params: { path: { itemId } }, body: patch })),
    invalidate: PROJECT_TEXT_READS,
  });
}

/** `DELETE /charter-items/{id}`. */
export function useDeleteCharterItem() {
  return usePlanMutation({
    mutationFn: ({ itemId }: { itemId: string }) =>
      unwrap(api.DELETE('/charter-items/{itemId}', { params: { path: { itemId } } })),
    invalidate: PROJECT_TEXT_READS,
  });
}
