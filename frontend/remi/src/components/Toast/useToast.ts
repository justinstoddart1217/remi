import { useCallback, useEffect, useRef, useState } from 'react';

/** Toast state: `show(text)` displays it for `duration` ms (3200 in the design); a new one restarts. */
export function useToast(duration = 3200): { message: string | null; show: (text: string) => void; hide: () => void } {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setMessage(null);
  }, []);

  const show = useCallback(
    (text: string) => {
      clearTimeout(timer.current);
      setMessage(text);
      timer.current = setTimeout(() => {
        setMessage(null);
      }, duration);
    },
    [duration],
  );

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  return { message, show, hide };
}
