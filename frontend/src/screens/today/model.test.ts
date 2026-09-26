import { describe, expect, it } from 'vitest';

import { addDays, CalendarIndex, weekdayOf } from '../../lib/calendar';
import type { CalendarDay } from '../../lib/calendar';
import {
  bauRowRule,
  capacityLabel,
  checklistUnit,
  dayCopy,
  dayOffText,
  dueLabel,
  kicker,
  loadItemKey,
  milestoneLine,
  mondayOf,
  monthBars,
  monthGroup,
  monthGroups,
  noBauText,
  overlayRows,
  resolveDay,
  rowText,
  ruleShort,
  runCardNote,
  runCardRule,
  weekLoadLabel,
  weekModel,
} from './model';
import type { DayLoadOut, MonthSnapshotRowOut } from './types';

/** Calendar days from `from` for `n` days; weekends and `holidays` are not business days. */
function days(from: string, n: number, holidays: Record<string, string> = {}): CalendarDay[] {
  const out: CalendarDay[] = [];
  const bdm = new Map<string, number>();
  for (let k = 0; k < n; k++) {
    const iso = addDays(from, k);
    const w = weekdayOf(iso);
    const hol = holidays[iso] ?? null;
    const bd = w >= 1 && w <= 5 && !hol;
    const month = iso.slice(0, 7);
    const m = bd ? (bdm.get(month) ?? 0) + 1 : bdm.get(month) ?? 0;
    bdm.set(month, m);
    out.push({ iso, w, bd, bdm: bd ? m : null, hol, week: 0 });
  }
  return out;
}

const load = (items: DayLoadOut['items'], capacity = 8): DayLoadOut => {
  const bau = items.filter((i) => i.refType !== 'project').reduce((n, i) => n + i.h, 0);
  const proj = items.filter((i) => i.refType === 'project').reduce((n, i) => n + i.h, 0);
  const total = bau + proj;
  return { items, bau, proj, total, free: Math.max(0, capacity - total), capacity, over: total > capacity };
};

describe('day copy', () => {
  const MON = { iso: '2026-10-05', isBd: true };
  const WED = { iso: '2026-10-07', isBd: true };
  const FRI = { iso: '2026-10-09', isBd: true };
  const SAT = { iso: '2026-10-10', isBd: false };
  const SUN = { iso: '2026-10-11', isBd: false };

  it('reads today, tomorrow, days ahead and days ago (a business-day today, as the prototype)', () => {
    expect(kicker('2026-10-05', 0, true, MON)).toBe('Today');
    expect(kicker('2026-10-06', 1, false, MON)).toBe('Tomorrow · preview');
    expect(kicker('2026-10-07', 2, false, MON)).toBe('Wednesday · 2 business days ahead');
    expect(kicker('2026-10-12', 5, false, MON)).toBe('Monday · 5 business days ahead');
    expect(kicker('2027-01-04', 62, false, MON)).toBe('Monday · 62 business days ahead');
    expect(kicker('2026-09-28', -5, false, MON)).toBe('Monday · 5 business days ago');
    expect(kicker('2026-10-06', -1, false, WED)).toBe('Yesterday · looking back');
  });

  it('keeps tomorrow and yesterday to the calendar across a weekend', () => {
    // Friday from Monday is one business day back, not yesterday.
    expect(kicker('2026-10-02', -1, false, MON)).toBe('Friday · 1 business day ago');
    expect(kicker('2026-10-01', -2, false, MON)).toBe('Thursday · 2 business days ago');
    // Monday from Friday is one business day on, not tomorrow.
    expect(kicker('2026-10-12', 1, false, FRI)).toBe('Monday · next business day');
    expect(kicker('2026-10-13', 2, false, FRI)).toBe('Tuesday · 2 business days ahead');
  });

  it('never calls a previewed day today when today is a weekend', () => {
    // bd_diff counts from the next business day: Monday is 0, Tuesday 1 from a Saturday.
    expect(kicker('2026-10-12', 0, false, SAT)).toBe('Monday · next business day');
    expect(kicker('2026-10-13', 1, false, SAT)).toBe('Tuesday · 2 business days ahead');
    expect(kicker('2026-10-16', 4, false, SAT)).toBe('Friday · 5 business days ahead');
    expect(kicker('2026-10-09', -1, false, SAT)).toBe('Friday · 1 business day ago');
    expect(kicker('2026-10-08', -2, false, SAT)).toBe('Thursday · 2 business days ago');
    // Sunday: Monday is the calendar's tomorrow, but only a business-day today has one.
    expect(kicker('2026-10-12', 0, false, SUN)).toBe('Monday · next business day');
    expect(dayCopy('2026-10-12', 0, false, SAT)).toMatchObject({
      kicker: 'Monday · next business day',
      capTitle: 'Monday’s capacity',
      planTitle: 'Monday’s plan',
    });
  });

  it('names the capacity and plan after the day', () => {
    expect(dayCopy('2026-10-05', 0, true, MON)).toEqual({
      kicker: 'Today',
      title: 'Monday 5 October',
      capTitle: 'Today’s capacity',
      planTitle: 'Today’s plan',
      planNote: 'BAU first, then focus blocks',
    });
    const wed = dayCopy('2026-11-04', 22, false, MON);
    expect(wed.capTitle).toBe('Wednesday’s capacity');
    expect(wed.planTitle).toBe('Wednesday’s plan');
    expect(wed.planNote).toBe('As planned today; it moves if the plan does');
    expect(dayCopy('2026-10-02', -1, false, MON).planNote).toBe('Looking back; the plan as it stands now');
  });

  it('labels capacity with rounded hours', () => {
    const full = load([
      { refType: 'routine', refId: 'r-ret', domain: 'pc', h: 6, name: 'Returns' },
      { refType: 'project', refId: 'manco', domain: 'pc', h: 2, name: 'ManCo automation' },
    ]);
    expect(capacityLabel(full)).toBe('8h of 8h planned · 0h free');
    const over = load([
      { refType: 'routine', refId: 'r-ret', domain: 'pc', h: 6, name: 'Returns' },
      { refType: 'project', refId: 'ret', domain: 'pc', h: 3.5000001, name: 'Returns pipeline' },
    ]);
    expect(capacityLabel(over)).toBe('9.5h planned · 1.5h over');
    expect(weekLoadLabel(over)).toBe('9.5h · over');
    expect(weekLoadLabel(load([{ refType: 'project', refId: 'x', domain: 'fi', h: 7, name: 'X' }]))).toBe('7h of 8h');
  });

  it('writes routine rules like the prototype', () => {
    expect(ruleShort({ kind: 'monthly', bd: 8, weekday: 1 })).toBe('BD8');
    expect(ruleShort({ kind: 'weekly', bd: 1, weekday: 3 })).toBe('Weekly · Wed');
    expect(ruleShort({ kind: 'daily', bd: 1, weekday: 1 })).toBe('Daily');
    expect(runCardRule({ kind: 'monthly', bd: 3, weekday: 1 })).toBe('BD3, monthly');
    expect(runCardRule({ kind: 'weekly', bd: 3, weekday: 5 })).toBe('Fri, weekly');
    expect(bauRowRule({ kind: 'monthly', bd: 8, weekday: 1 }, 1, 4)).toBe('BD8 · automating');
    expect(bauRowRule({ kind: 'monthly', bd: 8, weekday: 1 }, 3, 4)).toBe('BD8 · handed over');
    expect(bauRowRule(null, null, 4)).toBe('4h a day');
  });

  it('takes the checklist unit from the routine detail', () => {
    expect(checklistUnit('12 funds', 12)).toBe('funds');
    expect(checklistUnit('', 3)).toBe('items');
    expect(checklistUnit(null, 1)).toBe('item');
    expect(checklistUnit('12', 12)).toBe('items');
  });

  it('notes a previewed run only away from today', () => {
    expect(runCardNote(0, true, true)).toBe('');
    expect(runCardNote(22, false, false)).toBe('Fresh checklist for this run · ticking opens on the day');
    expect(runCardNote(-3, false, false)).toBe('Past run · the ticks are kept as they were');
  });

  it('says when the next run is, or drops the clause', () => {
    expect(noBauText({ afterMove: false, date: '2026-10-12' }, true)).toBe('No BAU on this day. The next run is Mon 12 Oct.');
    expect(noBauText({ afterMove: true, date: '2027-01-06' }, true)).toBe('No BAU on this day. The next run is after the move.');
    expect(noBauText(null, true)).toBe('No BAU on this day. The next run is after the move.');
    expect(noBauText(null, false)).toBe('No BAU on this day.');
    expect(dayOffText(null)).toBe('Weekend. Nothing is planned.');
    expect(dayOffText('Christmas Day', { afterMove: false, date: '2027-01-04' })).toBe(
      'Christmas Day. Nothing is planned, and business-day numbers skip it. The next run is Mon 4 Jan.',
    );
  });

  it('introduces the next milestone', () => {
    expect(milestoneLine({ name: 'Performance section builds itself', date: '2026-10-16', dueThisDay: false })).toBe(
      'Next milestone: Performance section builds itself · Fri 16 Oct',
    );
    expect(milestoneLine({ name: 'Parallel run on November BD3', date: '2026-11-04', dueThisDay: true })).toBe(
      'Milestone due this day: Parallel run on November BD3 · Wed 4 Nov',
    );
    expect(milestoneLine(null)).toBe('');
  });
});

describe('the selected day', () => {
  it('finds the Monday (a weekend looks at the next week)', () => {
    expect(mondayOf('2026-10-07')).toBe('2026-10-05');
    expect(mondayOf('2026-10-05')).toBe('2026-10-05');
    expect(mondayOf('2026-10-09')).toBe('2026-10-05');
    expect(mondayOf('2026-10-10')).toBe('2026-10-12');
    expect(mondayOf('2026-10-11')).toBe('2026-10-12');
  });

  it('falls back to today for missing, malformed and non-business days', () => {
    expect(resolveDay(null, '2026-10-05', null)).toBe('2026-10-05');
    expect(resolveDay('nonsense', '2026-10-05', null)).toBe('2026-10-05');
    expect(resolveDay('2026-02-30', '2026-10-05', null)).toBe('2026-10-05');
    expect(resolveDay('2026-10-10', '2026-10-05', false)).toBe('2026-10-05');
    expect(resolveDay('2026-10-12', '2026-10-05', true)).toBe('2026-10-12');
    // Unknown yet (outside the calendar): the day's own read decides later.
    expect(resolveDay('2030-01-07', '2026-10-05', null)).toBe('2030-01-07');
  });
});

describe('week strip', () => {
  const calendar = new CalendarIndex(days('2026-09-28', 100, { '2026-12-25': 'Christmas Day' }));
  const loads: Record<string, DayLoadOut> = {
    '2026-10-05': load([
      { refType: 'routine', refId: 'r-ret', domain: 'pc', h: 6, name: 'Returns' },
      { refType: 'project', refId: 'manco', domain: 'pc', h: 2, name: 'ManCo automation' },
    ]),
    '2026-10-06': load([
      { refType: 'project', refId: 'manco', domain: 'pc', h: 1.5, name: 'ManCo automation' },
      { refType: 'project', refId: 'ret', domain: 'pc', h: 3.5, name: 'Returns pipeline' },
      { refType: 'project', refId: 'play', domain: 'pc', h: 1, name: 'Handover playbook' },
      { refType: 'project', refId: 'fion', domain: 'fi', h: 1, name: 'FI onboarding' },
    ]),
  };
  const projects = [
    { id: 'ret', domain: 'pc' as const, derived: { milestones: [{ name: 'Fund-level engine reconciles', date: '2026-10-16' }] } },
    { id: 'fion', domain: 'fi' as const, derived: { milestones: [{ name: 'Data entitlements', date: '2026-10-16' }] } },
  ];

  it('titles this week and other weeks', () => {
    const week = weekModel({ selected: '2026-10-05', today: '2026-10-05', calendar, loads, projects });
    expect(week.title).toBe('This week');
    expect(week.sub).toBe('5–9 Oct · pick a day to preview it');
    const later = weekModel({ selected: '2026-11-04', today: '2026-10-05', calendar, loads, projects });
    expect(later.title).toBe('Week of 2 Nov');
    expect(later.sub).toBe('2–6 Nov · pick a day to preview it');
    const across = weekModel({ selected: '2026-09-30', today: '2026-10-05', calendar, loads, projects });
    expect(across.sub).toBe('28 Sep–2 Oct · pick a day to preview it');
  });

  it('builds cards: BAU chips, the two biggest projects, then +N more', () => {
    const week = weekModel({ selected: '2026-10-06', today: '2026-10-05', calendar, loads, projects });
    const [mon, tue] = week.slots;
    if (mon?.kind !== 'day' || tue?.kind !== 'day') throw new Error('expected day cards');
    expect(mon).toMatchObject({ label: 'Mon 5', bd: 'BD3', isToday: true, selected: false, loadLabel: '8h of 8h' });
    expect(mon.chips.map((c) => c.label)).toEqual(['Returns 6h']);
    expect(tue).toMatchObject({ label: 'Tue 6', selected: true, more: '+2 more' });
    expect(tue.items.map((i) => [i.name, i.h, i.width])).toEqual([
      ['Returns pipeline', '3.5h', '87.5%'],
      ['ManCo automation', '1.5h', '37.5%'],
    ]);
  });

  it('puts milestone chips after BAU, in project order', () => {
    const week = weekModel({ selected: '2026-10-16', today: '2026-10-05', calendar, loads, projects });
    const fri = week.slots[4];
    if (fri?.kind !== 'day') throw new Error('expected a day card');
    expect(fri.chips.map((c) => [c.label, c.domain, c.milestone])).toEqual([
      ['◆ Fund-level engine reconciles', 'pc', true],
      ['◆ Data entitlements', 'fi', true],
    ]);
    expect(fri.loadLabel).toBe('');
  });

  it('keeps a holiday as a gap in its own column', () => {
    const week = weekModel({ selected: '2026-12-24', today: '2026-10-05', calendar, loads, projects });
    expect(week.slots.map((s) => s.kind)).toEqual(['day', 'day', 'day', 'day', 'gap']);
    expect(week.slots[4]).toEqual({ kind: 'gap', iso: '2026-12-25', holiday: 'Christmas Day' });
  });

  it('keys hover by project, routine, or the one rotation', () => {
    expect(loadItemKey({ refType: 'project', refId: 'ret' })).toEqual({ type: 'project', id: 'ret' });
    expect(loadItemKey({ refType: 'routine', refId: 'r-ret' })).toEqual({ type: 'routine', id: 'r-ret' });
    expect(loadItemKey({ refType: 'rotation', refId: 'rot-3' })).toEqual({ type: 'rotation', id: 'rotation' });
  });
});

describe('month snapshot', () => {
  const row = (key: string, due: string, extra: Partial<MonthSnapshotRowOut> = {}): MonthSnapshotRowOut => ({
    key,
    kind: 'task',
    text: key,
    sub: 'Returns pipeline',
    due,
    done: false,
    doneOn: null,
    late: false,
    domain: 'pc',
    projectId: 'ret',
    routineId: null,
    occurrenceDate: null,
    taskId: key,
    milestoneId: null,
    hasChecklist: false,
    ...extra,
  });

  const tasks = [
    row('a', '2026-10-16'),
    row('b', '2026-10-02', { late: true }),
    row('c', '2026-10-15'),
    row('d', '2026-10-16'),
    row('e', '2026-10-16'),
    row('f', '2026-10-16'),
    row('g', '2026-10-30'),
    row('x', '2026-10-15', { done: true, doneOn: '2026-10-01' }),
    row('y', '2026-10-16', { done: true, doneOn: '2026-10-02' }),
  ];

  it('shows open rows by due date up to the limit, then offers the rest', () => {
    const g = monthGroup('proj', 'Projects', tasks, false);
    expect(g.rows.map((r) => r.key)).toEqual(['b', 'c', 'a', 'd', 'e']);
    expect(g.count).toBe('2/9');
    expect(g.more).toBe('Show 2 more and 2 done');
    expect(g.empty).toBeNull();
  });

  it('expands to every open row, then done rows newest first', () => {
    const g = monthGroup('proj', 'Projects', tasks, true);
    expect(g.rows.map((r) => r.key)).toEqual(['b', 'c', 'a', 'd', 'e', 'f', 'g', 'y', 'x']);
    expect(g.more).toBe('Show less');
  });

  it('words the empty and all-done groups', () => {
    expect(monthGroup('bau', 'BAU', [], false)).toMatchObject({ empty: 'Nothing due this month.', more: null, pct: '0%' });
    const allDone = monthGroup('bau', 'BAU', [row('x', '2026-10-05', { done: true, doneOn: '2026-10-05' })], false);
    expect(allDone).toMatchObject({ empty: 'All done for the month.', more: 'Show 1 done', pct: '100%', rows: [] });
    const onlyMore = monthGroup('bau', 'BAU', tasks.slice(0, 6), false);
    expect(onlyMore.more).toBe('Show 2 more');
  });

  it('splits BAU from projects', () => {
    const groups = monthGroups([row('r', '2026-10-05', { kind: 'bau' }), ...tasks], {});
    expect(groups.map((g) => [g.label, g.rows.length])).toEqual([
      ['BAU', 1],
      ['Projects', 5],
    ]);
  });

  it('labels due dates', () => {
    expect(dueLabel(row('x', '2026-10-15', { done: true, doneOn: '2026-10-05' }), '2026-10-05', null, '2026-10-01').text).toBe('done 5 Oct');
    expect(dueLabel(row('x', '2026-10-15', { done: true }), '2026-10-05', null, '2026-10-01').text).toBe('done 1 Oct');
    expect(dueLabel(row('b', '2026-10-02', { late: true }), '2026-10-05', 1, '2026-10-01')).toEqual({ text: 'overdue 1 BD', tone: 'late' });
    expect(dueLabel(row('t', '2026-10-05'), '2026-10-05', null, '2026-10-01')).toEqual({ text: 'today', tone: 'today' });
    expect(dueLabel(row('t', '2026-10-15'), '2026-10-05', null, '2026-10-01')).toEqual({ text: 'Thu 15 Oct', tone: 'plain' });
    expect(rowText(row('m', '2026-10-30', { kind: 'milestone', text: 'Curve & auction data feeds' }))).toBe('◆ Curve & auction data feeds');
  });

  it('draws cumulative bars once arrived', () => {
    const bars = [
      { iso: '2026-10-01', plan: 0, done: 1, late: 0, past: true },
      { iso: '2026-10-05', plan: 2, done: 2, late: 1, past: true },
      { iso: '2026-10-06', plan: 2, done: 0, late: 0, past: false },
    ];
    expect(monthBars(bars, 4, '2026-10-05', false).every((b) => b.plan === '0%' && b.done === '0%')).toBe(true);
    const [first, today, next] = monthBars(bars, 4, '2026-10-05', true);
    expect(first).toMatchObject({ plan: '0%', done: '25%', late: '25%', delay: '0ms', title: 'Thu 1 Oct · 0 due by then, 1 done' });
    expect(today).toMatchObject({ plan: '50%', done: '50%', late: '75%', today: true, delay: '8ms' });
    expect(today?.title).toBe('Mon 5 Oct · 2 due by then, 2 done, 1 overdue');
    expect(next).toMatchObject({ past: false, title: 'Tue 6 Oct · 2 due by then' });
    expect(monthBars(bars, 0, '2026-10-05', true)[1]?.plan).toBe('0%');
  });

  it('adjusts rows and counts for ticks in flight', () => {
    const rows = [row('b', '2026-10-02', { late: true }), row('x', '2026-10-15', { done: true, doneOn: '2026-10-01' })];
    const flip = new Set(['b', 'x']);
    const out = overlayRows(rows, { done: 1, late: 1 }, '2026-10-05', (k, v) => (flip.has(k) ? !v : v));
    expect(out.done).toBe(1);
    expect(out.late).toBe(0);
    expect(out.rows.map((r) => [r.key, r.done, r.late, r.doneOn])).toEqual([
      ['b', true, false, '2026-10-05'],
      ['x', false, false, null],
    ]);
    const same = overlayRows(rows, { done: 1, late: 1 }, '2026-10-05', (_k, v) => v);
    expect(same.rows[0]).toBe(rows[0]);
  });
});
