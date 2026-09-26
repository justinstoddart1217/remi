/** The Fixed Income rotation (Settings' rotation editor, setup step 3). */

import { api, unwrap } from '../client';
import type { Schemas } from '../client';
import { PLAN_READS, usePlanMutation } from './core';

/** `PATCH /rotation`: title, hours a day or start. */
export function useUpdateRotation() {
  return usePlanMutation({
    mutationFn: (patch: Schemas['RotationPatch']) => unwrap(api.PATCH('/rotation', { body: patch })),
    invalidate: PLAN_READS,
  });
}

/** `PUT /rotation/segments`: replace the ordered segment list. */
export function usePutRotationSegments() {
  return usePlanMutation({
    mutationFn: (segments: Schemas['RotationSegmentsPut']['segments']) =>
      unwrap(api.PUT('/rotation/segments', { body: { segments } })),
    invalidate: PLAN_READS,
  });
}
