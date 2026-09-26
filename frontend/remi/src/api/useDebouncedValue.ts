import { hashKey } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

/** The debounce for live previews (check-in review, replan, note tags): 150ms (spec). */
export const PREVIEW_DEBOUNCE_MS = 150;

/**
 * `value`, settled for `ms`. Values are compared by content (the query-key hash), so a caller
 * that rebuilds an equal array on every render does not keep restarting the timer.
 */
export function useDebouncedValue<T>(value: T, ms: number = PREVIEW_DEBOUNCE_MS): T {
  const [settled, setSettled] = useState<{ hash: string; value: T }>(() => ({ hash: hashKey([value]), value }));
  const hash = hashKey([value]);

  useEffect(() => {
    if (hash === settled.hash) return;
    const id = setTimeout(() => {
      setSettled({ hash, value });
    }, ms);
    return () => {
      clearTimeout(id);
    };
    // `value` is represented by `hash`; re-running on identity alone would restart the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, ms, settled.hash]);

  return settled.value;
}
