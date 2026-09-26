import { useEffect, useRef } from 'react';
import { useLocation, useParams } from 'react-router';

import type { ScreenId } from '../../app/screens';
import { useOverlays } from '../../stores/overlays';
import { useUi } from '../../stores/ui';

/**
 * Route bookkeeping for the shell:
 * - records where each screen was last shown (hidden screens keep their params; a tab
 *   returns there);
 * - keeps `lastWorkspaceId` in step with `:projectId`;
 * - closes the palette on navigation (not the drawer, as the prototype);
 * - opens overlays from deep links on first load: `?palette=<query>` and
 *   `?drawer=<projectId|new|any>` (used by the parity and behaviour harnesses).
 */
export function useShellRoute(active: ScreenId | null): void {
  const location = useLocation();
  const params = useParams();
  const paramsKey = JSON.stringify(params);
  const lastKey = useRef(location.key);

  useEffect(() => {
    if (!active) return;
    const ui = useUi.getState();
    ui.recordScreenLocation(active, {
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
      params: JSON.parse(paramsKey) as Record<string, string | undefined>,
      key: location.key,
    });
    if (active === 'workspace' && typeof params.projectId === 'string') ui.setLastWorkspaceId(params.projectId);
  }, [active, location.pathname, location.search, location.hash, location.key, paramsKey, params.projectId]);

  useEffect(() => {
    if (lastKey.current === location.key) return;
    lastKey.current = location.key;
    useOverlays.getState().closePalette();
  }, [location.key]);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const drawer = search.get('drawer');
    const palette = search.get('palette');
    const overlays = useOverlays.getState();
    if (drawer !== null) overlays.openDrawer(['', 'any', 'new'].includes(drawer) ? null : drawer);
    if (palette !== null) overlays.openPalette(palette);
  }, []);
}
