/**
 * Today's screen-local view logic (Today.dc.html renderVals and monthSnap), as pure functions.
 *
 * The server owns every number: loads, the day's BAU rows and focus blocks, the month
 * snapshot's rows and cumulative bars. What is left here is copy, grouping and geometry:
 * kickers and labels, the week strip's five slots, the month groups' limits and "Show more",
 * and the bar heights.
 */

import type { DayLoad, Domain, LoadItem } from '../../components';
import type {
  DayLoadOut,
  MonthSnapshotBarOut,
  MonthSnapshotRowOut,
  ProjectOut,
  RoutineRuleOut,
} from './types';
import type { CalendarIndex, IsoDate } from '../../lib/calendar';
import { addDays, isIsoDate, weekdayOf } from '../../lib/calendar';
import { d as dayOfMonth, dm, hours, l as longDate, mon, num, s as shortDate, wd, wdL } from '../../lib/format';
import type { HoverKey } from '../../stores/hover';
import { hoverKey, ROTATION_KEY } from '../../stores/hover';

// ---------------------------------------------------------------------------------------------
// Shared

export const DOMAIN_LABEL: Readonly<Record<Domain, string>> = { pc: 'Private Credit', fi: 'Fixed Income' };

export const asDomain = (value: string): Domain => (value === 'fi' ? 'fi' : 'pc');

/** Routines' handover stages (Remi.dc.html STAGES). */
export const STAGE_NAMES = ['Manual', 'Automating', 'Shadowed', 'Handed over'] as const;

const WEEKDAY_SHORT_MON_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;

/** The prototype's `hrs`: 2 dp, 'h' suffix ('6h', '0.75h', '9.5h'). */
export const hrs = (h: number): string => hours(h);

/** The API's load item, narrowed to the component library's shape. */
export function toLoadItem(item: DayLoadOut['items'][number]): LoadItem {
  const refType = item.refType === 'routine' || item.refType === 'rotation' ? item.refType : 'project';
  return { refType, refId: item.refId, domain: asDomain(item.domain), h: item.h, name: item.name };
}

export function toDayLoad(load: DayLoadOut): DayLoad {
  return {
    items: load.items.map(toLoadItem),
    bau: load.bau,
    proj: load.proj,
    total: load.total,
    free: load.free,
    capacity: load.capacity,
    over: load.over,
  };
}

/** The linked-highlight key of a load item: rotation items share one key (E-engine note). */
export function loadItemKey(item: Pick<LoadItem, 'refType' | 'refId'>): HoverKey {
  if (item.refType === 'rotation') return ROTATION_KEY;
  return hoverKey(item.refType === 'routine' ? 'routine' : 'project', item.refId);
}

/** Optimistic-tick keys, shared by the plan and the month snapshot (its row keys use the same form). */
export const tickKey = (routineId: string, iso: string, itemId: string) => `tick:${routineId}:${iso}:${itemId}`;
export const taskKey = (taskId: string) => `task:${taskId}`;
export const runKey = (routineId: string, iso: string) => `bau:${routineId}:${iso}`;

// ---------------------------------------------------------------------------------------------
// Day header, capacity and plan copy

/** What the kicker needs to know about today (`PlanOut.today`). */
export interface TodayRef {
  iso: string;
  isBd: boolean;
}

const bdCount = (n: number) => `${String(n)} business ${n === 1 ? 'day' : 'days'}`;

/**
 * The kicker over the date (Today.dc.html:367: 'Today', 'Tomorrow · preview', '<Weekday> · N
 * business days ahead'). The prototype's today was always a business day; for the rest:
 *
 * - Only today itself reads 'Today'.
 * - 'Tomorrow' and 'Yesterday' are the calendar's: the day after or before a business-day
 *   today. Friday seen from a Monday is '1 business day ago', not 'Yesterday'.
 * - `aheadBd` is `bd_diff(today, day)`, which counts from the next business day when today is
 *   not one. Seen from a weekend or holiday, that next business day (aheadBd 0) is day 1
 *   ahead, so future days read one more than aheadBd. Past days need no shift.
 * - The prototype printed '-N business days ahead' for past days (today.json risks); they read
 *   as days ago instead.
 */
export function kicker(iso: string, aheadBd: number, isToday: boolean, today: TodayRef): string {
  if (isToday) return 'Today';
  if (today.isBd && iso === addDays(today.iso, 1)) return 'Tomorrow · preview';
  if (today.isBd && iso === addDays(today.iso, -1)) return 'Yesterday · looking back';
  if (iso < today.iso) return `${wdL(iso)} · ${bdCount(Math.max(1, -aheadBd))} ago`;
  const ahead = today.isBd ? aheadBd : aheadBd + 1;
  if (ahead <= 1) return `${wdL(iso)} · next business day`;
  return `${wdL(iso)} · ${bdCount(ahead)} ahead`;
}

export interface DayCopy {
  kicker: string;
  title: string;
  capTitle: string;
  planTitle: string;
  planNote: string;
}

export function dayCopy(iso: string, aheadBd: number, isToday: boolean, today: TodayRef): DayCopy {
  const who = isToday ? 'Today' : wdL(iso);
  return {
    kicker: kicker(iso, aheadBd, isToday, today),
    title: longDate(iso),
    capTitle: `${who}’s capacity`,
    planTitle: `${who}’s plan`,
    planNote: isToday
      ? 'BAU first, then focus blocks'
      : iso < today.iso
        ? 'Looking back; the plan as it stands now'
        : 'As planned today; it moves if the plan does',
  };
}

/** '8h of 8h planned · 0h free' or '9.5h planned · 1.5h over'. */
export function capacityLabel(load: Pick<DayLoadOut, 'total' | 'free' | 'capacity' | 'over'>): string {
  return load.over
    ? `${hrs(load.total)} planned · ${hrs(load.total - load.capacity)} over`
    : `${hrs(load.total)} of ${hrs(load.capacity)} planned · ${hrs(load.free)} free`;
}

/** A week card's load line: '7h of 8h' or '9.5h · over'. */
export function weekLoadLabel(load: Pick<DayLoadOut, 'total' | 'capacity' | 'over'>): string {
  return load.over ? `${hrs(load.total)} · over` : `${hrs(load.total)} of ${hrs(load.capacity)}`;
}

/** Remi.dc.html ruleShort: 'BD8', 'Weekly · Mon', 'Daily'. */
export function ruleShort(rule: RoutineRuleOut): string {
  if (rule.kind === 'daily') return 'Daily';
  if (rule.kind === 'weekly') return `Weekly · ${WEEKDAY_SHORT_MON_FIRST[rule.weekday - 1] ?? ''}`;
  return `BD${String(rule.bd)}`;
}

/**
 * The checklist run card's rule. The prototype hard-coded 'BD3, monthly' for the Returns run;
 * this is the same shape for any rule.
 */
export function runCardRule(rule: RoutineRuleOut): string {
  if (rule.kind === 'daily') return 'Every business day';
  if (rule.kind === 'weekly') return `${WEEKDAY_SHORT_MON_FIRST[rule.weekday - 1] ?? ''}, weekly`;
  return `BD${String(rule.bd)}, monthly`;
}

/** Another BAU row's rule: 'BD8 · automating'; the rotation's '4h a day'. */
export function bauRowRule(rule: RoutineRuleOut | null, stage: number | null, h: number): string {
  if (!rule) return `${hrs(h)} a day`;
  const stageName = STAGE_NAMES[stage ?? 0] ?? STAGE_NAMES[0];
  return `${ruleShort(rule)} · ${stageName.toLowerCase()}`;
}

/**
 * The checklist's unit, from the routine's detail ('12 funds' → 'funds'). The prototype wrote
 * 'of 12 funds' literally; the count now comes from the checklist itself.
 */
export function checklistUnit(detail: string | null | undefined, count: number): string {
  const word = (detail ?? '').trim().replace(/^\d+(?:\.\d+)?\s*/, '');
  if (word && !/^\d/.test(word)) return word;
  return count === 1 ? 'item' : 'items';
}

/** The run card's note next to the rule, per day. */
export function runCardNote(aheadBd: number, isToday: boolean, editable: boolean): string {
  if (isToday || editable) return '';
  if (aheadBd < 0) return 'Past run · the ticks are kept as they were';
  return 'Fresh checklist for this run · ticking opens on the day';
}

export interface NextRunLike {
  afterMove: boolean;
  date?: string | null;
}

/** 'No BAU on this day. The next run is Mon 12 Oct.' (the clause is dropped with no routines). */
export function noBauText(next: NextRunLike | null | undefined, hasRoutines: boolean): string {
  if (!hasRoutines) return 'No BAU on this day.';
  const when = next && !next.afterMove && next.date ? shortDate(next.date) : 'after the move';
  return `No BAU on this day. The next run is ${when}.`;
}

/**
 * A non-business day in the plan column: Calendar's copy, plus the next run when there is one
 * before the move.
 */
export function dayOffText(holiday: string | null | undefined, next?: NextRunLike | null): string {
  const base = holiday ? `${holiday}. Nothing is planned, and business-day numbers skip it.` : 'Weekend. Nothing is planned.';
  return next && !next.afterMove && next.date ? `${base} The next run is ${shortDate(next.date)}.` : base;
}

export const NO_FOCUS_BLOCKS = 'No focus blocks. Give a project hours a day and it appears here.';

export const FOCUS_EMPTY: Readonly<Record<'no_tasks' | 'used_up', string>> = {
  no_tasks: 'No tasks planned in Now yet. Add them in the workspace.',
  used_up: 'The tasks in Now are used up before this day. Plan the next ones in the workspace.',
};

/** 'Next milestone: <name> · Fri 16 Oct' / 'Milestone due this day: <name> · Wed 4 Nov'. */
export function milestoneLine(ms: { name: string; date: string; dueThisDay: boolean } | null | undefined): string {
  if (!ms) return '';
  return `${ms.dueThisDay ? 'Milestone due this day: ' : 'Next milestone: '}${ms.name} · ${shortDate(ms.date)}`;
}

// ---------------------------------------------------------------------------------------------
// The selected day

/**
 * Monday of the day's week, the prototype's `S - (w - 1)`, except that a weekend looks at the
 * next week. The prototype's Sunday already did; a Saturday showed the week just ended, with no
 * card selected and the next business day out of reach. Today is never a weekend in the design.
 */
export function mondayOf(iso: string): IsoDate {
  const w = weekdayOf(iso);
  return addDays(iso, w === 6 ? 2 : 1 - w);
}

/**
 * Which day the screen shows. A missing, malformed or non-business day falls back to today
 * (Today.dc.html:301). `isBd` is the calendar's answer, or null while it is unknown.
 */
export function resolveDay(route: string | null | undefined, today: string, isBd: boolean | null): string {
  if (!route || !isIsoDate(route) || route === today) return today;
  if (isBd === false) return today;
  return route;
}

// ---------------------------------------------------------------------------------------------
// Week strip

export interface WeekChip {
  key: string;
  label: string;
  domain: Domain;
  /** Milestone chips have no fill and take their project's accent. */
  milestone: boolean;
  hover: HoverKey;
}

export interface WeekItem {
  key: string;
  name: string;
  h: string;
  /** Bar width, h / 4 × 100% (uncapped, as the prototype). */
  width: string;
  domain: Domain;
  hover: HoverKey;
}

export interface WeekCard {
  kind: 'day';
  iso: string;
  label: string;
  bd: string;
  isToday: boolean;
  selected: boolean;
  load: DayLoad | null;
  loadLabel: string;
  over: boolean;
  chips: WeekChip[];
  items: WeekItem[];
  more: string;
}

/** A holiday (or a day outside the calendar) keeps its column empty (critique CORRECTION :334). */
export interface WeekGap {
  kind: 'gap';
  iso: string;
  holiday: string | null;
}

export type WeekSlot = WeekCard | WeekGap;

export interface WeekModel {
  monday: string;
  title: string;
  sub: string;
  slots: WeekSlot[];
}

type MilestoneSource = Pick<ProjectOut, 'id' | 'domain'> & {
  derived: { milestones: readonly { name: string; date: string }[] };
};

export function weekModel(args: {
  selected: string;
  today: string;
  calendar: CalendarIndex | undefined;
  loads: Readonly<Record<string, DayLoadOut>> | undefined;
  projects: readonly MilestoneSource[];
}): WeekModel {
  const { selected, today, calendar, loads, projects } = args;
  const monday = mondayOf(selected);
  const friday = addDays(monday, 4);
  const sameMonth = mon(monday) === mon(friday);
  const range = `${String(dayOfMonth(monday))}${sameMonth ? '' : ` ${mon(monday)}`}–${String(dayOfMonth(friday))} ${mon(friday)}`;
  const title = monday === mondayOf(today) ? 'This week' : `Week of ${String(dayOfMonth(monday))} ${mon(monday)}`;

  const slots: WeekSlot[] = [0, 1, 2, 3, 4].map((k): WeekSlot => {
    const iso = addDays(monday, k);
    const day = calendar?.day(iso) ?? null;
    if (!day?.bd) return { kind: 'gap', iso, holiday: day?.hol ?? null };
    const raw = loads?.[iso];
    const load = raw ? toDayLoad(raw) : null;
    const items = load?.items ?? [];
    const bau = items.filter((i) => i.refType !== 'project');
    const projs = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.refType === 'project')
      .sort((a, b) => b.item.h - a.item.h || a.index - b.index)
      .map(({ item }) => item);
    const chips: WeekChip[] = [
      ...bau.map((i) => ({
        key: `bau:${i.refType}:${i.refId}`,
        label: `${i.name} ${num(i.h)}h`,
        domain: i.domain,
        milestone: false,
        hover: loadItemKey(i),
      })),
      ...projects.flatMap((p) =>
        p.derived.milestones
          .filter((m) => m.date === iso)
          .map((m, j) => ({
            key: `ms:${p.id}:${String(j)}:${m.name}`,
            label: `◆ ${m.name}`,
            domain: asDomain(p.domain),
            milestone: true,
            hover: hoverKey('project', p.id),
          })),
      ),
    ];
    return {
      kind: 'day',
      iso,
      label: `${wd(iso)} ${String(dayOfMonth(iso))}`,
      bd: day.bdm != null ? `BD${String(day.bdm)}` : '',
      isToday: iso === today,
      selected: iso === selected,
      load,
      loadLabel: raw ? weekLoadLabel(raw) : '',
      over: raw?.over ?? false,
      chips,
      items: projs.slice(0, 2).map((i) => ({
        key: `proj:${i.refId}`,
        name: i.name,
        h: hrs(i.h),
        width: `${String((i.h / 4) * 100)}%`,
        domain: i.domain,
        hover: loadItemKey(i),
      })),
      more: projs.length > 2 ? `+${String(projs.length - 2)} more` : '',
    };
  });

  return { monday, title, sub: `${range} · pick a day to preview it`, slots };
}

// ---------------------------------------------------------------------------------------------
// Month snapshot

export type GroupKey = 'bau' | 'proj';

export const GROUP_LIMIT: Readonly<Record<GroupKey, number>> = { bau: 4, proj: 5 };

export interface MonthGroup<R extends MonthRowLike = MonthSnapshotRowOut> {
  key: GroupKey;
  label: string;
  /** '0/2': done over all. */
  count: string;
  /** Done share for the 56px mini bar. */
  pct: string;
  rows: R[];
  empty: string | null;
  more: string | null;
}

export type MonthRowLike = Pick<MonthSnapshotRowOut, 'kind' | 'due' | 'done' | 'doneOn'>;

const byDueAsc = <R extends MonthRowLike>(a: R, b: R) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
const byDoneOnDesc = <R extends MonthRowLike>(a: R, b: R) => {
  const x = a.doneOn ?? '';
  const y = b.doneOn ?? '';
  return x < y ? 1 : x > y ? -1 : 0;
};

/** Today.dc.html monthSnap `group`: open rows by due date, then (expanded) done rows, newest first. */
export function monthGroup<R extends MonthRowLike>(key: GroupKey, label: string, items: readonly R[], expanded: boolean): MonthGroup<R> {
  const open = items.filter((x) => !x.done).sort(byDueAsc);
  const done = items.filter((x) => x.done).sort(byDoneOnDesc);
  const lim = GROUP_LIMIT[key];
  const rows = expanded ? [...open, ...done] : open.slice(0, lim);
  const hidden = open.length - rows.filter((x) => !x.done).length;
  const dn = done.length;
  const more = expanded
    ? 'Show less'
    : hidden || dn
      ? `Show ${[hidden ? `${String(hidden)} more` : null, dn ? `${String(dn)} done` : null].filter(Boolean).join(' and ')}`
      : null;
  return {
    key,
    label,
    count: `${String(dn)}/${String(items.length)}`,
    pct: items.length ? `${String((dn / items.length) * 100)}%` : '0%',
    rows,
    empty: items.length === 0 ? 'Nothing due this month.' : open.length === 0 && !expanded ? 'All done for the month.' : null,
    more,
  };
}

export function monthGroups<R extends MonthRowLike>(rows: readonly R[], open: Readonly<Partial<Record<GroupKey, boolean>>>): MonthGroup<R>[] {
  return [
    monthGroup('bau', 'BAU', rows.filter((r) => r.kind === 'bau'), !!open.bau),
    monthGroup('proj', 'Projects', rows.filter((r) => r.kind !== 'bau'), !!open.proj),
  ];
}

export type DueTone = 'done' | 'late' | 'today' | 'plain';

/** 'done 5 Oct' / 'overdue 1 BD' / 'today' / 'Thu 15 Oct'. */
export function dueLabel(
  row: Pick<MonthSnapshotRowOut, 'due' | 'done' | 'doneOn' | 'late'>,
  today: string,
  overdueBd: number | null,
  monthStart: string,
): { text: string; tone: DueTone } {
  if (row.done) return { text: `done ${dm(row.doneOn ?? monthStart)}`, tone: 'done' };
  if (row.late) return { text: overdueBd != null ? `overdue ${String(overdueBd)} BD` : 'overdue', tone: 'late' };
  if (row.due === today) return { text: 'today', tone: 'today' };
  return { text: shortDate(row.due), tone: 'plain' };
}

/** A month row's text: milestones carry the diamond ('◆ name'). */
export function rowText(row: Pick<MonthSnapshotRowOut, 'kind' | 'text'>): string {
  return row.kind === 'milestone' ? `◆ ${row.text}` : row.text || 'Untitled';
}

/** The linked-highlight key of a month row (its routine, or its project). */
export function rowHoverKey(row: Pick<MonthSnapshotRowOut, 'kind' | 'routineId' | 'projectId'>): HoverKey | null {
  if (row.kind === 'bau' && row.routineId) return hoverKey('routine', row.routineId);
  return row.projectId ? hoverKey('project', row.projectId) : null;
}

export interface MonthBar {
  iso: string;
  /** Heights as CSS percentages ('0%' before arrival). */
  plan: string;
  late: string;
  done: string;
  past: boolean;
  today: boolean;
  delay: string;
  title: string;
}

/** The cumulative bars: due-by-then outline, overdue fill (done + late) and done fill. */
export function monthBars(bars: readonly MonthSnapshotBarOut[], total: number, today: string, arrived: boolean): MonthBar[] {
  const pct = (k: number) => (total && arrived ? `${String((k / total) * 100)}%` : '0%');
  return bars.map((b, i) => ({
    iso: b.iso,
    plan: pct(b.plan),
    late: pct(b.done + b.late),
    done: pct(b.done),
    past: b.past,
    today: b.iso === today,
    delay: `${String(Math.round(i * 8))}ms`,
    title:
      `${shortDate(b.iso)} · ${String(b.plan)} due by then` +
      (b.past ? `, ${String(b.done)} done${b.late ? `, ${String(b.late)} overdue` : ''}` : ''),
  }));
}

/**
 * The rows as shown while ticks are in flight (`shown(key, serverDone)`), with the header's
 * done and overdue counts adjusted to match. The server's rows and totals are otherwise kept.
 */
export function overlayRows<R extends Pick<MonthSnapshotRowOut, 'key' | 'due' | 'done' | 'doneOn' | 'late'>>(
  rows: readonly R[],
  totals: { done: number; late: number },
  today: string,
  shown: (key: string, server: boolean) => boolean,
): { rows: R[]; done: number; late: number } {
  let done = totals.done;
  let late = totals.late;
  const out = rows.map((r) => {
    const value = shown(r.key, r.done);
    if (value === r.done) return r;
    const nowLate = !value && r.due < today;
    done += value ? 1 : -1;
    late += (nowLate ? 1 : 0) - (r.late ? 1 : 0);
    return { ...r, done: value, late: nowLate, doneOn: value ? (r.doneOn ?? today) : null };
  });
  return { rows: out, done, late };
}
