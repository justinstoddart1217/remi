import { describe, expect, it } from 'vitest';

import type { ProjectDerivedOut, ProjectOut } from '../../api';
import { fixtureProject as fixtureProjectFull } from '../../test/msw';
import { EMPTY_GOAL, growthText, pcNote, projectGroups, projectsHelper, projectRow, rowDelayMs, targetText } from './model';

const MINUS = '−';

type Over = Partial<Omit<ProjectOut, 'derived'>> & { derived?: Partial<ProjectDerivedOut> };
/** The shared fixture merges a partial `derived` over its defaults. */
const fixtureProject = (over: Over = {}): ProjectOut => fixtureProjectFull(over as Partial<ProjectOut>);

describe('growthText (critique Projects:82)', () => {
  it('reads "—" without a baseline', () => {
    expect(growthText(0, 0, null)).toBe('—');
    expect(growthText(0, 12, 20)).toBe('—');
  });

  it('reads "0% · {h}h" with no growth', () => {
    expect(growthText(40, 0, 0)).toBe('0% · 40h');
    expect(growthText(40, 0, null)).toBe('0% · 40h');
  });

  it('adds the growth and the total hours', () => {
    expect(growthText(60, 10, 17)).toBe('+17% · 70h');
    expect(growthText(12.5, 0.25, 2)).toBe('+2% · 12.75h');
  });
});

describe('targetText', () => {
  it('prefers the fuzzy label', () => {
    expect(targetText({ targetLabel: 'Late Mar 2027', targetDate: '2027-03-26' })).toBe('Late Mar 2027');
    expect(targetText({ targetLabel: null, targetDate: '2026-11-27' })).toBe('Fri 27 Nov');
  });
});

describe('projectRow', () => {
  it('formats a late project with the risk chip', () => {
    const p = fixtureProject({
      forecastDate: '2026-12-02',
      targetDate: '2026-11-27',
      baselineHours: 60,
      derived: { status: 'risk', deltaBd: 3, addedH: 10, growthPct: 17, sinceDays: 3, stale: false },
    });
    const row = projectRow(p, 0);
    expect(row).toMatchObject({
      forecast: 'Wed 2 Dec',
      chip: '+3 BD',
      chipTone: 'risk',
      target: 'target Fri 27 Nov',
      growth: '+17% · 70h',
      growthRisk: true,
      sinceLabel: '3 days ago',
      goalMuted: false,
      stale: false,
    });
    expect(parseFloat(row.baseW) + parseFloat(row.addW)).toBeCloseTo(100);
    expect(parseFloat(row.addW)).toBeCloseTo((10 / 70) * 100);
  });

  it('shows "Not yet" and "no plan" in Define', () => {
    const p = fixtureProject({ forecastDate: null, baselineHours: 0, derived: { status: 'define', deltaBd: null, growthPct: null } });
    const row = projectRow(p, 4);
    expect(row.forecast).toBe('Not yet');
    expect(row.chip).toBe('no plan');
    expect(row.chipTone).toBe('neutral');
    expect(row.growth).toBe('—');
    expect(row.baseW).toBe('0%');
    expect(row.addW).toBe('0%');
    expect(row.index).toBe(4);
  });

  it('uses the neutral chip ahead of target and on target', () => {
    const early = projectRow(fixtureProject({ derived: { status: 'on', deltaBd: -2 } }), 0);
    expect(early.chip).toBe(`${MINUS}2 BD`);
    expect(early.chipTone).toBe('neutral');
    expect(projectRow(fixtureProject({ derived: { status: 'on', deltaBd: 0 } }), 0).chip).toBe('On target');
  });

  it('mutes a stale goal and prompts for a missing one (critique Projects:75)', () => {
    const stale = projectRow(fixtureProject({ derived: { stale: true, sinceDays: 9 } }), 0);
    expect(stale.goalMuted).toBe(true);
    expect(stale.stale).toBe(true);
    expect(stale.sinceDays).toBe(9);
    expect(stale.sinceLabel).toBe('9 days ago');

    const blank = projectRow(fixtureProject({ goal: '   ' }), 0);
    expect(blank.goal).toBe(EMPTY_GOAL);
    expect(blank.goalMuted).toBe(true);
  });

  it('reads "Not yet" before the first check-in', () => {
    expect(projectRow(fixtureProject({ derived: { sinceDays: null } }), 0).sinceLabel).toBe('Not yet');
  });
});

describe('pcNote', () => {
  it('counts Private Credit projects past target', () => {
    const list = [
      fixtureProject({ id: 'a', domain: 'pc', derived: { status: 'risk' } }),
      fixtureProject({ id: 'b', domain: 'pc', derived: { status: 'on' } }),
      fixtureProject({ id: 'c', domain: 'fi', derived: { status: 'risk' } }),
    ];
    expect(pcNote(list, '2027-01-04')).toBe('Wind down by 4 Jan: automate or hand over · 1 past target');
  });

  it('reads "all inside target" when every Private Credit project lands inside it', () => {
    const list = [
      fixtureProject({ id: 'a', domain: 'pc', derived: { status: 'on' } }),
      fixtureProject({ id: 'c', domain: 'fi', derived: { status: 'risk' } }),
    ];
    expect(pcNote(list, '2027-01-04')).toBe('Wind down by 4 Jan: automate or hand over · all inside target');
  });

  it('claims nothing about targets with no Private Credit projects, and falls back without a move date', () => {
    expect(pcNote([], null)).toBe('Wind down before the move: automate or hand over');
    expect(pcNote([fixtureProject({ id: 'f', domain: 'fi', derived: { status: 'on' } })], '2027-01-04')).toBe(
      'Wind down by 4 Jan: automate or hand over',
    );
  });

  it('does not call Define projects (no forecast) inside target', () => {
    const define = fixtureProject({ id: 'd', domain: 'pc', derived: { status: 'define' } });
    const on = fixtureProject({ id: 'o', domain: 'pc', derived: { status: 'on' } });
    expect(pcNote([define], '2027-01-04')).toBe('Wind down by 4 Jan: automate or hand over · no plan yet');
    expect(pcNote([define, on], '2027-01-04')).toBe('Wind down by 4 Jan: automate or hand over · none past target');
  });
});

describe('projectsHelper', () => {
  it('only hints at clicking a project once there is one', () => {
    expect(projectsHelper(3)).toBe('Private Credit first, then Fixed Income · click a project to open its workspace');
    expect(projectsHelper(0)).toBe('Private Credit first, then Fixed Income');
  });
});

describe('projectGroups', () => {
  const list = [
    fixtureProject({ id: 'fion', domain: 'fi' }),
    fixtureProject({ id: 'ret', domain: 'pc' }),
    fixtureProject({ id: 'alpha', domain: 'fi' }),
    fixtureProject({ id: 'manco', domain: 'pc' }),
  ];

  it('puts Private Credit first, then Fixed Income, each in plan order', () => {
    const groups = projectGroups(list, '2027-01-04');
    expect(groups.map((g) => g.label)).toEqual(['Private Credit', 'Fixed Income']);
    expect(groups[0]?.rows.map((r) => r.id)).toEqual(['ret', 'manco']);
    expect(groups[1]?.rows.map((r) => r.id)).toEqual(['fion', 'alpha']);
    expect(groups[1]?.note).toBe('Ready for day one, then build');
  });

  it('runs the arrival index on across the groups', () => {
    const groups = projectGroups(list, '2027-01-04');
    expect(groups.flatMap((g) => g.rows.map((r) => r.index))).toEqual([0, 1, 2, 3]);
  });

  it('carries the start-empty copy for each group', () => {
    const groups = projectGroups([], null);
    expect(groups.every((g) => g.rows.length === 0)).toBe(true);
    expect(groups[0]?.empty).toBe('No Private Credit projects yet. Start one with + New project.');
    expect(groups[1]?.empty).toBe('No Fixed Income projects yet. Start one with + New project.');
  });
});

describe('rowDelayMs (Projects.dc.html:88)', () => {
  it('is 40 + 30ms per row', () => {
    expect(rowDelayMs(0)).toBe(40);
    expect(rowDelayMs(3)).toBe(130);
  });
});
