/**
 * Navigation helpers shared by the top bar's tabs, its countdown and the palette. Every `go()` is a
 * history push, so Back and Forward replay the same cross-fade (arch-frontend-core §3).
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router';

import { useOverlays } from '../stores/overlays';
import { useUi } from '../stores/ui';
import type { ScreenId } from './screens';
import { paths, screenPath } from './screens';

export interface GoOptions {
  /** Focus the new screen's h1 (palette and keyboard navigation). */
  focusHeading?: boolean;
}

/**
 * The URL a tab returns to for a screen: where it was last shown (so a screen keeps its
 * day or month, as the prototype's always-mounted screens did), else its default.
 */
export function returnPath(id: ScreenId): string {
  const ui = useUi.getState();
  if (id === 'projects') return paths.projects();
  if (id === 'workspace') return screenPath('workspace', ui.lastWorkspaceId);
  const last = ui.screenLocations[id];
  return last ? `${last.pathname}${last.search}${last.hash}` : screenPath(id);
}

/** `go(screen)`: navigate to a screen and close the palette (not the drawer), as the prototype. */
export function useGo(): (id: ScreenId, options?: GoOptions) => void {
  const navigate = useNavigate();
  return useCallback(
    (id: ScreenId, options?: GoOptions) => {
      useOverlays.getState().closePalette();
      if (options?.focusHeading) useUi.getState().requestHeadingFocus();
      void navigate(returnPath(id));
    },
    [navigate],
  );
}
