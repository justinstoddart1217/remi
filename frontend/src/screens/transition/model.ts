/**
 * Pure view logic for the Transition screen (Transition.dc.html renderVals). The server owns
 * every number: the countdown, the remaining business days and which of them the Private Credit
 * exits still cover, the flags' slots and stagger (`move.flags`), the verdict and its buffer,
 * readiness, deltas and the rotation dates. This module only turns them into copy and geometry.
 */

import type { MoveOut, PlanOut, ProjectOut, ReadinessItemOut, RotationOut, RoutineOut, VerdictOut } from '../../api';
import type { DeltaTone } from '../../components';
import { isoParts } from '../../lib/calendar';
import { delta, dm, l, MONTHS_SHORT, monL, s } from '../../lib/format';
import { NO_PC_SENTENCE } from '../../shell/HeaderBar/headerModel';
import { holidayWord } from '../calendar/model';
import { ruleText, STAGES } from '../routines/model';

/** Copy the design writes for this screen (Transition.dc.html, arch-frontend-screens §5). */
export const COPY = {
  eyebrow: 'Transition',
  question: 'Am I on track to move cleanly?',
  legendRunning: 'Private Credit exits still running',
  legendBuffer: 'Buffer after the last exit',
  windDown: 'Wind-down projects',
  /** D */
  noWindDown: 'No Private Credit projects left to wind down.',
  routines: 'Routines by handover status',
  /** N */
  noRoutines: 'No routines to hand over.',
  onboarding: 'Onboarding readiness',
  /** N */
  noOnboarding: 'No onboarding items yet.',
  /** N: onboarding items belong to a Fixed Income project, and there is none yet. */
  noOnboardingHost: 'No onboarding items yet. They belong to a Fixed Income project, so start one first.',
  startFiProject: 'Start a Fixed Income project',
  onboardingPlaceholder: 'Name an onboarding item',
  firstRotation: 'First rotation',
  /** N */
  noRotation: 'No rotation yet. Set it up to see where each country falls after the move.',
  setUpRotation: 'Set up the rotation',
  afterDayOne: 'After day one',
  /** N */
  nothingAfter: 'Nothing planned after day one yet.',
  untitledRoutine: 'Untitled routine',
  saveFailed: 'Couldn’t save that. Try again.',
} as const;

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

// ------------------------------------------------------------------------------------ hero

/** '61' and 'business days to Fixed Income'. */
export function countdownLabel(n: number): string {
  return `${plural(n, 'business day')} to Fixed Income`;
}

/** 'Monday 4 January 2027'. */
export function longDate(iso: string): string {
  return `${l(iso)} ${String(isoParts(iso).y)}`;
}

/**
 * A name in running text: 'Returns pipeline' reads 'the returns pipeline', while acronyms and
 * mixed-case words ('ManCo automation', 'PC handover playbook') keep their capitals.
 */
export function inSentence(name: string): string {
  return name.replace(/^([A-Z])([a-z]+)\b/, (_m, first: string, rest: string) => first.toLowerCase() + rest);
}

/** The verdict sentence under the answer (Remi.dc.html buildModel), from the server's verdict. */
export function verdictSentence(
  verdict: Pick<VerdictOut, 'state' | 'bufferBd' | 'keyRun' | 'toRunBd' | 'keyProjectId'>,
  moveDate: string,
  keyProject: Pick<ProjectOut, 'short' | 'name' | 'forecastDate'> | null,
): string {
  const move = dm(moveDate);
  const key = keyProject ? inSentence(keyProject.short || keyProject.name) : null;
  const run = verdict.keyRun;
  switch (verdict.state) {
    case 'no_pc':
      return NO_PC_SENTENCE;
    case 'off_track':
      return `A Private Credit exit now lands on or after ${move}. Something has to be cut, automated later, or handed over as it stands.`;
    case 'at_risk':
      return key && run
        ? `Every Private Credit exit still lands before ${move}, but the ${key} now misses the ${monL(run)} run on ${s(run)}, the last one your successor can shadow with you there.`
        : `Every Private Credit exit still lands before ${move}, but the key run is at risk.`;
    case 'on_track':
    case 'on_track_narrowly': {
      const buffer = verdict.bufferBd ?? 0;
      const first = `Every Private Credit exit lands before ${move}, with ${String(buffer)} ${plural(buffer, 'business day')} to spare.`;
      const toRun = verdict.toRunBd;
      if (!key || !run || toRun === null || !keyProject?.forecastDate) return first;
      return `${first} The one to watch is the ${key}: forecast ${s(keyProject.forecastDate)}, ${String(toRun)} ${plural(toRun, 'business day')} before the ${monL(run)} run your successor needs to shadow.`;
    }
  }
}

// ----------------------------------------------------------------------------------- strip

export interface Tick {
  iso: string;
  running: boolean;
  /** 'Tue 6 Oct · BD4' (the native tooltip). */
  title: string;
}

export interface Flag {
  key: string;
  /** '68.852%': the block boundary the stick stands on. */
  x: string;
  label: string;
  tone: 'ink' | 'risk' | 'muted' | 'move';
  /** A flag at the strip's end (the Move flag, or a forecast at or after it) hangs its label to the left of the stick. */
  end: boolean;
  liftPx: number;
  stickPx: number;
}

export interface MonthMark {
  key: string;
  x: string;
  /** 'November'. */
  label: string;
}

export interface StripModel {
  ticks: Tick[];
  flags: Flag[];
  months: MonthMark[];
}

const pct = (k: number, n: number) => `${(n ? (k / n) * 100 : 0).toFixed(3)}%`;

/**
 * The strip legend's note (Transition.dc.html:53), with the region's word for the holidays it
 * leaves out: 'bank holidays' in England and Wales (the design), 'public holidays' elsewhere
 * (the calendar's holidayWord).
 */
export function legendNote(region: string | null | undefined): string {
  return `One block per remaining business day; ${holidayWord(region).toLowerCase()}s left out.`;
}

// ---------------------------------------------------------------------------- flag labels

/** A flag label as drawn: its stick's x and the label's measured box (px). */
export interface FlagBox {
  x: number;
  width: number;
  height: number;
  /** The label's bottom above the ticks as the server placed it (stick + lift). */
  bottom: number;
  /** Hangs to the left of its stick (a flag at the strip's end). */
  end: boolean;
}

export interface FlagPlace {
  /** The label's bottom above the ticks (px). */
  bottom: number;
  end: boolean;
}

/** Label rows: the server's two (12px and 44px, stick + lift) and the 16px steps around them. */
const FLAG_ROW_BASE = 12;
const FLAG_ROW_STEP = 16;
const FLAG_ROWS = 10;
/** Clear space between two labels on one row. */
const FLAG_GAP_PX = 6;

/**
 * Keeps flag labels from printing over each other or off the strip. The server alternates two
 * label heights by sorted index (ADR-0007, the prototype's rule), which is enough while flags
 * are spread out; forecasts cluster near the move, so a few more Private Credit projects put
 * several labels on the same spot. Each label, in the server's order, keeps its own row when it
 * is clear there, and otherwise takes the nearest clear row (lower first). A label that would
 * run past the strip's right edge hangs left of its stick instead (and one past the left edge
 * hangs right). Nothing moves when nothing collides, so the design's layout is unchanged.
 */
export function placeFlagLabels(boxes: readonly FlagBox[], stripWidth: number): FlagPlace[] {
  const placed: { l: number; r: number; bottom: number; top: number }[] = [];
  const rows = Array.from({ length: FLAG_ROWS }, (_, k) => FLAG_ROW_BASE + k * FLAG_ROW_STEP);
  return boxes.map((b) => {
    // Not laid out yet (or not measurable): the server's placement.
    if (stripWidth <= 0 || b.width <= 0) return { bottom: b.bottom, end: b.end };
    let end = b.end;
    if (!end && b.x + b.width > stripWidth) end = true;
    else if (end && b.x - b.width < 0) end = false;
    const l = end ? b.x - b.width : b.x;
    const r = l + b.width;
    const clear = (bottom: number) =>
      placed.every((p) => p.r + FLAG_GAP_PX <= l || r + FLAG_GAP_PX <= p.l || p.top <= bottom || bottom + b.height <= p.bottom);
    const candidates = [b.bottom, ...[...rows].sort((a, c) => Math.abs(a - b.bottom) - Math.abs(c - b.bottom) || a - c)];
    const bottom = candidates.find(clear) ?? b.bottom;
    placed.push({ l, r, bottom, top: bottom + b.height });
    return { bottom, end };
  });
}

/** The business-day strip: one block per remaining day, the flags above, the months below. */
export function stripModel(
  move: Pick<MoveOut, 'remaining' | 'flags'>,
  projects: readonly Pick<ProjectOut, 'id' | 'short' | 'name'>[],
): StripModel {
  const n = move.remaining.length;
  const ticks = move.remaining.map((d): Tick => ({ iso: d.iso, running: d.pcRunning, title: `${s(d.iso)} · BD${String(d.bdm)}` }));
  const byId = new Map(projects.map((p) => [p.id, p]));
  const flags = move.flags.map((f): Flag => {
    // The Move flag hangs its label to the left of its stick (Transition.dc.html:157). A PC
    // forecast at or after the move also stands at the end; the prototype wrote its x as
    // '100.000%', so its label ran off the strip. Here it hangs left too (a deliberate fix).
    const base = { liftPx: f.liftPx, stickPx: f.stickPx, end: n > 0 && f.slot >= n };
    if (f.kind === 'move') return { ...base, key: 'move', x: n ? pct(f.slot, n) : '100.000%', label: 'Move', tone: 'move', end: true };
    if (f.kind === 'key_run') {
      return { ...base, key: 'key-run', x: pct(f.slot, n), label: `${MONTHS_SHORT[isoParts(f.iso).m - 1] ?? ''} run`, tone: 'muted' };
    }
    const p = f.projectId ? byId.get(f.projectId) : undefined;
    const name = p ? p.short || p.name : '';
    return {
      ...base,
      key: `project-${f.projectId ?? f.iso}`,
      x: pct(f.slot, n),
      label: `${name} · ${dm(f.iso)}`,
      tone: f.atRisk ? 'risk' : 'ink',
    };
  });
  const months: MonthMark[] = [];
  move.remaining.forEach((d, k) => {
    const prev = move.remaining[k - 1];
    if (!prev || isoParts(prev.iso).m !== isoParts(d.iso).m) months.push({ key: d.iso.slice(0, 7), x: pct(k, n), label: monL(d.iso) });
  });
  return { ticks, flags, months };
}

// ---------------------------------------------------------------------------- Private Credit

export interface WindDownRow {
  id: string;
  name: string;
  /** 0-100, the fill's width. */
  ready: number;
  /** '60%'. */
  readyLabel: string;
  /** '2 Dec', or '—' without a forecast. */
  forecast: string;
  /** '+3 BD', 'On target', 'No forecast'. */
  chip: string;
  tone: DeltaTone;
}

/** 'N project(s)'. */
export function projectCount(n: number): string {
  return `${String(n)} ${plural(n, 'project')}`;
}

export function windDownRows(projects: readonly ProjectOut[]): WindDownRow[] {
  return projects
    .filter((p) => p.domain === 'pc')
    .map((p) => {
      const ready = Math.max(0, Math.min(100, Math.round(p.derived.readinessPct ?? 0)));
      return {
        id: p.id,
        name: p.name,
        ready,
        readyLabel: `${String(ready)}%`,
        forecast: p.forecastDate ? dm(p.forecastDate) : '—',
        chip: delta(p.derived.deltaBd),
        tone: p.derived.status === 'risk' ? 'risk' : 'neutral',
      };
    });
}

export interface HandoverRow {
  id: string;
  name: string;
  note: string;
  status: string;
}

/** Every routine, handed over or not (crit Transition:166); the note falls back to the rule. */
export function handoverRows(routines: readonly RoutineOut[]): HandoverRow[] {
  return routines.map((r) => ({
    id: r.id,
    name: r.name || COPY.untitledRoutine,
    note: [r.transitionNote, r.statusNote].find((x) => x?.trim()) ?? ruleText(r.rule),
    status: STAGES[r.stage],
  }));
}

// ----------------------------------------------------------------------------- Fixed Income

/**
 * The FI project whose onboarding items the column lists: the first FI project with items,
 * else the first FI project that lands by the move (the one to add them to), else the first.
 */
export function onboardingHost(projects: readonly ProjectOut[], moveDate: string): ProjectOut | null {
  const fi = projects.filter((p) => p.domain === 'fi');
  return (
    fi.find((p) => p.readinessItems.length > 0) ??
    fi.find((p) => p.forecastDate !== null && p.forecastDate <= moveDate) ??
    fi[0] ??
    null
  );
}

export interface OnboardingItem {
  id: string;
  text: string;
  done: boolean;
  dueDate: string | null;
}

export function onboardingItems(items: readonly ReadinessItemOut[]): OnboardingItem[] {
  return [...items]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((x) => ({ id: x.id, text: x.text, done: x.done, dueDate: x.dueDate }));
}

/** The right-hand note: 'done', the due date ('Fri 30 Oct'), or nothing. */
export function dueLabel(done: boolean, dueDate: string | null): string {
  return done ? 'done' : dueDate ? s(dueDate) : '';
}

/** '2 of 5 ready'. */
export function readyCount(items: readonly { done?: boolean }[]): string {
  return `${String(items.filter((x) => x.done).length)} of ${String(items.length)} ready`;
}

/**
 * The note under the list: when the host project's forecast lands against the move, then the
 * item that tests it all ('The dry run on Thu 17 Dec is the real test.').
 */
export function onboardingNote(
  host: Pick<ProjectOut, 'forecastDate'>,
  items: readonly Pick<ReadinessItemOut, 'text' | 'done' | 'dueDate'>[],
  moveDate: string,
): string {
  const f = host.forecastDate;
  const first = !f
    ? 'No forecast yet.'
    : f === moveDate
      ? `Forecast ready ${s(f)}, the day of the move.`
      : f < moveDate
        ? `Forecast ready ${s(f)}, before the move.`
        : `Forecast ready ${s(f)}, after the move.`;
  const pending = items.filter((x) => !x.done && x.dueDate).sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  const dryRun = pending.find((x) => /\bdry run\b/i.test(x.text));
  if (dryRun?.dueDate) return `${first} The dry run on ${s(dryRun.dueDate)} is the real test.`;
  const last = pending[pending.length - 1];
  if (last?.dueDate) return `${first} Last to land: ${last.text}, ${s(last.dueDate)}.`;
  if (items.length > 0 && items.every((x) => x.done)) return `${first} Every item is ready.`;
  return first;
}

export interface FirstTile {
  id: string;
  code: string;
  country: string;
  pass: 'Build' | 'Refresh';
  /** '4 Jan – 11 Jan'. */
  dates: string;
  current: boolean;
}

export interface FirstRotation {
  tiles: FirstTile[];
  /** 'starts on day one'. */
  starts: string;
  /** 'Whole rotation, loop 1 ends Mon 8 Mar'. */
  link: string;
}

export function firstRotation(rotation: RotationOut, moveDate: string): FirstRotation | null {
  const segments = [...rotation.segments].sort((a, b) => a.order - b.order);
  if (segments.length === 0) return null;
  const cur = rotation.current;
  const tiles = segments
    .slice(0, 3)
    .map((g, k): FirstTile => ({
      id: g.id,
      code: g.code,
      country: g.country,
      pass: g.pass,
      dates: `${dm(g.start)} – ${dm(g.end)}`,
      current: cur.status === 'active' ? g.id === cur.segmentId : k === 0,
    }));
  const start = rotation.startDate;
  const starts = rotation.startFollowsMove || !start || start === moveDate ? 'starts on day one' : `starts ${s(start)}`;
  return { tiles, starts, link: rotation.loopEnd ? `Whole rotation, loop 1 ends ${s(rotation.loopEnd)}` : 'Whole rotation' };
}

export interface AfterRow {
  id: string;
  name: string;
  note: string;
  /** 'Target Late Mar 2027'. */
  target: string;
}

/** The FI projects after day one: every FI project but the onboarding one. */
export function afterDayOneRows(projects: readonly ProjectOut[], hostId: string | null): AfterRow[] {
  return projects
    .filter((p) => p.domain === 'fi' && p.id !== hostId)
    .map((p) => ({
      id: p.id,
      name: p.name,
      note: p.afterDayOneNote ?? (p.forecastDate ? `Forecast ${s(p.forecastDate)}.` : 'In Define. No plan yet.'),
      target: `Target ${p.targetLabel ?? s(p.targetDate)}`,
    }));
}

/** The key project the verdict watches (Settings), if it still exists. */
export function keyProjectOf(plan: Pick<PlanOut, 'verdict' | 'projects'>): ProjectOut | null {
  const id = plan.verdict.keyProjectId;
  return id ? (plan.projects.find((p) => p.id === id) ?? null) : null;
}
