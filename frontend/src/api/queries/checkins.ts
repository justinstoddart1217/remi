/**
 * The check-in review preview: `POST /checkins/preview` with the ticked changes. The server
 * runs the same `plan_project_changes` as apply, so preview == apply. Toggling a row waits
 * 150ms for the ticks to settle, and the previous effect chips stay while the next loads.
 */

import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api, retryApi, unwrap } from '../client';
import type { RemiApiError } from '../client';
import { keys } from '../keys';
import type { CheckinChange, PreviewOut } from '../types';
import { PREVIEW_DEBOUNCE_MS, useDebouncedValue } from '../useDebouncedValue';

const NO_EFFECT: PreviewOut = { projects: [] };

/**
 * The forecast effect of `changes` (null while not reviewing). Nothing ticked is no effect and
 * sends nothing.
 */
export function useCheckinPreview(changes: readonly CheckinChange[] | null, options: { enabled?: boolean } = {}) {
  const settled = useDebouncedValue(changes, PREVIEW_DEBOUNCE_MS);
  return useQuery<PreviewOut, RemiApiError>({
    queryKey: keys.checkins.preview(settled ?? []),
    queryFn: ({ signal }) =>
      settled === null || settled.length === 0
        ? Promise.resolve(NO_EFFECT)
        : unwrap(api.POST('/checkins/preview', { body: { changes: [...settled] }, signal })),
    enabled: (options.enabled ?? true) && settled !== null,
    placeholderData: keepPreviousData,
    staleTime: 0,
    retry: retryApi,
  });
}
