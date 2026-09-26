/**
 * History scrubber geometry (Workspace.dc.html:435-493, :343-355): pure functions over day
 * numbers (days since 1970-01-01, the prototype's `F.dn`). The snapshots are the server's
 * check-ins; the last stop shows the live plan, dated at the last check-in, as the prototype
 * does (:437), so 'Plan as of' reads the date of the check-in the live plan was last
 * confirmed at ('Sat 3 Oct' on Mon 5 Oct). With no check-ins the one live stop is dated today.
 * Everything here is layout and interpolation, no business rules.
 */

import type { DerivedMilestoneOut, ProjectSnapshotOut } from '../../api';
import { dayNumber } from '../../lib/calendar';

export interface SnapMilestone {
  name: string;
  n: number;
}

export interface Snap {
  /** Day number of the check-in (the live stop keeps the last check-in's date; today if none). */
  date: number;
  /** Forecast day number, or null (Define). */
  f: number | null;
  /** The target the check-in recorded (null: not recorded, read the current target). */
  target: string | null;
  conf: number | null;
  ms: SnapMilestone[];
}

export interface LiveState {
  today: string;
  forecast: string | null;
  confidence: number | null;
  milestones: readonly Pick<DerivedMilestoneOut, 'name' | 'date'>[];
}

const toMs = (list: readonly { name: string; date: string }[]): SnapMilestone[] =>
  list.map((x) => ({ name: x.name, n: dayNumber(x.date) }));

/**
 * The stops: one per check-in, oldest first, with the last replaced by the live plan but kept
 * at that check-in's date (Workspace.dc.html:437 `{ ...cur, date: snaps[last].date }`). No
 * check-ins: one live stop dated today. A check-in without stored milestones falls back to the
 * current ones (the prototype's `c.ms || p.milestones`).
 */
export function buildSnaps(snapshots: readonly ProjectSnapshotOut[] | undefined, live: LiveState): Snap[] {
  const current = toMs(live.milestones);
  const cur: Snap = {
    date: dayNumber(live.today),
    f: live.forecast ? dayNumber(live.forecast) : null,
    target: null,
    conf: live.confidence,
    ms: current,
  };
  const list = snapshots ?? [];
  if (list.length === 0) return [cur];
  const snaps: Snap[] = list.map((c) => ({
    date: dayNumber(c.date),
    f: c.forecastDate ? dayNumber(c.forecastDate) : null,
    target: c.targetDate,
    conf: c.confidence,
    ms: c.milestones.length ? toMs(c.milestones) : current,
  }));
  const last = snaps[snaps.length - 1];
  if (last) snaps[snaps.length - 1] = { ...cur, date: last.date };
  return snaps;
}

export interface Axis {
  a0: number;
  a1: number;
}

/** The strip's day range: 4 days before the earliest start/check-in, 12 after the latest end. */
export function axisOf(startN: number, targetN: number, todayN: number, snaps: readonly Snap[]): Axis {
  const fs = snaps.map((x) => x.f).filter((x): x is number => x != null);
  const a0 = Math.min(startN, ...snaps.map((x) => x.date)) - 4;
  const a1 = Math.max(targetN > todayN + 200 ? todayN + 120 : targetN, todayN, ...fs) + 12;
  return { a0, a1 };
}

/** Clamped percentage along the axis, with three decimals ('41.304%'). */
export function pct(axis: Axis, n: number): string {
  return `${(Math.max(0, Math.min(1, (n - axis.a0) / (axis.a1 - axis.a0))) * 100).toFixed(3)}%`;
}

/** Unclamped stop positions in percent (the drag maths). */
export function stopXs(axis: Axis, snaps: readonly Snap[]): number[] {
  return snaps.map((x) => ((x.date - axis.a0) / (axis.a1 - axis.a0)) * 100);
}

export interface Interp {
  i0: number;
  i1: number;
  /** Fraction between stop i0 and i1. */
  t: number;
  a: Snap;
  b: Snap;
  /** The nearest stop (the header and "Plan as of"). */
  near: Snap;
  nearIndex: number;
  /** Interpolated forecast day number (fractional while dragging), or null. */
  fNow: number | null;
}

/** Where the handle is: `pos` null means the live (last) stop. */
export function interpolate(snaps: readonly Snap[], pos: number | null): Interp {
  const last = snaps.length - 1;
  const p = pos == null ? last : Math.max(0, Math.min(last, pos));
  const i0 = Math.floor(p);
  const t = p - i0;
  const i1 = Math.min(last, i0 + 1);
  const a = snaps[i0] ?? snaps[0];
  const b = snaps[i1] ?? a;
  const nearIndex = Math.round(p);
  const near = snaps[nearIndex] ?? a;
  if (!a || !b || !near) throw new RangeError('interpolate needs at least one snapshot');
  const fNow = a.f != null && b.f != null ? a.f + (b.f - a.f) * t : (b.f ?? a.f);
  return { i0, i1, t, a, b, near, nearIndex, fNow };
}

/** Milestone names across every stop, first seen first. */
export function milestoneNames(snaps: readonly Snap[]): string[] {
  return [...new Set(snaps.flatMap((x) => x.ms.map((m) => m.name)))];
}

/** Drag: the pointer's percentage along the track → a fractional stop position. */
export function positionFromPercent(xs: readonly number[], p: number): number {
  const first = xs[0];
  if (first === undefined || p <= first) return 0;
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i] ?? 0;
    const x1 = xs[i + 1] ?? 0;
    if (p <= x1) return i + (p - x0) / Math.max(0.001, x1 - x0);
  }
  return xs.length - 1;
}

/** On release the handle snaps to the nearest stop; the last stop is the live view (null). */
export function snapRelease(pos: number | null, count: number): number | null {
  const last = count - 1;
  const p = Math.round(pos ?? last);
  return p >= last ? null : p;
}

export interface MonthTick {
  n: number;
  /** 'Oct' */
  label: string;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** The first of every month inside the axis. */
export function monthTicks(axis: Axis): MonthTick[] {
  const out: MonthTick[] = [];
  for (let n = Math.ceil(axis.a0); n <= axis.a1; n++) {
    const date = new Date(n * 86_400_000);
    if (date.getUTCDate() === 1) out.push({ n, label: MON[date.getUTCMonth()] ?? '' });
  }
  return out;
}

export type LabelKind = 'start' | 'ms' | 'end' | 'tgt';

export interface LabelInput {
  n: number;
  name: string;
  kind: LabelKind;
}

/**
 * The hover labels in date order: Start, each milestone (at B, else A), the interpolated
 * forecast end ('Handover-ready · forecast') and the Target.
 */
export function hoverLabelInputs(opts: {
  startN: number;
  targetN: number;
  endName: string;
  names: readonly string[];
  interp: Interp;
}): LabelInput[] {
  const { interp } = opts;
  const lab: LabelInput[] = [{ n: opts.startN, name: 'Start', kind: 'start' }];
  for (const nm of opts.names) {
    const m = interp.b.ms.find((x) => x.name === nm) ?? interp.a.ms.find((x) => x.name === nm);
    if (m) lab.push({ n: m.n, name: nm, kind: 'ms' });
  }
  if (interp.fNow != null) lab.push({ n: Math.round(interp.fNow), name: `${opts.endName || 'Forecast'} · forecast`, kind: 'end' });
  lab.push({ n: opts.targetN, name: 'Target', kind: 'tgt' });
  return lab.sort((x, y) => x.n - y.n);
}

export interface PlacedLabel extends LabelInput {
  /** Left as a percentage string. */
  x: string;
  /** Row 0-2 (17px pitch). */
  row: number;
  anchor: 'l' | 'c' | 'r';
  /** 'Mon 14 Sep' */
  date: string;
}

/**
 * Greedy 3-row packing (Workspace.dc.html:462-470). Widths are estimated from character
 * counts, as the prototype does: 6.1px per name character, 6.2px per date character, plus 34.
 * A label takes the first row whose last label ends more than 10px before it starts, else the
 * row that ends earliest.
 */
export function packLabels(labels: readonly LabelInput[], axis: Axis, barWidth: number, dateOf: (n: number) => string): PlacedLabel[] {
  const ends = [-1e9, -1e9, -1e9];
  return labels.map((l) => {
    const xp = Math.max(0, Math.min(1, (l.n + 0.5 - axis.a0) / (axis.a1 - axis.a0))) * 100;
    const date = dateOf(l.n);
    const wpx = l.name.length * 6.1 + date.length * 6.2 + 34;
    const anchor = xp < 6 ? 'l' : xp > 94 ? 'r' : 'c';
    const cx = (xp / 100) * barWidth;
    const left = anchor === 'l' ? cx - 4 : anchor === 'r' ? cx - wpx + 4 : cx - wpx / 2;
    let row = ends.findIndex((e) => e + 10 < left);
    if (row < 0) row = ends.indexOf(Math.min(...ends));
    ends[row] = left + wpx;
    return { ...l, x: `${xp.toFixed(3)}%`, row, anchor, date };
  });
}

/** The label's transform for its anchor. */
export function labelTransform(anchor: PlacedLabel['anchor']): string {
  return anchor === 'l' ? 'translateX(-4px)' : anchor === 'r' ? 'translateX(calc(-100% + 4px))' : 'translateX(-50%)';
}

/** The crosshair's day under a hover fraction (0-1 along the bar). */
export function hoverDay(axis: Axis, hx: number): number {
  return Math.round(axis.a0 + hx * (axis.a1 - axis.a0) - 0.5);
}

/** The crosshair chip flips at the edges (critique :479). */
export function crosshairTransform(hx: number): string {
  return hx < 0.12 ? 'translateX(0)' : hx > 0.88 ? 'translateX(-100%)' : 'translateX(-50%)';
}

export interface StripInput {
  startN: number;
  targetN: number;
  todayN: number;
  snaps: readonly Snap[];
  /** The handle's fractional stop position; null is the live (last) stop. */
  pos: number | null;
}

export interface StripModel {
  axis: Axis;
  interp: Interp;
  /** The interpolated forecast lands past the target. */
  risk: boolean;
  names: string[];
  /** Unclamped stop positions (the drag maths). */
  xs: number[];
  bar: { x: string; w: string };
  over: { x: string; w: string };
  milestones: { name: string; x: string; o: number; past: boolean }[];
  end: { x: string; on: boolean };
  target: string;
  today: string;
  months: { x: string; label: string; n: number }[];
  stops: { x: string; near: boolean }[];
  handle: string;
}

/**
 * Everything the strip draws at a handle position (Workspace.dc.html:439-493): the plan bar to
 * min(forecast, target), the risk overrun past the target, milestone diamonds (lerped, and
 * cross-faded when a milestone exists at only one end), the end diamond, the target flag, the
 * today line, month ticks, check-in stops and the handle.
 */
export function buildStrip({ startN, targetN, todayN, snaps, pos }: StripInput): StripModel {
  const axis = axisOf(startN, targetN, todayN, snaps);
  const interp = interpolate(snaps, pos);
  const { a, b, t, fNow } = interp;
  const at = (n: number) => pct(axis, n);
  const risk = fNow != null && fNow > targetN + 0.5;
  const names = milestoneNames(snaps);
  const xs = stopXs(axis, snaps);
  const barEnd = fNow != null ? Math.min(fNow, targetN) + 1 : targetN + 1;
  const milestones = names.map((name) => {
    const ma = a.ms.find((x) => x.name === name);
    const mb = b.ms.find((x) => x.name === name);
    const n = ma && mb ? ma.n + (mb.n - ma.n) * t : ((mb ?? ma)?.n ?? 0);
    return { name, x: at(n + 0.5), o: (ma ? 1 - t : 0) + (mb ? t : 0), past: n < todayN };
  });
  const x0 = xs[interp.i0] ?? 0;
  const x1 = xs[interp.i1] ?? x0;
  return {
    axis,
    interp,
    risk,
    names,
    xs,
    bar: { x: at(startN), w: `calc(${at(barEnd)} - ${at(startN)})` },
    over: { x: at(targetN + 1), w: risk ? `calc(${at(fNow + 1)} - ${at(targetN + 1)})` : '0%' },
    milestones,
    end: { x: fNow != null ? at(fNow + 0.5) : '0%', on: fNow != null },
    target: at(targetN + 1),
    today: at(todayN + 0.5),
    months: monthTicks(axis).map((m) => ({ ...m, x: at(m.n) })),
    stops: snaps.map((snap, k) => ({ x: at(snap.date), near: k === interp.nearIndex })),
    handle: `${(x0 + (x1 - x0) * t).toFixed(3)}%`,
  };
}

/** 'Viewing a past check-in' / 'Drag back through N check-ins' / 'One check-in so far' (critique :589). */
export function asOfHint(inHistory: boolean, count: number): string {
  if (inHistory) return 'Viewing a past check-in';
  return count > 1 ? `Drag back through ${String(count)} check-ins` : 'One check-in so far';
}

/** Arrow keys and Home/End on the track: the next stop, as a position (null = live). */
export function stepStop(pos: number | null, count: number, key: string): number | null | undefined {
  const last = count - 1;
  const cur = pos == null ? last : Math.round(pos);
  let next: number;
  if (key === 'ArrowLeft' || key === 'ArrowDown') next = Math.max(0, cur - 1);
  else if (key === 'ArrowRight' || key === 'ArrowUp') next = Math.min(last, cur + 1);
  else if (key === 'Home') next = 0;
  else if (key === 'End') next = last;
  else return undefined;
  return next >= last ? null : next;
}
