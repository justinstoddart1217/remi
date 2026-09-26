import type { PickerCalendar } from '../../../components';
import type { CalendarIndex } from '../../../lib/calendar';
import { addDays } from '../../../lib/calendar';

/** The date picker's calendar over the server's days (lookups only, never computed here). */
export function pickerCalendar(index: CalendarIndex): PickerCalendar {
  return {
    inRange: (iso) => index.has(iso),
    isBd: (iso) => index.isBD(iso) ?? false,
    bdm: (iso) => index.bdOfMonth(iso),
    holiday: (iso) => index.holiday(iso),
    nextBD: (iso) => index.nextBD(iso) ?? iso,
  };
}

/** How far ahead the move can be picked: the server accepts up to ten years; three is plenty. */
export const PICKER_SPAN_DAYS = 3 * 366;

/** The picker's range: today (earlier days are disabled) to about three years out. */
export function pickerRange(today: string): { from: string; to: string } {
  return { from: today, to: addDays(today, PICKER_SPAN_DAYS) };
}
