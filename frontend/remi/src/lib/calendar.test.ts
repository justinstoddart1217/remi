import { describe, expect, it } from 'vitest';

import { buildCalendarDays, FIXTURE_DAYS, FIXTURE_MOVE, FIXTURE_TODAY } from '../test/fixtures/calendar';
import { addMonths, asIsoDate, CalendarIndex, isIsoDate, weekdayOf } from './calendar';

const cal = new CalendarIndex(FIXTURE_DAYS);

function bdsInMonth(month: string): number {
  return cal.days.filter((d) => d.iso.startsWith(month) && d.bd).length;
}

describe('CalendarIndex', () => {
  it('brands only real ISO dates', () => {
    expect(isIsoDate('2026-10-05')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-10-5')).toBe(false);
    expect(asIsoDate('nope')).toBeNull();
    expect(weekdayOf('2026-10-05')).toBe(1);
    expect(weekdayOf('2026-10-04')).toBe(0);
  });

  it('looks up days, business days and holidays', () => {
    expect(cal.first).toBe('2026-08-31');
    expect(cal.last).toBe('2027-04-30');
    expect(cal.isBD('2026-10-05')).toBe(true);
    expect(cal.bdOfMonth('2026-10-05')).toBe(3);
    expect(cal.isBD('2026-10-10')).toBe(false);
    expect(cal.bdOfMonth('2026-10-10')).toBeNull();
    expect(cal.holiday('2026-12-25')).toBe('Christmas Day');
    expect(cal.isBD('2026-08-31')).toBe(false);
    expect(cal.day('2027-05-01')).toBeNull();
    expect(cal.isBD('2027-05-01')).toBeNull();
  });

  it('counts the golden business days per month', () => {
    expect(bdsInMonth('2026-10')).toBe(22);
    expect(bdsInMonth('2026-11')).toBe(21);
    expect(bdsInMonth('2026-12')).toBe(21);
    expect(bdsInMonth('2027-01')).toBe(20);
  });

  it('steps business days like the prototype, without clamping', () => {
    expect(cal.nextBD('2026-10-10')).toBe('2026-10-12');
    expect(cal.nextBD('2026-10-05')).toBe('2026-10-05');
    expect(cal.prevBD('2026-10-11')).toBe('2026-10-09');
    expect(cal.addBD('2026-10-05', 1)).toBe('2026-10-06');
    expect(cal.addBD('2026-10-09', 1)).toBe('2026-10-12');
    expect(cal.addBD('2026-10-10', 0)).toBe('2026-10-12');
    expect(cal.addBD('2026-12-24', 1)).toBe('2026-12-29');
    expect(cal.addBD('2026-10-05', -3)).toBe('2026-09-30');
    expect(cal.addBD('2027-04-29', 5)).toBeNull();
    expect(cal.addBD('2026-09-01', -5)).toBeNull();
    expect(cal.nextBD('2027-05-03')).toBeNull();
  });

  it('measures business-day distances; the countdown excludes today and the move day', () => {
    expect(cal.bdDiff(FIXTURE_TODAY, FIXTURE_MOVE)).toBe(62);
    expect(cal.bdBetween(FIXTURE_TODAY, FIXTURE_MOVE)).toBe(61);
    expect(cal.bdDiff('2026-10-09', '2026-10-12')).toBe(1);
    expect(cal.bdDiff('2026-10-12', '2026-10-09')).toBe(-1);
    expect(cal.bdBetween('2026-10-09', '2026-10-12')).toBe(0);
    expect(cal.bdBetween('2026-10-12', '2026-10-09')).toBe(0);
    expect(cal.bdBetween(FIXTURE_TODAY, '2027-06-01')).toBeNull();
  });

  it('returns ranges and business days in range', () => {
    expect(cal.range('2026-10-03', '2026-10-06')?.map((d) => d.iso)).toEqual([
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
    ]);
    expect(cal.businessDays('2026-12-24', '2026-12-31')).toEqual(['2026-12-24', '2026-12-29', '2026-12-30', '2026-12-31']);
    expect(cal.range('2027-04-29', '2027-05-02')).toBeNull();
  });

  it('builds Monday-first month grids padded to whole weeks', () => {
    const oct = cal.monthGrid('2026-10');
    expect(oct).not.toBeNull();
    if (!oct) return;
    expect(oct.weeks).toHaveLength(5);
    expect(oct.weeks.every((w) => w.length === 7)).toBe(true);
    expect(oct.weeks[0]?.[0]?.iso).toBe('2026-09-28');
    expect(oct.weeks[0]?.[0]?.inMonth).toBe(false);
    expect(oct.weeks[0]?.[3]?.iso).toBe('2026-10-01');
    expect(oct.weeks[4]?.[6]?.iso).toBe('2026-11-01');
    expect(oct.weeks.flat().every((c) => c.weekday === weekdayOf(c.iso))).toBe(true);

    // August 2026 starts before the window: out of range.
    expect(cal.monthGrid('2026-08')).toBeNull();
    // September's leading padding (31 Aug) is inside the window; its trailing days too.
    expect(cal.monthGrid('2026-09')?.weeks[0]?.[0]?.day?.hol).toBe('Summer bank holiday');
    // April 2027 ends the window: May padding days have no server day.
    const apr = cal.monthGrid('2027-04');
    expect(apr?.weeks.at(-1)?.at(-1)?.day).toBeNull();
    expect(cal.monthGrid('2027-05')).toBeNull();
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
  });

  it('treats a gap in the days as out of range', () => {
    const gappy = new CalendarIndex(
      buildCalendarDays('2026-10-01', '2026-10-31').filter((d) => d.iso !== '2026-10-14'),
    );
    expect(gappy.range('2026-10-12', '2026-10-16')).toBeNull();
    expect(gappy.day('2026-10-14')).toBeNull();
  });
});
