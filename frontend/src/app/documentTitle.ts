/**
 * `document.title` per route (WCAG 2.4.2): a screen-reader user hears where a navigation landed,
 * and tabs and history entries are told apart. The prototype's titles are the product areas
 * ('Remi', 'Remi · Textbook', 'Remi · Foundations'); each route puts its own name first:
 *
 *   /                         Remi
 *   /app/today                Today · Remi              (every screen: its tab label)
 *   /app/projects/ret         Returns pipeline · Remi   (the project's name from the plan)
 *   /textbook                 Remi · Textbook
 *   /textbook/fi-rates        Rates primer · Remi · Textbook
 *   /settings, /setup         Settings · Remi, Set up · Remi
 *
 * Names come from what is already cached (the plan, a Textbook page); nothing is fetched for a
 * title, and until a name is read the route's generic title shows.
 */

import { useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router';

import { keys } from '../api/keys';
import type { PageOut, PlanOut } from '../api/types';
import { paths, SCREENS, screenFromPath } from './screens';

export const APP_TITLE = 'Remi';
export const TEXTBOOK_TITLE = 'Remi · Textbook';
export const FOUNDATIONS_TITLE = 'Remi · Foundations';

const SEP = ' · ';

/** Names read from the cache: the workspace's project, the Textbook page. */
export interface TitleNames {
  project?: string | null;
  page?: string | null;
}

function titled(name: string | null | undefined, area: string): string {
  const n = name?.trim();
  return n ? `${n}${SEP}${area}` : area;
}

/** The route's `:projectId` or `:pageId`, decoded. */
export function routeId(pathname: string): { projectId: string | null; pageId: string | null } {
  const project = /^\/app\/projects\/([^/]+)\/?$/.exec(pathname)?.[1];
  const page = /^\/textbook\/([^/]+)\/?$/.exec(pathname)?.[1];
  const decode = (v: string | undefined) => {
    if (v === undefined) return null;
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };
  return { projectId: decode(project), pageId: decode(page) };
}

/** The title for a pathname. Pure. */
export function documentTitleFor(pathname: string, names: TitleNames = {}): string {
  const screen = screenFromPath(pathname);
  if (screen === 'workspace') return titled(names.project ?? SCREENS.workspace.label, APP_TITLE);
  if (screen) return titled(SCREENS[screen].label, APP_TITLE);
  if (pathname === paths.textbook() || pathname.startsWith(`${paths.textbook()}/`)) return titled(names.page, TEXTBOOK_TITLE);
  if (pathname === paths.settings()) return titled('Settings', APP_TITLE);
  if (pathname === paths.setup()) return titled('Set up', APP_TITLE);
  if (/^\/(dev\/)?foundations(\/library)?\/?$/.test(pathname)) {
    return pathname.includes('/library') ? titled('Library', FOUNDATIONS_TITLE) : FOUNDATIONS_TITLE;
  }
  return APP_TITLE;
}

/** A value read from the query cache, kept live; never fetches. `read` must return a primitive. */
function useCacheValue<T extends string | null>(read: (queryClient: QueryClient) => T): T {
  const queryClient = useQueryClient();
  const subscribe = useCallback((onChange: () => void) => queryClient.getQueryCache().subscribe(onChange), [queryClient]);
  const snapshot = () => read(queryClient);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Keeps `document.title` in step with the route (RootLayout). */
export function useDocumentTitle(): void {
  const { pathname } = useLocation();
  const { projectId, pageId } = routeId(pathname);
  const project = useCacheValue((c) =>
    projectId === null ? null : (c.getQueryData<PlanOut>(keys.plan)?.projects.find((p) => p.id === projectId)?.name ?? null),
  );
  const page = useCacheValue((c) => (pageId === null ? null : (c.getQueryData<PageOut>(keys.textbook.page(pageId))?.title ?? null)));
  const title = documentTitleFor(pathname, { project, page });

  useEffect(() => {
    document.title = title;
  }, [title]);
}
