/**
 * The workspace's words (Workspace.dc.html panel() and renderVals, with the stat copy the
 * critique adds for :407-413). Pure: every number comes from the server's `derived` block;
 * this only formats it. The verdict sentence is rendered from `sentence.case` and its params.
 */

import type { ProjectOut } from '../../api';
import { delta as deltaLabel, dm, num, s as short, since } from '../../lib/format';

/** The prototype's `hr`: one decimal place ('3.8', '10.5', '3'). */
export function hr(x: number | null | undefined): string {
  return String(Math.round((x ?? 0) * 10) / 10);
}

/** The prototype's `hrs`: two decimal places plus 'h' ('14h', '5.5h'). */
export function hrs(x: number): string {
  return `${num(x)}h`;
}

export type SentenceTone = 'faint' | 'ink' | 'risk' | 'overload';

export interface SentenceModel {
  text: string;
  /** The 8px dot: ink-faint (no plan), ink (buffer), risk (late / no buffer), overload (after the move). */
  tone: SentenceTone;
  /** The forecast cell takes the 7% risk tint. */
  late: boolean;
}

export const NO_PLAN_SENTENCE = 'No plan yet. Enter the work left and hours a day, and Remi works out when it lands.';

/** 'Fri 27 Nov', or the fuzzy label ('Late Mar 2027'). */
export function targetShort(p: Pick<ProjectOut, 'targetLabel' | 'targetDate'>): string {
  return p.targetLabel ?? short(p.targetDate);
}

/**
 * The second half of the 'late' sentence. The prototype always wrote "plan {need}h a day" and
 * its hr(null) printed 0 (Workspace.dc.html:399), but the need solver has no rate once the
 * target has passed or when no day before it takes planned hours (`derived.need.state`, the
 * same state the "To land on target" stat reads). Then no rate lands it, so the sentence says
 * what does: move the target, or cut work when cutting some (not all) of it would land it.
 */
function lateRemedy(p: ProjectOut, target: string): string {
  const { params } = p.derived.sentence;
  const need = params.needRate ?? p.derived.need.rate;
  if (need != null) {
    return `To make ${target}, plan ${hr(need)}h a day instead of ${hr(params.rate ?? p.rate)}h, or cut about ${hr(params.cutH)}h of work.`;
  }
  if (p.derived.need.state === 'target_passed') return `${target} has passed, so move the target to replan it.`;
  const cut = params.cutH ?? 0;
  const left = params.workLeftH ?? p.derived.workLeft ?? null;
  const cutHelps = cut > 0 && (left == null || cut < left - 0.05);
  return cutHelps
    ? `More hours a day cannot land it: no day before ${target} takes planned hours. Move the target, or cut about ${hr(cut)}h of work.`
    : `More hours a day cannot land it: no day before ${target} takes planned hours. Move the target.`;
}

/** The progress verdict (Workspace.dc.html:396-404), from the server's case and params. */
export function verdictSentence(p: ProjectOut): SentenceModel {
  const { case: kind, params } = p.derived.sentence;
  const rate = params.rate ?? p.rate;
  const target = targetShort(p);
  let text: string;
  let tone: SentenceTone = 'ink';
  let late = false;
  switch (kind) {
    case 'no_plan':
      // The prototype still adds the stale clause to the no-plan sentence (Workspace.dc.html:403).
      text = NO_PLAN_SENTENCE;
      tone = 'faint';
      break;
    case 'after_move': {
      const move = params.moveDate ? dm(params.moveDate) : 'the move';
      text = `Lands after the move on ${move}. At ${hr(rate)}h a day this does not leave with you; cut ${hr(params.cutH)}h or plan more time.`;
      tone = 'overload';
      late = true;
      break;
    }
    case 'late':
      text = `Lands ${String(params.lateBd ?? 0)} BD after target. ${lateRemedy(p, target)}`;
      tone = 'risk';
      late = true;
      break;
    case 'no_buffer':
      text = `No buffer. It lands on the target day, so any new scope pushes it past ${target}.`;
      tone = 'risk';
      break;
    case 'buffer':
      text = `${String(params.bufferBd ?? 0)} BD of buffer: roughly ${hr(params.scopeH)}h of new scope before the target moves.`;
      break;
  }
  if (params.overDayCount > 0 && params.firstOverDay) {
    const n = params.overDayCount;
    text += ` It sits on ${String(n)} overloaded day${n === 1 ? '' : 's'}, first ${short(params.firstOverDay)}.`;
  }
  if (params.staleDays != null) text += ` Not checked in for ${String(params.staleDays)} days, so treat the forecast as untested.`;
  if (params.startsInBd != null) text += ` Starts in ${String(params.startsInBd)} BD.`;
  return { text, tone, late };
}

export interface NeedModel {
  /** Roll value ('3.8') or '—'. */
  value: string;
  unit: string;
  /** Needs more than the plan (risk 45% into ink). */
  bad: boolean;
  /** '—' with nothing to solve. */
  none: boolean;
  sub: string;
}

/** 'To land on target' (Workspace.dc.html:412-413, critique :407-413). */
export function needModel(p: ProjectOut): NeedModel {
  const need = p.derived.need;
  if (need.rate == null) {
    const sub =
      need.state === 'target_passed'
        ? 'target has passed'
        : need.state === 'no_capacity'
          ? 'no planned hours before the target'
          : 'needs a work estimate';
    return { value: '—', unit: '', bad: false, none: true, sub };
  }
  const bad = need.rate > p.rate + 0.05;
  return {
    value: hr(need.rate),
    unit: 'h a day',
    bad,
    none: false,
    sub: bad ? `${hr(need.rate - p.rate)}h a day more than planned` : `within your ${hr(p.rate)}h a day`,
  };
}

export interface StatsModel {
  start: { roll: string; sub: string };
  target: { roll: string; sub: string };
  forecast: { sub: string };
  rate: { sub: string };
  left: { value: string; sub: string };
  need: NeedModel;
  /** Progress rule fill, '25.862069%'. */
  progress: string;
}

/** The six stat cells' copy (Workspace.dc.html:407-415 and the critique's additions). */
export function statsModel(p: ProjectOut, todayIso: string): StatsModel {
  const d = p.derived;
  const hasF = p.forecastDate != null;
  const startSub = d.started
    ? `${String(d.doneBd)} BD in${d.totalBd ? ` of ${String(d.totalBd)}` : ''}`
    : `starts in ${String(d.startsInBd ?? 0)} BD`;
  const targetSub = d.bdToTarget
    ? `${String(d.bdToTarget)} BD from ${d.started ? 'today' : 'start'}`
    : p.targetDate < todayIso
      ? 'passed'
      : '—';
  const avg = d.avgPlan;
  return {
    start: { roll: short(p.startDate), sub: startSub },
    target: { roll: targetShort(p), sub: targetSub },
    forecast: { sub: hasF ? `${String(d.bdLeft ?? 0)} BD of work left` : 'set work left to get one' },
    rate: {
      sub:
        hasF && avg != null && Math.abs(avg - p.rate) > 0.2 ? `averages ${hr(avg)}h once BAU days are counted` : 'planned focus time',
    },
    left: {
      value: d.workLeftDisplay == null ? '' : num(d.workLeftDisplay),
      sub: hasF ? 'planned between now and the forecast' : 'your estimate of what remains',
    },
    need: needModel(p),
    progress: `${String(Math.min(100, Math.max(0, d.progressPct)))}%`,
  };
}

/** Header chip for a forecast (live or a past snapshot): '+3 BD vs target', 'On target'. */
export function forecastChip(deltaBd: number | null): { label: string; tone: 'risk' | 'neutral' } {
  if (deltaBd == null) return { label: 'No forecast', tone: 'neutral' };
  if (deltaBd === 0) return { label: 'On target', tone: 'neutral' };
  return { label: `${deltaLabel(deltaBd)} vs target`, tone: deltaBd > 0 ? 'risk' : 'neutral' };
}

/** 'Checked in 2 days ago' / 'Checked in never' (critique :580). */
export function checkedInText(sinceDays: number | null): string {
  const label = since(sinceDays);
  return label === 'Not yet' ? 'never' : label.toLowerCase();
}

/** "Plan" header note: 'Drafted after the charter' in Define, else '14h estimated in Now'. */
export function planNote(p: ProjectOut): string {
  return p.derived.status === 'define' ? 'Drafted after the charter' : `${hrs(p.derived.nowEstimateH)} estimated in Now`;
}

/** 'next 2 weeks · 5–16 Oct' (hard-coded in the prototype; computed from today). */
export function nowWindow(todayIso: string, endIso: string | null): string {
  if (!endIso) return 'next 2 weeks';
  const sameMonth = todayIso.slice(0, 7) === endIso.slice(0, 7);
  const from = sameMonth ? String(Number(todayIso.slice(8, 10))) : dm(todayIso);
  return `next 2 weeks · ${from}–${dm(endIso)}`;
}

/** The Remove project button's armed label (critique :602). */
export function removeArmedLabel(name: string): string {
  return `Click again to remove ${name} and its history`;
}

/**
 * A milestone due-date button's name: the milestone, then the date the button shows (each
 * button would otherwise be named by a bare date, 'Fri 16 Oct').
 */
export function dueLabel(m: { name: string; dueDate: string | null }): string {
  const name = m.name.trim() || 'Milestone';
  return m.dueDate ? `${name}, due ${short(m.dueDate)}` : `${name}: Set date`;
}

/** 'Wed 2 Dec' for a forecast ISO date, 'Not yet' without one (Define). */
export function forecastRoll(iso: string | null): string {
  return iso ? short(iso) : 'Not yet';
}

export interface CharterListCopy {
  list: 'success' | 'inScope' | 'outScope' | 'constraints';
  label: string;
  placeholder: string;
  empty: string;
  /** Success measures: the 01/02 index column and 15px lines. */
  numbered?: boolean;
  /** Out of scope: ink-muted until edited. */
  muted?: boolean;
}

/** The four charter lists (Workspace.dc.html:525, critique :525): label, placeholder, empty copy. */
export const CHARTER_LISTS: readonly CharterListCopy[] = [
  {
    list: 'success',
    label: 'Success measures',
    placeholder: 'A measurable outcome',
    empty: 'How will you know it worked?',
    numbered: true,
  },
  { list: 'inScope', label: 'In scope', placeholder: 'Something this includes', empty: 'Not written yet. What must it do?' },
  {
    list: 'outScope',
    label: 'Out of scope',
    placeholder: 'Something you will refuse',
    empty: 'Not written yet. What will you refuse to build?',
    muted: true,
  },
  { list: 'constraints', label: 'Constraints', placeholder: 'A limit to respect', empty: 'None noted yet.' },
];
