import { describe, expect, it } from 'vitest';

import type { ProjectDerivedOut, ProjectOut } from '../../api';
import { fixtureProject, fixtureRotation, fixtureRoutine } from '../../test/msw';
import {
  capacityCaption,
  dayTip,
  footnote,
  forecastText,
  loadItemKey,
  milestoneTip,
  moveTag,
  projectShortTip,
  projectTip,
  rotationNote,
  rotationSub,
  rotationTip,
  routineRowLabel,
  routineRowSub,
  routineTip,
  rowChipText,
  ruleShort,
  ruleText,
  stageName,
  tickText,
} from './model';

/** The fixture project's derived fields with some replaced. */
function fixtureProjectDerived(patch: Partial<ProjectDerivedOut>): ProjectDerivedOut {
  return { ...fixtureProject().derived, ...patch };
}

/** The design's Returns pipeline (Timeline tip baseline: timeline-tip-ret). */
function ret(): ProjectOut {
  return fixtureProject({
    id: 'ret',
    name: 'Returns pipeline automation',
    endName: 'Handover-ready',
    startDate: '2026-09-14',
    targetDate: '2026-11-27',
    forecastDate: '2026-12-02',
    prevForecastDate: '2026-11-27',
    confidence: 3,
    derived: fixtureProjectDerived({
      status: 'risk',
      deltaBd: 3,
      sinceDays: 2,
      milestones: [
        {
          name: 'Security-level data feed connected',
          date: '2026-10-15',
          passed: false,
          done: false,
          horizon: 'now',
          milestoneId: null,
        },
        { name: 'Fund-level engine reconciles', date: '2026-10-16', passed: false, done: false, horizon: 'now', milestoneId: 'm1' },
      ],
    }),
  });
}

function alpha(): ProjectOut {
  return fixtureProject({
    id: 'alpha',
    domain: 'fi',
    name: 'Alpha engine v0',
    targetDate: '2027-03-25',
    targetLabel: 'Late Mar 2027',
    forecastDate: null,
    prevForecastDate: null,
    confidence: null,
    derived: fixtureProjectDerived({ status: 'define', deltaBd: null, sinceDays: null, milestones: [] }),
  });
}

describe('routine copy', () => {
  it('writes the rule long and short', () => {
    expect(ruleText({ kind: 'monthly', bd: 3, weekday: 2 })).toBe('3rd business day, monthly');
    expect(ruleText({ kind: 'monthly', bd: 11, weekday: 2 })).toBe('11th business day, monthly');
    expect(ruleText({ kind: 'weekly', bd: 5, weekday: 2 })).toBe('Every Tuesday');
    expect(ruleText({ kind: 'daily', bd: 5, weekday: 2 })).toBe('Every business day');
    expect(ruleShort({ kind: 'monthly', bd: 8, weekday: 2 })).toBe('BD8');
    expect(ruleShort({ kind: 'weekly', bd: 5, weekday: 4 })).toBe('Weekly · Thu');
    expect(ruleShort({ kind: 'daily', bd: 5, weekday: 2 })).toBe('Daily');
  });

  it('labels the row as the design does', () => {
    expect(routineRowLabel({ name: 'Fund & security-level returns', label: 'Fund & security returns' })).toBe(
      'Fund & security returns',
    );
    expect(routineRowLabel({ name: 'Monthly returns run', label: null })).toBe('Monthly returns run');
    expect(routineRowLabel({ name: 'Managing Committee pack', label: '  ' })).toBe('Managing Committee pack');
    expect(routineRowLabel({ name: '', label: null })).toBe('Untitled routine');
    expect(routineRowSub({ rule: { kind: 'monthly', bd: 3, weekday: 2 }, hours: 6 })).toBe('BD3 · 6h');
  });

  it('builds the routine tip with its stage and note', () => {
    const r = fixtureRoutine({ name: 'Fund & security-level returns', stage: 1, statusNote: 'Successor takes over in December.' });
    expect(routineTip(r)).toEqual({
      key: 'routine:r-ret',
      title: 'Fund & security-level returns',
      chip: 'BAU',
      lines: ['3rd business day, monthly, 6h · Automating', 'Successor takes over in December.'],
    });
    expect(routineTip(fixtureRoutine({ statusNote: '' })).lines).toHaveLength(1);
    expect(stageName(3)).toBe('Handed over');
  });

  it('labels two-week ticks, handed over after the move', () => {
    const r = fixtureRoutine();
    expect(tickText(r, false)).toBe('Returns · 6h');
    expect(tickText(r, true)).toBe('Handed over');
  });
});

describe('project copy', () => {
  it('shows the forecast and the delta in the row', () => {
    expect(forecastText(ret())).toBe('Wed 2 Dec');
    expect(rowChipText(ret())).toBe('+3 BD');
    expect(rowChipText(fixtureProject({ derived: fixtureProjectDerived({ status: 'on', deltaBd: -2 }) }))).toBe('−2 BD');
  });

  it('shows "Not yet" and the target chip for a Define project (critique :327)', () => {
    expect(forecastText(alpha())).toBe('Not yet');
    expect(rowChipText(alpha())).toBe('Target Late Mar 2027');
  });

  it('builds the project tip exactly', () => {
    expect(projectTip(ret())).toEqual({
      key: 'project:ret',
      title: 'Returns pipeline automation',
      chip: '+3 BD',
      chipColor: 'var(--risk-text)',
      lines: [
        'Forecast Wed 2 Dec · target Fri 27 Nov',
        'Previous plan ended Fri 27 Nov',
        'Confidence 3/5 · checked in 2 days ago',
        '◆ Security-level data feed connected · Thu 15 Oct',
        '◆ Fund-level engine reconciles · Fri 16 Oct',
        '◆ Handover-ready · Wed 2 Dec',
      ],
    });
  });

  it('builds the Define tip with "no plan" (only in the tip)', () => {
    expect(projectTip(alpha())).toEqual({
      key: 'project:alpha',
      title: 'Alpha engine v0',
      chip: 'no plan',
      chipColor: undefined,
      lines: ['No forecast until the plan exists · target Late Mar 2027', 'No plan yet'],
    });
  });

  it('shows an unset confidence and a project never checked in', () => {
    const p = fixtureProject({ confidence: null, derived: fixtureProjectDerived({ status: 'on', deltaBd: 0, sinceDays: null }) });
    expect(projectTip(p).lines[1]).toBe('Confidence —/5 · checked in not yet');
    expect(projectTip(p).chip).toBe('On target');
  });

  it('reverts to the shortened project tip on a milestone leave (Timeline.dc.html:337)', () => {
    expect(projectShortTip(ret())).toEqual({
      key: 'project:ret',
      title: 'Returns pipeline automation',
      chip: '+3 BD',
      lines: ['Forecast Wed 2 Dec · target Fri 27 Nov'],
    });
    // The same key as the full tip, so the rest of the row keeps the short tip (as setTip).
    expect(projectShortTip(ret()).key).toBe(projectTip(ret()).key);
  });

  it('builds the milestone tip', () => {
    const m = { name: 'Fund-level engine reconciles', date: '2026-10-16', passed: false };
    expect(milestoneTip(ret(), m, 12, 9)).toEqual({
      key: 'milestone:ret:Fund-level engine reconciles',
      title: 'Fund-level engine reconciles',
      chip: 'Milestone',
      lines: ['Friday 16 October · BD12', 'Returns pipeline automation', '9 business days away'],
    });
    expect(milestoneTip(ret(), { ...m, passed: true }, 12, -3).lines[2]).toBe('Passed');
    expect(milestoneTip(ret(), m, 12, 1).lines[2]).toBe('1 business day away');
  });
});

describe('rotation copy', () => {
  const rot = fixtureRotation({
    title: 'Eurozone sovereign rotation',
    startDate: '2027-01-04',
    loopEnd: '2027-03-08',
    segments: [
      {
        id: 'rot-0',
        order: 0,
        country: 'Germany',
        code: 'DE',
        lengthBd: 6,
        pass: 'Build',
        loop: 1,
        start: '2027-01-04',
        end: '2027-01-11',
      },
      {
        id: 'rot-1',
        order: 1,
        country: 'France',
        code: 'FR',
        lengthBd: 5,
        pass: 'Build',
        loop: 1,
        start: '2027-01-12',
        end: '2027-01-18',
      },
      {
        id: 'rot-2',
        order: 2,
        country: 'Germany',
        code: 'DE',
        lengthBd: 3,
        pass: 'Refresh',
        loop: 2,
        start: '2027-01-19',
        end: '2027-01-21',
      },
    ],
  });

  it('writes the note, the hours and the tip from the schedule', () => {
    expect(rotationNote(rot)).toBe('Starts Mon 4 Jan with Germany, first Build pass →');
    expect(rotationSub(rot)).toBe('4h/day');
    expect(rotationTip(rot)).toEqual({
      key: 'rotation',
      title: 'Eurozone sovereign rotation',
      chip: 'BAU',
      lines: ['Germany → France, then back to Germany to refresh.', 'First loop complete Mon 8 Mar.'],
    });
  });

  it('has no note without segments', () => {
    expect(rotationNote(fixtureRotation())).toBeNull();
    expect(rotationTip(fixtureRotation()).lines).toEqual([]);
  });
});

describe('capacity copy', () => {
  it('builds the day tip', () => {
    const load = {
      items: [
        { refType: 'routine' as const, refId: 'r-ret', domain: 'pc' as const, h: 6, name: 'Returns' },
        { refType: 'project' as const, refId: 'ret', domain: 'pc' as const, h: 3.5, name: 'Returns pipeline' },
      ],
      bau: 6,
      proj: 3.5,
      total: 9.5,
      free: 0,
      capacity: 8,
      over: true,
    };
    expect(dayTip({ iso: '2026-11-04', bdm: 3 }, load)).toEqual({
      key: 'day:2026-11-04',
      title: 'Wed 4 Nov · BD3',
      chip: 'Overload',
      chipColor: 'var(--overload)',
      lines: ['Returns (BAU) · 6h', 'Returns pipeline · 3.5h'],
    });
    const free = dayTip({ iso: '2026-12-21', bdm: 15 }, { ...load, items: [], total: 0, over: false });
    expect(free).toMatchObject({ chip: '0h of 8h', lines: ['Nothing planned.'], chipColor: undefined });
  });

  it('keys load items for the linked highlight', () => {
    expect(loadItemKey({ refType: 'rotation', refId: 'rot-3' })).toEqual({ type: 'rotation', id: 'rotation' });
    expect(loadItemKey({ refType: 'routine', refId: 'r-ret' })).toEqual({ type: 'routine', id: 'r-ret' });
    expect(loadItemKey({ refType: 'project', refId: 'ret' })).toEqual({ type: 'project', id: 'ret' });
  });

  it('writes the captions from settings', () => {
    expect(capacityCaption(8)).toBe('Hours per day against 8h.');
    expect(capacityCaption(7.5)).toBe('Hours per day against 7.5h.');
    expect(moveTag('2027-01-04')).toBe('FI move · Mon 4 Jan');
    expect(footnote('GB-ENG')).toBe(
      'Weekends and UK bank holidays are collapsed to slivers. Hover a row to trace it through the capacity strip; click for details.',
    );
    expect(footnote('ZA')).toMatch(/^Weekends and public holidays/);
    expect(footnote('GB-ENG', true)).toBe('Weekends and UK bank holidays are collapsed to slivers.');
  });
});
