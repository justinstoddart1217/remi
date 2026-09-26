/**
 * Calendar-range reads for dates outside the plan window: `GET /calendar`, `GET /loads`,
 * `GET /holidays` and `GET /leave` (data only).
 */

import { queryOptions, useQuery } from '@tanstack/react-query';

import { api, retryApi, unwrap } from '../client';
import type { RemiApiError } from '../client';
import { compact, keys } from '../keys';
import type { CalendarParams, RangeParams } from '../keys';
import type { CalendarOut, HolidayOut, LeaveDayOut, LoadsOut } from '../types';

/** Calendar days for any range; holidays are extended on demand. */
export function calendarRangeQuery(params?: CalendarParams) {
  return queryOptions<CalendarOut, RemiApiError>({
    queryKey: keys.calendar.range(params),
    queryFn: ({ signal }) => unwrap(api.GET('/calendar', { params: { query: compact(params) }, signal })),
    staleTime: 5 * 60_000,
    retry: retryApi,
  });
}

export function useCalendarRange(params?: CalendarParams, options: { enabled?: boolean } = {}) {
  return useQuery({ ...calendarRangeQuery(params), enabled: options.enabled ?? true });
}

/** Business-day loads for any range (months outside the plan window). */
export function loadsRangeQuery(params?: RangeParams) {
  return queryOptions<LoadsOut, RemiApiError>({
    queryKey: keys.loads.range(params),
    queryFn: ({ signal }) => unwrap(api.GET('/loads', { params: { query: compact(params) }, signal })),
    retry: retryApi,
  });
}

export function useLoadsRange(params?: RangeParams, options: { enabled?: boolean } = {}) {
  return useQuery({ ...loadsRangeQuery(params), enabled: options.enabled ?? true });
}

/** Holidays in the current region, including suppressed ones (Settings). */
export function holidaysQuery(params?: RangeParams) {
  return queryOptions<HolidayOut[], RemiApiError>({
    queryKey: keys.holidays.range(params),
    queryFn: ({ signal }) => unwrap(api.GET('/holidays', { params: { query: compact(params) }, signal })),
    retry: retryApi,
  });
}

export function useHolidays(params?: RangeParams) {
  return useQuery(holidaysQuery(params));
}

/** Personal leave days (data only, decision 8). */
export function leaveQuery(params?: RangeParams) {
  return queryOptions<LeaveDayOut[], RemiApiError>({
    queryKey: keys.leave.range(params),
    queryFn: ({ signal }) => unwrap(api.GET('/leave', { params: { query: compact(params) }, signal })),
    retry: retryApi,
  });
}

export function useLeave(params?: RangeParams) {
  return useQuery(leaveQuery(params));
}
