import { describe, expect, it } from 'vitest';

import type { IsoDate } from '../../lib/calendar';
import { initialNav, navReducer } from './nav';
import type { NavAction, NavBounds, NavState } from './nav';

const BOUNDS: NavBounds = { min: '2026-10', max: null };
const reduce = (s: NavState, ...actions: NavAction[]) => actions.reduce(navReducer(BOUNDS), s);
const start = initialNav(BOUNDS, null, null);
const iso = (v: string) => v as IsoDate;

describe('calendar navigation', () => {
  it('starts on today’s month, or the route’s month or day, never before today’s month', () => {
    expect(start).toEqual({ shown: '2026-10', target: '2026-10', dir: 1, sel: null });
    expect(initialNav(BOUNDS, '2026-11', iso('2026-11-04'))).toMatchObject({ shown: '2026-11', sel: '2026-11-04' });
    expect(initialNav(BOUNDS, null, iso('2027-01-04'))).toMatchObject({ shown: '2027-01', sel: '2027-01-04' });
    expect(initialNav(BOUNDS, '2026-08', null)).toMatchObject({ shown: '2026-10' });
  });

  it('lets the day decide the month when a link disagrees, and drops a day it cannot show', () => {
    expect(initialNav(BOUNDS, '2026-10', iso('2026-11-04'))).toMatchObject({ shown: '2026-11', sel: '2026-11-04' });
    expect(initialNav(BOUNDS, '2026-11', iso('2026-09-15'))).toMatchObject({ shown: '2026-11', sel: null });
    const capped: NavBounds = { min: '2026-10', max: '2036-12' };
    expect(initialNav(capped, null, iso('2037-01-05'))).toMatchObject({ shown: '2026-10', sel: null });
  });

  it('lands on a month known to load in one step, keeping a day only in that month', () => {
    const far = initialNav(BOUNDS, '2099-01', iso('2099-01-05'));
    expect(reduce(far, { type: 'land', month: '2026-10' })).toEqual({ shown: '2026-10', target: '2026-10', dir: 1, sel: null });
    const s = reduce(start, { type: 'toggle', iso: iso('2026-10-07') });
    expect(reduce(s, { type: 'land', month: '2026-10' })).toBe(s);
  });

  it('moves the target first and swaps the shown month later', () => {
    const s = reduce(start, { type: 'go', delta: 1 });
    expect(s).toMatchObject({ shown: '2026-10', target: '2026-11', dir: 1 });
    expect(reduce(s, { type: 'swap' })).toMatchObject({ shown: '2026-11', target: '2026-11' });
  });

  it('counts every click: two quick nexts move two months', () => {
    const s = reduce(start, { type: 'go', delta: 1 }, { type: 'go', delta: 1 }, { type: 'swap' });
    expect(s).toMatchObject({ shown: '2026-12', target: '2026-12' });
  });

  it('drifts back when going back, and stops at today’s month', () => {
    const dec = reduce(start, { type: 'go', delta: 2 }, { type: 'swap' });
    expect(reduce(dec, { type: 'go', delta: -1 })).toMatchObject({ target: '2026-11', dir: -1 });
    expect(reduce(start, { type: 'go', delta: -1 })).toBe(start);
    expect(reduce(dec, { type: 'thisMonth' })).toMatchObject({ target: '2026-10', dir: -1 });
    expect(reduce(start, { type: 'thisMonth' })).toBe(start);
  });

  it('is open-ended forward until the server’s end is known', () => {
    const far = reduce(start, { type: 'go', delta: 40 }, { type: 'swap' });
    expect(far.shown).toBe('2030-02');
    const capped = navReducer({ min: '2026-10', max: '2026-12' });
    expect(capped(start, { type: 'go', delta: 5 })).toMatchObject({ target: '2026-12' });
    expect(capped(far, { type: 'bounds' })).toMatchObject({ shown: '2026-12', target: '2026-12' });
  });

  it('clears the selection on a month change, not on a no-op', () => {
    const open = reduce(start, { type: 'toggle', iso: iso('2026-10-14') });
    expect(open.sel).toBe('2026-10-14');
    expect(reduce(open, { type: 'go', delta: 1 }).sel).toBeNull();
    expect(reduce(open, { type: 'thisMonth' }).sel).toBe('2026-10-14');
  });

  it('toggles and closes the day', () => {
    const open = reduce(start, { type: 'toggle', iso: iso('2026-10-14') });
    expect(reduce(open, { type: 'toggle', iso: iso('2026-10-14') }).sel).toBeNull();
    expect(reduce(open, { type: 'toggle', iso: iso('2026-10-15') }).sel).toBe('2026-10-15');
    expect(reduce(open, { type: 'close' }).sel).toBeNull();
  });

  it('steps across months at once, without a fade, but not before the first month', () => {
    const s = reduce(start, { type: 'step', iso: iso('2026-11-02') });
    expect(s).toMatchObject({ shown: '2026-11', target: '2026-11', sel: '2026-11-02' });
    const early = reduce(start, { type: 'toggle', iso: iso('2026-10-01') });
    expect(reduce(early, { type: 'step', iso: iso('2026-09-30') })).toBe(early);
  });

  it('applies a deep link at once and ignores one that changes nothing', () => {
    const s = reduce(start, { type: 'route', month: '2026-11', day: iso('2026-11-04') });
    expect(s).toMatchObject({ shown: '2026-11', target: '2026-11', sel: '2026-11-04' });
    expect(reduce(s, { type: 'route', month: '2026-11', day: iso('2026-11-04') })).toBe(s);
  });
});
