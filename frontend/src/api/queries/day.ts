/**
 * Parameterised read models: `GET /day/{iso}` (Today, the Calendar day panel),
 * `GET /month-snapshot` (Today) and `GET /home` (the launcher; works before setup).
 */

import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';

import { api, retryApi, unwrap } from '../client';
import type { RemiApiError } from '../client';
import { keys } from '../keys';
import type { DayOut, HomeOut, MonthSnapshotOut } from '../types';

/** One day's plan: BAU rows with the checklist run, focus blocks, next milestone and run. */
export function dayQuery(iso: string) {
  return queryOptions<DayOut, RemiApiError>({
    queryKey: keys.day.detail(iso),
    queryFn: ({ signal }) => unwrap(api.GET('/day/{iso}', { params: { path: { iso } }, signal })),
    structuralSharing: true,
    retry: retryApi,
  });
}

/**
 * `GET /day/{iso}`. Pass null to wait (e.g. until the route's day is known). The previous day
 * stays on screen while the next one loads, so the day slide never flashes empty.
 */
export function useDay(iso: string | null | undefined) {
  return useQuery({
    ...dayQuery(iso ?? ''),
    enabled: iso != null && iso !== '',
    placeholderData: keepPreviousData,
  });
}

/** Month snapshot: BAU runs, tasks and milestones due. `month` is `YYYY-MM`; null = today's. */
export function monthSnapshotQuery(month?: string | null) {
  return queryOptions<MonthSnapshotOut, RemiApiError>({
    queryKey: keys.monthSnapshot.detail(month),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/month-snapshot', { params: { query: month ? { month } : {} }, signal })),
    structuralSharing: true,
    retry: retryApi,
  });
}

export function useMonthSnapshot(month?: string | null) {
  return useQuery(monthSnapshotQuery(month));
}

/** The launcher page (today, BD, countdown, counts, key project, textbook counts). */
export function homeQuery() {
  return queryOptions<HomeOut, RemiApiError>({
    queryKey: keys.home,
    queryFn: ({ signal }) => unwrap(api.GET('/home', { signal })),
    structuralSharing: true,
    retry: retryApi,
  });
}

export function useHome() {
  return useQuery(homeQuery());
}
