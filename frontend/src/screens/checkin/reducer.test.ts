import { describe, expect, it } from 'vitest';

import type { ProposalOut } from '../../api';
import { canSend, checkinReducer, initialState } from './reducer';
import type { CheckinAction, CheckinState } from './reducer';

const PROPOSAL: ProposalOut = {
  summary: 'Here is what a simple reading picked out.',
  changes: [
    { type: 'scope_add', projectId: 'ret', text: 'FX attribution', hours: 6 },
    { type: 'blocker', projectId: 'ret', text: 'the admin extract' },
  ],
  unplaced: [],
  source: 'simple',
  parseId: 'p1',
  provider: 'none',
  model: null,
};

function run(state: CheckinState, ...actions: CheckinAction[]): CheckinState {
  return actions.reduce(checkinReducer, state);
}

const composing = () => initialState(1, 'ret', 'Finished the FX share classes. They want FX attribution too.', true);

describe('checkinReducer', () => {
  it('sends only non-blank text, from compose or error', () => {
    expect(canSend(initialState(1, null, '   ', true))).toBe(false);
    const s = run(composing(), { type: 'send' });
    expect(s.phase).toBe('thinking');
    expect(s.echo).toEqual(['Finished the FX share classes.', 'They want FX attribution too.']);
    expect(s.progress).toBe(0);
    expect(run(s, { type: 'send' })).toBe(s);
  });

  it('runs the progress rule 0 → 88 → 100 for the current attempt only', () => {
    const s = run(composing(), { type: 'send' });
    const reading = run(s, { type: 'reading', attempt: s.attempt });
    expect(reading).toMatchObject({ progress: 88, echoOn: true });
    expect(run(reading, { type: 'answered', attempt: s.attempt }).progress).toBe(100);
    expect(run(s, { type: 'reading', attempt: s.attempt - 1 })).toBe(s);
  });

  it('lands a reading in review with everything ticked, and ignores stale answers', () => {
    const s = run(composing(), { type: 'send' });
    const review = run(s, { type: 'resolved', attempt: s.attempt, result: PROPOSAL });
    expect(review).toMatchObject({ phase: 'review', off: {}, shown: false, progress: 100 });
    expect(run(review, { type: 'shown', attempt: s.attempt }).shown).toBe(true);
    expect(run(s, { type: 'resolved', attempt: s.attempt + 1, result: PROPOSAL })).toBe(s);
  });

  it('fails to the error phase with the reason, and ⌘↵ can send again from there', () => {
    const s = run(composing(), { type: 'send' });
    const err = run(s, { type: 'failed', attempt: s.attempt, message: 'Remi replied without a plan.' });
    expect(err).toMatchObject({ phase: 'error', error: 'Remi replied without a plan.' });
    expect(canSend(err)).toBe(true);
    expect(run(err, { type: 'send' }).phase).toBe('thinking');
  });

  it('"Use a simple reading" runs from the error phase only', () => {
    const s = run(composing(), { type: 'send' });
    const err = run(s, { type: 'failed', attempt: s.attempt, message: 'x' });
    const simple = run(err, { type: 'simple' });
    expect(simple.simplePending).toBe(true);
    expect(simple.attempt).toBe(err.attempt + 1);
    expect(run(composing(), { type: 'simple' }).simplePending).toBe(false);
    expect(run(simple, { type: 'resolved', attempt: simple.attempt, result: PROPOSAL }).phase).toBe('review');
  });

  it('toggles rows in review', () => {
    const s = run(composing(), { type: 'send' });
    const review = run(s, { type: 'resolved', attempt: s.attempt, result: PROPOSAL });
    const off = run(review, { type: 'toggle', index: 0 });
    expect(off.off).toEqual({ 0: true });
    expect(run(off, { type: 'toggle', index: 0 }).off).toEqual({});
    expect(run(review, { type: 'toggle', index: 9 })).toBe(review);
  });

  it('drops back to compose when the text changes in review or error (crit :309)', () => {
    const s = run(composing(), { type: 'send' });
    const review = run(s, { type: 'resolved', attempt: s.attempt, result: PROPOSAL });
    const typed = run(review, { type: 'type', text: 'Something else' });
    expect(typed).toMatchObject({ phase: 'compose', result: null, text: 'Something else' });
    // A late answer from the discarded reading is ignored.
    expect(run(typed, { type: 'resolved', attempt: s.attempt, result: PROPOSAL }).phase).toBe('compose');
    // The textarea is read-only while thinking.
    expect(run(s, { type: 'type', text: 'x' })).toBe(s);
  });

  it('"Edit update" returns to compose from review', () => {
    const s = run(composing(), { type: 'send' });
    const review = run(s, { type: 'resolved', attempt: s.attempt, result: PROPOSAL });
    expect(run(review, { type: 'edit' }).phase).toBe('compose');
  });

  it('closing abandons a reading in flight', () => {
    const s = run(composing(), { type: 'send' });
    const closed = run(s, { type: 'visibility', open: false });
    expect(closed).toMatchObject({ phase: 'compose', open: false });
    expect(run(closed, { type: 'resolved', attempt: s.attempt, result: PROPOSAL }).phase).toBe('compose');
  });

  it('a new session resets; a failed apply reopens the same review', () => {
    const s = run(composing(), { type: 'send' });
    const review = run(s, { type: 'resolved', attempt: s.attempt, result: PROPOSAL }, { type: 'toggle', index: 1 });
    const fresh = run(review, { type: 'open', session: 2, focus: null, text: 'Hello', open: true });
    expect(fresh).toMatchObject({ session: 2, phase: 'compose', text: 'Hello', focus: null, result: null });

    const failed = run(review, { type: 'applyFailed', session: 1 });
    expect(failed.restoreNext).toBe(true);
    const restored = run(failed, { type: 'restore', session: 2, open: true });
    expect(restored).toMatchObject({ session: 2, phase: 'review', off: { 1: true }, restoreNext: false });
  });

  it('clears the focus project', () => {
    expect(run(composing(), { type: 'clearFocus' }).focus).toBeNull();
  });
});
