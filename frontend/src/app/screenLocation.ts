/**
 * Route data for a screen that stays mounted while hidden.
 *
 * The active screen reads the live location. A hidden screen keeps the location it had when
 * it was last active (recorded by AppShell), so its params do not vanish while it fades out
 * or waits in the stack. A component using this hook in a hidden screen still re-renders on
 * every navigation (the hook calls useLocation and useParams, which subscribe to the router),
 * but the ScreenRoute it returns keeps its identity, so effects and memos that depend on it do
 * not run again.
 */

import { useContext, useMemo } from 'react';
import { useLocation, useParams } from 'react-router';

import { ScreenActivityContext } from '../lib/arrival';
import { useUi } from '../stores/ui';
import type { ScreenId } from './screens';

export interface ScreenRoute {
  params: Readonly<Record<string, string | undefined>>;
  searchParams: URLSearchParams;
  hash: string;
  /** Changes on every navigation to this screen, even to the same URL (replaces `routineReq.t`). */
  key: string;
}

const EMPTY: ScreenRoute = { params: {}, searchParams: new URLSearchParams(), hash: '', key: '' };

export function useScreenRoute(): ScreenRoute {
  const { screen, active } = useContext(ScreenActivityContext);
  const liveParams = useParams();
  const live = useLocation();
  const latched = useUi((s) => (screen ? s.screenLocations[screen as ScreenId] : undefined));

  const search = active ? live.search : (latched?.search ?? '');
  const hash = active ? live.hash : (latched?.hash ?? '');
  const key = active ? live.key : (latched?.key ?? '');
  const params = active ? liveParams : latched?.params;
  const paramsKey = JSON.stringify(params ?? {});

  return useMemo(() => {
    if (!active && !latched) return EMPTY;
    return {
      params: JSON.parse(paramsKey) as Record<string, string | undefined>,
      searchParams: new URLSearchParams(search),
      hash,
      key,
    };
  }, [active, latched, paramsKey, search, hash, key]);
}

/** The workspace's project: the route's `:projectId`, kept while the workspace is hidden. */
export function useWorkspaceProjectId(): string | null {
  return useUi((s) => s.lastWorkspaceId);
}
