/**
 * Home launcher (Remi Home.dc.html): the pure parts. Copy, counts and the Control Panel
 * preview's geometry, all from server numbers.
 *
 * The preview is the prototype's composition with real data in place of its hand-drawn
 * `CAP` / `rowsDef` arrays (synthesis.hardcodedToGeneralise "Home"):
 * - one axis in business days: today sits at 4% and the move at 84% of the preview width,
 *   as the template's today and move lines do (:78-79);
 * - 30 capacity bars, each the busiest business day of its slice of that axis
 *   (h / (capacity × 1.25) of 44px: 8h of an 8h day is 80%, as the prototype's h/10);
 * - up to five Gantt rows from the plan's projects, in plan order (PC first, then FI);
 * - on hover, the key project's row, Roll and delta show what six more hours of work would
 *   do (the prototype's `+6h` demo, :189, :214), from `POST /projects/{id}/replan/preview`.
 */

import type { DayLoadOut, ProjectOut } from '../../api';
import type { CalendarIndex } from '../../lib/calendar';
import { count, delta, l, s as shortDate } from '../../lib/format';

/** Where today and the move sit on the preview (fractions of its width). */
export const TODAY_X = 0.04;
export const MOVE_X = 0.84;
/** Bars may run a little past the right edge into the card padding (Alpha, :193). */
export const MAX_X = 1.02;
export const CAP_BARS = 30;
export const MAX_ROWS = 5;
/** Rows sit at top 86, 120, 154 … (:198). */
export const ROW_TOP = 86;
export const ROW_STEP = 34;
/** Without a move ahead, the axis still spans this many business days from today to 84%. */
const FALLBACK_SPAN_BD = 60;
/** The bar scale: capacity × 1.25 fills the strip (the prototype's h/10 for an 8h day). */
const CAP_HEADROOM = 1.25;
/** The hover demo: this much more work on the key project (the prototype's +6h). */
export const HOVER_EXTRA_HOURS = 6;

// ------------------------------------------------------------------ copy
export type DayPart = 'morning' | 'afternoon' | 'evening';

/** The prototype's clock split: before 12, before 18, then evening (:205-209). */
export function dayPart(hour: number): DayPart {
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}

/** 'Good morning · Monday 5 October' (shown uppercase). */
export function greeting(hour: number, todayIso: string | null): string {
  const part = dayPart(hour);
  const hello = `Good ${part}`;
  return todayIso ? `${hello} · ${l(todayIso)}` : hello;
}

/** 'Where to this morning?' */
export function headline(hour: number): string {
  return `Where to this ${dayPart(hour)}?`;
}

/** '5 projects · 2 routines · 3 notes today' (correct plurals, real zeros). */
export function planMeta(projects: number, routines: number, notesToday: number): string {
  return `${count(projects, 'project')} · ${count(routines, 'routine')} · ${count(notesToday, 'note')} today`;
}

/** '4 pages · 1 live chart' */
export function textbookMeta(pages: number, liveCharts: number): string {
  return `${count(pages, 'page')} · ${count(liveCharts, 'live chart')}`;
}

/** 'business days to Fixed Income' after the count. */
export function countdownWords(n: number): string {
  return `${n === 1 ? 'business day' : 'business days'} to Fixed Income`;
}

export interface KeyProjectLike {
  name: string;
  short: string;
  forecastDate: string | null;
  deltaBd: number | null;
}

export interface KeyFooter {
  name: string;
  /** Roll value: 'Wed 2 Dec', or 'Not yet' without a forecast. */
  forecast: string;
  /** Pill: '+3 BD', '−1 BD', 'On target', or 'no plan'. */
  delta: string;
  tone: 'risk' | 'neutral';
}

/** The footer row: the key project, its forecast and its delta against target (catalogue N). */
export function keyFooter(key: KeyProjectLike | null, hover?: { forecast: string | null; deltaBd: number | null } | null): KeyFooter {
  if (!key) return { name: 'No projects yet', forecast: 'Not yet', delta: 'no plan', tone: 'neutral' };
  const forecast = hover ? hover.forecast : key.forecastDate;
  const d = hover ? hover.deltaBd : key.deltaBd;
  if (!forecast || d === null) return { name: key.short || key.name, forecast: forecast ? shortDate(forecast) : 'Not yet', delta: 'no plan', tone: 'neutral' };
  return { name: key.short || key.name, forecast: shortDate(forecast), delta: delta(d), tone: d > 0 ? 'risk' : 'neutral' };
}

// ------------------------------------------------------------------ axis
export interface Axis {
  /** Fraction of the preview width per business day. */
  unit: number;
  /** Business days from today to the move (null when there is no move ahead). */
  moveOff: number | null;
  /** Position of a date: today = TODAY_X; ±Infinity outside the known calendar. */
  x: (iso: string) => number;
  /** Business-day offset of a date from today, or null outside the calendar. */
  offset: (iso: string) => number | null;
}

export function makeAxis(index: CalendarIndex, today: string, move: string | null): Axis {
  const offset = (iso: string): number | null => index.bdDiff(today, iso);
  const rawMove = move ? offset(move) : null;
  const moveOff = rawMove !== null && rawMove > 0 ? rawMove : null;
  const unit = (MOVE_X - TODAY_X) / (moveOff ?? FALLBACK_SPAN_BD);
  const x = (iso: string): number => {
    const off = offset(iso);
    if (off !== null) return TODAY_X + off * unit;
    if (index.first && iso < index.first) return -Infinity;
    return Infinity;
  };
  return { unit, moveOff, x, offset };
}

const clampX = (v: number) => Math.min(MAX_X, Math.max(0, v));

/** '57.50%' */
export function pct(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

// ------------------------------------------------------------------ capacity strip
export type BarTone = 'pc' | 'fi' | 'over';

export interface CapBar {
  /** 0..1 of the strip height. */
  h: number;
  tone: BarTone;
}

export interface HoverLoad {
  /** The key project's planned hours per business day after the change. */
  projectId: string;
  /** Where the preview plans from (`derived.planFrom`); days before it keep their hours. */
  planFrom: string;
  dayHours: Readonly<Record<string, number>>;
  /** Overloaded days that include the project after the change. */
  overDays: readonly string[];
}

/**
 * A day's total after swapping the key project's hours for the preview's (display only).
 * The preview only re-plans from its `planFrom`; days before it are history and keep their load.
 */
export function hoverTotal(load: DayLoadOut, iso: string, hover: HoverLoad): number {
  if (iso < hover.planFrom) return load.total;
  const before = load.items.find((it) => it.refType === 'project' && it.refId === hover.projectId)?.h ?? 0;
  const after = hover.dayHours[iso] ?? 0;
  return load.total - before + after;
}

/**
 * Thirty bars over the axis. Each bar is the busiest business day in its slice; overloaded
 * slices take the overload colour, slices from the move on the Fixed Income colour.
 */
export function capacityBars(
  index: CalendarIndex,
  loads: Readonly<Record<string, DayLoadOut>>,
  axis: Axis,
  today: string,
  capacity: number,
  hover: HoverLoad | null = null,
): CapBar[] {
  const scale = Math.max(1, capacity) * CAP_HEADROOM;
  const over = hover ? new Set(hover.overDays) : null;
  const bars: CapBar[] = [];
  for (let i = 0; i < CAP_BARS; i++) {
    const kFrom = Math.ceil((i / CAP_BARS - TODAY_X) / axis.unit - 1e-9);
    const kTo = Math.ceil(((i + 1) / CAP_BARS - TODAY_X) / axis.unit - 1e-9) - 1;
    let top = 0;
    let isOver = false;
    for (let k = kFrom; k <= kTo; k++) {
      const iso = index.addBD(today, k);
      if (!iso) continue;
      const load = loads[iso];
      if (!load) continue;
      const total = hover ? hoverTotal(load, iso, hover) : load.total;
      top = Math.max(top, total);
      if (load.over || over?.has(iso)) isOver = true;
    }
    const afterMove = axis.moveOff !== null && kFrom >= axis.moveOff;
    bars.push({ h: Math.min(1, top / scale), tone: isOver ? 'over' : afterMove ? 'fi' : 'pc' });
  }
  return bars;
}

// ------------------------------------------------------------------ Gantt rows
export interface GanttRow {
  id: string;
  domain: 'pc' | 'fi';
  /** Define projects: hatched, from start to target. */
  hatch: boolean;
  /** Bar start and width (fractions); the width stops at the target when the project is late. */
  x: number;
  w: number;
  /** Overrun past the target (risk colour). */
  ox: number;
  ow: number;
  /** Dashed ghost under the bar: the target span, or on hover the forecast before the change. */
  gx: number;
  gw: number;
  go: number;
  /** Milestone diamonds (fractions). */
  ms: number[];
}

export interface RowPreview {
  projectId: string;
  forecast: string | null;
}

export function ganttRows(
  projects: readonly ProjectOut[],
  axis: Axis,
  hover: boolean,
  preview: RowPreview | null,
): GanttRow[] {
  return projects.slice(0, MAX_ROWS).map((p) => {
    const x = clampX(axis.x(p.startDate));
    const tgt = clampX(axis.x(p.targetDate));
    const ms = p.derived.milestones
      .filter((m) => !m.done)
      .map((m) => axis.x(m.date))
      .filter((v) => v >= 0 && v <= MAX_X);
    if (!p.forecastDate) {
      return { id: p.id, domain: p.domain, hatch: true, x, w: Math.max(0, tgt - x), ox: tgt, ow: 0, gx: x, gw: 0, go: 0, ms };
    }
    const moved = hover && preview?.projectId === p.id && preview.forecast ? preview.forecast : null;
    const now = clampX(axis.x(p.forecastDate));
    const end = moved ? clampX(axis.x(moved)) : now;
    const late = end > tgt + 1e-9;
    const base = late ? tgt : end;
    // At rest a late project shows its target as the ghost; while the hover demo moves it,
    // the ghost is where the forecast was (the timeline's ghost bar after a move).
    const ghostEnd = moved ? now : late ? tgt : null;
    return {
      id: p.id,
      domain: p.domain,
      hatch: false,
      x,
      w: Math.max(0, base - x),
      ox: base,
      ow: late ? end - tgt : 0,
      gx: x,
      gw: ghostEnd === null ? 0 : Math.max(0, ghostEnd - x),
      go: ghostEnd === null ? 0 : hover ? 0.9 : 0.4,
      ms,
    };
  });
}
