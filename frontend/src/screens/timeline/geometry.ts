/**
 * Timeline geometry (Timeline.dc.html:248-292, synthesis.engineAlgorithms "Timeline geometry").
 *
 * Pure functions over the server's calendar days. One column per business day; every run of
 * non-business days (weekends, bank holidays) collapses into a sliver 5px wide in the
 * three-month view and 18px wide in the two-week view. Every slot in the window gets a
 * cumulative x, so zooming and panning only rescale and offset the same slots: all positioned
 * elements keep their identity and glide on --spring-soft.
 *
 * Dates are UTC day numbers (days since 1970-01-01), as the prototype, so arithmetic never
 * depends on the browser's time zone. Nothing here decides a business rule: business days,
 * holidays, week numbers and business-day-of-month all come from the server.
 */

import { dayNumber, isoFromDayNumber } from '../../lib/calendar';
import type { CalendarDay } from '../../lib/calendar';
import { MONTHS_LONG, MONTHS_SHORT } from '../../lib/format';

export type Zoom = '3m' | '2w';

/** The label column (grid-template-columns: 280px minmax(0,1fr)). */
export const LABEL_COL = 280;
/** Sliver width for a run of non-business days. */
export const GAP_W: Readonly<Record<Zoom, number>> = { '3m': 5, '2w': 18 };
/** Chart width before the first measurement (the prototype's default). */
export const DEFAULT_CHART_W = 1400;
/** Off-window sentinels (Timeline.dc.html:264-265). */
const OFF_LEFT = 40;
const OFF_RIGHT_L = 40;
const OFF_RIGHT_R = 80;

/** 0 = Sunday … 6 = Saturday for a day number (day 0 was a Thursday). */
export function weekdayOfN(n: number): number {
  return (((n + 4) % 7) + 7) % 7;
}

/** The Monday on or before day `n`. */
export function mondayOf(n: number): number {
  return n - ((weekdayOfN(n) + 6) % 7);
}

export interface TimelineWindow {
  /** First day of the three-month window: the Monday of the week before today's week. */
  t0: number;
  /** Last day: the Friday of the week after the move's week, and at least 16 weeks after t0. */
  t1: number;
  /** Monday of today's week (week offset 0 in the two-week view). */
  anchor: number;
  /** Two-week pan bounds (the prototype's [-1, 13] for Mon 5 Oct and Mon 4 Jan). */
  wkMin: number;
  wkMax: number;
}

/**
 * The window, derived from today and the move (the prototype hard-codes Mon 28 Sep to
 * Fri 15 Jan). Clamped to the days the calendar covers, when given.
 */
export function timelineWindow(todayIso: string, moveIso: string | null, cover?: { first: string; last: string }): TimelineWindow {
  const anchor = mondayOf(dayNumber(todayIso));
  let t0 = anchor - 7;
  // Mon of the previous week + 16 weeks - 3 days = the Friday 15 weeks on (Fri 15 Jan in the design).
  const minEnd = t0 + 16 * 7 - 3;
  let t1 = moveIso ? Math.max(mondayOf(dayNumber(moveIso)) + 11, minEnd) : minEnd;
  if (cover) {
    t0 = Math.max(t0, dayNumber(cover.first));
    t1 = Math.min(t1, dayNumber(cover.last));
    if (t1 < t0) t1 = t0;
  }
  const wkMin = Math.ceil((t0 - anchor) / 7);
  const wkMax = Math.max(wkMin, Math.floor((t1 - 11 - anchor) / 7));
  return { t0, t1, anchor, wkMin, wkMax };
}

export interface Slot {
  kind: 'bd' | 'gap';
  /** First and last day of the slot (equal for a business day). */
  a: number;
  b: number;
  /** Unshifted x and width. */
  x: number;
  w: number;
}

export interface LayoutInput {
  days: ReadonlyMap<number, CalendarDay>;
  t0: number;
  t1: number;
  zoom: Zoom;
  /** Week offset (two-week view only). */
  week: number;
  /** Monday of today's week. */
  anchor: number;
  /** Measured chart width (px). */
  width: number;
}

export interface Layout {
  zoom: Zoom;
  t0: number;
  t1: number;
  /** Visible window (the whole range in three months). */
  winA: number;
  winB: number;
  width: number;
  /** Business-day column width. */
  colW: number;
  gapW: number;
  /** Shift applied to every x (the first visible slot's x in two weeks). */
  off: number;
  total: number;
  slots: readonly Slot[];
  bdSlots: readonly Slot[];
  /** Business days fully inside the visible window. */
  visibleBd: number;
  /** Left edge of the column for the first business day on or after `n`. */
  lx: (n: number) => number;
  /** Right edge of that column. */
  rx: (n: number) => number;
  /** Its centre. */
  cx: (n: number) => number;
}

function isBusinessDay(days: ReadonlyMap<number, CalendarDay>, n: number): boolean {
  const d = days.get(n);
  if (d) return d.bd;
  const w = weekdayOfN(n);
  return w !== 0 && w !== 6;
}

/** Slots, column width and the x mapping (Timeline.dc.html:250-266). */
export function layoutTimeline({ days, t0, t1, zoom, week, anchor, width }: LayoutInput): Layout {
  const gapW = GAP_W[zoom];
  const raw: { kind: 'bd' | 'gap'; a: number; b: number }[] = [];
  for (let n = t0; n <= t1;) {
    if (isBusinessDay(days, n)) {
      raw.push({ kind: 'bd', a: n, b: n });
      n++;
    } else {
      const a = n;
      while (n <= t1 && !isBusinessDay(days, n)) n++;
      raw.push({ kind: 'gap', a, b: n - 1 });
    }
  }

  let winA = t0;
  let winB = t1;
  if (zoom === '2w') {
    winA = anchor + week * 7;
    winB = winA + 13;
  }
  const inWindow = (sl: { a: number; b: number }) => sl.a >= winA && sl.b <= winB;
  let nbd = 0;
  let ng = 0;
  let firstVisible = -1;
  raw.forEach((sl, i) => {
    if (!inWindow(sl)) return;
    if (firstVisible < 0) firstVisible = i;
    if (sl.kind === 'bd') nbd++;
    else ng++;
  });
  const colW = Math.max(4, (width - ng * gapW) / Math.max(1, nbd));

  let acc = 0;
  const slots: Slot[] = raw.map((sl) => {
    const w = sl.kind === 'bd' ? colW : gapW;
    const slot: Slot = { ...sl, x: acc, w };
    acc += w;
    return slot;
  });
  const total = acc;
  const first = firstVisible >= 0 ? slots[firstVisible] : undefined;
  const off = zoom === '2w' && first ? first.x : 0;

  const bdSlots = slots.filter((sl) => sl.kind === 'bd');
  const byDay = new Map<number, Slot>();
  for (const sl of bdSlots) byDay.set(sl.a, sl);
  const bdDays = bdSlots.map((sl) => sl.a);

  /** The slot of the first business day on or after n (binary search), or undefined. */
  const slotFrom = (n: number): Slot | undefined => {
    const exact = byDay.get(n);
    if (exact) return exact;
    let lo = 0;
    let hi = bdDays.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((bdDays[mid] ?? 0) < n) lo = mid + 1;
      else hi = mid;
    }
    const hit = bdDays[lo];
    return hit === undefined ? undefined : byDay.get(hit);
  };

  const lx = (n: number): number => {
    if (n < t0) return -off - OFF_LEFT;
    if (n > t1) return total - off + OFF_RIGHT_L;
    const sl = slotFrom(n);
    return sl ? sl.x - off : total - off + OFF_RIGHT_L;
  };
  const rx = (n: number): number => {
    if (n < t0) return -off - OFF_LEFT;
    if (n > t1) return total - off + OFF_RIGHT_R;
    const sl = slotFrom(n);
    return sl ? sl.x + sl.w - off : total - off + OFF_RIGHT_R;
  };
  const cx = (n: number): number => (lx(n) + rx(n)) / 2;

  return { zoom, t0, t1, winA, winB, width, colW, gapW, off, total, slots, bdSlots, visibleBd: nbd, lx, rx, cx };
}

// ---------------------------------------------------------------------------------------------
// Header tiers

export interface MonthLabel {
  key: number;
  x: number;
  w: number;
  /** Visible only when the clamped width exceeds 70px. */
  visible: boolean;
  /** Hairline left border unless the month starts before the left edge. */
  border: boolean;
  label: string;
}

/** Month tier (Timeline.dc.html:270-277): gaps belong to the month of their first day. */
export function monthLabels(layout: Layout, days: ReadonlyMap<number, CalendarDay>): MonthLabel[] {
  const out: (MonthLabel & { x0: number; x1: number })[] = [];
  for (const sl of layout.slots) {
    const iso = days.get(sl.a)?.iso ?? isoFromDayNumber(sl.a);
    const y = Number(iso.slice(0, 4));
    const m = Number(iso.slice(5, 7)) - 1;
    const key = y * 12 + m;
    const last = out[out.length - 1];
    const x0 = sl.x - layout.off;
    const x1 = sl.x + sl.w - layout.off;
    if (last?.key !== key) {
      const label = `${MONTHS_LONG[m] ?? ''}${m === 0 || out.length === 0 ? ` ${String(y)}` : ''}`;
      out.push({ key, x0, x1, x: 0, w: 0, visible: false, border: false, label });
    } else {
      last.x1 = x1;
    }
  }
  return out.map(({ key, x0, x1, label }) => {
    const x = Math.max(0, x0);
    const w = Math.max(0, Math.min(layout.width, x1) - x);
    return { key, x, w, visible: w > 70, border: x0 >= 0, label };
  });
}

export interface WeekLabel {
  /** The week's first business day. */
  n: number;
  x: number;
  label: string;
}

/** ISO-week tier: a label at the first business day of each week (Timeline.dc.html:279-280). */
export function weekLabels(layout: Layout, days: ReadonlyMap<number, CalendarDay>): WeekLabel[] {
  const out: WeekLabel[] = [];
  let last: number | null = null;
  for (const sl of layout.bdSlots) {
    const wn = days.get(sl.a)?.week ?? isoWeek(sl.a);
    if (wn !== last) {
      last = wn;
      out.push({ n: sl.a, x: sl.x - layout.off, label: `W${String(wn)}` });
    }
  }
  return out;
}

/** ISO-8601 week number of a day number (the prototype's isoWeek), used only as a fallback. */
export function isoWeek(n: number): number {
  const thu = n - ((weekdayOfN(n) + 6) % 7) + 3;
  const year = new Date(thu * 86_400_000).getUTCFullYear();
  const jan4 = Math.round(Date.UTC(year, 0, 4) / 86_400_000);
  const jan4Thu = jan4 - ((weekdayOfN(jan4) + 6) % 7) + 3;
  return 1 + Math.round((thu - jan4Thu) / 7);
}

export interface DayLabel {
  n: number;
  iso: string;
  x: number;
  w: number;
  /** '5' (3m) or 'Mon 5' (2w). */
  label: string;
  /** '3' (3m) or 'BD3' (2w). */
  bd: string;
  today: boolean;
  /** BD1 is drawn in ink. */
  first: boolean;
}

const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Day pills and business-day numbers (Timeline.dc.html:282-286). */
export function dayLabels(layout: Layout, days: ReadonlyMap<number, CalendarDay>, today: number): DayLabel[] {
  return layout.bdSlots.map((sl) => {
    const day = days.get(sl.a);
    const iso = day?.iso ?? isoFromDayNumber(sl.a);
    const dom = String(Number(iso.slice(8, 10)));
    const bdm = day?.bdm ?? 0;
    const wide = layout.zoom === '2w';
    return {
      n: sl.a,
      iso,
      x: sl.x - layout.off,
      w: sl.w,
      label: wide ? `${WD_SHORT[weekdayOfN(sl.a)] ?? ''} ${dom}` : dom,
      bd: wide ? `BD${String(bdm)}` : String(bdm),
      today: sl.a === today,
      first: bdm === 1,
    };
  });
}

export interface Band {
  a: number;
  x: number;
  w: number;
  holiday: boolean;
}

/** Non-working slivers; a gap containing a bank holiday is shaded darker (Timeline.dc.html:288-292). */
export function bands(layout: Layout, days: ReadonlyMap<number, CalendarDay>): Band[] {
  return layout.slots
    .filter((sl) => sl.kind === 'gap')
    .map((sl) => {
      let holiday = false;
      for (let n = sl.a; n <= sl.b; n++) if (days.get(n)?.hol) holiday = true;
      return { a: sl.a, x: sl.x - layout.off, w: sl.w, holiday };
    });
}

// ---------------------------------------------------------------------------------------------
// Labels

function longDate(n: number): string {
  const iso = isoFromDayNumber(n);
  return `${String(Number(iso.slice(8, 10)))} ${MONTHS_SHORT[Number(iso.slice(5, 7)) - 1] ?? ''} ${iso.slice(0, 4)}`;
}

function shortDate(n: number): string {
  const iso = isoFromDayNumber(n);
  return `${String(Number(iso.slice(8, 10)))} ${MONTHS_SHORT[Number(iso.slice(5, 7)) - 1] ?? ''}`;
}

/**
 * Title and subtitle (Timeline.dc.html:366-369). Three months: '28 Sep 2026 – 15 Jan 2027 ·
 * 77 business days'. Two weeks: '5 Oct – 16 Oct · 10 business days', counting the window's
 * real business days (the prototype always printed 10).
 */
export function windowTitle(layout: Layout): { title: string; subtitle: string } {
  if (layout.zoom === '2w') {
    const n = layout.visibleBd;
    return {
      title: 'Two weeks',
      subtitle: `${shortDate(layout.winA)} – ${shortDate(layout.winA + 11)} · ${String(n)} business ${n === 1 ? 'day' : 'days'}`,
    };
  }
  const n = layout.bdSlots.length;
  return {
    title: 'Three months',
    subtitle: `${longDate(layout.t0)} – ${longDate(layout.t1)} · ${String(n)} business ${n === 1 ? 'day' : 'days'}`,
  };
}

/** Index the server's calendar days by day number. */
export function indexDays(days: readonly CalendarDay[]): Map<number, CalendarDay> {
  const map = new Map<number, CalendarDay>();
  for (const d of days) map.set(dayNumber(d.iso), d);
  return map;
}
