import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { fixturePlan, renderWithClient, setupMockApi } from '../../test/msw';
import {
  COUNTDOWN_PLACEHOLDER,
  dateLine,
  dateLineParts,
  headerModelFromPlan,
  NO_PC_SENTENCE,
  PLACEHOLDER_HEADER,
  placeholderHeader,
  useHeaderModel,
  VERDICT_CHROME,
} from './headerModel';

const mock = setupMockApi();

describe('headerModelFromPlan', () => {
  it('formats the prototype header: Mon 5 Oct · BD3 · 61 · Move on track, narrowly', () => {
    const model = headerModelFromPlan(fixturePlan());
    expect(model.status).toBe('ready');
    expect(model.today).toBe('Mon 5 Oct');
    expect(model.bd).toBe('BD3');
    expect(model.countdown).toBe('61');
    expect(model.countdownBd).toBe(61);
    expect(model.verdict).toEqual({ word: 'Move on track, narrowly', short: 'Yes, narrowly', dot: 'var(--ink)' });
    expect(model.verdictState).toBe('on_track_narrowly');
    expect(model.tz).toBe('Europe/London');
    expect(dateLine(model)).toBe('Mon 5 Oct · BD3 · Move on track, narrowly');
    expect(dateLineParts(model)).toEqual({ date: 'Mon 5 Oct · BD3 ·', verdict: 'Move on track, narrowly' });
  });

  it("reads the clock's zone from the plan's business timezone", () => {
    const plan = fixturePlan();
    expect(headerModelFromPlan({ ...plan, today: { ...plan.today, tz: 'Africa/Johannesburg' } }).tz).toBe('Africa/Johannesburg');
  });

  it('shows no BD on a weekend or holiday', () => {
    const plan = fixturePlan();
    const saturday = { ...plan, today: { ...plan.today, iso: '2026-10-10', w: 6, isBd: false, bdm: null } };
    const model = headerModelFromPlan(saturday);
    expect(model.today).toBe('Sat 10 Oct');
    expect(model.bd).toBe('');
    expect(dateLine(model)).toBe('Sat 10 Oct · Move on track, narrowly');
  });

  it('uses the spec copy for every verdict state', () => {
    const plan = fixturePlan();
    const word = (state: keyof typeof VERDICT_CHROME) =>
      headerModelFromPlan({ ...plan, verdict: { ...plan.verdict, state } }).verdict;
    expect(word('off_track')).toEqual({ word: 'Off track for the move', short: 'Not yet', dot: 'var(--overload)' });
    expect(word('at_risk')).toEqual({ word: 'Move at risk', short: 'At risk', dot: 'var(--risk)' });
    expect(word('on_track')).toEqual({ word: 'Move on track', short: 'Yes', dot: 'var(--ink)' });
    expect(word('no_pc').short).toBe('Not yet');
    expect(NO_PC_SENTENCE).toBe(
      'Add your Private Credit projects and routines, and Remi works out whether you can move cleanly.',
    );
  });

  it('placeholders carry no date, number or verdict', () => {
    for (const model of [PLACEHOLDER_HEADER, placeholderHeader('setup'), placeholderHeader('error')]) {
      expect(model.today).toBe('');
      expect(model.bd).toBe('');
      expect(model.countdown).toBe(COUNTDOWN_PLACEHOLDER);
      expect(model.countdownBd).toBeNull();
      expect(model.verdict.word).toBe('');
      expect(model.verdictState).toBeNull();
      expect(model.tz).toBeNull();
      expect(dateLine(model)).toBe('');
      expect(dateLineParts(model)).toEqual({ date: '', verdict: '' });
    }
  });
});

describe('useHeaderModel', () => {
  it('shows placeholders while loading, then the plan', async () => {
    const { result } = renderWithClient(() => useHeaderModel());
    expect(result.current).toBe(PLACEHOLDER_HEADER);
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect([result.current.today, result.current.bd, result.current.countdown, result.current.verdict.word]).toEqual([
      'Mon 5 Oct',
      'BD3',
      '61',
      'Move on track, narrowly',
    ]);
  });

  it('stays calm before setup', async () => {
    mock.api.state.plan = null;
    const { result } = renderWithClient(() => useHeaderModel());
    await waitFor(() => {
      expect(result.current.status).toBe('setup');
    });
    expect(result.current.countdown).toBe(COUNTDOWN_PLACEHOLDER);
    expect(result.current.today).toBe('');
  });
});
