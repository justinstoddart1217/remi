import { describe, expect, it } from 'vitest';

import { CalendarIndex } from '../../lib/calendar';
import { fixturePlan, fixtureProject } from '../../test/msw/fixtures';
import {
  CAP_BARS,
  capacityBars,
  countdownWords,
  dayPart,
  ganttRows,
  greeting,
  headline,
  hoverTotal,
  keyFooter,
  makeAxis,
  MAX_ROWS,
  MOVE_X,
  planMeta,
  textbookMeta,
  TODAY_X,
} from './model';

const plan = fixturePlan();
const index = new CalendarIndex(plan.calendar.days);
const TODAY = '2026-10-05';
const MOVE = '2027-01-04';

describe('Home copy', () => {
  it('follows the real clock: morning before 12, afternoon before 18', () => {
    expect([dayPart(0), dayPart(11), dayPart(12), dayPart(17), dayPart(18), dayPart(23)]).toEqual([
      'morning',
      'morning',
      'afternoon',
      'afternoon',
      'evening',
      'evening',
    ]);
    expect(greeting(9, TODAY)).toBe('Good morning · Monday 5 October');
    expect(greeting(19, null)).toBe('Good evening');
    expect(headline(14)).toBe('Where to this afternoon?');
  });

  it('pluralises every count, with real zeros (no "|| 5" fallback)', () => {
    expect(planMeta(5, 2, 3)).toBe('5 projects · 2 routines · 3 notes today');
    expect(planMeta(1, 1, 1)).toBe('1 project · 1 routine · 1 note today');
    expect(planMeta(0, 0, 0)).toBe('0 projects · 0 routines · 0 notes today');
    expect(textbookMeta(4, 1)).toBe('4 pages · 1 live chart');
    expect(textbookMeta(1, 0)).toBe('1 page · 0 live charts');
    expect(countdownWords(61)).toBe('business days to Fixed Income');
    expect(countdownWords(1)).toBe('business day to Fixed Income');
  });

  it('writes the key project footer, the hover demo, and the empty plan', () => {
    const key = { name: 'Returns pipeline automation', short: 'Returns pipeline', forecastDate: '2026-12-02', deltaBd: 3 };
    expect(keyFooter(key)).toEqual({ name: 'Returns pipeline', forecast: 'Wed 2 Dec', delta: '+3 BD', tone: 'risk' });
    expect(keyFooter(key, { forecast: '2026-12-07', deltaBd: 6 })).toMatchObject({ forecast: 'Mon 7 Dec', delta: '+6 BD' });
    expect(keyFooter({ ...key, deltaBd: 0 })).toMatchObject({ tone: 'neutral' });
    expect(keyFooter({ ...key, forecastDate: null, deltaBd: null })).toEqual({
      name: 'Returns pipeline',
      forecast: 'Not yet',
      delta: 'no plan',
      tone: 'neutral',
    });
    expect(keyFooter(null)).toEqual({ name: 'No projects yet', forecast: 'Not yet', delta: 'no plan', tone: 'neutral' });
  });
});

describe('preview geometry', () => {
  const axis = makeAxis(index, TODAY, MOVE);

  it('puts today at 4% and the move at 84%', () => {
    expect(axis.moveOff).toBe(index.bdDiff(TODAY, MOVE));
    expect(axis.x(TODAY)).toBeCloseTo(TODAY_X);
    expect(axis.x(MOVE)).toBeCloseTo(MOVE_X);
    expect(axis.x('1999-01-01')).toBe(-Infinity);
    expect(axis.x('2099-01-01')).toBe(Infinity);
  });

  it('draws thirty bars scaled to capacity × 1.25, with overloads and the move in their colours', () => {
    const bars = capacityBars(index, plan.loads, axis, TODAY, 8);
    expect(bars).toHaveLength(CAP_BARS);
    // Today sits at 4%, inside the second of the thirty slices.
    const today = Math.floor(TODAY_X * CAP_BARS);
    expect(bars[today]?.h).toBeCloseTo(8 / 10);
    const over = bars.findIndex((b) => b.tone === 'over');
    expect(over).toBeGreaterThan(0);
    expect(bars[over]?.h).toBeCloseTo(9.5 / 10);
    expect(bars.at(-1)?.tone).toBe('fi');
    expect(bars.every((b) => b.h >= 0 && b.h <= 1)).toBe(true);
  });

  it('shows the hover demo’s hours in place of the key project’s', () => {
    const hover = { projectId: 'ret', planFrom: TODAY, dayHours: { [TODAY]: 4 }, overDays: [TODAY] };
    const bars = capacityBars(index, plan.loads, axis, TODAY, 8, hover);
    expect(bars[Math.floor(TODAY_X * CAP_BARS)]).toEqual({ h: 10 / 10, tone: 'over' });
  });

  it('keeps the load of days before the preview’s planFrom (history is not re-planned)', () => {
    const day = plan.loads[TODAY];
    if (!day) throw new Error('fixture has no load for today');
    // The preview plans from tomorrow: today (8h, ret 2h) keeps its whole load.
    const later = { projectId: 'ret', planFrom: '2026-10-06', dayHours: { '2026-10-06': 4 }, overDays: [] };
    expect(hoverTotal(day, TODAY, later)).toBe(8);
    const bars = capacityBars(index, plan.loads, axis, TODAY, 8, later);
    expect(bars[Math.floor(TODAY_X * CAP_BARS)]).toEqual({ h: 8 / 10, tone: 'pc' });
    // From planFrom on, a day missing from dayHours has no hours of the project left.
    const from = { projectId: 'ret', planFrom: TODAY, dayHours: {}, overDays: [] };
    expect(hoverTotal(day, TODAY, from)).toBe(6);
  });

  it('draws late projects to their target with a risk overrun and a dashed target ghost', () => {
    const [row] = ganttRows([fixtureProject()], axis, false, null);
    const tgt = axis.x('2026-11-27');
    const end = axis.x('2026-12-02');
    expect(row?.x).toBe(0);
    expect(row?.w).toBeCloseTo(tgt);
    expect(row?.ox).toBeCloseTo(tgt);
    expect(row?.ow).toBeCloseTo(end - tgt);
    expect(row?.go).toBe(0.4);
  });

  it('on hover moves the key project to the preview and ghosts where it was', () => {
    const [row] = ganttRows([fixtureProject()], axis, true, { projectId: 'ret', forecast: '2026-12-07' });
    expect((row?.ox ?? 0) + (row?.ow ?? 0)).toBeCloseTo(axis.x('2026-12-07'));
    expect(row?.gw).toBeCloseTo(axis.x('2026-12-02'));
    expect(row?.go).toBe(0.9);
  });

  it('hatches a project without a forecast from start to target, and caps at five rows', () => {
    const define = fixtureProject({ id: 'new', forecastDate: null });
    const [row] = ganttRows([define], axis, false, null);
    expect(row?.hatch).toBe(true);
    expect(row?.ow).toBe(0);
    const many = Array.from({ length: 7 }, (_, i) => fixtureProject({ id: `p${String(i)}` }));
    expect(ganttRows(many, axis, false, null)).toHaveLength(MAX_ROWS);
  });
});
