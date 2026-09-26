/**
 * The workspace's one date picker (Workspace.dc.html:251-297): Start, Target and each
 * milestone's date button open the same 292px BusinessDayDatePicker, anchored under the
 * trigger inside the workspace root. Clicking the same trigger again closes it (:254).
 *
 * The picker takes focus when it opens, and it unmounts when it closes (Escape, a pick,
 * 'Today', the backdrop), so closing puts focus back on the trigger that opened it, as the
 * Setup move-date field does; otherwise keyboard users land on <body> after every date change.
 */

import { useCallback, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { anchorPicker } from '../../components';
import type { PickerCalendar } from '../../components';
import type { CalendarIndex } from '../../lib/calendar';
import { captureFocus } from '../../lib/focus';

export interface PickerRequest {
  /** Which trigger opened it ('start', 'target', 'ms:<id>'): the same key toggles it closed. */
  key: string;
  value: string | null;
  /** Footer note; the picker's default when omitted. */
  note?: string;
  /** Accessible name of the dialog. */
  label: string;
  onPick: (iso: string) => void;
}

export interface PickerState extends PickerRequest {
  x: number;
  y: number;
}

/** Footer note for the Start picker (Workspace.dc.html:407). */
export const START_NOTE = 'Moving the start keeps the work left the same';

export function usePicker(rootRef: RefObject<HTMLElement | null>) {
  const [picker, setPicker] = useState<PickerState | null>(null);
  /** Puts focus back on the trigger of the picker that is open. */
  const restore = useRef<(() => void) | null>(null);

  const open = useCallback(
    (req: PickerRequest, trigger: HTMLElement) => {
      const root = rootRef.current;
      if (!root) return;
      const at = anchorPicker(root, trigger);
      restore.current = captureFocus(trigger);
      setPicker((cur) => (cur?.key === req.key ? null : { ...req, ...at }));
    },
    [rootRef],
  );
  const close = useCallback(() => {
    setPicker(null);
    const back = restore.current;
    restore.current = null;
    back?.();
  }, []);

  return { picker, open, close };
}

/** The picker's calendar, read from the server's calendar days (never computed here). */
export function pickerCalendar(cal: CalendarIndex): PickerCalendar {
  return {
    inRange: (iso) => cal.has(iso),
    isBd: (iso) => cal.isBD(iso) === true,
    bdm: (iso) => cal.bdOfMonth(iso),
    holiday: (iso) => cal.holiday(iso),
    nextBD: (iso) => cal.nextBD(iso) ?? iso,
  };
}
