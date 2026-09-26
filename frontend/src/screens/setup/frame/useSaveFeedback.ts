import { useCallback, useEffect, useRef, useState } from 'react';

import { isRemiApiError } from '../../../api';

export type SavePhase = 'idle' | 'saving' | 'saved' | 'error';

export interface SaveFeedback {
  phase: SavePhase;
  /** The error's message ('error'), or what the save did ('saved': '2 forecasts moved'). */
  message: string | null;
  /** Whether the note is showing (a 'saved' note fades out after SAVED_HOLD_MS). */
  visible: boolean;
  /**
   * The field a failed save belongs to: its message shows under that field (FieldError) and
   * the section header only says 'Not saved'. null puts the whole message in the header.
   */
  field: string | null;
  /** The server's own words when the page shows calmer ones ('error'): the message's title. */
  detail: string | null;
}

/** How long 'Saved' stays before it fades (400ms). */
export const SAVED_HOLD_MS = 2400;

const IDLE: SaveFeedback = { phase: 'idle', message: null, visible: false, field: null, detail: null };

/**
 * Failures whose server message is written for a developer (it names a command or an
 * environment variable): the page says what happened in plain words instead.
 */
const CALM_ERRORS: Readonly<Record<string, string>> = {
  NETWORK_ERROR: 'Remi is not answering. Try again in a moment.',
  KEYCHAIN_UNAVAILABLE: "Remi could not reach this computer's secure key store, so the key was not stored.",
};

/**
 * The words for a failed save (the server's message, calm words for a known code, or a
 * fallback) and, when the words are not the server's, the server's own text as `detail`.
 */
export function saveError(error: unknown): { message: string; detail: string | null } {
  if (!isRemiApiError(error)) return { message: 'Remi could not save that.', detail: null };
  const calm = CALM_ERRORS[error.code];
  if (calm) return { message: calm, detail: error.message && error.message !== calm ? error.message : null };
  return { message: error.message || 'Remi could not save that.', detail: null };
}

/** The words for a failed save (see saveError). */
export function saveErrorMessage(error: unknown): string {
  return saveError(error).message;
}

/**
 * Calm confirmation for a section that saves as you go: 'Saving…' while requests are in
 * flight, then 'Saved' (with what it did, when `describe` says) for 2.4s, then it fades. A
 * failure stays until the next save; pass `field` to show its words under that field.
 */
export function useSaveFeedback() {
  const [state, setState] = useState<SaveFeedback>(IDLE);
  const pending = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  const track = useCallback(
    <T>(work: Promise<T>, describe?: ((value: T) => string | null) | null, field?: string): Promise<T> => {
      clearTimeout(timer.current);
      pending.current += 1;
      setState({ phase: 'saving', message: null, visible: true, field: null, detail: null });
      return work.then(
        (value) => {
          pending.current -= 1;
          if (pending.current === 0) {
            setState({ phase: 'saved', message: describe?.(value) ?? null, visible: true, field: null, detail: null });
            timer.current = setTimeout(() => {
              setState((cur) => (cur.phase === 'saved' ? { ...cur, visible: false } : cur));
            }, SAVED_HOLD_MS);
          }
          return value;
        },
        (error: unknown) => {
          pending.current -= 1;
          setState({ phase: 'error', ...saveError(error), visible: true, field: field ?? null });
          throw error;
        },
      );
    },
    [],
  );

  /** Shows an error without a request (a value the page refused before sending). */
  const fail = useCallback((message: string, field?: string) => {
    clearTimeout(timer.current);
    setState({ phase: 'error', message, visible: true, field: field ?? null, detail: null });
  }, []);

  return { state, track, fail };
}
