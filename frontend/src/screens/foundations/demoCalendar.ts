/**
 * A tiny business calendar for the Foundations date-picker demo only. The app gets these
 * answers from the server's calendar days (lib/calendar.ts); this stub mirrors the fixture
 * range (31 Aug 2026 – 30 Apr 2027) and its England bank holidays.
 */
import type { PickerCalendar } from '../../components';

const HOLIDAYS: Readonly<Record<string, string>> = {
  '2026-08-31': 'Summer bank holiday',
  '2026-12-25': 'Christmas Day',
  '2026-12-28': 'Boxing Day (substitute day)',
  '2027-01-01': 'New Year’s Day',
  '2027-03-26': 'Good Friday',
  '2027-03-29': 'Easter Monday',
};
const FROM = '2026-08-31';
const TO = '2027-04-30';
const DAY_MS = 86_400_000;

const dn = (iso: string) => {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
};
const iso = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const weekday = (n: number) => new Date(n * DAY_MS).getUTCDay();

export const DEMO_TODAY = '2026-10-05';

export const demoCalendar: PickerCalendar = {
  inRange: (d) => d >= FROM && d <= TO,
  isBd: (d) => {
    const w = weekday(dn(d));
    return w !== 0 && w !== 6 && !(d in HOLIDAYS);
  },
  holiday: (d) => HOLIDAYS[d] ?? null,
  bdm: (d) => {
    if (!demoCalendar.isBd(d)) return null;
    let k = 0;
    for (let n = dn(`${d.slice(0, 8)}01`); n <= dn(d); n++) if (demoCalendar.isBd(iso(n))) k++;
    return k;
  },
  nextBD: (d) => {
    let n = dn(d);
    while (!demoCalendar.isBd(iso(n)) && iso(n) <= TO) n++;
    return iso(n);
  },
};
