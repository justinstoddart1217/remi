import { describe, expect, it } from 'vitest';

import type { ProjectDerivedOut, ProjectOut } from '../../api';
import { fixtureProject as fixtureProjectFull } from '../../test/msw';
import {
  CHARTER_LISTS,
  checkedInText,
  dueLabel,
  forecastChip,
  forecastRoll,
  hr,
  hrs,
  needModel,
  NO_PLAN_SENTENCE,
  nowWindow,
  planNote,
  removeArmedLabel,
  statsModel,
  verdictSentence,
} from './copy';

type Derived = Partial<ProjectDerivedOut>;
type Over = Partial<Omit<ProjectOut, 'derived'>> & { derived?: Derived };
const project = (over: Over = {}): ProjectOut => fixtureProjectFull(over as Partial<ProjectOut>);

type Params = ProjectDerivedOut['sentence']['params'];
const NO_PARAMS: Params = {
  bufferBd: null,
  cutH: null,
  firstOverDay: null,
  lateBd: null,
  moveDate: null,
  needRate: null,
  overDayCount: 0,
  rate: null,
  scopeH: null,
  staleDays: null,
  startsInBd: null,
  targetDate: null,
  workLeftH: null,
};

function withSentence(kind: ProjectDerivedOut['sentence']['case'], params: Partial<Params>, over: Over = {}): ProjectOut {
  return project({ ...over, derived: { ...over.derived, sentence: { case: kind, params: { ...NO_PARAMS, ...params } } } });
}

describe('number formats', () => {
  it('hr keeps one decimal place, hrs two plus "h"', () => {
    expect(hr(3.8)).toBe('3.8');
    expect(hr(3.04)).toBe('3');
    expect(hr(null)).toBe('0');
    expect(hrs(14)).toBe('14h');
    expect(hrs(5.555)).toBe('5.56h');
  });
});

describe('verdictSentence (Workspace.dc.html:396-404)', () => {
  it('asks for a plan without a forecast, in ink-faint', () => {
    expect(verdictSentence(withSentence('no_plan', {}))).toEqual({ text: NO_PLAN_SENTENCE, tone: 'faint', late: false });
  });

  it('keeps the stale clause on the no-plan sentence, as the prototype does', () => {
    const say = verdictSentence(withSentence('no_plan', { staleDays: 9 }));
    expect(say.text).toBe(`${NO_PLAN_SENTENCE} Not checked in for 9 days, so treat the forecast as untested.`);
  });

  it('writes the late case with the need and the cut', () => {
    const say = verdictSentence(
      withSentence('late', { lateBd: 3, needRate: 3.8, rate: 3.5, cutH: 10.25 }, { rate: 3.5, targetDate: '2026-11-27' }),
    );
    expect(say).toEqual({
      text: 'Lands 3 BD after target. To make Fri 27 Nov, plan 3.8h a day instead of 3.5h, or cut about 10.3h of work.',
      tone: 'risk',
      late: true,
    });
  });

  it('never tells a late project to plan 0h a day once the target has passed', () => {
    // Day rollover past the target: the server sends 'late' with no need rate (need.state
    // target_passed) and cutH = all the work left.
    const say = verdictSentence(
      withSentence(
        'late',
        { lateBd: 3, needRate: null, rate: 3.5, cutH: 10.5, workLeftH: 10.5 },
        { rate: 3.5, targetDate: '2026-11-27', derived: { need: { rate: null, state: 'target_passed' } } },
      ),
    );
    expect(say.text).toBe('Lands 3 BD after target. Fri 27 Nov has passed, so move the target to replan it.');
    expect(say.text).not.toMatch(/0h a day|cut about/);
    expect(say.tone).toBe('risk');
  });

  it('with no planned hours before the target, offers only the remedies that work', () => {
    const noCap = { need: { rate: null, state: 'no_capacity' } as ProjectDerivedOut['need'] };
    const all = verdictSentence(
      withSentence('late', { lateBd: 2, rate: 1, cutH: 12, workLeftH: 12 }, { rate: 1, targetDate: '2026-11-27', derived: noCap }),
    );
    expect(all.text).toBe(
      'Lands 2 BD after target. More hours a day cannot land it: no day before Fri 27 Nov takes planned hours. Move the target.',
    );
    const some = verdictSentence(
      withSentence('late', { lateBd: 2, rate: 1, cutH: 4, workLeftH: 12 }, { rate: 1, targetDate: '2026-11-27', derived: noCap }),
    );
    expect(some.text).toBe(
      'Lands 2 BD after target. More hours a day cannot land it: no day before Fri 27 Nov takes planned hours. Move the target, or cut about 4h of work.',
    );
  });

  it('uses the fuzzy target label in the copy', () => {
    const say = verdictSentence(withSentence('no_buffer', {}, { targetLabel: 'Late Mar 2027' }));
    expect(say.text).toBe('No buffer. It lands on the target day, so any new scope pushes it past Late Mar 2027.');
    expect(say.tone).toBe('risk');
    expect(say.late).toBe(false);
  });

  it('writes the after-the-move case in overload', () => {
    const say = verdictSentence(withSentence('after_move', { moveDate: '2027-01-04', rate: 2, cutH: 12 }));
    expect(say.text).toBe('Lands after the move on 4 Jan. At 2h a day this does not leave with you; cut 12h or plan more time.');
    expect(say.tone).toBe('overload');
    expect(say.late).toBe(true);
  });

  it('adds the overload, stale and start clauses in order', () => {
    const say = verdictSentence(
      withSentence('buffer', {
        bufferBd: 17,
        scopeH: 74.62,
        overDayCount: 2,
        firstOverDay: '2026-10-12',
        staleDays: 9,
        startsInBd: 4,
      }),
    );
    expect(say.text).toBe(
      '17 BD of buffer: roughly 74.6h of new scope before the target moves. It sits on 2 overloaded days, first Mon 12 Oct. ' +
        'Not checked in for 9 days, so treat the forecast as untested. Starts in 4 BD.',
    );
    expect(say.tone).toBe('ink');
  });

  it('uses the singular for one overloaded day', () => {
    const say = verdictSentence(withSentence('buffer', { bufferBd: 2, scopeH: 3, overDayCount: 1, firstOverDay: '2026-11-04' }));
    expect(say.text).toContain('It sits on 1 overloaded day, first Wed 4 Nov.');
  });
});

describe('needModel (critique Workspace:407-413)', () => {
  it('shows "—" with the reason when there is nothing to solve', () => {
    expect(needModel(project({ derived: { need: { rate: null, state: 'no_estimate' } } }))).toMatchObject({
      value: '—',
      unit: '',
      none: true,
      sub: 'needs a work estimate',
    });
    expect(needModel(project({ derived: { need: { rate: null, state: 'target_passed' } } })).sub).toBe('target has passed');
  });

  it('flags a need above the plan', () => {
    const need = needModel(project({ rate: 3.5, derived: { need: { rate: 3.8, state: 'ok' } } }));
    expect(need).toEqual({ value: '3.8', unit: 'h a day', bad: true, none: false, sub: '0.3h a day more than planned' });
  });

  it('reads "within your" when the plan is enough (0.05h tolerance)', () => {
    const need = needModel(project({ rate: 3, derived: { need: { rate: 3.05, state: 'ok' } } }));
    expect(need.bad).toBe(false);
    expect(need.sub).toBe('within your 3h a day');
  });
});

describe('statsModel (Workspace.dc.html:407-415)', () => {
  const today = '2026-10-05';

  it('describes a started project with a forecast', () => {
    const p = project({
      startDate: '2026-09-14',
      targetDate: '2026-11-27',
      forecastDate: '2026-12-02',
      rate: 3.5,
      derived: {
        started: true,
        doneBd: 15,
        totalBd: 58,
        bdToTarget: 40,
        bdLeft: 43,
        avgPlan: 3,
        workLeftDisplay: 144.5,
        progressPct: 25.862069,
      },
    });
    const st = statsModel(p, today);
    expect(st.start).toEqual({ roll: 'Mon 14 Sep', sub: '15 BD in of 58' });
    expect(st.target).toEqual({ roll: 'Fri 27 Nov', sub: '40 BD from today' });
    expect(st.forecast.sub).toBe('43 BD of work left');
    expect(st.rate.sub).toBe('averages 3h once BAU days are counted');
    expect(st.left).toEqual({ value: '144.5', sub: 'planned between now and the forecast' });
    expect(st.progress).toBe('25.862069%');
  });

  it('describes a project that has not started, without a forecast', () => {
    const p = project({
      startDate: '2026-10-12',
      targetDate: '2026-11-27',
      forecastDate: null,
      derived: { started: false, startsInBd: 5, bdToTarget: 35, workLeftDisplay: null, avgPlan: null, progressPct: 0 },
    });
    const st = statsModel(p, today);
    expect(st.start.sub).toBe('starts in 5 BD');
    expect(st.target.sub).toBe('35 BD from start');
    expect(st.forecast.sub).toBe('set work left to get one');
    expect(st.rate.sub).toBe('planned focus time');
    expect(st.left).toEqual({ value: '', sub: 'your estimate of what remains' });
  });

  it('reads "passed" for a past target and clamps the progress rule', () => {
    const p = project({ targetDate: '2026-09-30', targetLabel: null, derived: { bdToTarget: 0, progressPct: 140 } });
    const st = statsModel(p, today);
    expect(st.target.sub).toBe('passed');
    expect(st.progress).toBe('100%');
  });

  it('keeps "planned focus time" when the average is within 0.2h of the rate', () => {
    const p = project({ rate: 3, forecastDate: '2026-12-02', derived: { avgPlan: 3.15 } });
    expect(statsModel(p, today).rate.sub).toBe('planned focus time');
  });
});

describe('header chips and small copy', () => {
  it('forecastChip', () => {
    expect(forecastChip(3)).toEqual({ label: '+3 BD vs target', tone: 'risk' });
    expect(forecastChip(-2)).toEqual({ label: '−2 BD vs target', tone: 'neutral' });
    expect(forecastChip(0)).toEqual({ label: 'On target', tone: 'neutral' });
    expect(forecastChip(null)).toEqual({ label: 'No forecast', tone: 'neutral' });
  });

  it('checkedInText (critique :580)', () => {
    expect(checkedInText(null)).toBe('never');
    expect(checkedInText(0)).toBe('today');
    expect(checkedInText(1)).toBe('yesterday');
    expect(checkedInText(2)).toBe('2 days ago');
  });

  it('nowWindow', () => {
    expect(nowWindow('2026-10-05', '2026-10-16')).toBe('next 2 weeks · 5–16 Oct');
    expect(nowWindow('2026-10-26', '2026-11-06')).toBe('next 2 weeks · 26 Oct–6 Nov');
    expect(nowWindow('2026-10-05', null)).toBe('next 2 weeks');
  });

  it('planNote', () => {
    expect(planNote(project({ derived: { status: 'define' } }))).toBe('Drafted after the charter');
    expect(planNote(project({ derived: { status: 'on', nowEstimateH: 14 } }))).toBe('14h estimated in Now');
  });

  it('forecastRoll and the remove label', () => {
    expect(forecastRoll('2026-12-02')).toBe('Wed 2 Dec');
    expect(forecastRoll(null)).toBe('Not yet');
    expect(removeArmedLabel('Returns pipeline')).toBe('Click again to remove Returns pipeline and its history');
  });

  it('charter lists carry the exact placeholders and empties (critique :525)', () => {
    expect(CHARTER_LISTS.map((l) => [l.label, l.placeholder, l.empty])).toEqual([
      ['Success measures', 'A measurable outcome', 'How will you know it worked?'],
      ['In scope', 'Something this includes', 'Not written yet. What must it do?'],
      ['Out of scope', 'Something you will refuse', 'Not written yet. What will you refuse to build?'],
      ['Constraints', 'A limit to respect', 'None noted yet.'],
    ]);
  });
});

describe('dueLabel', () => {
  it('names a milestone date button by its milestone, then the date it shows', () => {
    expect(dueLabel({ name: 'Dry run', dueDate: '2026-10-16' })).toBe('Dry run, due Fri 16 Oct');
    expect(dueLabel({ name: '  ', dueDate: null })).toBe('Milestone: Set date');
  });
});
