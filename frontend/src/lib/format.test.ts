import { describe, expect, it } from 'vitest';

import * as F from './format';

describe('format', () => {
  it('formats dates with fixed en-GB arrays', () => {
    expect(F.s('2026-10-05')).toBe('Mon 5 Oct');
    expect(F.dm('2026-10-05')).toBe('5 Oct');
    expect(F.l('2026-10-05')).toBe('Monday 5 October');
    expect(F.s('2026-12-02')).toBe('Wed 2 Dec');
    expect(F.s('2027-01-04')).toBe('Mon 4 Jan');
    expect(F.wd('2026-10-10')).toBe('Sat');
    expect(F.mon('2027-03-08')).toBe('Mar');
    expect(F.monL('2027-03-08')).toBe('March');
    expect(F.d('2027-03-08')).toBe(8);
    expect(F.monthYear('2026-10')).toBe('October 2026');
  });

  it('matches the Roll date shapes', () => {
    expect(F.s('2026-11-27')).toMatch(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/);
    expect(F.dm('2026-11-27')).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/);
  });

  it('formats business days and deltas with U+2212', () => {
    expect(F.bd(3)).toBe('BD3');
    expect(F.delta(3)).toBe('+3 BD');
    expect(F.delta(-2)).toBe('−2 BD');
    expect(F.delta(0)).toBe('On target');
    expect(F.delta(null)).toBe('No forecast');
    expect(F.deltaBD(3)).toBe('+3 BD');
    expect(F.deltaBD(-1)).toBe('−1 BD');
    expect(F.deltaBD(0)).toBe('±0 BD');
    expect(F.signed(-2.5)).toBe('−2.5');
    expect(F.MINUS).toBe('−');
  });

  it('formats since, hours, ordinals and plurals', () => {
    expect(F.since(null)).toBe('Not yet');
    expect(F.since(0)).toBe('Today');
    expect(F.since(1)).toBe('Yesterday');
    expect(F.since(9)).toBe('9 days ago');
    expect(F.hours(6)).toBe('6h');
    expect(F.hours(0.75)).toBe('0.75h');
    expect(F.hours(9.500000001)).toBe('9.5h');
    expect(F.hours(0.1 + 0.2)).toBe('0.3h');
    expect([1, 2, 3, 4, 8, 11, 12, 13, 21, 22, 23].map(F.ord)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '8th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
    ]);
    expect(F.plural(1, 'business day')).toBe('business day');
    expect(F.plural(2, 'business day')).toBe('business days');
    expect(F.count(1, 'note')).toBe('1 note');
    expect(F.count(0, 'note')).toBe('0 notes');
    expect(F.count(2, 'child', 'children')).toBe('2 children');
  });
});
