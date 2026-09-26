/**
 * Data-only reads (decision 8: stored, no UI yet): the activity feed, the event log and the
 * stored aliases. The palette and Notes read aliases from the plan (`usePlanAliases`).
 */

import { queryOptions, useQuery } from '@tanstack/react-query';

import { api, retryApi, unwrap } from '../client';
import type { RemiApiError } from '../client';
import { compact, keys } from '../keys';
import type { EventParams, PageParams } from '../keys';
import type { AliasOut, EventPageOut, FeedPageOut } from '../types';

export function feedQuery(params?: PageParams) {
  return queryOptions<FeedPageOut, RemiApiError>({
    queryKey: keys.feed.page(params),
    queryFn: ({ signal }) => unwrap(api.GET('/feed', { params: { query: compact(params) }, signal })),
    retry: retryApi,
  });
}

/** Activity, newest first. */
export function useFeed(params?: PageParams) {
  return useQuery(feedQuery(params));
}

export function eventsQuery(params?: EventParams) {
  return queryOptions<EventPageOut, RemiApiError>({
    queryKey: keys.events.page(params),
    queryFn: ({ signal }) => unwrap(api.GET('/events', { params: { query: compact(params) }, signal })),
    retry: retryApi,
  });
}

/** Events after a cursor, oldest first. */
export function useEvents(params?: EventParams) {
  return useQuery(eventsQuery(params));
}

export function aliasesQuery() {
  return queryOptions<AliasOut[], RemiApiError>({
    queryKey: keys.aliases,
    queryFn: ({ signal }) => unwrap(api.GET('/aliases', { signal })),
    retry: retryApi,
  });
}

/** Every stored alias (`GET /aliases`). */
export function useAliases() {
  return useQuery(aliasesQuery());
}
