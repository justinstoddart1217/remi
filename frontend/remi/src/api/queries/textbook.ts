/**
 * Textbook reads: the sidebar tree, the Textbook home, one page with its blocks, and search.
 * These never touch the plan. Charts render from `chartUrl(assetId)` in a sandboxed iframe.
 */

import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';

import { api, retryApi, unwrap } from '../client';
import type { RemiApiError } from '../client';
import { keys } from '../keys';
import type { PageOut, TextbookHomeOut, TextbookSearchOut, TextbookTreeOut } from '../types';
import { PREVIEW_DEBOUNCE_MS, useDebouncedValue } from '../useDebouncedValue';

export function textbookTreeQuery() {
  return queryOptions<TextbookTreeOut, RemiApiError>({
    queryKey: keys.textbook.tree,
    queryFn: ({ signal }) => unwrap(api.GET('/textbook', { signal })),
    structuralSharing: true,
    retry: retryApi,
  });
}

/** Every section and page (the sidebar tree). */
export function useTextbookTree() {
  return useQuery(textbookTreeQuery());
}

export function textbookHomeQuery() {
  return queryOptions<TextbookHomeOut, RemiApiError>({
    queryKey: keys.textbook.home,
    queryFn: ({ signal }) => unwrap(api.GET('/textbook/home', { signal })),
    structuralSharing: true,
    retry: retryApi,
  });
}

/** Textbook home: counts, recent pages, charts, sections. */
export function useTextbookHome() {
  return useQuery(textbookHomeQuery());
}

export function textbookPageQuery(pageId: string) {
  return queryOptions<PageOut, RemiApiError>({
    queryKey: keys.textbook.page(pageId),
    queryFn: ({ signal }) => unwrap(api.GET('/textbook/pages/{pageId}', { params: { path: { pageId } }, signal })),
    // The editor owns the blocks once loaded; only an explicit invalidation (409) refetches.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: retryApi,
  });
}

/** A page with its blocks. `version` is the optimistic lock for `useSavePageBlocks`. */
export function useTextbookPage(pageId: string | null | undefined) {
  return useQuery({ ...textbookPageQuery(pageId ?? ''), enabled: Boolean(pageId) });
}

const NO_HITS = (q: string): TextbookSearchOut => ({ q, hits: [] });

/** Find pages by title or block text. Waits 150ms for typing; a blank query sends nothing. */
export function useTextbookSearch(q: string) {
  const settled = useDebouncedValue(q.trim(), PREVIEW_DEBOUNCE_MS);
  return useQuery<TextbookSearchOut, RemiApiError>({
    queryKey: keys.textbook.search(settled),
    queryFn: ({ signal }) =>
      settled === '' ? Promise.resolve(NO_HITS(settled)) : unwrap(api.GET('/textbook/search', { params: { query: { q: settled } }, signal })),
    placeholderData: keepPreviousData,
    retry: retryApi,
  });
}
