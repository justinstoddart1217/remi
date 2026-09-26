import { describe, expect, it } from 'vitest';

import { dayNumber } from '../../lib/calendar';
import { FIXTURE_DAYS, FIXTURE_MOVE, FIXTURE_TODAY } from '../../test/fixtures/calendar';
import {
  bands,
  dayLabels,
  indexDays,
  isoWeek,
  layoutTimeline,
  mondayOf,
  monthLabels,
  timelineWindow,
  weekLabels,
  windowTitle,
} from './geometry';
import type { Zoom } from './geometry';

const days = indexDays(FIXTURE_DAYS);
const dn = dayNumber;
/** The chart width at 1920: 1920 - 88 (rail) - 96 (padding) - 280 (labels). */
const W = 1456;

function layout(zoom: Zoom = '3m', week = 0, width = W) {
  const win = timelineWindow(FIXTURE_TODAY, FIXTURE_MOVE);
  return layoutTimeline({ days, t0: win.t0, t1: win.t1, zoom, week, anchor: win.anchor, width });
}

describe('timelineWindow', () => {
  it('derives the design window from today and the move', () => {
    const win = timelineWindow(FIXTURE_TODAY, FIXTURE_MOVE);
    expect(win.t0).toBe(dn('2026-09-28'));
    expect(win.t1).toBe(dn('2027-01-15'));
    expect(win.anchor).toBe(dn('2026-10-05'));
    expect([win.wkMin, win.wkMax]).toEqual([-1, 13]);
  });

  it('runs to the Friday after the move week when the move is further out', () => {
    const win = timelineWindow(FIXTURE_TODAY, '2027-03-03');
    expect(win.t1).toBe(dn('2027-03-12'));
    expect(win.wkMax).toBe(Math.floor((dn('2027-03-01') - dn('2026-10-05')) / 7));
  });

  it('keeps at least sixteen weeks after the move has passed', () => {
    const win = timelineWindow('2027-02-10', '2027-01-04');
    expect(win.t0).toBe(dn('2027-02-01'));
    expect(win.t1).toBe(dn('2027-02-01') + 109);
  });

  it('clamps to the calendar it has', () => {
    const win = timelineWindow(FIXTURE_TODAY, FIXTURE_MOVE, { first: '2026-09-30', last: '2027-01-08' });
    expect(win.t0).toBe(dn('2026-09-30'));
    expect(win.t1).toBe(dn('2027-01-08'));
  });

  it('finds the Monday of a week', () => {
    expect(mondayOf(dn('2026-10-05'))).toBe(dn('2026-10-05'));
    expect(mondayOf(dn('2026-10-11'))).toBe(dn('2026-10-05'));
    expect(mondayOf(dn('2026-10-10'))).toBe(dn('2026-10-05'));
  });
});

describe('layoutTimeline, three months', () => {
  const L = layout();

  it('has 77 business-day columns and 15 slivers that fill the width exactly', () => {
    expect(L.bdSlots).toHaveLength(77);
    expect(L.slots.filter((s) => s.kind === 'gap')).toHaveLength(15);
    expect(L.colW).toBeCloseTo((W - 15 * 5) / 77, 6);
    expect(L.total).toBeCloseTo(W, 6);
    expect(L.off).toBe(0);
  });

  it('collapses Christmas (Fri 25 to Mon 28 Dec) and New Year (Fri 1 to Sun 3 Jan) into one sliver each', () => {
    const gaps = L.slots.filter((s) => s.kind === 'gap');
    expect(gaps.some((g) => g.a === dn('2026-12-25') && g.b === dn('2026-12-28'))).toBe(true);
    expect(gaps.some((g) => g.a === dn('2027-01-01') && g.b === dn('2027-01-03'))).toBe(true);
  });

  it('places today and the move where the prototype does', () => {
    expect(L.cx(dn('2026-10-05'))).toBeCloseTo(5 * L.colW + 5 + L.colW / 2, 6);
    expect(L.cx(dn('2026-10-05'))).toBeCloseTo(103.6, 1);
    expect(L.lx(dn('2027-01-04'))).toBeCloseTo(67 * L.colW + 14 * 5, 6);
  });

  it('snaps a weekend date to the next business day, and parks dates outside the window', () => {
    expect(L.lx(dn('2026-10-10'))).toBe(L.lx(dn('2026-10-12')));
    expect(L.rx(dn('2026-12-26'))).toBe(L.rx(dn('2026-12-29')));
    expect(L.lx(dn('2026-09-01'))).toBe(-40);
    expect(L.lx(dn('2027-03-25'))).toBeCloseTo(L.total + 40, 6);
    expect(L.rx(dn('2027-03-25'))).toBeCloseTo(L.total + 80, 6);
  });

  it('labels the months, pinning and hiding narrow ones', () => {
    const months = monthLabels(L, days);
    expect(months.map((m) => m.label)).toEqual(['September 2026', 'October', 'November', 'December', 'January 2027']);
    expect(months[0]).toMatchObject({ x: 0, visible: false, border: true });
    expect(months.slice(1).every((m) => m.visible && m.border)).toBe(true);
    expect(months[4]?.w).toBeCloseTo(W - (months[4]?.x ?? 0), 6);
  });

  it('labels each ISO week at its first business day', () => {
    const weeks = weekLabels(L, days);
    expect(weeks.map((w) => w.label)).toEqual([
      'W40',
      'W41',
      'W42',
      'W43',
      'W44',
      'W45',
      'W46',
      'W47',
      'W48',
      'W49',
      'W50',
      'W51',
      'W52',
      'W53',
      'W1',
      'W2',
    ]);
    expect(weeks[14]?.n).toBe(dn('2027-01-04'));
  });

  it('labels days and business days, with today inverted and BD1 in ink', () => {
    const labels = dayLabels(L, days, dn(FIXTURE_TODAY));
    const today = labels.find((d) => d.today);
    expect(today).toMatchObject({ label: '5', bd: '3', iso: '2026-10-05' });
    expect(labels.find((d) => d.iso === '2026-10-01')).toMatchObject({ label: '1', bd: '1', first: true });
    expect(labels.filter((d) => d.today)).toHaveLength(1);
  });

  it('shades holiday slivers darker than weekends', () => {
    const b = bands(L, days);
    expect(b).toHaveLength(15);
    expect(b.filter((x) => x.holiday).map((x) => x.a)).toEqual([dn('2026-12-25'), dn('2027-01-01')]);
  });

  it('titles the window', () => {
    expect(windowTitle(L)).toEqual({ title: 'Three months', subtitle: '28 Sep 2026 – 15 Jan 2027 · 77 business days' });
  });
});

describe('layoutTimeline, two weeks', () => {
  it('fills the width with ten columns and two 18px slivers, offset to this Monday', () => {
    const L = layout('2w', 0);
    expect(L.visibleBd).toBe(10);
    expect(L.colW).toBeCloseTo((W - 36) / 10, 6);
    expect(L.lx(dn('2026-10-05'))).toBeCloseTo(0, 6);
    expect(L.rx(dn('2026-10-16')) + 18).toBeCloseTo(W, 6);
    expect(windowTitle(L)).toEqual({ title: 'Two weeks', subtitle: '5 Oct – 16 Oct · 10 business days' });
    const labels = dayLabels(L, days, dn(FIXTURE_TODAY));
    expect(labels.find((d) => d.today)).toMatchObject({ label: 'Mon 5', bd: 'BD3' });
  });

  it('pans by whole weeks', () => {
    expect(layout('2w', -1).lx(dn('2026-09-28'))).toBeCloseTo(0, 6);
    expect(layout('2w', 13).lx(dn('2027-01-04'))).toBeCloseTo(0, 6);
  });

  it('counts the real business days of a holiday fortnight', () => {
    const L = layout('2w', 11);
    expect(L.visibleBd).toBe(7);
    expect(windowTitle(L).subtitle).toBe('21 Dec – 1 Jan · 7 business days');
    expect(L.colW).toBeCloseTo((W - 2 * 18) / 7, 6);
  });
});

describe('isoWeek', () => {
  it('matches the server calendar', () => {
    for (const d of FIXTURE_DAYS) expect(isoWeek(dn(d.iso))).toBe(d.week);
  });
});
