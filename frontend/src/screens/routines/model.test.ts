import { describe, expect, it } from 'vitest';

import type { RotationOut, RotationSegmentOut } from '../../api';
import { fixtureProject, fixtureRotation, fixtureRoutine } from '../../test/msw/fixtures';
import {
  checklistLabel,
  COPY,
  effortWidth,
  listCountries,
  monthlyEffort,
  nextMessage,
  nextRun,
  nowLine,
  pcNote,
  pcRoutines,
  projectLink,
  ruleLine,
  ruleText,
  sentenceCase,
  tileDates,
  trackModel,
} from './model';

/** The design seed's Eurozone rotation: ten Build stops (46 BD), then Germany refreshed. */
const SEGMENTS: RotationSegmentOut[] = [
  ['DE', 'Germany', 6, '2027-01-04', '2027-01-11'],
  ['FR', 'France', 5, '2027-01-12', '2027-01-18'],
  ['IT', 'Italy', 6, '2027-01-19', '2027-01-26'],
  ['ES', 'Spain', 5, '2027-01-27', '2027-02-02'],
  ['NL', 'Netherlands', 4, '2027-02-03', '2027-02-08'],
  ['BE', 'Belgium', 4, '2027-02-09', '2027-02-12'],
  ['AT', 'Austria', 4, '2027-02-15', '2027-02-18'],
  ['PT', 'Portugal', 4, '2027-02-19', '2027-02-24'],
  ['IE', 'Ireland', 4, '2027-02-25', '2027-03-02'],
  ['FI', 'Finland', 4, '2027-03-03', '2027-03-08'],
].map(([code, country, lengthBd, start, end], order) => ({
  id: `rot-${String(order)}`,
  order,
  code: code as string,
  country: country as string,
  lengthBd: lengthBd as number,
  pass: 'Build' as const,
  loop: 1,
  start: start as string,
  end: end as string,
}));

const REFRESH: RotationSegmentOut = {
  id: 'rot-10',
  order: 10,
  code: 'DE',
  country: 'Germany',
  lengthBd: 3,
  pass: 'Refresh',
  loop: 2,
  start: '2027-03-09',
  end: '2027-03-11',
};

function seedRotation(overrides: Partial<RotationOut> = {}): RotationOut {
  return fixtureRotation({
    title: 'Eurozone sovereign rotation',
    startDate: '2027-01-04',
    startFollowsMove: true,
    hoursPerDay: 4,
    // Shuffled: the track sorts by order.
    segments: [REFRESH, ...SEGMENTS.slice(5), ...SEGMENTS.slice(0, 5)],
    loopBd: 46,
    loopEnd: '2027-03-08',
    refresh: { start: '2027-03-09', end: '2027-03-11' },
    totalBd: 49,
    current: { status: 'waiting', order: null, segmentId: null, bdToStart: 61 },
    ...overrides,
  });
}

describe('rules', () => {
  it('reads each kind as a sentence', () => {
    expect(ruleText({ kind: 'monthly', bd: 3, weekday: 1 })).toBe('3rd business day, monthly');
    expect(ruleText({ kind: 'monthly', bd: 11, weekday: 1 })).toBe('11th business day, monthly');
    expect(ruleText({ kind: 'weekly', bd: 3, weekday: 2 })).toBe('Every Tuesday');
    expect(ruleText({ kind: 'daily', bd: 3, weekday: 2 })).toBe('Every business day');
  });

  it('adds the detail in lower case, and nothing for a blank one', () => {
    expect(ruleLine({ kind: 'monthly', bd: 3, weekday: 1 }, '12 Funds')).toBe('3rd business day, monthly · 12 funds');
    expect(ruleLine({ kind: 'monthly', bd: 8, weekday: 1 }, '  ')).toBe('8th business day, monthly');
  });
});

describe('effort', () => {
  it('rounds the monthly estimate as the prototype does', () => {
    expect(monthlyEffort('monthly', { monthlyEffortH: 6, monthlyEffortApprox: false })).toBe('6h a month');
    expect(monthlyEffort('weekly', { monthlyEffortH: 4.3, monthlyEffortApprox: true })).toBe('≈4.3h a month');
    expect(monthlyEffort('daily', { monthlyEffortH: 21.4, monthlyEffortApprox: true })).toBe('≈21h a month');
  });

  it('grows the hours input with its text', () => {
    expect(effortWidth('6')).toBe('calc(0.62em + 8px)');
    expect(effortWidth('')).toBe('calc(0.62em + 8px)');
    expect(effortWidth('1.5')).toBe(`calc(${String(3 * 0.62)}em + 8px)`);
  });
});

describe('next three', () => {
  it('notes today, after the move, or the business days away', () => {
    expect(nextRun({ iso: '2026-10-05', bdm: 3, bdAway: 0, today: true, afterMove: false })).toEqual({
      iso: '2026-10-05',
      date: 'Mon 5 Oct',
      note: 'today',
      today: true,
    });
    expect(nextRun({ iso: '2026-11-04', bdm: 3, bdAway: 22, today: false, afterMove: false }).note).toBe('22 BD away');
    expect(nextRun({ iso: '2027-01-06', bdm: 3, bdAway: 63, today: false, afterMove: true }).note).toBe('after the move');
  });

  it('says handed over at stage 3 even with runs, and no runs otherwise', () => {
    expect(nextMessage(3, [1, 2, 3])).toBe(COPY.handedOver);
    expect(nextMessage(1, [])).toBe(COPY.noRuns);
    expect(nextMessage(1, [1])).toBeNull();
  });
});

describe('project link', () => {
  it('sentence-cases the name, as the prototype writes it', () => {
    expect(sentenceCase('ManCo pack automation')).toBe('Manco pack automation');
    expect(projectLink(fixtureProject({ name: 'Returns pipeline automation', forecastDate: '2026-12-02' }))).toBe(
      'Via Returns pipeline automation · 2 Dec',
    );
  });

  it('shows a dash without a forecast, and nothing without a project', () => {
    expect(projectLink(fixtureProject({ name: 'Alpha engine v0', forecastDate: null }))).toBe('Via Alpha engine v0 · —');
    expect(projectLink(null)).toBeNull();
  });
});

describe('Private Credit list', () => {
  it('lists Private Credit routines only, in plan order', () => {
    const plan = { routines: [fixtureRoutine({ id: 'a' }), fixtureRoutine({ id: 'fi', domain: 'fi' }), fixtureRoutine({ id: 'b' })] };
    expect(pcRoutines(plan).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('counts only routines not yet handed over', () => {
    expect(pcNote([{ stage: 1 }, { stage: 0 }])).toBe(
      '2 routines on your plan until the move · each one leaves by automation or handover',
    );
    expect(pcNote([{ stage: 1 }, { stage: 3 }])).toMatch(/^1 routine on your plan/);
  });

  it('labels the checklist with its size', () => {
    expect(checklistLabel(12)).toBe('Checklist · 12');
    expect(checklistLabel(0)).toBe('Checklist');
  });
});

describe('rotation track', () => {
  it('lays the seed rotation out clockwise, as the prototype draws it', () => {
    const t = trackModel(seedRotation());
    expect(t).not.toBeNull();
    if (!t) return;
    expect(t.columns).toBe(5);
    expect(t.top.map((x) => `${x.index} ${x.code}`)).toEqual(['01 DE', '02 FR', '03 IT', '04 ES', '05 NL']);
    // The bottom row runs right to left: Finland sits under Germany.
    expect(t.bottom.map((x) => `${x.index} ${x.code}`)).toEqual(['10 FI', '09 IE', '08 PT', '07 AT', '06 BE']);
    expect(t.top[0]).toMatchObject({
      dates: '4 Jan – 11 Jan · 6 BD',
      current: true,
      flag: 'First up · Mon 4 Jan',
      extra: 'Refresh 9 Mar – 11 Mar',
    });
    expect(t.top.slice(1).some((x) => x.current || x.flag !== undefined || x.extra !== undefined)).toBe(false);
    expect(t.now).toBe('Waiting to start. 61 BD to go.');
    expect(t.loop).toBe('10 countries · 46 business days');
    expect(t.completion).toBe('Mon 8 Mar 2027');
    expect(t.then).toBe('Back to Germany to refresh, Tue 9 Mar – 11 Mar');
    expect(t.subtitle).toBe('Eurozone sovereign rotation · 4h a day from the move · one country at a time, then round again');
  });

  it('flags the active stop with its end date', () => {
    const t = trackModel(seedRotation({ current: { status: 'active', order: 2, segmentId: 'rot-2', bdToStart: null } }));
    const italy = t?.top[2];
    expect(italy).toMatchObject({ current: true, flag: 'Now · until Tue 26 Jan' });
    expect(t?.top[0]?.current).toBe(false);
    expect(t?.now).toBe('Italy, until Tue 26 Jan.');
  });

  it('keeps the flag off the bottom row, and handles an odd number of stops', () => {
    const segments = SEGMENTS.slice(0, 3);
    const t = trackModel(
      seedRotation({ segments, refresh: null, current: { status: 'active', order: 2, segmentId: 'rot-2', bdToStart: null } }),
    );
    expect(t?.columns).toBe(2);
    expect(t?.top.map((x) => x.code)).toEqual(['DE', 'FR']);
    expect(t?.bottom).toMatchObject([{ code: 'IT', current: true }]);
    expect(t?.bottom[0]?.flag).toBeUndefined();
    expect(t?.then).toBeNull();
    expect(t?.loop).toBe('3 countries · 46 business days');
  });

  it('dates the subtitle when the rotation does not follow the move', () => {
    const t = trackModel(seedRotation({ startFollowsMove: false, startDate: '2027-01-11' }));
    expect(t?.subtitle).toMatch(/· 4h a day from Mon 11 Jan ·/);
  });

  it('has no track without segments', () => {
    expect(trackModel(fixtureRotation())).toBeNull();
  });

  it('reads the status line for each state', () => {
    expect(nowLine({ current: { status: 'done', order: null, segmentId: null, bdToStart: null }, segments: [] })).toBe(
      'Loop complete. Round again.',
    );
    expect(nowLine({ current: { status: 'none', order: null, segmentId: null, bdToStart: null }, segments: [] })).toBe('');
  });

  it('formats dates and country lists', () => {
    expect(tileDates({ start: '2027-02-09', end: '2027-02-12', lengthBd: 4 })).toBe('9 Feb – 12 Feb · 4 BD');
    expect(listCountries(['Germany'])).toBe('Germany');
    expect(listCountries(['Germany', 'France', 'Germany'])).toBe('Germany and France');
    expect(listCountries(['Germany', 'France', 'Italy'])).toBe('Germany, France and Italy');
  });
});
