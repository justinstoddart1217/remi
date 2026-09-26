/**
 * The Calendar's navigation state (Calendar.dc.html:130-138, 183): the month on screen, the
 * month it is fading to, and the selected day. A pure reducer, so the rules are testable:
 *
 * - Header navigation is a functional update from the month being navigated to, so two quick
 *   clicks move two months (the prototype read a stale index and moved one). The swap is
 *   debounced by the caller (130ms after the last click), and a month change clears the
 *   selection (arch-frontend-screens, Calendar "Tricky").
 * - 'This month' is today's month, not the first of a fixed list.
 * - Months are open-ended forward; nothing before today's month is shown.
 * - Panel prev/next and deep links switch the month at once, with no fade.
 */

import type { IsoDate, IsoMonth } from '../../lib/calendar';
import { addMonths, monthOf } from '../../lib/calendar';
import { clampMonth, monthDiff } from './model';

export interface NavState {
  /** The month on screen. */
  shown: IsoMonth;
  /** The month being navigated to (equals `shown` unless a fade is running). */
  target: IsoMonth;
  /** +1 forward, −1 back: the side the outgoing grid drifts away from. */
  dir: 1 | -1;
  sel: IsoDate | null;
}

export interface NavBounds {
  /** Today's month: the first month shown, and 'This month'. */
  min: IsoMonth;
  /** The last month the server can answer, once known (null = open-ended). */
  max: IsoMonth | null;
}

export type NavAction =
  | { type: 'go'; delta: number }
  | { type: 'thisMonth' }
  | { type: 'swap' }
  | { type: 'toggle'; iso: IsoDate }
  | { type: 'step'; iso: IsoDate }
  | { type: 'close' }
  | { type: 'route'; month: IsoMonth | null; day: IsoDate | null }
  | { type: 'land'; month: IsoMonth }
  | { type: 'bounds' };

/**
 * A deep link's month and day. The day wins when the two disagree (the panel then opens on
 * its own month, with the day ringed); a day outside the months the Calendar shows is dropped.
 */
export function initialNav(bounds: NavBounds, month: IsoMonth | null, day: IsoDate | null): NavState {
  const dayMonth = day ? monthOf(day) : null;
  const sel = dayMonth !== null && clampMonth(dayMonth, bounds.min, bounds.max) === dayMonth ? day : null;
  const m = clampMonth(sel ? monthOf(sel) : (month ?? bounds.min), bounds.min, bounds.max);
  return { shown: m, target: m, dir: 1, sel };
}

function moveTo(s: NavState, next: IsoMonth): NavState {
  if (next === s.target) return s;
  const d = monthDiff(s.shown, next);
  return { ...s, target: next, dir: d < 0 ? -1 : 1, sel: null };
}

export function navReducer(bounds: NavBounds) {
  return (s: NavState, a: NavAction): NavState => {
    switch (a.type) {
      case 'go':
        return moveTo(s, clampMonth(addMonths(s.target, a.delta), bounds.min, bounds.max));
      case 'thisMonth':
        return moveTo(s, bounds.min);
      case 'swap':
        return s.shown === s.target ? s : { ...s, shown: s.target };
      case 'toggle':
        return { ...s, sel: s.sel === a.iso ? null : a.iso };
      case 'step': {
        const m = monthOf(a.iso);
        if (clampMonth(m, bounds.min, bounds.max) !== m) return s;
        return { ...s, sel: a.iso, shown: m, target: m };
      }
      case 'close':
        return s.sel === null ? s : { ...s, sel: null };
      case 'route': {
        const next = initialNav(bounds, a.month, a.day);
        if (next.shown === s.shown && next.target === s.target && next.sel === s.sel) return s;
        return { ...next, dir: s.dir };
      }
      case 'land': {
        // Straight to a month known to load (a link past the server's range), with no fade.
        const m = clampMonth(a.month, bounds.min, bounds.max);
        const sel = s.sel && monthOf(s.sel) === m ? s.sel : null;
        return s.shown === m && s.target === m && s.sel === sel ? s : { ...s, shown: m, target: m, sel };
      }
      case 'bounds': {
        const shown = clampMonth(s.shown, bounds.min, bounds.max);
        const target = clampMonth(s.target, bounds.min, bounds.max);
        return shown === s.shown && target === s.target ? s : { ...s, shown, target };
      }
    }
  };
}
