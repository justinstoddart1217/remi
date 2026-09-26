/**
 * Day-number arithmetic for the date picker. ISO dates are split, never parsed with
 * `new Date(iso)`, so the local timezone can't shift a day. A day number is days since the
 * Unix epoch (the prototype's `F.dn`).
 */
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const MONTH_LONG = [
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

const DAY_MS = 86_400_000;

export function isoToDn(iso: string): number {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function dnToIso(dn: number): string {
  const dt = new Date(dn * DAY_MS);
  const y = String(dt.getUTCFullYear()).padStart(4, '0');
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Day number of the first of a month (month is 0-based and may overflow either way). */
export function firstOfMonth(year: number, month: number): number {
  return Math.round(Date.UTC(year, month, 1) / DAY_MS);
}

export function parts(dn: number): { y: number; m: number; d: number; wd: number } {
  const dt = new Date(dn * DAY_MS);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate(), wd: dt.getUTCDay() };
}

/** 'Mon 5 Oct' (the prototype's F.s). */
export function formatShort(dn: number): string {
  const { m, d, wd } = parts(dn);
  return `${WD[wd] ?? ''} ${String(d)} ${MON[m] ?? ''}`;
}
