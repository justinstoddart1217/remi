import { describe, expect, it } from 'vitest';

import {
  blankSegment,
  countedTotals,
  editSegment,
  fromServer,
  MAX_LENGTH_BD,
  moveSegment,
  normaliseCode,
  position,
  rotationSummary,
  rotationTotals,
  segmentIssue,
  segmentsDirty,
  segmentsIn,
  segmentsValid,
} from './model';
import type { SegmentDraft } from './model';

function seg(patch: Partial<SegmentDraft> = {}): SegmentDraft {
  return { key: 'k', id: null, country: 'Germany', code: 'DE', lengthBd: 6, pass: 'Build', ...patch };
}

describe('codes and issues', () => {
  it('normalises codes to two capital letters', () => {
    expect(normaliseCode(' de ')).toBe('DE');
    expect(normaliseCode('d3')).toBe('D');
    expect(normaliseCode('fra')).toBe('FR');
  });

  it('names what an entry still needs', () => {
    expect(segmentIssue(seg())).toBeNull();
    expect(segmentIssue(seg({ country: '', code: '' }))).toBe('Needs a country and its two-letter code');
    expect(segmentIssue(seg({ country: ' ' }))).toBe('Needs a country name');
    expect(segmentIssue(seg({ code: 'D' }))).toBe('Needs a two-letter code');
    expect(segmentIssue(seg({ country: 'x'.repeat(61) }))).toBe('Country names stop at 60 characters');
    expect(segmentIssue(seg({ lengthBd: 0 }))).toBe(`Length is 1 to ${String(MAX_LENGTH_BD)} business days`);
    expect(segmentsValid([seg(), seg({ code: '' })])).toBe(false);
    expect(segmentsValid([])).toBe(true);
  });
});

describe('editSegment', () => {
  it('fills an empty country from a code, and an empty code from a country', () => {
    expect(editSegment(seg({ country: '', code: '' }), { code: 'fr' })).toMatchObject({ code: 'FR', country: 'France' });
    expect(editSegment(seg({ country: '', code: '' }), { country: 'Germany' })).toMatchObject({ code: 'DE' });
    expect(editSegment(seg({ country: '', code: '' }), { country: ' uk ' })).toMatchObject({ country: 'United Kingdom', code: 'GB' });
    expect(editSegment(seg({ country: '', code: '' }), { country: 'fr' })).toMatchObject({ country: 'France', code: 'FR' });
    expect(editSegment(seg({ country: '', code: '' }), { country: 'England' })).toMatchObject({ country: 'England', code: 'GB' });
  });

  it('never overwrites what is already there', () => {
    expect(editSegment(seg({ country: 'Deutschland' }), { code: 'AT' })).toMatchObject({ country: 'Deutschland', code: 'AT' });
    expect(editSegment(seg({ code: 'XX' }), { country: 'France' })).toMatchObject({ code: 'XX' });
  });

  it('clamps and rounds the length', () => {
    expect(editSegment(seg(), { lengthBd: 0 }).lengthBd).toBe(1);
    expect(editSegment(seg(), { lengthBd: 500 }).lengthBd).toBe(MAX_LENGTH_BD);
    expect(editSegment(seg(), { lengthBd: 4.6 }).lengthBd).toBe(5);
  });
});

describe('list helpers', () => {
  it('moves an entry and keeps the same list for a no-op', () => {
    const list = ['a', 'b', 'c'] as const;
    expect(moveSegment(list, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveSegment(list, 2, -5)).toEqual(['c', 'a', 'b']);
    expect(moveSegment(list, 1, 1)).toBe(list);
    expect(moveSegment(list, 7, 0)).toBe(list);
  });

  it('compares a draft with what the server holds', () => {
    const saved = [seg({ id: 'r0', key: 'r0' })];
    expect(segmentsDirty([seg({ id: 'r0', key: 'other' })], saved)).toBe(false);
    expect(segmentsDirty([seg({ id: 'r0', lengthBd: 7 })], saved)).toBe(true);
    expect(segmentsDirty([], saved)).toBe(true);
    expect(segmentsDirty([seg({ id: null })], saved)).toBe(true);
  });

  it('sums the loop and the refresh, counting countries once', () => {
    const list = [seg(), seg({ code: 'FR', lengthBd: 5 }), seg({ pass: 'Refresh', lengthBd: 3 })];
    expect(rotationTotals(list)).toEqual({ build: 11, refresh: 3, total: 14 });
    expect(rotationSummary(list)).toBe('2 countries · 14 BD');
  });

  it('summarises complete stops only, and names the unfinished ones (the editor never counts them)', () => {
    const blank = { ...blankSegment('Build'), key: 'b' };
    // 'Add the first country', left blank: the rail must not claim a country or its days.
    expect(rotationSummary([blank])).toBe('1 unfinished stop');
    expect(rotationSummary([seg(), seg({ code: 'FR', lengthBd: 5 }), blank])).toBe('2 countries · 11 BD · 1 unfinished stop');
    expect(rotationSummary([seg({ code: '' }), seg({ code: '' })])).toBe('2 unfinished stops');
  });

  it('leaves unfinished stops out of the totals line and counts them', () => {
    const saved = [seg({ lengthBd: 38 }), seg({ code: 'FR', lengthBd: 5 }), seg({ pass: 'Refresh', lengthBd: 3 })];
    const blank = { ...blankSegment('Refresh'), key: 'b' };
    expect(countedTotals([...saved, blank])).toEqual({ build: 43, refresh: 3, unfinished: 1 });
    expect(countedTotals(saved)).toEqual({ build: 43, refresh: 3, unfinished: 0 });
    expect(countedTotals([blank, { ...blank, key: 'c', pass: 'Build' }])).toEqual({ build: 0, refresh: 0, unfinished: 2 });
  });

  it('builds the request, sending ids only for saved entries', () => {
    expect(segmentsIn([seg({ id: 'r0', country: ' Germany ' }), seg({ code: 'FR', country: 'France' })])).toEqual([
      { id: 'r0', country: 'Germany', code: 'DE', lengthBd: 6, pass: 'Build' },
      { country: 'France', code: 'FR', lengthBd: 6, pass: 'Build' },
    ]);
  });

  it('reads the server list in order, keyed by id', () => {
    const out = fromServer([
      { id: 'b', order: 1, country: 'France', code: 'FR', lengthBd: 5, pass: 'Build', loop: 1, start: '2027-01-12', end: '2027-01-18' },
      { id: 'a', order: 0, country: 'Germany', code: 'DE', lengthBd: 6, pass: 'Build', loop: 1, start: '2027-01-04', end: '2027-01-11' },
    ]);
    expect(out.map((s) => s.key)).toEqual(['a', 'b']);
  });

  it('makes blank entries with fresh keys, and pads positions', () => {
    const a = blankSegment();
    const b = blankSegment('Refresh');
    expect(a.key).not.toBe(b.key);
    expect(b).toMatchObject({ id: null, country: '', code: '', pass: 'Refresh' });
    expect(position(0)).toBe('01');
    expect(position(10)).toBe('11');
  });
});
