/**
 * Tell Remi: parse an update into proposed changes, cancel a parse, and apply the ticked
 * changes. The review preview is a query (`useCheckinPreview` in ../queries/checkins).
 *
 * Parse sessions: every `parse()` gets a fresh `parseId` (a UUID the server echoes) and its own
 * AbortController. Starting a new parse or calling `cancel()` aborts the previous request and
 * asks the server to stop it (`DELETE /checkins/parse/{parseId}`). An answer for any session
 * but the current one resolves to `null`, so a late reply can never land in a newer review.
 * A reply to the current session that echoes another `parseId` is a broken answer: the session
 * ends and the parse rejects with `BAD_RESPONSE`.
 *
 * Apply (arch-frontend-core §5): the drawer closes immediately; the request goes out at once,
 * and the result is applied only after both it and a 220ms pause have finished
 * (`Promise.all([request, sleep(220)])`), so the plan moves once the drawer is out of the way.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import { sleep } from '../../lib/timers';
import { useOverlays } from '../../stores/overlays';
import { api, isAbortError, newParseId, RemiApiError, unwrap } from '../client';
import type { Schemas } from '../client';
import type { ApplyRequest, ProposalOut, WithDefaults } from '../types';
import { CHECKIN_READS, commitPlanMutation, refreshAfterStaleWrite } from './core';

/** The pause between the drawer closing and the plan moving. */
export const APPLY_DELAY_MS = 220;

/** `auto` uses the configured provider (`POST /checkins/parse`); `simple` the offline reading. */
export type ParseMode = 'auto' | 'simple';

export interface ParseInput {
  text: string;
  focusProjectId?: string | null;
  mode?: ParseMode;
}

export interface CheckinParser {
  /**
   * Resolves to the proposal, or to `null` when this parse was superseded or cancelled.
   * Rejects with `RemiApiError` (e.g. `AI_BAD_REPLY`, `AI_TIMEOUT`, `NETWORK_ERROR`, or
   * `BAD_RESPONSE` when the reply echoes another `parseId`). Either way the session is over.
   */
  parse: (input: ParseInput) => Promise<ProposalOut | null>;
  /** Aborts the in-flight parse, if any, and tells the server to stop it. */
  cancel: () => void;
  /** The in-flight parse's id, or null. */
  current: () => string | null;
}

interface Session {
  parseId: string;
  controller: AbortController;
}

/** Tells the server to drop a parse. Best effort: failures are ignored. */
export function cancelParseOnServer(parseId: string): void {
  void api.DELETE('/checkins/parse/{parseId}', { params: { path: { parseId } } }).catch(() => undefined);
}

/** A parse session guard (no React). `useCheckinParser` wraps one per component. */
export function createCheckinParser(): CheckinParser {
  let session: Session | null = null;

  function cancel(): void {
    const s = session;
    if (!s) return;
    session = null;
    s.controller.abort();
    cancelParseOnServer(s.parseId);
  }

  async function parse({ text, focusProjectId = null, mode = 'auto' }: ParseInput): Promise<ProposalOut | null> {
    cancel();
    const mine: Session = { parseId: newParseId(), controller: new AbortController() };
    session = mine;
    const body: Schemas['ParseRequest'] = { parseId: mine.parseId, text, focusProjectId };
    const init = { body, signal: mine.controller.signal };
    let proposal: ProposalOut;
    try {
      proposal = await unwrap(
        mode === 'simple' ? api.POST('/checkins/parse-simple', init) : api.POST('/checkins/parse', init),
      );
    } catch (error) {
      if (session !== mine || isAbortError(error)) return null;
      session = null;
      throw error;
    }
    // Superseded or cancelled while the request was out.
    if (session !== mine) return null;
    // Settled either way: nothing is in flight, and a later cancel() has nothing to stop.
    session = null;
    if (proposal.parseId !== mine.parseId) {
      throw new RemiApiError({
        status: 200,
        code: 'BAD_RESPONSE',
        message: 'The reply was for a different update.',
      });
    }
    return proposal;
  }

  return { parse, cancel, current: () => session?.parseId ?? null };
}

/** A parse session owned by the calling component; unmounting cancels it. */
export function useCheckinParser(): CheckinParser {
  const parser = useMemo(() => createCheckinParser(), []);
  useEffect(
    () => () => {
      parser.cancel();
    },
    [parser],
  );
  return parser;
}

/** `DELETE /checkins/parse/{parseId}` as a mutation, for callers that track the id themselves. */
export function useCancelParse() {
  return useMutation<undefined, RemiApiError, { parseId: string }>({
    mutationFn: async ({ parseId }) => {
      await unwrap(api.DELETE('/checkins/parse/{parseId}', { params: { path: { parseId } } }));
      return undefined;
    },
  });
}

/**
 * `POST /checkins/apply`. Closes the drawer at once, then commits the plan and plays the
 * movements 220ms later at the earliest. On failure nothing is applied and the promise
 * rejects; the drawer reopens in review with the toast "Couldn't apply that. Your update is
 * still here."
 */
export function useApplyCheckin() {
  const queryClient = useQueryClient();
  return useMutation<Schemas['CheckinMutationOut'], RemiApiError, WithDefaults<ApplyRequest, 'rawText'>>({
    mutationFn: async (input) => {
      useOverlays.getState().closeDrawer();
      const body: ApplyRequest = { ...input, rawText: input.rawText ?? '' };
      const [out] = await Promise.all([unwrap(api.POST('/checkins/apply', { body })), sleep(APPLY_DELAY_MS)]);
      return out;
    },
    onSuccess: (out) => commitPlanMutation(queryClient, out, { invalidate: CHECKIN_READS }),
    // A change names a project or task deleted elsewhere: show the plan as it now is.
    onError: (error) => {
      refreshAfterStaleWrite(queryClient, error);
    },
  });
}
