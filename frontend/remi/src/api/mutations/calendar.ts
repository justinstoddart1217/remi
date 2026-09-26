/**
 * Holidays (Settings) and leave (data only). A holiday shifts business days, so every read
 * model can change: everything is invalidated.
 */

import { api, unwrap } from '../client';
import type { Schemas } from '../client';
import type { WithDefaults } from '../types';
import { usePlanMutation } from './core';

/** `POST /holidays`: add a manual holiday. */
export function useCreateHoliday() {
  return usePlanMutation({
    mutationFn: (body: Schemas['HolidayCreate']) => unwrap(api.POST('/holidays', { body })),
    invalidate: 'all',
  });
}

/** `DELETE /holidays/{iso}`: generated holidays are suppressed, manual ones deleted. */
export function useDeleteHoliday() {
  return usePlanMutation({
    mutationFn: ({ iso }: { iso: string }) => unwrap(api.DELETE('/holidays/{iso}', { params: { path: { iso } } })),
    invalidate: 'all',
  });
}

/** `PUT /leave/{iso}` (data only). */
export function usePutLeave() {
  return usePlanMutation({
    mutationFn: ({ iso, body }: { iso: string; body: WithDefaults<Schemas['LeavePut'], 'note'> }) =>
      unwrap(api.PUT('/leave/{iso}', { params: { path: { iso } }, body: { ...body, note: body.note ?? '' } })),
    invalidate: 'all',
  });
}

/** `DELETE /leave/{iso}` (data only). */
export function useDeleteLeave() {
  return usePlanMutation({
    mutationFn: ({ iso }: { iso: string }) => unwrap(api.DELETE('/leave/{iso}', { params: { path: { iso } } })),
    invalidate: 'all',
  });
}
