import { useMatches } from 'react-router';

import { isScreenHandle } from '../app/screens';
import type { ScreenId } from '../app/screens';

/** The app screen the current route shows (from the matched route's `handle`), or null. */
export function useActiveScreen(): ScreenId | null {
  const matches = useMatches();
  for (let i = matches.length - 1; i >= 0; i--) {
    const handle = matches[i]?.handle;
    if (isScreenHandle(handle)) return handle.screen;
  }
  return null;
}
