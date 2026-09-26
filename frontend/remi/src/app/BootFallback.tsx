import { useEffect, useState } from 'react';

import s from './BootFallback.module.css';

/**
 * How long a pending boot shows nothing. The local server answers in a few ms, so a normal
 * start never flashes a message before the app (or the redirect to /setup).
 */
export const BOOT_QUIET_MS = 300;

export const BOOT_TEXT = 'Starting Remi…';

/**
 * What shows while the first answers are on their way: SetupGate's `GET /api/setup`, and a lazy
 * route's chunk when it is the first page loaded (react-router's `HydrateFallback`). Nothing
 * for BOOT_QUIET_MS, then a quiet "Starting Remi…", so a slow server is never a blank page.
 * The status region is there from the start, so screen readers announce the text when it comes.
 */
export function BootFallback() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => {
      setSlow(true);
    }, BOOT_QUIET_MS);
    return () => {
      clearTimeout(id);
    };
  }, []);
  return (
    <div className={s.boot} role="status" aria-live="polite" data-slow={slow ? '' : undefined}>
      {slow ? BOOT_TEXT : null}
    </div>
  );
}
