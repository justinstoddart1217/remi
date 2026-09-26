/** Aliases (data only): extra names that tag notes and the simple reading to an entity. */

import { api, unwrap } from '../client';
import type { Schemas } from '../client';
import { keys } from '../keys';
import { usePlanMutation } from './core';

const ALIAS_READS = [keys.aliases, keys.notes.all, keys.feed.all, keys.events.all] as const;

/** `POST /aliases`: add an alias to a project or routine. */
export function useCreateAlias() {
  return usePlanMutation({
    mutationFn: (body: Schemas['AliasCreate']) => unwrap(api.POST('/aliases', { body })),
    invalidate: ALIAS_READS,
  });
}

/** `DELETE /aliases/{id}`. */
export function useDeleteAlias() {
  return usePlanMutation({
    mutationFn: ({ aliasId }: { aliasId: string }) => unwrap(api.DELETE('/aliases/{aliasId}', { params: { path: { aliasId } } })),
    invalidate: ALIAS_READS,
  });
}
