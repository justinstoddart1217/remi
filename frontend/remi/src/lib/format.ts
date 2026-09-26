/**
 * Display formatters with fixed en-GB arrays (no `Intl`), so output is identical in every
 * browser, locale and time zone. The shapes match the prototype's `F.*` helpers exactly:
 * Roll's date regexes depend on 'Ddd D Mon' and 'D Mon' (arch-frontend-core §6-7).
 *
 * Date inputs are ISO strings, parsed by splitting (see lib/calendar.ts).
 */

import { isoParts, weekdayOf } from './calendar';

/** U+2212 MINUS SIGN, used for every negative delta. */
export const MINUS = '−';

export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function at<T>(list: readonly T[], i: number): T {
  const value = list[i];
  if (value === undefined) throw new RangeError(`Index ${String(i)} out of range`);
  return value;
}

/** 'Mon' */
export function wd(iso: string): string {
  return at(WEEKDAYS_SHORT, weekdayOf(iso));
}

/** 'Monday' */
export function wdL(iso: string): string {
  return at(WEEKDAYS_LONG, weekdayOf(iso));
}

/** 'Oct' */
export function mon(iso: string): string {
  return at(MONTHS_SHORT, isoParts(iso).m - 1);
}

/** 'October' */
export function monL(iso: string): string {
  return at(MONTHS_LONG, isoParts(iso).m - 1);
}

/** Day of the month: 5 */
export function d(iso: string): number {
  return isoParts(iso).d;
}

/** 'Mon 5 Oct' */
export function s(iso: string): string {
  return `${wd(iso)} ${String(d(iso))} ${mon(iso)}`;
}

/** '5 Oct' */
export function dm(iso: string): string {
  return `${String(d(iso))} ${mon(iso)}`;
}

/** 'Monday 5 October' */
export function l(iso: string): string {
  return `${wdL(iso)} ${String(d(iso))} ${monL(iso)}`;
}

/** 'October 2026' for a `YYYY-MM` month or an ISO date. */
export function monthYear(monthOrIso: string): string {
  const y = monthOrIso.slice(0, 4);
  const m = Number(monthOrIso.slice(5, 7));
  return `${at(MONTHS_LONG, m - 1)} ${y}`;
}

/** 'BD3' */
export function bd(n: number): string {
  return `BD${String(n)}`;
}

/** A number without float noise: 0.75 → '0.75', 6 → '6', 9.500001 → '9.5'. */
export function num(n: number, decimals = 2): string {
  const f = 10 ** decimals;
  const rounded = Math.round(n * f) / f;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** Signed number with U+2212 for negatives: '+3', '−2', '0'. */
export function signed(n: number): string {
  if (n > 0) return `+${num(n)}`;
  if (n < 0) return `${MINUS}${num(-n)}`;
  return '0';
}

/**
 * Forecast delta against target, as the prototype's `deltaLabel`:
 * '+3 BD' / '−2 BD' / 'On target', or 'No forecast' when there is none.
 */
export function delta(n: number | null | undefined): string {
  if (n == null) return 'No forecast';
  if (n > 0) return `+${String(n)} BD`;
  if (n < 0) return `${MINUS}${String(-n)} BD`;
  return 'On target';
}

/** A plan-move label ('+3 BD', '−2 BD', '±0 BD'), used by the moved chip. */
export function deltaBD(n: number): string {
  if (n > 0) return `+${String(n)} BD`;
  if (n < 0) return `${MINUS}${String(-n)} BD`;
  return '±0 BD';
}

/** Days since the last check-in: 'Not yet' / 'Today' / 'Yesterday' / 'N days ago'. */
export function since(days: number | null | undefined): string {
  if (days == null) return 'Not yet';
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${String(days)} days ago`;
}

/** Hours: '6h', '0.5h', '9.5h'. */
export function hours(h: number): string {
  return `${num(h)}h`;
}

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st (the prototype's `ORD`). */
export function ord(n: number): string {
  const last = n % 10;
  if (last === 1 && n % 100 !== 11) return `${String(n)}st`;
  if (last === 2 && n % 100 !== 12) return `${String(n)}nd`;
  if (last === 3 && n % 100 !== 13) return `${String(n)}rd`;
  return `${String(n)}th`;
}

/** The word form for `n`: plural(1, 'day') → 'day', plural(2, 'day') → 'days'. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/** The count with its word: count(1, 'business day') → '1 business day'. */
export function count(n: number, one: string, many?: string): string {
  return `${String(n)} ${plural(n, one, many)}`;
}
