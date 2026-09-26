/**
 * The top bar's live clock (Remi.dc.html `LondonClock`): the time now in the plan's business
 * timezone, 'HH:MM:SS' on a 24-hour clock, ticking every second, under the zone's city.
 *
 * The prototype hard-codes Europe/London and 'London'. Remi reads the business timezone the
 * plan is computed in (`plan.today.tz`, from Settings), so the clock and "today" always agree,
 * and names its city: the zone's last segment with underscores as spaces ('Europe/London' →
 * 'London', 'America/Argentina/Buenos_Aires' → 'Buenos Aires'). CSS upper-cases it, as the design
 * does, so screen readers still read a word.
 *
 * The time is the browser's clock (`Date.now()`), not the backend's: it is a clock, and
 * `REMI_TODAY` only pins the business date. In the parity runs the browser clock is pinned to
 * 09:30, so the clock reads 09:30:00 in both apps.
 */

import { useEffect, useState } from 'react';

/** The design's zone, used until the plan (or Settings) names one. */
export const DEFAULT_CLOCK_TZ = 'Europe/London';

const formatters = new Map<string, Intl.DateTimeFormat>();

/** en-GB 'HH:MM:SS' in `tz`; `null` for a zone this browser does not know. */
function formatterFor(tz: string): Intl.DateTimeFormat | null {
  const cached = formatters.get(tz);
  if (cached) return cached;
  try {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    formatters.set(tz, f);
    return f;
  } catch {
    return null;
  }
}

/** True for an IANA zone the browser can format in. */
export function isTimeZone(tz: string | null | undefined): tz is string {
  return typeof tz === 'string' && tz !== '' && formatterFor(tz) !== null;
}

/** The first usable zone: the plan's, Settings', the design's (Europe/London). */
export function clockZone(...candidates: (string | null | undefined)[]): string {
  return candidates.find(isTimeZone) ?? DEFAULT_CLOCK_TZ;
}

/** '09:30:00': the wall-clock time at `date` in `tz` (24-hour, en-GB). */
export function formatClock(date: Date, tz: string): string {
  const f = formatterFor(tz) ?? formatterFor(DEFAULT_CLOCK_TZ);
  return f ? f.format(date) : '';
}

/** The zone's city: its last segment, underscores as spaces ('Africa/Johannesburg' → 'Johannesburg'). */
export function clockCity(tz: string): string {
  const last = tz.split('/').pop() ?? tz;
  return last.replace(/_/g, ' ');
}

/** Milliseconds to the next whole second, so every tick lands on the second. */
export function msToNextSecond(now: number): number {
  const rest = now % 1000;
  return rest === 0 ? 1000 : 1000 - rest;
}

/** The current instant, refreshed on every whole second while mounted. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      const d = new Date();
      setNow(d);
      id = setTimeout(tick, msToNextSecond(d.getTime()));
    };
    id = setTimeout(tick, msToNextSecond(Date.now()));
    return () => {
      clearTimeout(id);
    };
  }, []);
  return now;
}
