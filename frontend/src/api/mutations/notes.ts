/** Notes: jot, edit and remove. Each answer carries the plan (note counts live there). */

import { api, unwrap } from '../client';
import { NOTE_READS, usePlanMutation } from './core';

/** `POST /notes`: jot a note on a day. */
export function useCreateNote() {
  return usePlanMutation({
    mutationFn: (body: { day: string; text: string }) => unwrap(api.POST('/notes', { body })),
    invalidate: NOTE_READS,
  });
}

/** `PATCH /notes/{id}`: edit a note's text. */
export function useUpdateNote() {
  return usePlanMutation({
    mutationFn: ({ noteId, text }: { noteId: string; text: string }) =>
      unwrap(api.PATCH('/notes/{noteId}', { params: { path: { noteId } }, body: { text } })),
    invalidate: NOTE_READS,
  });
}

/** `DELETE /notes/{id}`. */
export function useDeleteNote() {
  return usePlanMutation({
    mutationFn: ({ noteId }: { noteId: string }) => unwrap(api.DELETE('/notes/{noteId}', { params: { path: { noteId } } })),
    invalidate: NOTE_READS,
  });
}
