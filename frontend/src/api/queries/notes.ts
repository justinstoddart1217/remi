/**
 * Notes reads: the rail (`GET /notes/days`), one day (`GET /notes?day=`), what Tell Remi may
 * send (`GET /notes/recent`), the drawer prefill (`GET /notes/day-text`) and the composer's
 * live tag chips (`POST /notes/tags`, a read: nothing is saved).
 */

import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

import { api, retryApi, unwrap } from '../client';
import type { RemiApiError } from '../client';
import { compact, keys } from '../keys';
import type { RangeParams } from '../keys';
import type { DayTextOut, NoteDaysOut, NoteListOut, RecentNotesOut, TagPreviewOut } from '../types';
import { PREVIEW_DEBOUNCE_MS, useDebouncedValue } from '../useDebouncedValue';

export function noteDaysQuery(params?: RangeParams) {
  return queryOptions<NoteDaysOut, RemiApiError>({
    queryKey: keys.notes.days(params),
    queryFn: ({ signal }) => unwrap(api.GET('/notes/days', { params: { query: compact(params) }, signal })),
    structuralSharing: true,
    retry: retryApi,
  });
}

/** Days that have notes, with counts and previews (the Notes rail). */
export function useNoteDays(params?: RangeParams) {
  return useQuery(noteDaysQuery(params));
}

export function notesQuery(day: string) {
  return queryOptions<NoteListOut, RemiApiError>({
    queryKey: keys.notes.day(day),
    queryFn: ({ signal }) => unwrap(api.GET('/notes', { params: { query: { day } }, signal })),
    structuralSharing: true,
    retry: retryApi,
  });
}

/** One day's notes and mentions. The previous day stays while the next one loads. */
export function useNotes(day: string | null | undefined) {
  return useQuery({
    ...notesQuery(day ?? ''),
    enabled: Boolean(day),
    placeholderData: keepPreviousData,
  });
}

export function recentNotesQuery(businessDays?: number | null) {
  return queryOptions<RecentNotesOut, RemiApiError>({
    queryKey: keys.notes.recent(businessDays),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/notes/recent', { params: { query: businessDays != null ? { businessDays } : {} }, signal })),
    retry: retryApi,
  });
}

/** Notes from the last N business days (what Tell Remi may send). */
export function useRecentNotes(businessDays?: number | null) {
  return useQuery(recentNotesQuery(businessDays));
}

export function noteDayTextQuery(day: string) {
  return queryOptions<DayTextOut, RemiApiError>({
    queryKey: keys.notes.dayText(day),
    queryFn: ({ signal }) => unwrap(api.GET('/notes/day-text', { params: { query: { day } }, signal })),
    staleTime: 0,
    retry: retryApi,
  });
}

/** A day's notes as update text. */
export function useNoteDayText(day: string | null | undefined, options: { enabled?: boolean } = {}) {
  return useQuery({ ...noteDayTextQuery(day ?? ''), enabled: Boolean(day) && (options.enabled ?? true) });
}

/** The same, on demand (Notes' "Send to Remi" prefills the drawer). Always fresh. */
export function fetchNoteDayText(queryClient: QueryClient, day: string): Promise<DayTextOut> {
  return queryClient.query(noteDayTextQuery(day));
}

const NO_TAGS: TagPreviewOut = { tags: [] };

/**
 * Tags for an unsaved draft (the composer's live chips). Waits 150ms for typing to settle and
 * keeps the previous chips meanwhile. A blank draft has no tags and sends nothing.
 */
export function useNoteTagPreview(text: string) {
  const settled = useDebouncedValue(text, PREVIEW_DEBOUNCE_MS);
  return useQuery<TagPreviewOut, RemiApiError>({
    queryKey: keys.notes.tags(settled),
    queryFn: ({ signal }) =>
      settled.trim() === '' ? Promise.resolve(NO_TAGS) : unwrap(api.POST('/notes/tags', { body: { text: settled }, signal })),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: retryApi,
  });
}
