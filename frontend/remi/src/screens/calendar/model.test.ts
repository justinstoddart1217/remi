import { describe, expect, it } from 'vitest';

import type { DayLoadOut, DayOut, ProjectOut } from '../../api';
import { CalendarIndex } from '../../lib/calendar';
import type { IsoDate } from '../../lib/calendar';
import { buildCalendarDays } from '../../test/fixtures/calendar';
import { fixtureProject, fixtureRoutine } from '../../test/msw';
import {
  buildCells,
  capacityLabel,
  cellLabel,
  clampMonth,
  dayFacts,
  dueItems,
  emptyCopy,
  gridRange,
  isIsoMonth,
  kicker,
  monthDiff,
  monthSubline,
  moveFocus,
  neededRange,
  panelSub,
  panelTitle,
  planRows,
  rovingFocus,
  stepBusinessDay,
} from './model';
import type { Loads } from './model';

const index = new CalendarIndex(buildCalendarDays('2026-08-31', '2027-04-30'));
const TODAY = '2026-10-05';
const MOVE = '2027-01-04';

function load(items: DayLoadOut['items'], capacity = 8): DayLoadOut {
  const bau = items.filter((i) => i.refType !== 'project').reduce((a, i) => a + i.h, 0);
  const proj = items.filter((i) => i.refType === 'project').reduce((a, i) => a + i.h, 0);
  const total = bau + proj;
  return { items, bau, proj, total, free: Math.max(0, capacity - total), capacity, over: total > capacity };
}

const ORDINARY = load([
  { refType: 'project', refId: 'ret', domain: 'pc', h: 3.5, name: 'Returns pipeline' },
  { refType: 'project', refId: 'manco', domain: 'pc', h: 1.5, name: 'ManCo automation' },
  { refType: 'project', refId: 'fion', domain: 'fi', h: 1, name: 'FI onboarding' },
]);
const BD3 = load([
  { refType: 'routine', refId: 'r-ret', domain: 'pc', h: 6, name: 'Returns' },
  { refType: 'project', refId: 'manco', domain: 'pc', h: 2, name: 'ManCo automation' },
]);
const OVER = load([
  { refType: 'routine', refId: 'r-ret', domain: 'pc', h: 6, name: 'Returns' },
  { refType: 'project', refId: 'ret', domain: 'pc', h: 3.5, name: 'Returns pipeline' },
]);
const ROTATION = load([
  { refType: 'rotation', refId: 'rot-0', domain: 'fi', h: 4, name: 'Germany · Build' },
  { refType: 'project', refId: 'fion', domain: 'fi', h: 1, name: 'FI onboarding' },
]);

function milestone(name: string, date: string) {
  return { milestoneId: null, name, date, horizon: 'now' as const, done: false, passed: date < TODAY };
}

const RET: ProjectOut = fixtureProject({
  id: 'ret',
  name: 'Returns pipeline automation',
  short: 'Returns pipeline',
  endName: 'Handover-ready',
  targetDate: '2026-11-27',
  forecastDate: '2026-12-02',
  derived: {
    status: 'risk',
    milestones: [
      milestone('Security-level data feed connected', '2026-10-15'),
      milestone('Fund-level engine reconciles', '2026-10-16'),
    ],
  } as ProjectOut['derived'],
});
const MANCO: ProjectOut = fixtureProject({
  id: 'manco',
  name: 'ManCo pack automation',
  short: 'ManCo automation',
  endName: 'Handover-ready',
  targetDate: '2026-12-11',
  forecastDate: '2026-12-11',
  derived: {
    status: 'on',
    milestones: [milestone('Performance section builds itself', '2026-10-16'), milestone('Kick-off', '2026-10-01')],
  } as ProjectOut['derived'],
});
const FION: ProjectOut = fixtureProject({
  id: 'fion',
  domain: 'fi',
  name: 'FI onboarding & data access',
  short: 'FI onboarding',
  endName: 'Day one',
  targetDate: MOVE,
  forecastDate: MOVE,
  derived: { status: 'on', milestones: [milestone('Data entitlements requested', '2026-10-16')] } as ProjectOut['derived'],
});
const PROJECTS = [RET, MANCO, FION];
const LOADS: Loads = { '2026-10-01': ORDINARY, '2026-10-05': BD3, '2026-10-16': ORDINARY, '2026-11-04': OVER, '2027-01-04': ROTATION };

function octoberCells() {
  const grid = index.monthGrid('2026-10');
  if (!grid) throw new Error('no grid');
  return { weeks: grid.weeks, cells: buildCells(grid.weeks, { today: TODAY, projects: PROJECTS, loads: LOADS }) };
}

describe('months', () => {
  it('validates and compares year + month', () => {
    expect(isIsoMonth('2026-10')).toBe(true);
    expect(isIsoMonth('2026-13')).toBe(false);
    expect(isIsoMonth('oct')).toBe(false);
    expect(monthDiff('2026-10', '2027-01')).toBe(3);
    expect(monthDiff('2027-10', '2026-10')).toBe(-12);
    expect(clampMonth('2026-09', '2026-10', null)).toBe('2026-10');
    expect(clampMonth('2040-01', '2026-10', null)).toBe('2040-01');
    expect(clampMonth('2037-01', '2026-10', '2036-12')).toBe('2036-12');
  });

  it('pads a month to whole Monday-first weeks', () => {
    expect(gridRange('2026-10')).toEqual({ from: '2026-09-28', to: '2026-11-01' });
    expect(gridRange('2026-11')).toEqual({ from: '2026-10-26', to: '2026-12-06' });
    expect(gridRange('2027-02')).toEqual({ from: '2027-02-01', to: '2027-02-28' });
  });

  it('asks for a week either side, except before the first month, and covers the selection', () => {
    expect(neededRange('2026-10', { isFirstMonth: true })).toEqual({ from: '2026-09-28', to: '2026-11-08' });
    expect(neededRange('2026-11', { isFirstMonth: false })).toEqual({ from: '2026-10-19', to: '2026-12-13' });
    expect(neededRange('2026-10', { isFirstMonth: true, sel: '2027-01-04' })).toEqual({ from: '2026-09-28', to: '2027-01-11' });
  });
});

describe('cells', () => {
  it('builds 35 October cells from Mon 28 Sep to Sun 1 Nov', () => {
    const { cells } = octoberCells();
    expect(cells).toHaveLength(35);
    expect(cells[0]).toMatchObject({ iso: '2026-09-28', inMonth: false, bd: 'BD20', chips: [], bars: [], load: null });
    expect(cells[34]).toMatchObject({ iso: '2026-11-01', inMonth: false, sunday: true, weekend: true, bd: '' });
  });

  it('shows BAU chips, bars and the meter on in-month business days', () => {
    const { cells } = octoberCells();
    const today = cells.find((c) => c.iso === '2026-10-05');
    expect(today).toMatchObject({ isToday: true, bd: 'BD3', tinted: false });
    expect(today?.chips.map((c) => c.label)).toEqual(['Returns · 6h']);
    expect(today?.chips[0]?.hover).toEqual({ type: 'routine', id: 'r-ret' });
    expect(today?.bars.map((b) => [b.label, b.title, b.width])).toEqual([['ManCo automation 2h', 'ManCo pack automation · 2h', 15.5]]);
    expect(today?.load?.total).toBe(8);
  });

  it('lists milestones in project order, with past ones filled', () => {
    const { cells } = octoberCells();
    const fri16 = cells.find((c) => c.iso === '2026-10-16');
    expect(fri16?.marks.map((m) => m.name)).toEqual([
      'Fund-level engine reconciles',
      'Performance section builds itself',
      'Data entitlements requested',
    ]);
    expect(fri16?.marks[2]).toMatchObject({ color: 'var(--fi-accent)', filled: false, hover: { type: 'project', id: 'fion' } });
    const oct1 = cells.find((c) => c.iso === '2026-10-01');
    expect(oct1?.marks[0]).toMatchObject({ name: 'Kick-off', filled: true });
  });

  it('draws the forecast end in the risk colour when late, and weekends with a tint and no content', () => {
    const grid = index.monthGrid('2026-12');
    if (!grid) throw new Error('no grid');
    const cells = buildCells(grid.weeks, { today: TODAY, projects: PROJECTS, loads: { '2026-12-02': ORDINARY } });
    const dec2 = cells.find((c) => c.iso === '2026-12-02');
    expect(dec2?.marks).toEqual([
      expect.objectContaining({ name: 'Returns pipeline · handover-ready', color: 'var(--risk)', filled: true }),
    ]);
    const xmas = cells.find((c) => c.iso === '2026-12-25');
    expect(xmas).toMatchObject({ holiday: 'Christmas Day', tinted: true, bd: '', marks: [], load: null });
    const sat = cells.find((c) => c.iso === '2026-12-05');
    expect(sat).toMatchObject({ weekend: true, tinted: true, sunday: false });
  });

  it('turns every bar red on an overloaded day', () => {
    const grid = index.monthGrid('2026-11');
    if (!grid) throw new Error('no grid');
    const cells = buildCells(grid.weeks, { today: TODAY, projects: PROJECTS, loads: LOADS });
    expect(cells).toHaveLength(42);
    const nov4 = cells.find((c) => c.iso === '2026-11-04');
    expect(nov4?.bars.map((b) => b.color)).toEqual(['var(--overload)']);
    expect(nov4?.bars[0]?.width).toBeCloseTo(27.125);
  });

  it('counts business days and overloaded days for the sub-line', () => {
    expect(monthSubline(octoberCells().weeks, LOADS)).toBe('22 business days');
    const nov = index.monthGrid('2026-11');
    expect(nov && monthSubline(nov.weeks, LOADS)).toBe('21 business days · 1 overloaded');
    const dec = index.monthGrid('2026-12');
    expect(dec && monthSubline(dec.weeks, undefined)).toBe('21 business days');
  });

  it('names a cell for assistive tech', () => {
    const cell = octoberCells().cells.find((c) => c.iso === '2026-10-05');
    expect(cell && cellLabel(cell)).toBe('Monday 5 October, BD3, Returns · 6h, 8h planned');
  });
});

describe('the day panel', () => {
  const facts = (iso: string) => {
    const f = dayFacts(index, iso as IsoDate);
    if (!f) throw new Error(iso);
    return f;
  };

  it('words the kicker in business days', () => {
    const k = (iso: string, region = 'GB-ENG') => kicker(facts(iso), TODAY, index.bdDiff(TODAY, iso), region);
    expect(k('2026-10-05')).toBe('Today');
    expect(k('2026-10-06')).toBe('Tomorrow');
    expect(k('2026-10-14')).toBe('7 business days ahead');
    expect(k('2026-11-04')).toBe('22 business days ahead');
    expect(k('2026-10-02')).toBe('1 business day ago');
    expect(k('2026-10-01')).toBe('2 business days ago');
    expect(k('2026-10-10')).toBe('Weekend');
    expect(k('2026-12-25')).toBe('Bank holiday');
    expect(k('2026-12-25', 'ZA')).toBe('Public holiday');
    // 'Tomorrow' counts business days: Monday from a Friday.
    expect(kicker(facts('2026-10-12'), '2026-10-09', index.bdDiff('2026-10-09', '2026-10-12'))).toBe('Tomorrow');
  });

  it('writes the title and sub-line', () => {
    expect(panelTitle('2026-10-14')).toBe('Wednesday 14 October');
    expect(panelSub(facts('2026-10-14'), MOVE)).toBe('BD10 of October');
    expect(panelSub(facts('2027-01-04'), MOVE)).toBe('BD1 of January · Fixed Income');
    expect(panelSub(facts('2026-12-25'), MOVE)).toBe('Christmas Day');
    expect(panelSub(facts('2026-10-10'), MOVE)).toBe('Not a business day');
  });

  it('labels capacity from the plan capacity', () => {
    expect(capacityLabel(ORDINARY)).toBe('6h of 8h · 2h free');
    expect(capacityLabel(BD3)).toBe('8h of 8h · 0h free');
    expect(capacityLabel(OVER)).toBe('9.5h planned · 1.5h over');
    expect(capacityLabel(load(ORDINARY.items, 7.5))).toBe('6h of 7.5h · 1.5h free');
  });

  it('has the empty copy for weekends, holidays and free days', () => {
    expect(emptyCopy(facts('2026-10-10'), null)).toBe('Weekend. Nothing is planned.');
    expect(emptyCopy(facts('2026-12-25'), null)).toBe('Christmas Day. Nothing is planned, and business-day numbers skip it.');
    expect(emptyCopy(facts('2026-10-14'), load([]))).toBe('Nothing planned. A free day.');
    expect(emptyCopy(facts('2026-10-14'), ORDINARY)).toBeNull();
  });

  it('builds plan rows with full names and the day’s tasks', () => {
    const day = {
      day: '2026-10-05',
      focusBlocks: [
        {
          projectId: 'manco',
          hours: 2,
          offsetH: 0,
          emptyReason: null,
          nextMilestone: null,
          tasks: [
            {
              id: 'man-0',
              text: 'Send the NAV bridge spec to Finance',
              hours: 0.5,
              done: false,
              doneOn: null,
              dueDate: null,
              milestoneId: 'm',
            },
            {
              id: 'man-1',
              text: 'Map NAV bridge to source tables',
              hours: 0.75,
              done: false,
              doneOn: null,
              dueDate: null,
              milestoneId: 'm',
            },
          ],
        },
      ],
    } as unknown as DayOut;
    const routines = [fixtureRoutine({ name: 'Fund & security-level returns' })];
    const rows = planRows(BD3, { projects: PROJECTS, routines, day, showTasks: true });
    expect(rows.map((r) => [r.hours, r.kind, r.name, r.projectId])).toEqual([
      ['6h', 'BAU · Private Credit', 'Fund & security-level returns', null],
      ['2h', 'Project · Private Credit', 'ManCo pack automation', 'manco'],
    ]);
    expect(rows[1]?.tasks.map((t) => `${t.text} ${t.hours}`)).toEqual([
      'Send the NAV bridge spec to Finance 0.5h',
      'Map NAV bridge to source tables 0.75h',
    ]);
    expect(planRows(BD3, { projects: PROJECTS, routines, day, showTasks: false })[1]?.tasks).toEqual([]);
    // The rotation keeps its segment name and lights up the rotation.
    const rot = planRows(ROTATION, { projects: PROJECTS, routines, day: null, showTasks: true });
    expect(rot[0]).toMatchObject({ kind: 'BAU · Fixed Income', name: 'Germany · Build', hover: { type: 'rotation', id: 'rotation' } });
    expect(rot[1]).toMatchObject({ kind: 'Project · Fixed Income', name: 'FI onboarding & data access' });
  });

  it('lists what is due: milestones, forecast ends, targets and the move', () => {
    expect(dueItems('2026-10-16', PROJECTS, MOVE).map((d) => d.name)).toEqual([
      'Fund-level engine reconciles · Returns pipeline',
      'Performance section builds itself · ManCo automation',
      'Data entitlements requested · FI onboarding',
    ]);
    expect(dueItems('2026-11-27', PROJECTS, MOVE)).toEqual([
      { key: 't:ret', name: 'Returns pipeline · target', color: 'var(--ink)', filled: false },
    ]);
    expect(dueItems('2026-12-02', PROJECTS, MOVE)[0]).toMatchObject({
      name: 'Returns pipeline · handover-ready (forecast)',
      color: 'var(--risk)',
      filled: true,
    });
    expect(dueItems(MOVE, PROJECTS, MOVE).map((d) => d.name)).toEqual([
      'FI onboarding · day one (forecast)',
      'FI onboarding · target',
      'Move to Fixed Income',
    ]);
    expect(dueItems('2026-10-20', PROJECTS, MOVE)).toEqual([]);
  });

  it('steps business days across weekends, holidays and months', () => {
    expect(stepBusinessDay(index, '2026-10-30', 1)).toBe('2026-11-02');
    expect(stepBusinessDay(index, '2026-11-02', -1)).toBe('2026-10-30');
    expect(stepBusinessDay(index, '2026-12-24', 1)).toBe('2026-12-29');
    expect(stepBusinessDay(index, '2026-10-10', 1)).toBe('2026-10-12');
    expect(stepBusinessDay(index, '2026-10-10', -1)).toBe('2026-10-09');
    expect(stepBusinessDay(index, '2027-04-30', 1)).toBeNull();
    expect(stepBusinessDay(undefined, '2026-10-30', 1)).toBeNull();
  });
});

describe('keyboard', () => {
  it('puts the tab stop on the selection, else today, else the 1st', () => {
    const { cells } = octoberCells();
    expect(rovingFocus(cells, '2026-10-14')).toBe('2026-10-14');
    expect(rovingFocus(cells, null)).toBe('2026-10-05');
    expect(rovingFocus(cells, '2026-11-01')).toBe('2026-10-05');
    const nov = index.monthGrid('2026-11');
    if (!nov) throw new Error('no grid');
    expect(rovingFocus(buildCells(nov.weeks, { today: TODAY, projects: [], loads: {} }), null)).toBe('2026-11-01');
  });

  it('moves by day and week, within the month', () => {
    const { cells } = octoberCells();
    const at = (iso: string) => cells.findIndex((c) => c.iso === iso);
    const iso = (k: number | null) => (k === null ? null : cells[k]?.iso);
    expect(iso(moveFocus(cells, at('2026-10-05'), 'ArrowRight'))).toBe('2026-10-06');
    expect(iso(moveFocus(cells, at('2026-10-05'), 'ArrowDown'))).toBe('2026-10-12');
    expect(iso(moveFocus(cells, at('2026-10-05'), 'End'))).toBe('2026-10-11');
    expect(iso(moveFocus(cells, at('2026-10-01'), 'ArrowLeft'))).toBeNull();
    expect(iso(moveFocus(cells, at('2026-10-01'), 'Home'))).toBeNull();
    expect(moveFocus(cells, at('2026-10-05'), 'Tab')).toBeNull();
  });
});
