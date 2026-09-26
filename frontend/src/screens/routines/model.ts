/**
 * Pure view logic for the Routines screen (Routines.dc.html renderVals). Every number comes from
 * the plan (`GET /plan`): the next three occurrences and their BD offsets, the monthly effort,
 * the rotation's dates, loop length and status. This module only formats and lays them out.
 */

import type { OccurrenceOut, PlanOut, ProjectOut, RotationOut, RotationSegmentOut, RoutineOut, RoutineRuleOut } from '../../api';
import { isoParts } from '../../lib/calendar';
import { dm, hours, num, ord, s, WEEKDAYS_LONG } from '../../lib/format';

/** The handover stages, in order (Remi.dc.html STAGES). */
export const STAGES = ['Manual', 'Automating', 'Shadowed', 'Handed over'] as const;

export type RoutineKind = RoutineRuleOut['kind'];
export type RoutineStage = RoutineOut['stage'];

export const KIND_OPTIONS: readonly { value: RoutineKind; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'daily', label: 'Daily' },
];

/** Copy the design writes for this screen (Routines.dc.html, arch-frontend-screens §5). */
export const COPY = {
  eyebrow: 'Routines',
  title: 'What repeats, and where each routine goes next',
  add: 'Add BAU routine',
  namePlaceholder: 'Name this routine',
  notePlaceholder: 'Where does this routine go after the move?',
  perRun: 'per run',
  handedOver: 'Handed over. It no longer takes your time.',
  noRuns: 'No upcoming runs.',
  remove: 'Remove',
  removeArmed: 'Click again to remove',
  /** D: every Private Credit routine is gone (the prototype's empty list). */
  pcEmpty: 'No Private Credit routines. Everything recurring has been handed over or stopped.',
  /** N: no routines at all yet (start empty). */
  noneYet: 'No routines yet. Add the BAU that repeats, and Remi reserves its time first.',
  /** N: the rotation has no segments. */
  noRotation: 'No rotation yet. Set it up to see where each country falls after the move.',
  setUpRotation: 'Set up the rotation',
  fiTail: 'one country at a time, then round again',
  buildLegend: 'First pass: models and views built from scratch',
  refreshLegend: 'Return visit: update what was built',
  /** Decision 10: the routine's checklist, in the Charter list language. */
  checklist: 'Checklist',
  checklistPlaceholder: 'Name a checklist item',
  checklistEmpty: 'No checklist yet. Add the items each run works through, such as the funds.',
  saveFailed: 'Couldn’t save that. Try again.',
} as const;

// ------------------------------------------------------------------------------------ rules

/** The rule as a sentence (Remi.dc.html ruleText): 'Every business day', 'Every Tuesday', '3rd business day, monthly'. */
export function ruleText(rule: Pick<RoutineRuleOut, 'kind' | 'bd' | 'weekday'>): string {
  if (rule.kind === 'daily') return 'Every business day';
  if (rule.kind === 'weekly') return `Every ${WEEKDAYS_LONG[rule.weekday % 7] ?? 'weekday'}`;
  return `${ord(rule.bd)} business day, monthly`;
}

/** The rule line under the controls: the rule, then ' · ' and the detail in lower case. */
export function ruleLine(rule: Pick<RoutineRuleOut, 'kind' | 'bd' | 'weekday'>, detail: string): string {
  const d = detail.trim();
  return ruleText(rule) + (d ? ` · ${d.toLowerCase()}` : '');
}

/**
 * The monthly estimate under the hours (the server computes the figure): '6h a month' for a
 * monthly routine, '≈4.3h a month' for a weekly one (one decimal) and '≈21h a month' for a daily
 * one (whole hours), as Routines.dc.html:201 rounds them.
 */
export function monthlyEffort(
  kind: RoutineKind,
  derived: Pick<RoutineOut['derived'], 'monthlyEffortH' | 'monthlyEffortApprox'>,
): string {
  const h = derived.monthlyEffortH;
  if (!derived.monthlyEffortApprox) return `${hours(h)} a month`;
  return `≈${kind === 'daily' ? String(Math.round(h)) : num(h, 1)}h a month`;
}

/** The effort input's width: it grows with the text (the prototype's `max(1, len) × 0.62em + 8px`). */
export function effortWidth(text: string): string {
  return `calc(${String(Math.max(1, text.length) * 0.62)}em + 8px)`;
}

export interface NextRun {
  iso: string;
  /** 'Mon 5 Oct'. */
  date: string;
  /** 'today', 'after the move' or '22 BD away'. */
  note: string;
  today: boolean;
}

/** One of the next three occurrences, as the column shows it. */
export function nextRun(o: OccurrenceOut): NextRun {
  return {
    iso: o.iso,
    date: s(o.iso),
    note: o.today ? 'today' : o.afterMove ? 'after the move' : `${String(o.bdAway)} BD away`,
    today: o.today,
  };
}

/** The message under (or instead of) the next three: handed over, or nothing coming up. */
export function nextMessage(stage: number, next: readonly unknown[]): string | null {
  if (stage >= 3) return COPY.handedOver;
  return next.length ? null : COPY.noRuns;
}

/**
 * Sentence case, as Routines.dc.html:216 writes the project link: lower-case everything, then
 * capitalise the first letter ('ManCo pack automation' reads 'Manco pack automation').
 */
export function sentenceCase(text: string): string {
  return text.toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

/** The link to the routine's automation project: 'Via Returns pipeline automation · 2 Dec'. */
export function projectLink(project: Pick<ProjectOut, 'name' | 'forecastDate'> | null | undefined): string | null {
  if (!project) return null;
  return `Via ${sentenceCase(project.name)} · ${project.forecastDate ? dm(project.forecastDate) : '—'}`;
}

/** The Private Credit header note: '2 routines on your plan until the move · …'. */
export function pcNote(routines: readonly Pick<RoutineOut, 'stage'>[]): string {
  const active = routines.filter((r) => r.stage < 3).length;
  return `${String(active)} routine${active === 1 ? '' : 's'} on your plan until the move · each one leaves by automation or handover`;
}

/** Private Credit routines in plan order (the screen lists no others: crit Routines:195). */
export function pcRoutines(plan: Pick<PlanOut, 'routines'>): RoutineOut[] {
  return plan.routines.filter((r) => r.domain === 'pc');
}

/** 'Checklist · 12', or just 'Checklist' while it is empty. */
export function checklistLabel(count: number): string {
  return count > 0 ? `${COPY.checklist} · ${String(count)}` : COPY.checklist;
}

// ---------------------------------------------------------------------------------- rotation

export interface TrackTile {
  id: string;
  /** '01'. */
  index: string;
  code: string;
  country: string;
  pass: RotationSegmentOut['pass'];
  /** '4 Jan – 11 Jan · 6 BD'. */
  dates: string;
  /** 'Refresh 9 Mar – 11 Mar' when this country is refreshed after the loop (top row only). */
  extra?: string;
  current: boolean;
  /** 'First up · Mon 4 Jan' on the next or current stop. */
  flag?: string;
}

export interface TrackModel {
  /** Tiles left to right along the top, then right to left along the bottom (clockwise). */
  top: TrackTile[];
  bottom: TrackTile[];
  columns: number;
  /** 'Waiting to start. 61 BD to go.' */
  now: string;
  /** '10 countries · 46 business days'. */
  loop: string;
  /** 'Mon 8 Mar 2027'. */
  completion: string;
  /** 'Back to Germany to refresh, Tue 9 Mar – 11 Mar', or null without a refresh. */
  then: string | null;
  /** The FI header: 'Eurozone sovereign rotation · 4h a day from the move · one country at a time, then round again'. */
  subtitle: string;
}

/** 'D Mon – D Mon' with an en dash. */
export function span(start: string, end: string): string {
  return `${dm(start)} – ${dm(end)}`;
}

/** A tile's date line: '4 Jan – 11 Jan · 6 BD'. */
export function tileDates(seg: Pick<RotationSegmentOut, 'start' | 'end' | 'lengthBd'>): string {
  return `${span(seg.start, seg.end)} · ${String(seg.lengthBd)} BD`;
}

/** 'Germany', 'Germany and France', 'Germany, France and Italy'. */
export function listCountries(names: readonly string[]): string {
  const unique = [...new Set(names)];
  if (unique.length <= 1) return unique[0] ?? '';
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1] ?? ''}`;
}

/** The status in the track's top-left gutter. */
export function nowLine(rotation: Pick<RotationOut, 'current' | 'segments'>): string {
  const cur = rotation.current;
  if (cur.status === 'waiting') return `Waiting to start. ${String(cur.bdToStart ?? 0)} BD to go.`;
  if (cur.status === 'active') {
    const seg = rotation.segments.find((g) => g.id === cur.segmentId) ?? rotation.segments.find((g) => g.order === cur.order);
    return seg ? `${seg.country}, until ${s(seg.end)}.` : 'Under way.';
  }
  if (cur.status === 'done') return 'Loop complete. Round again.';
  return '';
}

/** The FI header's subtitle, from the rotation's title, hours and start. */
export function rotationSubtitle(rotation: Pick<RotationOut, 'title' | 'hoursPerDay' | 'startFollowsMove' | 'startDate'>): string {
  const from = rotation.startFollowsMove || !rotation.startDate ? 'from the move' : `from ${s(rotation.startDate)}`;
  return `${rotation.title} · ${hours(rotation.hoursPerDay)} a day ${from} · ${COPY.fiTail}`;
}

/** Builds the stadium track from the rotation (Routines.dc.html tiles, loopBD, loopEnd, refresh). */
export function trackModel(rotation: RotationOut): TrackModel | null {
  const segments = [...rotation.segments].sort((a, b) => a.order - b.order);
  if (segments.length === 0) return null;
  const loop = segments.filter((g) => g.loop === 1);
  const stops = loop.length ? loop : segments;
  const refreshes = segments.filter((g) => g.loop > 1 && g.pass === 'Refresh');
  const cur = rotation.current;
  // The highlighted stop: the active segment, else the first one while waiting.
  const currentId =
    cur.status === 'active'
      ? (cur.segmentId ?? stops.find((g) => g.order === cur.order)?.id ?? null)
      : cur.status === 'waiting'
        ? (stops[0]?.id ?? null)
        : null;

  const columns = Math.max(1, Math.ceil(stops.length / 2));
  // The top row carries the refresh line and the flag; the bottom row's template draws neither.
  const tile = (g: RotationSegmentOut, k: number): TrackTile => {
    const current = g.id === currentId;
    const base: TrackTile = {
      id: g.id,
      index: String(k + 1).padStart(2, '0'),
      code: g.code,
      country: g.country,
      pass: g.pass,
      dates: tileDates(g),
      current,
    };
    if (k >= columns) return base;
    const refresh = refreshes.find((r) => r.code === g.code);
    if (refresh) base.extra = `Refresh ${span(refresh.start, refresh.end)}`;
    if (current) base.flag = cur.status === 'active' ? `Now · until ${s(g.end)}` : `First up · ${s(g.start)}`;
    return base;
  };
  const tiles = stops.map(tile);
  const top = tiles.slice(0, columns);
  // The bottom row runs right to left, so the loop reads clockwise.
  const bottom = tiles.slice(columns).reverse();

  const loopEnd = rotation.loopEnd;
  const refresh = rotation.refresh;
  return {
    top,
    bottom,
    columns,
    now: nowLine(rotation),
    loop: `${String(stops.length)} ${stops.length === 1 ? 'country' : 'countries'} · ${String(rotation.loopBd)} business day${rotation.loopBd === 1 ? '' : 's'}`,
    completion: loopEnd ? `${s(loopEnd)} ${String(isoParts(loopEnd).y)}` : '—',
    then:
      refresh && refreshes.length
        ? `Back to ${listCountries(refreshes.map((g) => g.country))} to refresh, ${s(refresh.start)} – ${dm(refresh.end)}`
        : null,
    subtitle: rotationSubtitle(rotation),
  };
}
