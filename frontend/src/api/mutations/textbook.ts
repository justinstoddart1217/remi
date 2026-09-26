/**
 * Textbook mutations. They never touch the plan; each keeps the textbook caches (tree, home,
 * pages, search) and Home's textbook counts in step.
 *
 * Autosave (`useSavePageBlocks`) writes the new `version` into the cached page, so the next
 * save sends the right `baseVersion`. A 409 `VERSION_CONFLICT` refetches the page; the editor
 * shows "This page changed in another tab. Showing the latest."
 *
 * Every other textbook write that finds its section, page or chart gone or changed elsewhere
 * (404, 409) refetches what is on screen (`refreshAfterStaleWrite`), so the sidebar and page
 * catch up instead of keeping a deleted row.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

import { api, isRemiApiError, unwrap } from '../client';
import type { RemiApiError, Schemas } from '../client';
import { keys } from '../keys';
import { refreshAfterStaleWrite } from './core';
import type {
  ChartUploadOut,
  PageCreatedOut,
  PageDeletedOut,
  PageOut,
  PageSavedOut,
  PageSummaryOut,
  SectionOut,
  TextbookBlock,
  TextbookTreeOut,
  WithDefaults,
} from '../types';

/** The textbook's overview reads, plus Home's textbook counts. */
const OVERVIEW: readonly QueryKey[] = [keys.textbook.tree, keys.textbook.home, keys.textbook.searches, keys.home];

function refresh(queryClient: QueryClient, what: readonly QueryKey[]): void {
  for (const queryKey of what) void queryClient.invalidateQueries({ queryKey });
}

/** `POST /textbook/sections`. */
export function useCreateSection() {
  const queryClient = useQueryClient();
  return useMutation<SectionOut, RemiApiError, WithDefaults<Schemas['SectionCreate'], 'label'>>({
    mutationFn: (body) => unwrap(api.POST('/textbook/sections', { body: { ...body, label: body.label ?? '' } })),
    onSuccess: () => {
      refresh(queryClient, OVERVIEW);
    },
    onError: (error) => {
      refreshAfterStaleWrite(queryClient, error);
    },
  });
}

/** `PUT /textbook/sections/order`: answers the new tree. */
export function useReorderSections() {
  const queryClient = useQueryClient();
  return useMutation<TextbookTreeOut, RemiApiError, { ids: string[] }>({
    mutationFn: ({ ids }) => unwrap(api.PUT('/textbook/sections/order', { body: { ids } })),
    onSuccess: (tree) => {
      queryClient.setQueryData(keys.textbook.tree, tree);
      refresh(queryClient, [keys.textbook.home]);
    },
    onError: (error) => {
      refreshAfterStaleWrite(queryClient, error);
    },
  });
}

/** `PATCH /textbook/sections/{id}`: rename, recolour or collapse. */
export function useUpdateSection() {
  const queryClient = useQueryClient();
  return useMutation<SectionOut, RemiApiError, { sectionId: string; patch: Schemas['SectionPatch'] }>({
    mutationFn: ({ sectionId, patch }) =>
      unwrap(api.PATCH('/textbook/sections/{sectionId}', { params: { path: { sectionId } }, body: patch })),
    onSuccess: () => {
      refresh(queryClient, [keys.textbook.tree, keys.textbook.home]);
    },
    onError: (error) => {
      refreshAfterStaleWrite(queryClient, error);
    },
  });
}

/** `DELETE /textbook/sections/{id}`: only empty sections, never the last one (409). */
export function useDeleteSection() {
  const queryClient = useQueryClient();
  return useMutation<undefined, RemiApiError, { sectionId: string }>({
    mutationFn: async ({ sectionId }) => {
      await unwrap(api.DELETE('/textbook/sections/{sectionId}', { params: { path: { sectionId } } }));
      return undefined;
    },
    onSuccess: () => {
      refresh(queryClient, OVERVIEW);
    },
    onError: (error) => {
      refreshAfterStaleWrite(queryClient, error);
    },
  });
}

/** `POST /textbook/pages`: a page or sub-page. The new page (and its updated parent) are cached. */
export function useCreatePage() {
  const queryClient = useQueryClient();
  return useMutation<PageCreatedOut, RemiApiError, WithDefaults<Schemas['PageCreate'], 'title'>>({
    mutationFn: (body) => unwrap(api.POST('/textbook/pages', { body: { ...body, title: body.title ?? '' } })),
    onSuccess: ({ page, parent }) => {
      queryClient.setQueryData<PageOut>(keys.textbook.page(page.id), page);
      if (parent) queryClient.setQueryData<PageOut>(keys.textbook.page(parent.id), parent);
      refresh(queryClient, OVERVIEW);
    },
    onError: (error) => {
      refreshAfterStaleWrite(queryClient, error);
    },
  });
}

/** `PATCH /textbook/pages/{id}`: rename. */
export function useUpdatePage() {
  const queryClient = useQueryClient();
  return useMutation<PageSummaryOut, RemiApiError, { pageId: string; title: string }>({
    mutationFn: ({ pageId, title }) =>
      unwrap(api.PATCH('/textbook/pages/{pageId}', { params: { path: { pageId } }, body: { title } })),
    onSuccess: (summary) => {
      queryClient.setQueryData<PageOut>(keys.textbook.page(summary.id), (page) =>
        page ? { ...page, title: summary.title, version: summary.version, updatedAt: summary.updatedAt } : page,
      );
      refresh(queryClient, OVERVIEW);
    },
    onError: (error) => {
      refreshAfterStaleWrite(queryClient, error);
    },
  });
}

/** `DELETE /textbook/pages/{id}`: the page and everything inside it. */
export function useDeletePage() {
  const queryClient = useQueryClient();
  return useMutation<PageDeletedOut, RemiApiError, { pageId: string }>({
    mutationFn: ({ pageId }) => unwrap(api.DELETE('/textbook/pages/{pageId}', { params: { path: { pageId } } })),
    onSuccess: ({ deletedIds }) => {
      for (const id of deletedIds) queryClient.removeQueries({ queryKey: keys.textbook.page(id), exact: true });
      // Page-link blocks elsewhere may point at a deleted page.
      refresh(queryClient, [...OVERVIEW, keys.textbook.pages]);
    },
    onError: (error) => {
      refreshAfterStaleWrite(queryClient, error);
    },
  });
}

/**
 * `PUT /textbook/pages/{id}/blocks`: autosave with the optimistic lock (`baseVersion`). On
 * success the cached page takes the saved blocks and the new version. On 409 the page is
 * refetched.
 */
export function useSavePageBlocks() {
  const queryClient = useQueryClient();
  return useMutation<PageSavedOut, RemiApiError, { pageId: string; blocks: TextbookBlock[]; baseVersion: number }>({
    mutationFn: ({ pageId, blocks, baseVersion }) =>
      unwrap(api.PUT('/textbook/pages/{pageId}/blocks', { params: { path: { pageId } }, body: { blocks, baseVersion } })),
    onSuccess: (saved, { pageId, blocks }) => {
      queryClient.setQueryData<PageOut>(keys.textbook.page(pageId), (page) =>
        page ? { ...page, blocks, version: saved.version, updatedAt: saved.updatedAt } : page,
      );
      // Counts and "recent" change on every save; refresh them when next shown, not per keystroke.
      for (const queryKey of [keys.textbook.tree, keys.textbook.home, keys.textbook.searches, keys.home]) {
        void queryClient.invalidateQueries({ queryKey, refetchType: 'none' });
      }
    },
    onError: (error, { pageId }) => {
      if (isRemiApiError(error, 'VERSION_CONFLICT')) {
        void queryClient.invalidateQueries({ queryKey: keys.textbook.page(pageId), exact: true });
      }
    },
  });
}

/** `POST /textbook/charts`: upload an HTML chart (.html/.htm, UTF-8, at most 4 MB). */
export function useUploadChart() {
  const queryClient = useQueryClient();
  return useMutation<ChartUploadOut, RemiApiError, { file: File }>({
    mutationFn: ({ file }) =>
      unwrap(
        api.POST('/textbook/charts', {
          body: { file: file.name },
          bodySerializer: () => {
            const form = new FormData();
            form.append('file', file, file.name);
            return form;
          },
        }),
      ),
    onSuccess: () => {
      refresh(queryClient, [keys.textbook.home, keys.home]);
    },
    onError: (error) => {
      refreshAfterStaleWrite(queryClient, error);
    },
  });
}

/** `DELETE /textbook/charts/{id}`: an unreferenced chart asset. */
export function useDeleteChart() {
  const queryClient = useQueryClient();
  return useMutation<undefined, RemiApiError, { assetId: string }>({
    mutationFn: async ({ assetId }) => {
      await unwrap(api.DELETE('/textbook/charts/{assetId}', { params: { path: { assetId } } }));
      return undefined;
    },
    onSuccess: () => {
      refresh(queryClient, [keys.textbook.home, keys.home]);
    },
    onError: (error) => {
      refreshAfterStaleWrite(queryClient, error);
    },
  });
}
