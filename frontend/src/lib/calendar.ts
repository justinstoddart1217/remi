/**
 * Business-calendar lookups over the server's calendar days. Lookups only: every business
 * rule (holidays, today, the countdown, loads, forecasts) is decided by the backend, and this
 * module just indexes the `CalendarDay[]` it sends (arch-frontend-core §7).
 *
 * Dates are branded ISO strings, parsed by splitting the string and never with
 * `new Date(iso)`, so nothing depends on the browser's time zone. Every lookup that leaves
 * the indexed range returns `null` instead of clamping (the prototype's `addBD` clamped
 * silently at the calendar ends).
 */

import { useMemo } from 'react';

declare const isoBrand: unique symbol;

/** A calendar date as `YYYY-MM-DD`. Build one with `isoDate()` or `asIsoDate()`. */
export type IsoDate = string & { readonly [isoBrand]: 'IsoDate' };

/** A calendar month as `YYYY-MM`. */
export type IsoMonth = string;

/**
 * One day of the server calendar: the backend's `CalendarDayOut` (`PlanOut.calendar.days[]`,
 * `GET /api/calendar`), field for field, so the generated schema's days can be indexed
 * directly. Swap for `components['schemas']['CalendarDayOut']` once the contract has it.
 */
export interface CalendarDay {
  iso: string;
  /** Weekday, 0 = Sunday … 6 = Saturday (the prototype's `w`). Not relied on here. */
  w: number;
  /** Business day: Monday to Friday and not a holiday. */
  bd: boolean;
  /** Business day of the month (BD3 = 3), or null on weekends and holidays. */
  bdm: number | null;
  /** Holiday name, or null. */
  hol: string | null;
  /** ISO week number. */
  week: number;
}

/** One cell of a Monday-first month grid. */
export interface MonthCell {
  iso: IsoDate;
  /** Day of the month, 1–31. */
  dayOfMonth: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  inMonth: boolean;
  /** The server's day, or null for padding days outside the indexed range. */
  day: CalendarDay | null;
}

export interface MonthGrid {
  month: IsoMonth;
  /** Rows of seven cells, Monday to Sunday. */
  weeks: MonthCell[][];
}

const DAY_MS = 86_400_000;
const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

/** True when `value` is a real `YYYY-MM-DD` date. */
export function isIsoDate(value: string): value is IsoDate {
  const m = ISO_PATTERN.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

/** Brands a `YYYY-MM-DD` string, or returns null when it is not a real date. */
export function asIsoDate(value: string | null | undefined): IsoDate | null {
  return value != null && isIsoDate(value) ? value : null;
}

/** Brands a `YYYY-MM-DD` string. Throws on anything else. */
export function isoDate(value: string): IsoDate {
  if (!isIsoDate(value)) throw new RangeError(`Not an ISO date: ${value}`);
  return value;
}

function daysInMonth(y: number, month1: number): number {
  return new Date(Date.UTC(y, month1, 0)).getUTCDate();
}

/** Splits an ISO date into numbers. `m` is 1-based. */
export function isoParts(iso: string): { y: number; m: number; d: number } {
  const match = ISO_PATTERN.exec(iso);
  if (!match) throw new RangeError(`Not an ISO date: ${iso}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** Days since 1970-01-01 (UTC day number). */
export function dayNumber(iso: string): number {
  const { y, m, d } = isoParts(iso);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** The ISO date for a UTC day number. */
export function isoFromDayNumber(n: number): IsoDate {
  return new Date(n * DAY_MS).toISOString().slice(0, 10) as IsoDate;
}

/** 0 = Sunday … 6 = Saturday, computed from the date itself. */
export function weekdayOf(iso: string): number {
  // Day 0 (1970-01-01) was a Thursday.
  return (((dayNumber(iso) + 4) % 7) + 7) % 7;
}

/** Calendar-day arithmetic (not business days). */
export function addDays(iso: string, k: number): IsoDate {
  return isoFromDayNumber(dayNumber(iso) + k);
}

/** `YYYY-MM` of a date. */
export function monthOf(iso: string): IsoMonth {
  return iso.slice(0, 7);
}

/** Month arithmetic on `YYYY-MM`. */
export function addMonths(month: IsoMonth, k: number): IsoMonth {
  const m = MONTH_PATTERN.exec(month);
  if (!m) throw new RangeError(`Not an ISO month: ${month}`);
  const index = Number(m[1]) * 12 + (Number(m[2]) - 1) + k;
  const y = Math.floor(index / 12);
  const mo = index - y * 12 + 1;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}`;
}

/** First index in the sorted `list` whose value is >= `n` (list.length if none). */
function lowerBound(list: readonly number[], n: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((list[mid] ?? 0) < n) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * An index over the server's calendar days. Days must be contiguous; gaps are treated as
 * out of range. Build it once per calendar payload (see `useCalendarIndex`).
 */
export class CalendarIndex {
  readonly days: readonly CalendarDay[];
  readonly first: IsoDate | null;
  readonly last: IsoDate | null;

  readonly #byIso = new Map<string, CalendarDay>();
  /** Sorted day numbers of every business day. */
  readonly #bds: number[] = [];
  /** Business-day day number → its position in `#bds`. */
  readonly #bdPos = new Map<number, number>();
  readonly #firstN: number;
  readonly #lastN: number;

  constructor(days: readonly CalendarDay[]) {
    const sorted = [...days].filter((d) => isIsoDate(d.iso)).sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
    this.days = sorted;
    for (const day of sorted) {
      this.#byIso.set(day.iso, day);
      if (day.bd) {
        const n = dayNumber(day.iso);
        this.#bdPos.set(n, this.#bds.length);
        this.#bds.push(n);
      }
    }
    const firstDay = sorted[0];
    const lastDay = sorted[sorted.length - 1];
    this.first = firstDay ? (firstDay.iso as IsoDate) : null;
    this.last = lastDay ? (lastDay.iso as IsoDate) : null;
    this.#firstN = firstDay ? dayNumber(firstDay.iso) : 0;
    this.#lastN = lastDay ? dayNumber(lastDay.iso) : -1;
  }

  /** True when the date is inside the indexed range. */
  has(iso: string): boolean {
    return this.#byIso.has(iso);
  }

  /** The server's day, or null out of range. */
  day(iso: string): CalendarDay | null {
    return this.#byIso.get(iso) ?? null;
  }

  /** Whether the date is a business day, or null out of range. */
  isBD(iso: string): boolean | null {
    const day = this.#byIso.get(iso);
    return day ? day.bd : null;
  }

  /** Business day of the month (3 for BD3), null on non-business days or out of range. */
  bdOfMonth(iso: string): number | null {
    return this.#byIso.get(iso)?.bdm ?? null;
  }

  /** Holiday name, or null. */
  holiday(iso: string): string | null {
    return this.#byIso.get(iso)?.hol ?? null;
  }

  /** The first business day on or after `iso`; null if the range runs out first. */
  nextBD(iso: string): IsoDate | null {
    if (!this.#byIso.has(iso)) return null;
    const i = lowerBound(this.#bds, dayNumber(iso));
    const n = this.#bds[i];
    return n === undefined ? null : isoFromDayNumber(n);
  }

  /** The last business day on or before `iso`; null if the range runs out first. */
  prevBD(iso: string): IsoDate | null {
    if (!this.#byIso.has(iso)) return null;
    const n = dayNumber(iso);
    const i = lowerBound(this.#bds, n + 1) - 1;
    const hit = this.#bds[i];
    return hit === undefined ? null : isoFromDayNumber(hit);
  }

  /**
   * `k` business days after the first business day on or after `iso` (k may be negative),
   * as the prototype's `addBD`. Null when the result leaves the range; never clamps.
   */
  addBD(iso: string, k: number): IsoDate | null {
    const start = this.#bdPosition(iso);
    if (start === null) return null;
    const n = this.#bds[start + k];
    return n === undefined ? null : isoFromDayNumber(n);
  }

  /**
   * Business days from `a` to `b`, both snapped forward to a business day first (the
   * prototype's `bdDiff`). Negative when `b` is before `a`. Null out of range.
   */
  bdDiff(a: string, b: string): number | null {
    const pa = this.#bdPosition(a);
    const pb = this.#bdPosition(b);
    return pa === null || pb === null ? null : pb - pa;
  }

  /**
   * Business days strictly between `a` and `b` (ADR-0009: excludes both ends). Zero when
   * `b <= a`. Null when either end is out of range.
   */
  bdBetween(a: string, b: string): number | null {
    if (!this.#byIso.has(a) || !this.#byIso.has(b)) return null;
    const na = dayNumber(a);
    const nb = dayNumber(b);
    if (nb <= na) return 0;
    return Math.max(0, lowerBound(this.#bds, nb) - lowerBound(this.#bds, na + 1));
  }

  /** Every day from `from` to `to` inclusive, or null if any part is out of range. */
  range(from: string, to: string): CalendarDay[] | null {
    if (!this.#byIso.has(from) || !this.#byIso.has(to)) return null;
    const a = dayNumber(from);
    const b = dayNumber(to);
    const out: CalendarDay[] = [];
    for (let n = a; n <= b; n++) {
      const day = this.#byIso.get(isoFromDayNumber(n));
      if (!day) return null;
      out.push(day);
    }
    return out;
  }

  /** Business days from `from` to `to` inclusive, or null if out of range. */
  businessDays(from: string, to: string): IsoDate[] | null {
    const days = this.range(from, to);
    return days ? days.filter((d) => d.bd).map((d) => d.iso as IsoDate) : null;
  }

  /**
   * A Monday-first month grid, padded to whole weeks with days from the neighbouring months.
   * Null when any day of the month itself is out of range; padding days outside the range
   * come back with `day: null`.
   */
  monthGrid(month: IsoMonth): MonthGrid | null {
    const m = MONTH_PATTERN.exec(month);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12) return null;
    const firstIso = `${m[1] ?? ''}-${m[2] ?? ''}-01`;
    const lastIso = `${m[1] ?? ''}-${m[2] ?? ''}-${String(daysInMonth(y, mo)).padStart(2, '0')}`;
    if (!this.#byIso.has(firstIso) || !this.#byIso.has(lastIso)) return null;
    const firstN = dayNumber(firstIso);
    const lastN = dayNumber(lastIso);
    const lead = (weekdayOf(firstIso) + 6) % 7;
    const trail = 6 - ((weekdayOf(lastIso) + 6) % 7);
    const weeks: MonthCell[][] = [];
    let row: MonthCell[] = [];
    for (let n = firstN - lead; n <= lastN + trail; n++) {
      const iso = isoFromDayNumber(n);
      const day = this.#byIso.get(iso) ?? null;
      if (n >= firstN && n <= lastN && !day) return null;
      row.push({ iso, dayOfMonth: isoParts(iso).d, weekday: weekdayOf(iso), inMonth: n >= firstN && n <= lastN, day });
      if (row.length === 7) {
        weeks.push(row);
        row = [];
      }
    }
    return { month, weeks };
  }

  /** Position of the first business day on or after `iso` in `#bds`, or null. */
  #bdPosition(iso: string): number | null {
    if (!this.#byIso.has(iso)) return null;
    const n = dayNumber(iso);
    if (n < this.#firstN || n > this.#lastN) return null;
    const exact = this.#bdPos.get(n);
    if (exact !== undefined) return exact;
    const i = lowerBound(this.#bds, n);
    return i < this.#bds.length ? i : null;
  }
}

const EMPTY_DAYS: readonly CalendarDay[] = [];

/**
 * A memoised `CalendarIndex` for a calendar payload. Pass the days array from the query
 * cache: TanStack Query's structural sharing keeps its identity stable between refetches.
 */
export function useCalendarIndex(days: readonly CalendarDay[] | null | undefined): CalendarIndex {
  const source = days ?? EMPTY_DAYS;
  return useMemo(() => new CalendarIndex(source), [source]);
}
