/**
 * The Tell Remi state machine (arch-frontend-screens §3): compose → thinking → review | error.
 *
 * - `open` (a new drawer session) resets everything to compose with the prefill;
 * - `send` needs text and leaves compose or error for thinking (never twice);
 * - `resolved` / `failed` land only for the current `attempt`, so a late answer from an older
 *   send (or one the user typed over) is dropped;
 * - typing in review or error drops back to compose and discards the reading (crit :309);
 * - `edit` returns to compose; `toggle` ticks rows in review only.
 */

import type { ProposalOut } from '../../api';
import type { Phase } from './model';
import { echoOf } from './model';

/** The progress rule: 0 at send, 88% while reading (2600ms), 100% once the answer is in. */
export type Progress = 0 | 88 | 100;

export interface CheckinState {
  session: number;
  text: string;
  /** Focus project id, or null for "About anything". */
  focus: string | null;
  phase: Phase;
  result: ProposalOut | null;
  /** Unticked rows, by index into `result.changes`. */
  off: Readonly<Record<number, true>>;
  /** The error panel's message (the server's reason). */
  error: string;
  /** Review groups have entered (two frames after review). */
  shown: boolean;
  progress: Progress;
  echo: readonly string[];
  /** Echo quotes have entered (two frames after send). */
  echoOn: boolean;
  /** Bumped by every send, and by anything that abandons one. */
  attempt: number;
  /** "Use a simple reading" is in flight from the error panel. */
  simplePending: boolean;
  /** The drawer is open (closing abandons a reading in flight). */
  open: boolean;
  /** An apply failed: the next session reopens this review instead of starting afresh. */
  restoreNext: boolean;
}

export type CheckinAction =
  | { type: 'open'; session: number; focus: string | null; text: string; open: boolean }
  | { type: 'restore'; session: number; open: boolean }
  | { type: 'visibility'; open: boolean }
  | { type: 'applyFailed'; session: number }
  | { type: 'type'; text: string }
  | { type: 'send' }
  | { type: 'simple' }
  | { type: 'reading'; attempt: number }
  | { type: 'answered'; attempt: number }
  | { type: 'resolved'; attempt: number; result: ProposalOut }
  | { type: 'failed'; attempt: number; message: string }
  | { type: 'shown'; attempt: number }
  | { type: 'toggle'; index: number }
  | { type: 'edit' }
  | { type: 'clearFocus' }
  | { type: 'abort' };

export function initialState(session: number, focus: string | null, text: string, open = false): CheckinState {
  return {
    session,
    text,
    focus,
    phase: 'compose',
    result: null,
    off: {},
    error: '',
    shown: false,
    progress: 0,
    echo: [],
    echoOn: false,
    attempt: 0,
    simplePending: false,
    open,
    restoreNext: false,
  };
}

/** Whether `send` would start a reading now. */
export function canSend(state: CheckinState): boolean {
  return state.text.trim() !== '' && (state.phase === 'compose' || state.phase === 'error');
}

export function checkinReducer(state: CheckinState, action: CheckinAction): CheckinState {
  switch (action.type) {
    case 'open':
      return { ...initialState(action.session, action.focus, action.text, action.open), attempt: state.attempt + 1 };

    case 'restore':
      return { ...state, session: action.session, open: action.open, restoreNext: false, attempt: state.attempt + 1, simplePending: false };

    case 'visibility': {
      if (action.open === state.open) return state;
      const next = { ...state, open: action.open };
      return action.open ? next : checkinReducer(next, { type: 'abort' });
    }

    case 'applyFailed':
      if (action.session !== state.session || state.phase !== 'review') return state;
      return { ...state, restoreNext: true };

    case 'type': {
      if (state.phase === 'thinking') return state;
      const leaving = state.phase === 'review' || state.phase === 'error';
      return leaving
        ? { ...state, text: action.text, phase: 'compose', result: null, off: {}, attempt: state.attempt + 1, simplePending: false }
        : { ...state, text: action.text };
    }

    case 'send':
      if (!canSend(state)) return state;
      return {
        ...state,
        phase: 'thinking',
        echo: echoOf(state.text),
        echoOn: false,
        progress: 0,
        error: '',
        attempt: state.attempt + 1,
        simplePending: false,
      };

    case 'simple':
      if (state.phase !== 'error' || state.text.trim() === '') return state;
      return { ...state, attempt: state.attempt + 1, simplePending: true };

    case 'reading':
      if (action.attempt !== state.attempt || state.phase !== 'thinking') return state;
      return { ...state, progress: 88, echoOn: true };

    case 'answered':
      if (action.attempt !== state.attempt || state.phase !== 'thinking') return state;
      return { ...state, progress: 100 };

    case 'resolved':
      if (action.attempt !== state.attempt) return state;
      return {
        ...state,
        phase: 'review',
        result: action.result,
        off: {},
        shown: false,
        progress: 100,
        simplePending: false,
      };

    case 'failed':
      if (action.attempt !== state.attempt) return state;
      return { ...state, phase: 'error', error: action.message, simplePending: false };

    case 'shown':
      if (action.attempt !== state.attempt || state.phase !== 'review') return state;
      return { ...state, shown: true };

    case 'toggle': {
      if (state.phase !== 'review' || !state.result || action.index < 0 || action.index >= state.result.changes.length) {
        return state;
      }
      const off: Record<number, true> = { ...state.off };
      if (off[action.index]) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- keyed by row index
        delete off[action.index];
      } else {
        off[action.index] = true;
      }
      return { ...state, off };
    }

    case 'edit':
      if (state.phase !== 'review') return state;
      return { ...state, phase: 'compose', attempt: state.attempt + 1 };

    case 'clearFocus':
      return state.focus === null ? state : { ...state, focus: null };

    case 'abort':
      if (state.phase === 'thinking') return { ...state, phase: 'compose', attempt: state.attempt + 1 };
      if (state.simplePending) return { ...state, simplePending: false, attempt: state.attempt + 1 };
      return state;
  }
}
