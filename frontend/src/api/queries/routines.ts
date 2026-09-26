/**
 * Routine and rotation reads outside the plan bundle: `GET /routines`, `GET /routines/{id}`,
 * `GET /routines/{id}/occurrences` and `GET /rotation`. Screens normally read these from the
 * plan (`useRoutines`, `useRoutine`, `useRotation` in ./plan).
 */

import { queryOptions, useQuery } from '@tanstack/react-query';

import { api, retryApi, unwrap } from '../client';
import type { RemiApiError } from '../client';
import { compact, keys } from '../keys';
import type { OccurrenceParams } from '../keys';
import type { OccurrenceOut, RotationOut, RoutineOut } from '../types';

export function routinesListQuery() {
  return queryOptions<RoutineOut[], RemiApiError>({
    queryKey: keys.routines.list,
    queryFn: ({ signal }) => unwrap(api.GET('/routines', { signal })),
    retry: retryApi,
  });
}

export function useRoutinesQuery() {
  return useQuery(routinesListQuery());
}

export function routineQuery(routineId: string) {
  return queryOptions<RoutineOut, RemiApiError>({
    queryKey: keys.routines.detail(routineId),
    queryFn: ({ signal }) => unwrap(api.GET('/routines/{routineId}', { params: { path: { routineId } }, signal })),
    retry: retryApi,
  });
}

export function useRoutineQuery(routineId: string | null | undefined) {
  return useQuery({ ...routineQuery(routineId ?? ''), enabled: Boolean(routineId) });
}

export function occurrencesQuery(routineId: string, params?: OccurrenceParams) {
  return queryOptions<OccurrenceOut[], RemiApiError>({
    queryKey: keys.routines.occurrences(routineId, params),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/routines/{routineId}/occurrences', {
          params: { path: { routineId }, query: compact(params) },
          signal,
        }),
      ),
    retry: retryApi,
  });
}

/** Occurrences in a range (`from`/`to`), or the next few after a date (`after`/`limit`). */
export function useRoutineOccurrences(routineId: string | null | undefined, params?: OccurrenceParams) {
  return useQuery({ ...occurrencesQuery(routineId ?? '', params), enabled: Boolean(routineId) });
}

export function rotationQuery() {
  return queryOptions<RotationOut, RemiApiError>({
    queryKey: keys.rotation,
    queryFn: ({ signal }) => unwrap(api.GET('/rotation', { signal })),
    retry: retryApi,
  });
}

/** `GET /rotation` (Settings' rotation editor). Screens use `useRotation()` from the plan. */
export function useRotationQuery() {
  return useQuery(rotationQuery());
}
