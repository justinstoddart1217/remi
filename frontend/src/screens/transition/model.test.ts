import { describe, expect, it } from 'vitest';

import type { MoveOut, ProjectOut, ReadinessItemOut, RotationOut } from '../../api';
import { NO_PC_SENTENCE } from '../../shell/HeaderBar/headerModel';
import { fixtureMove, fixtureProject, fixtureRotation, fixtureRoutine } from '../../test/msw/fixtures';
import {
  afterDayOneRows,
  countdownLabel,
  COPY,
  dueLabel,
  firstRotation,
  handoverRows,
  inSentence,
  keyProjectOf,
  legendNote,
  longDate,
  onboardingHost,
  onboardingItems,
  onboardingNote,
  placeFlagLabels,
  projectCount,
  readyCount,
  stripModel,
  verdictSentence,
  windDownRows,
} from './model';

const MOVE = '2027-01-04';

const ret = fixtureProject({ id: 'ret', name: 'Returns pipeline automation', short: 'Returns pipeline', forecastDate: '2026-12-02' });

/** A project with some derived fields changed (the fixture builder takes a whole `derived`). */
function withDerived(overrides: Partial<ProjectOut>, derived: Partial<ProjectOut['derived']>): ProjectOut {
  const base = fixtureProject(overrides);
  return { ...base, derived: { ...base.derived, ...derived } };
}

function item(id: string, text: string, overrides: Partial<ReadinessItemOut> = {}): ReadinessItemOut {
  return { id, projectId: 'fion', text, done: false, doneOn: null, dueDate: null, sortOrder: 0, ...overrides };
}

describe('hero', () => {
  it('counts the business days and dates the move', () => {
    expect(countdownLabel(61)).toBe('business days to Fixed Income');
    expect(countdownLabel(1)).toBe('business day to Fixed Income');
    expect(longDate(MOVE)).toBe('Monday 4 January 2027');
  });

  it('lower-cases a plain leading word only', () => {
    expect(inSentence('Returns pipeline')).toBe('returns pipeline');
    expect(inSentence('ManCo automation')).toBe('ManCo automation');
    expect(inSentence('PC handover playbook')).toBe('PC handover playbook');
  });
});

describe('verdict sentence', () => {
  const verdict = { state: 'on_track_narrowly' as const, bufferBd: 7, keyRun: '2026-12-03', toRunBd: 1, keyProjectId: 'ret' };

  it('reads the seed verdict (buffer 7, ADR-0007)', () => {
    expect(verdictSentence(verdict, MOVE, ret)).toBe(
      'Every Private Credit exit lands before 4 Jan, with 7 business days to spare. The one to watch is the returns pipeline: forecast Wed 2 Dec, 1 business day before the December run your successor needs to shadow.',
    );
  });

  it('stops after the buffer without a key project', () => {
    expect(verdictSentence({ ...verdict, state: 'on_track', bufferBd: 1 }, MOVE, null)).toBe(
      'Every Private Credit exit lands before 4 Jan, with 1 business day to spare.',
    );
  });

  it('names the missed run when at risk', () => {
    expect(verdictSentence({ ...verdict, state: 'at_risk' }, MOVE, ret)).toBe(
      'Every Private Credit exit still lands before 4 Jan, but the returns pipeline now misses the December run on Thu 3 Dec, the last one your successor can shadow with you there.',
    );
    expect(verdictSentence({ ...verdict, state: 'at_risk', keyRun: null }, MOVE, ret)).toMatch(/the key run is at risk\.$/);
  });

  it('reads off track and no Private Credit', () => {
    expect(verdictSentence({ ...verdict, state: 'off_track' }, MOVE, ret)).toMatch(
      /^A Private Credit exit now lands on or after 4 Jan\./,
    );
    expect(verdictSentence({ ...verdict, state: 'no_pc' }, MOVE, null)).toBe(NO_PC_SENTENCE);
  });

  it('finds the key project, if it still exists', () => {
    expect(keyProjectOf({ verdict: { ...verdict, bufferBd: 7, lastPcExit: null, anyRisk: false }, projects: [ret] })?.id).toBe('ret');
    expect(
      keyProjectOf({ verdict: { ...verdict, keyProjectId: 'gone', lastPcExit: null, anyRisk: false }, projects: [ret] }),
    ).toBeNull();
  });
});

describe('strip', () => {
  const move = fixtureMove();

  it('draws one block per remaining business day, filled while an exit runs', () => {
    const strip = stripModel(move, [ret]);
    expect(strip.ticks).toHaveLength(move.remaining.length);
    expect(strip.ticks[0]).toEqual({ iso: '2026-10-06', running: true, title: 'Tue 6 Oct · BD4' });
    expect(
      strip.ticks
        .filter((t) => t.running)
        .map((t) => t.iso)
        .at(-1),
    ).toBe('2026-12-02');
  });

  it('places the flags on block boundaries with the server stagger', () => {
    const strip = stripModel(move, [ret]);
    const n = move.remaining.length;
    const bySlot = (slot: number) => `${((slot / n) * 100).toFixed(3)}%`;
    expect(strip.flags.map((f) => [f.label, f.tone, f.liftPx, f.stickPx])).toEqual([
      ['Returns pipeline · 2 Dec', 'risk', 2, 10],
      ['Dec run', 'muted', 18, 26],
      ['Move', 'move', 2, 10],
    ]);
    expect(strip.flags[0]?.x).toBe(bySlot(move.flags[0]?.slot ?? -1));
    expect(strip.flags[2]).toMatchObject({ x: '100.000%', end: true });
    expect(strip.flags.filter((f) => f.end)).toHaveLength(1);
  });

  it('hangs a project flag at the end of the strip to the left, like the Move flag', () => {
    const n = move.remaining.length;
    const late: MoveOut = {
      ...move,
      flags: [
        { kind: 'project', projectId: 'ret', iso: '2027-01-04', atRisk: true, slot: n, index: 0, liftPx: 18, stickPx: 26 },
        { kind: 'move', projectId: null, iso: MOVE, atRisk: false, slot: n, index: 1, liftPx: 2, stickPx: 10 },
      ],
    };
    const strip = stripModel(late, [ret]);
    expect(strip.flags.map((f) => [f.label, f.x, f.end, f.liftPx])).toEqual([
      ['Returns pipeline · 4 Jan', '100.000%', true, 18],
      ['Move', '100.000%', true, 2],
    ]);
    // A flag inside the strip keeps its label to the right of the stick.
    const inside = stripModel({ ...late, flags: late.flags.slice(0, 1).map((f) => ({ ...f, slot: n - 1 })) }, [ret]);
    expect(inside.flags[0]?.end).toBe(false);
  });

  it('marks each month where it starts', () => {
    const strip = stripModel(move, [ret]);
    expect(strip.months.map((m) => m.label)).toEqual(['October', 'November', 'December']);
    expect(strip.months[0]?.x).toBe('0.000%');
  });

  it('survives a flag whose project is gone, and an empty strip', () => {
    const lost: MoveOut = {
      ...move,
      flags: [{ kind: 'project', projectId: 'gone', iso: '2026-12-02', atRisk: false, slot: 3, index: 0, liftPx: 2, stickPx: 10 }],
    };
    expect(stripModel(lost, []).flags[0]).toMatchObject({ label: ' · 2 Dec', tone: 'ink' });
    const empty = stripModel(
      {
        remaining: [],
        flags: [{ kind: 'move', projectId: null, iso: MOVE, atRisk: false, slot: 0, index: 0, liftPx: 2, stickPx: 10 }],
      },
      [],
    );
    expect(empty).toMatchObject({ ticks: [], months: [], flags: [{ x: '100.000%', label: 'Move' }] });
  });
});

describe('flag labels', () => {
  const W = 1200;
  const box = (x: number, width: number, bottom: number, end = false) => ({ x, width, height: 14, bottom, end });

  it('keeps the server rows while nothing collides (the design layout does not move)', () => {
    // The design's spread: alternating 12px and 44px rows, and the Move flag hanging left.
    const boxes = [box(700, 150, 12), box(820, 60, 44), box(900, 140, 12), box(1000, 150, 44), box(W, 40, 12, true)];
    expect(placeFlagLabels(boxes, W)).toEqual(boxes.map((b) => ({ bottom: b.bottom, end: b.end })));
  });

  it('moves a label that would print over another to the nearest clear row', () => {
    const places = placeFlagLabels([box(900, 150, 12), box(960, 150, 44), box(1000, 150, 12)], W);
    expect(places.map((p) => p.bottom)).toEqual([12, 44, 28]);
  });

  it('stacks several forecasts at the move into separate rows, none overlapping', () => {
    // Three projects forecast on the move day, then the Move flag: all hang left of x = W.
    const boxes = [box(W, 150, 12, true), box(W, 150, 44, true), box(W, 150, 12, true), box(W, 40, 44, true)];
    const places = placeFlagLabels(boxes, W);
    const bottoms = places.map((p) => p.bottom);
    expect(new Set(bottoms).size).toBe(4);
    for (const [i, a] of bottoms.entries()) {
      for (const b of bottoms.slice(i + 1)) expect(Math.abs(a - b)).toBeGreaterThanOrEqual(14);
    }
    expect(places.every((p) => p.end)).toBe(true);
  });

  it('hangs a label left of its stick rather than past the right edge', () => {
    expect(placeFlagLabels([box(1150, 150, 12)], W)).toEqual([{ bottom: 12, end: true }]);
    expect(placeFlagLabels([box(1000, 150, 12)], W)).toEqual([{ bottom: 12, end: false }]);
  });

  it('changes nothing before the labels are measured', () => {
    const boxes = [box(0, 0, 12), box(0, 0, 44), box(0, 0, 12, true)];
    expect(placeFlagLabels(boxes, 0)).toEqual(boxes.map((b) => ({ bottom: b.bottom, end: b.end })));
  });

  it("names the region's holidays in the legend", () => {
    expect(legendNote('GB-ENG')).toBe('One block per remaining business day; bank holidays left out.');
    expect(legendNote('ZA')).toBe('One block per remaining business day; public holidays left out.');
  });
});

describe('Private Credit column', () => {
  it('lists Private Credit projects with readiness and the delta chip', () => {
    const rows = windDownRows([
      withDerived({ id: 'ret' }, { readinessPct: 60, deltaBd: 3, status: 'risk' }),
      withDerived(
        { id: 'manco', name: 'ManCo pack automation', forecastDate: '2026-12-11' },
        { readinessPct: 35.4, deltaBd: 0, status: 'on' },
      ),
      fixtureProject({ id: 'fion', domain: 'fi' }),
      withDerived({ id: 'new', forecastDate: null }, { readinessPct: null, deltaBd: null, status: 'define' }),
    ]);
    expect(rows.map((r) => [r.id, r.readyLabel, r.forecast, r.chip, r.tone])).toEqual([
      ['ret', '60%', '2 Dec', '+3 BD', 'risk'],
      ['manco', '35%', '11 Dec', 'On target', 'neutral'],
      ['new', '0%', '—', 'No forecast', 'neutral'],
    ]);
    expect(projectCount(3)).toBe('3 projects');
    expect(projectCount(1)).toBe('1 project');
  });

  it('lists every routine, with the note falling back to the status note, then the rule', () => {
    const rows = handoverRows([
      fixtureRoutine({ id: 'a', stage: 1, transitionNote: 'Successor shadows the Thu 3 Dec run', statusNote: 'ignored' }),
      fixtureRoutine({ id: 'b', stage: 3, transitionNote: null, statusNote: 'Handed to the team' }),
      fixtureRoutine({ id: 'c', name: '', stage: 0, transitionNote: '  ', statusNote: '' }),
    ]);
    expect(rows).toEqual([
      { id: 'a', name: 'Monthly returns run', note: 'Successor shadows the Thu 3 Dec run', status: 'Automating' },
      { id: 'b', name: 'Monthly returns run', note: 'Handed to the team', status: 'Handed over' },
      { id: 'c', name: COPY.untitledRoutine, note: '3rd business day, monthly', status: 'Manual' },
    ]);
  });
});

describe('onboarding', () => {
  const items = [
    item('d', 'Dry run of the first rotation day', { dueDate: '2026-12-17', sortOrder: 3 }),
    item('a', 'Bloomberg and data access', { done: true, sortOrder: 0 }),
    item('b', 'Risk system login', { dueDate: '2026-10-30', sortOrder: 1 }),
  ];
  const fion = fixtureProject({ id: 'fion', domain: 'fi', forecastDate: MOVE, readinessItems: items });

  it('picks the Fixed Income project that holds the items', () => {
    const alpha = fixtureProject({ id: 'alpha', domain: 'fi', forecastDate: null });
    expect(onboardingHost([ret, alpha, fion], MOVE)?.id).toBe('fion');
    const early = fixtureProject({ id: 'early', domain: 'fi', forecastDate: '2026-12-01' });
    expect(onboardingHost([ret, alpha, early], MOVE)?.id).toBe('early');
    expect(onboardingHost([ret, alpha], MOVE)?.id).toBe('alpha');
    expect(onboardingHost([ret], MOVE)).toBeNull();
  });

  it('sorts the items and labels them', () => {
    expect(onboardingItems(items).map((x) => x.id)).toEqual(['a', 'b', 'd']);
    expect(dueLabel(true, '2026-10-30')).toBe('done');
    expect(dueLabel(false, '2026-10-30')).toBe('Fri 30 Oct');
    expect(dueLabel(false, null)).toBe('');
    expect(readyCount(onboardingItems(items))).toBe('1 of 3 ready');
  });

  it('writes the note the design shows, then falls back', () => {
    expect(onboardingNote(fion, items, MOVE)).toBe(
      'Forecast ready Mon 4 Jan, the day of the move. The dry run on Thu 17 Dec is the real test.',
    );
    const noDry = items.filter((x) => x.id !== 'd');
    expect(onboardingNote({ forecastDate: '2026-12-01' }, noDry, MOVE)).toBe(
      'Forecast ready Tue 1 Dec, before the move. Last to land: Risk system login, Fri 30 Oct.',
    );
    expect(onboardingNote({ forecastDate: '2027-01-11' }, [item('a', 'x', { done: true })], MOVE)).toBe(
      'Forecast ready Mon 11 Jan, after the move. Every item is ready.',
    );
    expect(onboardingNote({ forecastDate: null }, [], MOVE)).toBe('No forecast yet.');
  });
});

describe('Fixed Income column', () => {
  const rotation: RotationOut = fixtureRotation({
    startDate: MOVE,
    startFollowsMove: true,
    loopEnd: '2027-03-08',
    segments: [
      {
        id: 'rot-1',
        order: 1,
        code: 'FR',
        country: 'France',
        lengthBd: 5,
        pass: 'Build',
        loop: 1,
        start: '2027-01-12',
        end: '2027-01-18',
      },
      { id: 'rot-0', order: 0, code: 'DE', country: 'Germany', lengthBd: 6, pass: 'Build', loop: 1, start: MOVE, end: '2027-01-11' },
      {
        id: 'rot-3',
        order: 3,
        code: 'ES',
        country: 'Spain',
        lengthBd: 5,
        pass: 'Build',
        loop: 1,
        start: '2027-01-27',
        end: '2027-02-02',
      },
      {
        id: 'rot-2',
        order: 2,
        code: 'IT',
        country: 'Italy',
        lengthBd: 6,
        pass: 'Build',
        loop: 1,
        start: '2027-01-19',
        end: '2027-01-26',
      },
    ],
    current: { status: 'waiting', order: null, segmentId: null, bdToStart: 61 },
  });

  it('shows the first three stops and the whole-rotation link', () => {
    const first = firstRotation(rotation, MOVE);
    expect(first?.tiles.map((t) => [t.code, t.dates, t.current])).toEqual([
      ['DE', '4 Jan – 11 Jan', true],
      ['FR', '12 Jan – 18 Jan', false],
      ['IT', '19 Jan – 26 Jan', false],
    ]);
    expect(first?.starts).toBe('starts on day one');
    expect(first?.link).toBe('Whole rotation, loop 1 ends Mon 8 Mar');
  });

  it('follows the active stop and a start that is not the move', () => {
    const active = firstRotation(
      {
        ...rotation,
        startFollowsMove: false,
        startDate: '2027-01-11',
        current: { status: 'active', order: 1, segmentId: 'rot-1', bdToStart: null },
      },
      MOVE,
    );
    expect(active?.tiles.map((t) => t.current)).toEqual([false, true, false]);
    expect(active?.starts).toBe('starts Mon 11 Jan');
    expect(firstRotation(fixtureRotation(), MOVE)).toBeNull();
  });

  it('lists the projects after day one', () => {
    const fion = fixtureProject({ id: 'fion', domain: 'fi' });
    const alpha = fixtureProject({
      id: 'alpha',
      domain: 'fi',
      name: 'Alpha engine v0',
      forecastDate: null,
      targetLabel: 'Late Mar 2027',
      afterDayOneNote: 'In Define, charter half-written. Planning starts once the rotation is under way.',
    });
    const beta = fixtureProject({ id: 'beta', domain: 'fi', name: 'Beta', forecastDate: '2027-02-01', targetDate: '2027-02-05' });
    expect(afterDayOneRows([ret, fion, alpha, beta], 'fion')).toEqual([
      {
        id: 'alpha',
        name: 'Alpha engine v0',
        note: 'In Define, charter half-written. Planning starts once the rotation is under way.',
        target: 'Target Late Mar 2027',
      },
      { id: 'beta', name: 'Beta', note: 'Forecast Mon 1 Feb.', target: 'Target Fri 5 Feb' },
    ]);
  });
});
