import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { RotationOut } from '../../api';
import { fromServer, segmentsDirty, segmentsIn, segmentsValid } from '../setup/rotation/model';
import type { SegmentDraft } from '../setup/rotation/model';
import { assignSavedIds } from './model';

/** Quiet time after the last edit before the list is saved (reorder clicks come in bursts). */
export const ROTATION_SAVE_DELAY_MS = 350;

type Segments = readonly SegmentDraft[];

/** Server segments as drafts, keeping the keys the draft already uses for the same ids. */
function rekey(server: Segments, draft: Segments): Segments {
  const keyById = new Map(draft.filter((s) => s.id).map((s) => [s.id, s.key]));
  return server.map((s) => ({ ...s, key: (s.id && keyById.get(s.id)) ?? s.key }));
}

/**
 * The Settings rotation editor's draft, saved as you go: every change that leaves the list
 * valid is sent as one `PUT /rotation/segments` after a short pause, one save at a time (the
 * latest list wins). An unfinished country waits, unsaved, until it is complete. When the
 * rotation changes elsewhere and nothing is waiting here, the draft follows the server.
 */
export function useRotationDraft(
  rotation: RotationOut | undefined,
  save: (segments: ReturnType<typeof segmentsIn>) => Promise<{ entity: RotationOut }>,
) {
  const [draft, setDraftState] = useState<Segments>(() => (rotation ? fromServer(rotation.segments) : []));
  const draftRef = useRef<Segments>(draft);
  const baseRef = useRef<Segments>(draft);
  const inFlight = useRef(false);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveRef = useRef(save);
  useLayoutEffect(() => {
    saveRef.current = save;
  });

  const setDraft = useCallback((next: Segments) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);

  // Follow the server when nothing local is pending.
  const serverSegments = rotation?.segments;
  useEffect(() => {
    if (!serverSegments) return;
    const server = fromServer(serverSegments);
    const local = draftRef.current;
    const pending = inFlight.current || timer.current !== undefined || segmentsDirty(local, baseRef.current);
    baseRef.current = rekey(server, local);
    if (!pending && segmentsDirty(local, server)) setDraft(baseRef.current);
  }, [serverSegments, setDraft]);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  // Read through a function: an edit during the await sets it (TS narrows the field to false).
  const takeAgain = useCallback(() => again.current, []);

  const flush = useCallback(async (): Promise<void> => {
    timer.current = undefined;
    if (inFlight.current) {
      again.current = true;
      return;
    }
    inFlight.current = true;
    try {
      do {
        again.current = false;
        const sent = draftRef.current;
        if (!segmentsValid(sent) || !segmentsDirty(sent, baseRef.current)) break;
        let out: { entity: RotationOut };
        try {
          out = await saveRef.current(segmentsIn(sent));
        } catch {
          break;
        }
        const next = assignSavedIds(draftRef.current, sent, out.entity.segments);
        baseRef.current = rekey(fromServer(out.entity.segments), next);
        if (next !== draftRef.current) setDraft(next);
      } while (takeAgain());
    } finally {
      inFlight.current = false;
    }
  }, [setDraft, takeAgain]);

  const change = useCallback(
    (next: Segments) => {
      setDraft(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flush();
      }, ROTATION_SAVE_DELAY_MS);
    },
    [flush, setDraft],
  );

  return { draft, change };
}
