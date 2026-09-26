import { describe, expect, it } from 'vitest';

import type { ProjectSnapshotOut } from '../../api';
import { dayNumber } from '../../lib/calendar';
import {
  asOfHint,
  axisOf,
  buildSnaps,
  buildStrip,
  crosshairTransform,
  hoverDay,
  hoverLabelInputs,
  interpolate,
  labelTransform,
  milestoneNames,
  monthTicks,
  packLabels,
  pct,
  positionFromPercent,
  snapRelease,
  stepStop,
  stopXs,
} from './scrubber';
import type { Axis, LabelInput, Snap } from './scrubber';

const dn = dayNumber;
const TODAY = '2026-10-05';

function snapshot(over: Partial<ProjectSnapshotOut>): ProjectSnapshotOut {
  return {
    date: '2026-09-08',
    forecastDate: '2026-11-27',
    targetDate: '2026-11-27',
    confidence: 3,
    milestones: [],
    ...over,
  } as ProjectSnapshotOut;
}

const live = { today: TODAY, forecast: '2026-12-02', confidence: 3, milestones: [{ name: 'Runbook drafted', date: '2026-11-27' }] };

describe('buildSnaps', () => {
  it('is one live stop dated today without check-ins', () => {
    const snaps = buildSnaps([], live);
    expect(snaps).toEqual([
      { date: dn(TODAY), f: dn('2026-12-02'), target: null, conf: 3, ms: [{ name: 'Runbook drafted', n: dn('2026-11-27') }] },
    ]);
    expect(buildSnaps(undefined, live)).toHaveLength(1);
  });

  it('replaces the last check-in with the live plan, kept at that check-in’s date', () => {
    const snaps = buildSnaps(
      [
        snapshot({
          date: '2026-09-08',
          forecastDate: '2026-11-25',
          confidence: 4,
          milestones: [{ name: 'Old', date: '2026-10-01', milestoneId: null }],
        }),
        snapshot({ date: '2026-10-03', forecastDate: '2026-11-30', confidence: 2 }),
      ],
      live,
    );
    expect(snaps).toHaveLength(2);
    expect(snaps[0]).toMatchObject({ date: dn('2026-09-08'), f: dn('2026-11-25'), conf: 4, target: '2026-11-27' });
    expect(snaps[0]?.ms).toEqual([{ name: 'Old', n: dn('2026-10-01') }]);
    expect(snaps[1]).toMatchObject({ date: dn('2026-10-03'), f: dn('2026-12-02'), conf: 3, target: null });
  });

  it('falls back to the current milestones for a check-in without any', () => {
    const snaps = buildSnaps([snapshot({ milestones: [] }), snapshot({ date: '2026-09-30' })], live);
    expect(snaps[0]?.ms).toEqual([{ name: 'Runbook drafted', n: dn('2026-11-27') }]);
  });

  it('keeps a Define forecast as null', () => {
    expect(buildSnaps([], { ...live, forecast: null })[0]?.f).toBeNull();
  });
});

const snap = (date: string, f: string | null, ms: [string, string][] = [], conf: number | null = 3): Snap => ({
  date: dn(date),
  f: f ? dn(f) : null,
  target: null,
  conf,
  ms: ms.map(([name, d]) => ({ name, n: dn(d) })),
});

describe('axis and percentages', () => {
  it('pads 4 days before the start and 12 after the latest end', () => {
    const snaps = [snap('2026-09-08', '2026-11-25'), snap(TODAY, '2026-12-02')];
    expect(axisOf(dn('2026-09-14'), dn('2026-11-27'), dn(TODAY), snaps)).toEqual({ a0: dn('2026-09-04'), a1: dn('2026-12-02') + 12 });
  });

  it('caps a far target at today + 120', () => {
    const axis = axisOf(dn(TODAY), dn('2027-06-30'), dn(TODAY), [snap(TODAY, null)]);
    expect(axis.a1).toBe(dn(TODAY) + 120 + 12);
  });

  it('pct clamps to the strip, with three decimals', () => {
    const axis: Axis = { a0: 0, a1: 200 };
    expect(pct(axis, 50)).toBe('25.000%');
    expect(pct(axis, -10)).toBe('0.000%');
    expect(pct(axis, 300)).toBe('100.000%');
    expect(stopXs(axis, [snap('1970-01-11', null)])).toEqual([5]);
  });

  it('marks the first of each month', () => {
    const ticks = monthTicks({ a0: dn('2026-09-04'), a1: dn('2026-12-14') });
    expect(ticks.map((t) => t.label)).toEqual(['Oct', 'Nov', 'Dec']);
    expect(ticks[0]?.n).toBe(dn('2026-10-01'));
  });
});

describe('interpolate', () => {
  const snaps = [snap('2026-09-08', '2026-11-20'), snap('2026-09-22', '2026-11-30'), snap(TODAY, '2026-12-02')];

  it('is the live stop at pos null', () => {
    const it0 = interpolate(snaps, null);
    expect(it0.nearIndex).toBe(2);
    expect(it0.fNow).toBe(dn('2026-12-02'));
  });

  it('lerps the forecast between stops and snaps "near" to the closest', () => {
    const mid = interpolate(snaps, 0.5);
    expect(mid.i0).toBe(0);
    expect(mid.i1).toBe(1);
    expect(mid.fNow).toBe(dn('2026-11-20') + 5);
    expect(mid.nearIndex).toBe(1);
    expect(interpolate(snaps, 0.4).nearIndex).toBe(0);
  });

  it('clamps the position and takes whichever end has a forecast', () => {
    expect(interpolate(snaps, 9).nearIndex).toBe(2);
    const partial = interpolate([snap('2026-09-08', null), snap(TODAY, '2026-12-02')], 0.25);
    expect(partial.fNow).toBe(dn('2026-12-02'));
  });
});

describe('drag and keys', () => {
  it('maps the pointer percentage to a fractional stop', () => {
    const xs = [10, 30, 90];
    expect(positionFromPercent(xs, 5)).toBe(0);
    expect(positionFromPercent(xs, 20)).toBe(0.5);
    expect(positionFromPercent(xs, 60)).toBe(1.5);
    expect(positionFromPercent(xs, 95)).toBe(2);
    expect(positionFromPercent([], 50)).toBe(0);
  });

  it('snaps on release, the last stop being live (null)', () => {
    expect(snapRelease(0.4, 3)).toBe(0);
    expect(snapRelease(1.6, 3)).toBeNull();
    expect(snapRelease(null, 3)).toBeNull();
  });

  it('steps between stops with the arrow keys, Home and End', () => {
    expect(stepStop(null, 3, 'ArrowLeft')).toBe(1);
    expect(stepStop(1, 3, 'ArrowLeft')).toBe(0);
    expect(stepStop(0, 3, 'ArrowLeft')).toBe(0);
    expect(stepStop(1, 3, 'ArrowRight')).toBeNull();
    expect(stepStop(null, 3, 'Home')).toBe(0);
    expect(stepStop(0, 3, 'End')).toBeNull();
    expect(stepStop(0, 3, 'a')).toBeUndefined();
  });

  it('hints how many check-ins there are (critique :589)', () => {
    expect(asOfHint(true, 3)).toBe('Viewing a past check-in');
    expect(asOfHint(false, 3)).toBe('Drag back through 3 check-ins');
    expect(asOfHint(false, 1)).toBe('One check-in so far');
  });
});

describe('hover labels', () => {
  const axis: Axis = { a0: 0, a1: 100 };
  const dateOf = (n: number) => `D${String(n)}`;

  it('lists Start, milestones, the forecast end and Target in date order', () => {
    const snaps = [
      snap('2026-09-08', '2026-11-20', [['A', '2026-10-15']]),
      snap(TODAY, '2026-12-02', [
        ['A', '2026-10-16'],
        ['B', '2026-11-04'],
      ]),
    ];
    const interp = interpolate(snaps, null);
    const labels = hoverLabelInputs({
      startN: dn('2026-09-14'),
      targetN: dn('2026-11-27'),
      endName: 'Handover-ready',
      names: milestoneNames(snaps),
      interp,
    });
    expect(labels.map((l) => [l.name, l.kind])).toEqual([
      ['Start', 'start'],
      ['A', 'ms'],
      ['B', 'ms'],
      ['Target', 'tgt'],
      ['Handover-ready · forecast', 'end'],
    ]);
    expect(labels.find((l) => l.name === 'A')?.n).toBe(dn('2026-10-16'));
  });

  it('names the end "Forecast" without an end name, and drops it without a forecast', () => {
    const interp = interpolate([snap(TODAY, '2026-12-02')], null);
    const named = hoverLabelInputs({ startN: 0, targetN: 1, endName: '', names: [], interp });
    expect(named.some((l) => l.name === 'Forecast · forecast')).toBe(true);
    const none = hoverLabelInputs({ startN: 0, targetN: 1, endName: 'X', names: [], interp: interpolate([snap(TODAY, null)], null) });
    expect(none.map((l) => l.kind)).toEqual(['start', 'tgt']);
  });

  it('packs overlapping labels into three rows, greedily', () => {
    const labels: LabelInput[] = [
      { n: 40, name: 'Aaaa', kind: 'ms' },
      { n: 41, name: 'Bbbb', kind: 'ms' },
      { n: 42, name: 'Cccc', kind: 'ms' },
      { n: 43, name: 'Dddd', kind: 'ms' },
      { n: 80, name: 'Eeee', kind: 'ms' },
    ];
    const placed = packLabels(labels, axis, 1000, dateOf);
    expect(placed.map((l) => l.row)).toEqual([0, 1, 2, 0, 0]);
    expect(placed[0]).toMatchObject({ x: '40.500%', anchor: 'c', date: 'D40' });
  });

  it('anchors labels at the strip edges', () => {
    const placed = packLabels(
      [
        { n: 2, name: 'Start', kind: 'start' },
        { n: 97, name: 'Target', kind: 'tgt' },
      ],
      axis,
      1000,
      dateOf,
    );
    expect(placed.map((l) => l.anchor)).toEqual(['l', 'r']);
    expect(labelTransform('l')).toBe('translateX(-4px)');
    expect(labelTransform('r')).toBe('translateX(calc(-100% + 4px))');
    expect(labelTransform('c')).toBe('translateX(-50%)');
  });

  it('flips the crosshair chip at the edges (critique :479)', () => {
    expect(crosshairTransform(0.05)).toBe('translateX(0)');
    expect(crosshairTransform(0.5)).toBe('translateX(-50%)');
    expect(crosshairTransform(0.95)).toBe('translateX(-100%)');
    expect(hoverDay(axis, 0.5)).toBe(50);
    expect(hoverDay({ a0: 10, a1: 20 }, 0)).toBe(10);
  });
});

describe('buildStrip', () => {
  const startN = dn('2026-09-14');
  const targetN = dn('2026-11-27');
  const todayN = dn(TODAY);

  it('draws the plan bar to the target and the overrun in risk when late', () => {
    const snaps = [snap('2026-09-08', '2026-11-25'), snap(TODAY, '2026-12-02')];
    const strip = buildStrip({ startN, targetN, todayN, snaps, pos: null });
    const at = (n: number) => pct(strip.axis, n);
    expect(strip.risk).toBe(true);
    expect(strip.bar).toEqual({ x: at(startN), w: `calc(${at(targetN + 1)} - ${at(startN)})` });
    expect(strip.over).toEqual({ x: at(targetN + 1), w: `calc(${at(dn('2026-12-02') + 1)} - ${at(targetN + 1)})` });
    expect(strip.end).toEqual({ x: at(dn('2026-12-02') + 0.5), on: true });
    expect(strip.stops.map((s) => s.near)).toEqual([false, true]);
    expect(strip.handle).toBe(`${(strip.xs[1] ?? 0).toFixed(3)}%`);
  });

  it('ends the bar at the forecast when early, with no overrun', () => {
    const strip = buildStrip({ startN, targetN, todayN, snaps: [snap(TODAY, '2026-11-20')], pos: null });
    expect(strip.risk).toBe(false);
    expect(strip.over.w).toBe('0%');
    expect(strip.bar.w).toBe(`calc(${pct(strip.axis, dn('2026-11-20') + 1)} - ${pct(strip.axis, startN)})`);
  });

  it('cross-fades a milestone that exists at only one end', () => {
    const snaps = [snap('2026-09-08', '2026-11-20', [['Old', '2026-10-01']]), snap(TODAY, '2026-11-20', [['New', '2026-10-20']])];
    const strip = buildStrip({ startN, targetN, todayN, snaps, pos: 0.25 });
    const byName = Object.fromEntries(strip.milestones.map((m) => [m.name, m]));
    expect(byName.Old?.o).toBeCloseTo(0.75);
    expect(byName.New?.o).toBeCloseTo(0.25);
    expect(byName.Old?.past).toBe(true);
    expect(byName.New?.past).toBe(false);
  });

  it('hides the end diamond without a forecast', () => {
    const strip = buildStrip({ startN, targetN, todayN, snaps: [snap(TODAY, null)], pos: null });
    expect(strip.end).toEqual({ x: '0%', on: false });
    expect(strip.bar.w).toBe(`calc(${pct(strip.axis, targetN + 1)} - ${pct(strip.axis, startN)})`);
  });
});
