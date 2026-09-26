/**
 * Calendar fixture: the prototype's window (Mon 31 Aug 2026 – Fri 30 Apr 2027) with the
 * England & Wales bank holidays the backend generates. This includes 31 Aug 2026, which the
 * prototype missed.
 */

import { dayNumber, isoFromDayNumber, weekdayOf } from '../../lib/calendar';
import type { CalendarDay } from '../../lib/calendar';

export const FIXTURE_TODAY = '2026-10-05';
export const FIXTURE_MOVE = '2027-01-04';

export const FIXTURE_HOLIDAYS: Readonly<Record<string, string>> = {
  '2026-08-31': 'Summer bank holiday',
  '2026-12-25': 'Christmas Day',
  '2026-12-28': 'Boxing Day (substitute)',
  '2027-01-01': "New Year's Day",
  '2027-03-26': 'Good Friday',
  '2027-03-29': 'Easter Monday',
};

function isoWeek(iso: string): number {
  const n = dayNumber(iso);
  const w = weekdayOf(iso) || 7;
  const thursday = n + 4 - w;
  const yearStart = dayNumber(`${isoFromDayNumber(thursday).slice(0, 4)}-01-01`);
  return Math.floor((thursday - yearStart) / 7) + 1;
}

/** Builds contiguous calendar days, numbering business days within each month. */
export function buildCalendarDays(
  from: string,
  to: string,
  holidays: Readonly<Record<string, string>> = FIXTURE_HOLIDAYS,
): CalendarDay[] {
  const days: CalendarDay[] = [];
  let month = '';
  let bdm = 0;
  for (let n = dayNumber(from); n <= dayNumber(to); n++) {
    const iso = isoFromDayNumber(n);
    if (iso.slice(0, 7) !== month) {
      month = iso.slice(0, 7);
      bdm = 0;
    }
    const w = weekdayOf(iso);
    const hol = holidays[iso] ?? null;
    const bd = w > 0 && w < 6 && hol === null;
    if (bd) bdm += 1;
    days.push({ iso, w, bd, bdm: bd ? bdm : null, hol, week: isoWeek(iso) });
  }
  return days;
}

export const FIXTURE_DAYS: readonly CalendarDay[] = buildCalendarDays('2026-08-31', '2027-04-30');
