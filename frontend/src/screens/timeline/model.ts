/**
 * Timeline copy and tooltip content (Timeline.dc.html:304-357, critique "Timeline"). Pure
 * formatting over the server's read model: every number (forecasts, deltas, loads, the
 * rotation schedule) comes from `GET /plan`; this file only turns it into the design's words.
 */

import type { CalendarDay } from '../../lib/calendar';
import * as F from '../../lib/format';
import type { HoverKey } from '../../stores/hover';
import { hoverKey, ROTATION_KEY } from '../../stores/hover';
import type { DayLoadItemOut, DayLoadOut, ProjectOut, RotationOut, RoutineOut } from '../../api';

/** A tooltip's content (the component library's TooltipContent, keyed). */
export interface Tip {
  key: string;
  title: string;
  chip: string;
  chipColor?: string;
  lines: string[];
}

/** Routine stages, as the shell's STAGES (Remi.dc.html:322). */
export const STAGE_NAMES = ['Manual', 'Automating', 'Shadowed', 'Handed over'] as const;

export function stageName(stage: number): string {
  return STAGE_NAMES[Math.max(0, Math.min(STAGE_NAMES.length - 1, stage))] ?? '';
}

type Rule = RoutineOut['rule'];

/** '3rd business day, monthly' / 'Every Tuesday' / 'Every business day' (Remi.dc.html:325). */
export function ruleText(rule: Rule): string {
  if (rule.kind === 'daily') return 'Every business day';
  if (rule.kind === 'weekly') return `Every ${F.WEEKDAYS_LONG[rule.weekday] ?? ''}`;
  return `${F.ord(rule.bd)} business day, monthly`;
}

/** 'BD3' / 'Weekly · Tue' / 'Daily' (Remi.dc.html:326). */
export function ruleShort(rule: Rule): string {
  if (rule.kind === 'daily') return 'Daily';
  if (rule.kind === 'weekly') return `Weekly · ${F.WEEKDAYS_SHORT[rule.weekday] ?? ''}`;
  return `BD${String(rule.bd)}`;
}

/**
 * The row label: the routine's curated display label (the design shortens 'Fund &
 * security-level returns' to 'Fund & security returns', Timeline.dc.html:309), else its name.
 */
export function routineRowLabel(r: Pick<RoutineOut, 'name' | 'label'>): string {
  const label = r.label?.trim() ?? '';
  if (label) return label;
  return r.name || 'Untitled routine';
}

/** 'BD3 · 6h' */
export function routineRowSub(r: Pick<RoutineOut, 'rule' | 'hours'>): string {
  return `${ruleShort(r.rule)} · ${F.hours(r.hours)}`;
}

/** Routine tip (Timeline.dc.html:310): the rule, hours and stage, then the status note. */
export function routineTip(r: RoutineOut): Tip {
  return {
    key: `routine:${r.id}`,
    title: r.name || 'Untitled routine',
    chip: 'BAU',
    lines: [`${ruleText(r.rule)}, ${F.hours(r.hours)} · ${stageName(r.stage)}`, r.statusNote].filter(Boolean),
  };
}

/** The two-week tick label: 'Returns · 6h', or 'Handed over' after the move (critique :314). */
export function tickText(r: Pick<RoutineOut, 'short' | 'name' | 'hours'>, handedOver: boolean): string {
  return handedOver ? 'Handed over' : `${r.short || r.name} · ${F.hours(r.hours)}`;
}

// ---------------------------------------------------------------------------------------------
// Projects

export type ProjectStatus = ProjectOut['derived']['status'];

/** targetLabel ('Late Mar 2027') wins over the date. */
export function targetText(p: Pick<ProjectOut, 'targetDate' | 'targetLabel'>): string {
  return p.targetLabel ?? F.s(p.targetDate);
}

/** The Roll value in the row: 'Wed 2 Dec', or 'Not yet' in Define (critique :327). */
export function forecastText(p: Pick<ProjectOut, 'forecastDate'>): string {
  return p.forecastDate ? F.s(p.forecastDate) : 'Not yet';
}

/** The row chip: 'Target Late Mar 2027' in Define, else '+3 BD' / 'On target' / '−2 BD'. */
export function rowChipText(p: ProjectOut): string {
  return p.derived.status === 'define' ? `Target ${targetText(p)}` : F.delta(p.derived.deltaBd);
}

/** Project tip (Timeline.dc.html:342-344), with the exact line order and copy. */
export function projectTip(p: ProjectOut): Tip {
  const def = p.derived.status === 'define';
  const risk = p.derived.status === 'risk';
  const target = targetText(p);
  const forecast = p.forecastDate ? F.s(p.forecastDate) : null;
  const lines: (string | null)[] = [
    def || !forecast ? `No forecast until the plan exists · target ${target}` : `Forecast ${forecast} · target ${target}`,
    p.prevForecastDate ? `Previous plan ended ${F.s(p.prevForecastDate)}` : null,
    def
      ? 'No plan yet'
      : `Confidence ${p.confidence ? String(p.confidence) : '—'}/5 · checked in ${F.since(p.derived.sinceDays).toLowerCase()}`,
    ...p.derived.milestones.map((m) => `◆ ${m.name} · ${F.s(m.date)}`),
    forecast ? `◆ ${p.endName} · ${forecast}` : null,
  ];
  return {
    key: `project:${p.id}`,
    title: p.name,
    chip: def ? 'no plan' : F.delta(p.derived.deltaBd),
    chipColor: risk ? 'var(--risk-text)' : undefined,
    lines: lines.filter((l): l is string => l !== null),
  };
}

/**
 * The shortened project tip a milestone's mouse leave reverts to (Timeline.dc.html:337, critique
 * "milestone … reverts to a shortened project tooltip"): the delta chip in muted ink and the
 * forecast line only. It shares the project tip's key, as the prototype's, so moving on along
 * the row keeps it until the pointer leaves the row.
 */
export function projectShortTip(p: ProjectOut): Tip {
  return {
    key: `project:${p.id}`,
    title: p.name,
    chip: F.delta(p.derived.deltaBd),
    lines: [projectTip(p).lines[0] ?? ''].filter(Boolean),
  };
}

/**
 * Milestone tip (Timeline.dc.html:336): the long date and its business day, the project, and
 * 'Passed' or how far away it is (a business-day offset from today, as the Routines row).
 */
export function milestoneTip(
  p: Pick<ProjectOut, 'id' | 'name'>,
  m: { name: string; date: string; passed: boolean },
  bdOfNext: number | null,
  bdAway: number | null,
): Tip {
  const away = bdAway === null ? '' : `${F.count(bdAway, 'business day')} away`;
  return {
    key: `milestone:${p.id}:${m.name}`,
    title: m.name,
    chip: 'Milestone',
    lines: [`${F.l(m.date)}${bdOfNext === null ? '' : ` · BD${String(bdOfNext)}`}`, p.name, m.passed ? 'Passed' : away].filter(
      Boolean,
    ),
  };
}

// ---------------------------------------------------------------------------------------------
// Rotation

/** Build segments of the first loop, in order. */
function firstLoop(rot: RotationOut): RotationOut['segments'] {
  return rot.segments.filter((s) => s.loop === 1);
}

/** '4h/day' */
export function rotationSub(rot: RotationOut): string {
  return `${F.num(rot.hoursPerDay)}h/day`;
}

/** 'Starts Mon 4 Jan with Germany, first Build pass →' (Timeline.dc.html:119). */
export function rotationNote(rot: RotationOut): string | null {
  const first = rot.segments[0];
  if (!first || !rot.startDate) return null;
  return `Starts ${F.s(rot.startDate)} with ${first.country}, first ${first.pass} pass →`;
}

/** Rotation tip (Timeline.dc.html:357): the order, then when the first loop completes. */
export function rotationTip(rot: RotationOut): Tip {
  const loop = firstLoop(rot);
  const refresh = rot.segments.find((s) => s.loop > 1);
  const order = loop.map((s) => s.country).join(' → ');
  const lines = [
    order ? `${order}${refresh ? `, then back to ${refresh.country} to refresh.` : '.'}` : '',
    rot.loopEnd ? `First loop complete ${F.s(rot.loopEnd)}.` : '',
  ].filter(Boolean);
  return { key: 'rotation', title: rot.title, chip: 'BAU', lines };
}

// ---------------------------------------------------------------------------------------------
// Capacity

/** The linked-highlight key of a load item: rotation items group by type (ADR-0007 notes). */
export function loadItemKey(item: Pick<DayLoadItemOut, 'refType' | 'refId'>): HoverKey {
  if (item.refType === 'rotation') return ROTATION_KEY;
  return hoverKey(item.refType === 'routine' ? 'routine' : 'project', item.refId);
}

/** Day tip (Timeline.dc.html:304-305): 'Wed 4 Nov · BD3', 'Overload' or '8h of 8h', one line per item. */
export function dayTip(day: Pick<CalendarDay, 'iso' | 'bdm'>, load: DayLoadOut | undefined): Tip {
  const items = load?.items ?? [];
  const over = load?.over ?? false;
  const total = load?.total ?? 0;
  const capacity = load?.capacity ?? 8;
  return {
    key: `day:${day.iso}`,
    title: `${F.s(day.iso)} · BD${String(day.bdm ?? '')}`,
    chip: over ? 'Overload' : `${F.hours(total)} of ${F.hours(capacity)}`,
    chipColor: over ? 'var(--overload)' : undefined,
    lines: items.length
      ? items.map((it) => `${it.name}${it.refType === 'project' ? '' : ' (BAU)'} · ${F.hours(it.h)}`)
      : ['Nothing planned.'],
  };
}

/** 'FI move · Mon 4 Jan' */
export function moveTag(moveIso: string): string {
  return `FI move · ${F.s(moveIso)}`;
}

/** Footnote: the holiday calendar is named after the region (the design is GB-ENG). */
export function footnote(region: string, empty = false): string {
  const hols = region.startsWith('GB') ? 'UK bank holidays' : 'public holidays';
  const slivers = `Weekends and ${hols} are collapsed to slivers.`;
  // An empty plan has no rows to hover or click.
  return empty ? slivers : `${slivers} Hover a row to trace it through the capacity strip; click for details.`;
}

/** 'Hours per day against 8h.' */
export function capacityCaption(capacity: number): string {
  return `Hours per day against ${F.hours(capacity)}.`;
}
