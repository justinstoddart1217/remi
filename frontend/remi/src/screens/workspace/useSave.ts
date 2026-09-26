/**
 * Every workspace edit is a mutation whose promise goes back to the field (InlineField holds
 * the committed text until the plan arrives, and reverts if the promise rejects). A failure
 * also shows the toast.
 */

import { useCallback } from 'react';

import { isRemiApiError } from '../../api';
import { useToast } from '../../components';

export const SAVE_FAILED = 'Couldn’t save that. Try again.';

/** A server reason as a sentence: a capital first letter and a closing full stop. */
export function asSentence(text: string): string {
  const t = text.trim();
  if (!t) return t;
  const cap = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?…]$/.test(cap) ? cap : `${cap}.`;
}

/** The toast copy for a failed save: the server's reason for a refused value, else generic. */
export function saveErrorCopy(e: unknown): string {
  if (isRemiApiError(e) && (e.status === 409 || e.status === 422) && e.message.trim()) {
    return `Couldn’t save that. ${asSentence(e.message)}`;
  }
  return SAVE_FAILED;
}

export function useSave() {
  const toast = useToast();
  const { show } = toast;
  const guard = useCallback(
    <T>(p: Promise<T>): Promise<T> => {
      p.catch((e: unknown) => {
        show(saveErrorCopy(e));
      });
      return p;
    },
    [show],
  );
  return { toast, guard };
}
