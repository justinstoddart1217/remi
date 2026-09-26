/**
 * The Calendar screen's view model (Calendar.dc.html renderVals, lines 139-220): the month
 * grid's cells, the header sub-line and the day panel. Pure functions over the server's read
 * models: every number (loads, business-day ordinals, forecasts, milestones) comes from the
 * API, and this module only picks, orders and words it.
 *
 * Generalised from the prototype:
 * - the months are open-ended (MONTHS was Oct 2026 – Jan 2027) and compared on year + month
 *   (the prototype compared the month alone);
 * - the 8h day is the plan's capacity (`load.capacity`), for bar widths and the panel label;
 * - "Bank holiday" becomes "Public holiday" outside England and Wales, as the Timeline footnote.
 */

import type { DayLoadItemOut, DayLoadOut, DayOut, ProjectOut, RoutineOut } from '../../api';
import { DOMAIN_NAME, formatHours } from '../../components';
import type { CalendarDay, CalendarIndex, IsoDate, IsoMonth, MonthCell } from '../../lib/calendar';
import { addDays, addMonths, weekdayOf } from '../../lib/calendar';
import * as F from '../../lib/format';
import { hoverKey, ROTATION_KEY } from '../../stores/hover';
import type { HoverKey } from '../../stores/hover';

export type Domain = 'pc' | 'fi';
export type Loads = Readonly<Record<string, DayLoadOut>>;

/** The month swap happens this long after the fade starts (Calendar.dc.html:137). */
export const SWAP_MS = 130;
/** A full day's project bar is 62% of the cell (Calendar.dc.html:167). */
export const BAR_FULL_PCT = 62;

const ACCENT: Readonly<Record<Domain, string>> = { pc: 'var(--pc-accent)', fi: 'var(--fi-accent)' };
const RISK = 'var(--risk)';
const OVERLOAD = 'var(--overload)';

// ------------------------------------------------------------------ months

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** True for a real `YYYY-MM`. */
export function isIsoMonth(value: string | null | undefined): value is IsoMonth {
  return value != null && MONTH_PATTERN.test(value);
}

/** Months apart: positive when `b` is after `a`. */
export function monthDiff(a: IsoMonth, b: IsoMonth): number {
  const [ya, ma] = a.split('-').map(Number) as [number, number];
  const [yb, mb] = b.split('-').map(Number) as [number, number];
  return (yb - ya) * 12 + (mb - ma);
}

/** Clamps `month` into `[min, max]` (`max` null = open-ended). */
export function clampMonth(month: IsoMonth, min: IsoMonth, max: IsoMonth | null): IsoMonth {
  if (monthDiff(min, month) < 0) return min;
  if (max !== null && monthDiff(month, max) < 0) return max;
  return month;
}

/** The first and last day of a month. */
export function monthBounds(month: IsoMonth): { first: IsoDate; last: IsoDate } {
  const first = `${month}-01` as IsoDate;
  const last = addDays(`${addMonths(month, 1)}-01`, -1);
  return { first, last };
}

/**
 * The month grid's span: the Monday on or before the 1st to the Sunday on or after the last
 * day (Calendar.dc.html:144-148). Always whole weeks.
 */
export function gridRange(month: IsoMonth): { from: IsoDate; to: IsoDate } {
  const { first, last } = monthBounds(month);
  const lead = (weekdayOf(first) + 6) % 7;
  const trail = 6 - ((weekdayOf(last) + 6) % 7);
  return { from: addDays(first, -lead), to: addDays(last, trail) };
}

/**
 * The calendar days the screen needs for a month: its grid plus a week either side, so the
 * panel can step to the neighbouring month's first or last business day across a long
 * weekend. The first allowed month needs nothing before its grid. A selected day outside the
 * month widens the range to cover it (and its neighbours) too.
 */
export function neededRange(month: IsoMonth, opts: { isFirstMonth: boolean; sel?: string | null }): { from: IsoDate; to: IsoDate } {
  const g = gridRange(month);
  let from = opts.isFirstMonth ? g.from : addDays(g.from, -7);
  let to = addDays(g.to, 7);
  if (opts.sel) {
    const a = addDays(opts.sel, -7);
    const b = addDays(opts.sel, 7);
    if (a < from) from = a;
    if (b > to) to = b;
  }
  return { from, to };
}

// ------------------------------------------------------------------ hover keys

/** The linked-highlight key of a load item: its routine, the rotation, or its project. */
export function itemHoverKey(item: Pick<DayLoadItemOut, 'refType' | 'refId'>): HoverKey {
  if (item.refType === 'rotation') return ROTATION_KEY;
  return hoverKey(item.refType === 'routine' ? 'routine' : 'project', item.refId);
}

const isBau = (item: DayLoadItemOut) => item.refType !== 'project';

// ------------------------------------------------------------------ cells

export interface ChipModel {
  key: string;
  label: string;
  domain: Domain;
  hover: HoverKey;
}

export interface MarkModel {
  key: string;
  name: string;
  /** Border colour. */
  color: string;
  /** Filled (solid) or hollow (paper). */
  filled: boolean;
  hover: HoverKey;
}

export interface BarModel {
  key: string;
  /** Percent of the cell's inner width. */
  width: number;
  color: string;
  label: string;
  title: string;
  hover: HoverKey;
}

export interface CellModel {
  iso: IsoDate;
  dayOfMonth: number;
  inMonth: boolean;
  /** Saturday or Sunday. */
  weekend: boolean;
  /** Sundays have no right border (the grid's last column). */
  sunday: boolean;
  isToday: boolean;
  /** 'BD3', or '' on a non-business day (shown on padding days too). */
  bd: string;
  holiday: string | null;
  /** Weekends and holidays get the 3.5% ink tint. */
  tinted: boolean;
  chips: ChipModel[];
  marks: MarkModel[];
  bars: BarModel[];
  /** The load meter, for in-month business days with a load. */
  load: DayLoadOut | null;
}

export interface GridInput {
  today: string;
  projects: readonly ProjectOut[];
  loads: Loads | undefined;
}

/** Milestones by day, in project order then milestone order (Calendar.dc.html:165). */
export function milestonesByDay(
  projects: readonly ProjectOut[],
): Map<string, { project: ProjectOut; name: string; passed: boolean }[]> {
  const out = new Map<string, { project: ProjectOut; name: string; passed: boolean }[]>();
  for (const p of projects) {
    for (const m of p.derived.milestones) {
      const list = out.get(m.date) ?? [];
      list.push({ project: p, name: m.name, passed: m.passed });
      out.set(m.date, list);
    }
  }
  return out;
}

/** The forecast-end colour: risk when the project is late, else its accent. */
function forecastColor(p: ProjectOut): string {
  return p.derived.status === 'risk' ? RISK : ACCENT[p.domain];
}

/** '{short} · {endName lowercased}' */
function forecastName(p: ProjectOut): string {
  return `${p.short} · ${p.endName.toLowerCase()}`;
}

function cellMarks(iso: string, projects: readonly ProjectOut[], byDay: ReturnType<typeof milestonesByDay>): MarkModel[] {
  const marks: MarkModel[] = [];
  (byDay.get(iso) ?? []).forEach((m, k) => {
    marks.push({
      key: `m:${m.project.id}:${String(k)}`,
      name: m.name,
      color: ACCENT[m.project.domain],
      filled: m.passed,
      hover: hoverKey('project', m.project.id),
    });
  });
  for (const p of projects) {
    if (p.forecastDate !== iso) continue;
    const color = forecastColor(p);
    marks.push({ key: `f:${p.id}`, name: forecastName(p), color, filled: true, hover: hoverKey('project', p.id) });
  }
  return marks;
}

function cellBars(load: DayLoadOut, projects: ReadonlyMap<string, ProjectOut>): BarModel[] {
  return load.items
    .filter((i) => !isBau(i))
    .map((i) => {
      const p = projects.get(i.refId);
      const short = p?.short ?? i.name;
      return {
        key: i.refId,
        width: (i.h / load.capacity) * BAR_FULL_PCT,
        color: load.over ? OVERLOAD : ACCENT[i.domain],
        label: `${short} ${formatHours(i.h)}`,
        title: `${p?.name ?? short} · ${formatHours(i.h)}`,
        hover: itemHoverKey(i),
      };
    });
}

/**
 * One cell per day of the month grid (Calendar.dc.html:153-174). Chips, milestones, bars and
 * the meter appear on in-month business days only; padding days keep their number and BD
 * label at 35% (the prototype's `inM`, now year + month).
 */
export function buildCells(weeks: readonly (readonly MonthCell[])[], input: GridInput): CellModel[] {
  const byDay = milestonesByDay(input.projects);
  const projectMap = new Map(input.projects.map((p) => [p.id, p]));
  const cells: CellModel[] = [];
  for (const week of weeks) {
    for (const c of week) {
      const day: CalendarDay | null = c.day;
      const weekend = c.weekday === 0 || c.weekday === 6;
      const holiday = day?.hol ?? null;
      const isBd = day?.bd === true;
      const load = isBd && c.inMonth ? (input.loads?.[c.iso] ?? null) : null;
      cells.push({
        iso: c.iso,
        dayOfMonth: c.dayOfMonth,
        inMonth: c.inMonth,
        weekend,
        sunday: c.weekday === 0,
        isToday: c.iso === input.today,
        bd: isBd && day.bdm != null ? F.bd(day.bdm) : '',
        holiday,
        tinted: weekend || holiday !== null,
        chips: load
          ? load.items
              .filter(isBau)
              .map((i) => ({
                key: `${i.refType}:${i.refId}`,
                label: `${i.name} · ${formatHours(i.h)}`,
                domain: i.domain,
                hover: itemHoverKey(i),
              }))
          : [],
        marks: isBd && c.inMonth ? cellMarks(c.iso, input.projects, byDay) : [],
        bars: load ? cellBars(load, projectMap) : [],
        load,
      });
    }
  }
  return cells;
}

/**
 * '22 business days' or '21 business days · 1 overloaded' (Calendar.dc.html:175-176, 214):
 * the month's business days from the calendar, and how many of them are over capacity.
 */
export function monthSubline(weeks: readonly (readonly MonthCell[])[], loads: Loads | undefined): string {
  let bds = 0;
  let over = 0;
  for (const week of weeks) {
    for (const c of week) {
      if (!c.inMonth || c.day?.bd !== true) continue;
      bds += 1;
      if (loads?.[c.iso]?.over) over += 1;
    }
  }
  return `${F.count(bds, 'business day')}${over ? ` · ${String(over)} overloaded` : ''}`;
}

// ------------------------------------------------------------------ the day panel

export interface DayFacts {
  iso: IsoDate;
  bd: boolean;
  bdm: number | null;
  holiday: string | null;
}

/** The panel's facts for a day, from the calendar index. Null outside the indexed range. */
export function dayFacts(index: CalendarIndex | undefined, iso: IsoDate): DayFacts | null {
  const day = index?.day(iso);
  if (!day) return null;
  return { iso, bd: day.bd, bdm: day.bdm, holiday: day.hol };
}

/** The same facts from `GET /day/{iso}` (a day outside every fetched calendar range). */
export function dayFactsFromDay(day: DayOut): DayFacts {
  return { iso: day.day as IsoDate, bd: day.bdm !== null, bdm: day.bdm, holiday: day.holiday };
}

/** 'Bank holiday' in England and Wales; 'Public holiday' elsewhere. */
export function holidayWord(region: string | null | undefined): string {
  return region === 'GB-ENG' ? 'Bank holiday' : 'Public holiday';
}

/**
 * The panel kicker (Calendar.dc.html:207): 'Today', 'Weekend', 'Bank holiday', 'Tomorrow'
 * (in business days, so Monday from a Friday), 'N business days ahead', 'N business days ago'.
 * `ahead` is the server calendar's bdDiff(today, day).
 */
export function kicker(facts: DayFacts, today: string, ahead: number | null, region?: string | null): string {
  if (facts.iso === today) return 'Today';
  if (!facts.bd) return facts.holiday ? holidayWord(region) : 'Weekend';
  if (ahead === null) return '';
  if (facts.iso < today) return `${F.count(Math.abs(ahead), 'business day')} ago`;
  if (ahead === 1) return 'Tomorrow';
  return `${F.count(ahead, 'business day')} ahead`;
}

/** 'BD10 of October', 'BD1 of January · Fixed Income', the holiday's name, or 'Not a business day'. */
export function panelSub(facts: DayFacts, move: string | null): string {
  if (facts.bd && facts.bdm !== null) {
    const after = move !== null && facts.iso >= move ? ' · Fixed Income' : '';
    return `${F.bd(facts.bdm)} of ${F.monL(facts.iso)}${after}`;
  }
  return facts.holiday ?? 'Not a business day';
}

/** Capacity value: '7h of 8h · 1h free' or '9.5h planned · 1.5h over'. */
export function capacityLabel(load: DayLoadOut): string {
  if (load.over) return `${formatHours(load.total)} planned · ${formatHours(load.total - load.capacity)} over`;
  return `${formatHours(load.total)} of ${formatHours(load.capacity)} · ${formatHours(load.free)} free`;
}

/** The empty copy (critique Calendar :209). */
export function emptyCopy(facts: DayFacts, load: DayLoadOut | null): string | null {
  if (!facts.bd) {
    return facts.holiday ? `${facts.holiday}. Nothing is planned, and business-day numbers skip it.` : 'Weekend. Nothing is planned.';
  }
  if (load?.items.length === 0) return 'Nothing planned. A free day.';
  return null;
}

export interface TaskLine {
  key: string;
  text: string;
  hours: string;
}

export interface PlanRowModel {
  key: string;
  hours: string;
  /** 'BAU · Private Credit', 'Project · Fixed Income' … */
  kind: string;
  domain: Domain;
  name: string;
  /** Set on project rows: they open the workspace. BAU rows are not clickable (crit :203). */
  projectId: string | null;
  tasks: TaskLine[];
  hover: HoverKey;
}

/**
 * The panel's plan rows (Calendar.dc.html:195-204), in the load's order (BAU first). BAU rows
 * name the full routine (the rotation keeps "Germany · Build"); project rows name the full
 * project and, from today on, the tasks the plan expects that day: the server's focus-block
 * allocation (`GET /day/{iso}`), which pours each project's Now tasks into its planned hours.
 */
export function planRows(
  load: DayLoadOut,
  data: { projects: readonly ProjectOut[]; routines: readonly RoutineOut[]; day: DayOut | null; showTasks: boolean },
): PlanRowModel[] {
  return load.items.map((i) => {
    const bau = isBau(i);
    const project = bau ? undefined : data.projects.find((p) => p.id === i.refId);
    const routine = i.refType === 'routine' ? data.routines.find((r) => r.id === i.refId) : undefined;
    const block = !bau && data.showTasks ? data.day?.focusBlocks.find((b) => b.projectId === i.refId) : undefined;
    return {
      key: `${i.refType}:${i.refId}`,
      hours: formatHours(i.h),
      kind: `${bau ? 'BAU' : 'Project'} · ${DOMAIN_NAME[i.domain]}`,
      domain: i.domain,
      name: project?.name ?? routine?.name ?? i.name,
      projectId: bau ? null : i.refId,
      tasks: (block?.tasks ?? []).map((t) => ({ key: t.id, text: t.text, hours: formatHours(t.hours) })),
      hover: itemHoverKey(i),
    };
  });
}

export interface DueItem {
  key: string;
  name: string;
  color: string;
  filled: boolean;
}

/**
 * 'Due this day' (Calendar.dc.html:184-186), for any day: per project, its milestones, its
 * forecast end and its target; then the move.
 */
export function dueItems(iso: string, projects: readonly ProjectOut[], move: string | null): DueItem[] {
  const out: DueItem[] = [];
  for (const p of projects) {
    p.derived.milestones.forEach((m, k) => {
      if (m.date !== iso) return;
      out.push({ key: `m:${p.id}:${String(k)}`, name: `${m.name} · ${p.short}`, color: ACCENT[p.domain], filled: m.passed });
    });
    if (p.forecastDate === iso) {
      out.push({ key: `f:${p.id}`, name: `${forecastName(p)} (forecast)`, color: forecastColor(p), filled: true });
    }
    if (p.targetDate === iso) {
      out.push({ key: `t:${p.id}`, name: `${p.short} · target`, color: 'var(--ink)', filled: false });
    }
  }
  if (move !== null && iso === move) {
    out.push({ key: 'move', name: 'Move to Fixed Income', color: ACCENT.fi, filled: true });
  }
  return out;
}

/**
 * The next or previous business day from `iso` (Calendar.dc.html:183), skipping weekends and
 * holidays. Null when the calendar runs out first.
 */
export function stepBusinessDay(index: CalendarIndex | undefined, iso: string, k: 1 | -1): IsoDate | null {
  if (!index) return null;
  const from = addDays(iso, k);
  return k > 0 ? index.nextBD(from) : index.prevBD(from);
}

/** 'Monday 5 October' (the prototype's F.l, no year). */
export function panelTitle(iso: string): string {
  return F.l(iso);
}

/** The accessible name of a cell: 'Monday 5 October, BD3, Returns · 6h, 8h planned'. */
export function cellLabel(cell: CellModel): string {
  const parts = [F.l(cell.iso)];
  if (cell.bd) parts.push(cell.bd);
  if (cell.holiday) parts.push(cell.holiday);
  for (const c of cell.chips) parts.push(c.label);
  for (const m of cell.marks) parts.push(m.name);
  if (cell.load) parts.push(`${formatHours(cell.load.total)} planned${cell.load.over ? ', over capacity' : ''}`);
  return parts.join(', ');
}

// ------------------------------------------------------------------ keyboard

/** The day that takes the grid's tab stop: the selected day, today, or the month's first day. */
export function rovingFocus(cells: readonly CellModel[], sel: string | null): string | null {
  const inMonth = cells.filter((c) => c.inMonth);
  return (inMonth.find((c) => c.iso === sel) ?? inMonth.find((c) => c.isToday) ?? inMonth[0])?.iso ?? null;
}

/** Where an arrow key moves from cell `k` (in-month days only), or null. */
export function moveFocus(cells: readonly CellModel[], k: number, key: string): number | null {
  const col = k % 7;
  const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -col, End: 6 - col };
  const d = steps[key];
  if (d === undefined || d === 0) return null;
  const to = k + d;
  return cells[to]?.inMonth ? to : null;
}
