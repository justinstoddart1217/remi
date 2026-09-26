/**
 * Pure Tell Remi logic (CheckIn.dc.html renderVals), kept apart from the component so it can be
 * tested: the echo sentences, word count and hints, the prefill, review grouping and row
 * formats, and the EffectChip text. Every forecast figure comes from the server's preview
 * (`POST /checkins/preview`); nothing here computes a date.
 */

import type { AiStatusOut, CheckinChange, ProjectOut, ProjectPreviewOut, ProposalOut, RoutineOut } from '../../api';
import { DOMAIN_ACCENT } from '../../components/shared/domain';
import { count, dm, num, s } from '../../lib/format';
import type { DrawerPrefill } from '../../stores/overlays';
import {
  BAU_GROUP,
  FOOT_OTHER,
  FOOT_REVIEW,
  FOOT_THINKING,
  HINT_EMPTY,
  HINT_REVIEW,
  KIND,
  NOTHING_SELECTED,
  SIMPLE_NOTE,
  SUMMARY_FALLBACK,
} from './copy';

export type Phase = 'compose' | 'thinking' | 'review' | 'error';

/** The thinking phase lasts at least this long, so the echo quotes never flash (arch §3). */
export const MIN_DWELL_MS = 600;

/**
 * The provider dot beside the title (`GET /ai/status`): which reader Tell Remi uses, and
 * whether it can answer. Only its tooltip and accessible name carry text.
 */
export function providerIndicator(status: AiStatusOut | undefined): { state: 'offline' | 'ai' | 'unavailable'; label: string } {
  if (!status || status.provider === 'none') {
    return { state: 'offline', label: 'Simple reading: works offline, and nothing leaves this computer.' };
  }
  const name = status.provider === 'anthropic' ? 'Anthropic' : 'Ollama';
  const model = status.model ? ` (${status.model})` : '';
  if (!status.available) {
    return {
      state: 'unavailable',
      label: `${name}${model} is not available${status.reason ? `: ${status.reason}` : ''}. Use a simple reading instead.`,
    };
  }
  return {
    state: 'ai',
    label: status.egress
      ? `Reads with ${name}${model}. Your update is sent to ${name}.`
      : `Reads with ${name}${model} on this computer.`,
  };
}

/** The prototype's sentence split: after . ! ? followed by space, or at newlines. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** At most five sentences are echoed while Remi reads. */
export const ECHO_MAX = 5;

export function echoOf(text: string): string[] {
  return splitSentences(text.trim()).slice(0, ECHO_MAX);
}

export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** The line under the textarea (crit :312). */
export function hintFor(phase: Phase, text: string): string {
  if (phase === 'review') return HINT_REVIEW;
  const words = wordCount(text);
  return words ? count(words, 'word') : HINT_EMPTY;
}

/** The footer note (crit :319). */
export function footNoteFor(phase: Phase): string {
  if (phase === 'review') return FOOT_REVIEW;
  if (phase === 'thinking') return FOOT_THINKING;
  return FOOT_OTHER;
}

/**
 * The composer's starting text: Notes hands over the day's text; the palette's quick add
 * starts a scope sentence ("New scope on Returns pipeline, about 6h: ").
 */
export function prefillText(prefill: DrawerPrefill | null, projectShort: string | null): string {
  if (!prefill) return '';
  if ('text' in prefill) return prefill.text;
  return `New scope on ${projectShort ?? 'this project'}, about ${num(prefill.scopeH)}h: `;
}

/** "Apply 3 changes" / "Apply 1 change" / "Nothing selected". */
export function applyLabel(n: number): string {
  return n ? `Apply ${String(n)} change${n === 1 ? '' : 's'}` : NOTHING_SELECTED;
}

/** The review header's note: "simple reading", or "7 of 8 selected" for an AI reading. */
export function sourceNote(source: ProposalOut['source'], selected: number, total: number): string {
  return source === 'simple' ? SIMPLE_NOTE : `${String(selected)} of ${String(total)} selected`;
}

export function summaryOf(result: Pick<ProposalOut, 'summary' | 'changes'>): string {
  return result.summary || (result.changes.length ? SUMMARY_FALLBACK : '');
}

// ------------------------------------------------------------------------------------ rows

function projectTasks(project: ProjectOut) {
  return project.milestones.flatMap((m) => m.tasks);
}

/** "Fri 18 Dec", or the fuzzy label ("Late Mar 2027") when the project has one. */
function targetText(project: ProjectOut): string {
  return project.targetLabel ?? s(project.targetDate);
}

/**
 * " (ticks all 12 funds)" for a routine with a checklist. The detail is used when it counts the
 * items ("12 funds"); otherwise the item count.
 */
function ticksAll(routine: RoutineOut): string {
  const n = routine.checklistItems.length;
  if (!n) return '';
  const detail = routine.detail.trim();
  const counted = new RegExp(`^${String(n)}\\s`).test(detail) ? detail : count(n, 'item');
  return ` (ticks all ${counted})`;
}

/** One review row's text (crit :268-277). */
export function rowText(change: CheckinChange, project: ProjectOut | null, routine: RoutineOut | null): string {
  switch (change.type) {
    case 'task_done': {
      const task = project ? projectTasks(project).find((t) => t.id === change.taskId) : undefined;
      return task ? task.text : change.taskId;
    }
    case 'task_add':
      return `${change.text} · ${num(change.hours)}h, added to Now`;
    case 'scope_add':
      return `${change.text} · +${num(change.hours)}h`;
    case 'confidence':
      return `${project?.confidence != null ? String(project.confidence) : '—'} → ${String(change.value)} of 5`;
    case 'target_move':
      return `${project ? targetText(project) : '—'} → ${s(change.date)}`;
    case 'hours_per_day':
      return `${project ? num(project.rate) : '—'}h → ${num(change.value)}h a day`;
    case 'bau_done':
      return `${routine ? routine.name : change.routineId}, today’s run${routine ? ticksAll(routine) : ''}`;
    case 'blocker':
    case 'note':
      return change.text;
  }
}

/** Blockers and new scope get the risk tint on their KIND label (crit :299). */
export function isRiskKind(type: CheckinChange['type']): boolean {
  return type === 'blocker' || type === 'scope_add';
}

export interface ReviewRow {
  /** Position in the proposal's `changes` (the toggle key). */
  index: number;
  change: CheckinChange;
  kind: string;
  risk: boolean;
  text: string;
  on: boolean;
}

export interface ReviewGroup {
  /** The project id, or 'bau' for routine runs. */
  key: string;
  projectId: string | null;
  name: string;
  accent: string;
  rows: ReviewRow[];
  /** A ticked target move (the chip then says "forecast holds" when nothing slips). */
  targetMoved: boolean;
}

/**
 * Rows grouped per project, in order of first appearance; routine runs go under
 * "BAU · today" (CheckIn.dc.html renderVals `groupsMap`).
 */
export function groupChanges(
  changes: readonly CheckinChange[],
  off: Readonly<Record<number, boolean | undefined>>,
  projects: readonly ProjectOut[],
  routines: readonly RoutineOut[],
): ReviewGroup[] {
  const byProject = new Map(projects.map((p) => [p.id, p]));
  const byRoutine = new Map(routines.map((r) => [r.id, r]));
  const groups = new Map<string, ReviewGroup>();
  changes.forEach((change, index) => {
    const projectId = change.type === 'bau_done' ? null : change.projectId;
    const key = projectId ?? 'bau';
    const project = projectId ? (byProject.get(projectId) ?? null) : null;
    const routine = change.type === 'bau_done' ? (byRoutine.get(change.routineId) ?? null) : null;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        projectId,
        name: projectId ? (project?.name ?? projectId) : BAU_GROUP,
        accent: project ? DOMAIN_ACCENT[project.domain] : routine ? DOMAIN_ACCENT[routine.domain] : DOMAIN_ACCENT.pc,
        rows: [],
        targetMoved: false,
      };
      groups.set(key, group);
    }
    const on = !off[index];
    if (on && change.type === 'target_move') group.targetMoved = true;
    group.rows.push({ index, change, kind: KIND[change.type], risk: isRiskKind(change.type), text: rowText(change, project, routine), on });
  });
  return [...groups.values()];
}

/** The ticked changes, in proposal order. */
export function selectedChanges(changes: readonly CheckinChange[], off: Readonly<Record<number, boolean | undefined>>): CheckinChange[] {
  return changes.filter((_, i) => !off[i]);
}

// ------------------------------------------------------------------------------ effect chip

export interface EffectChip {
  text: string;
  /** Risk styling: the new forecast lands after the target. */
  late: boolean;
}

/**
 * The group's EffectChip from the server preview (CheckIn.dc.html renderVals `effect`):
 * - the forecast moves: "2 Dec → 7 Dec · +3 BD" (risk-tinted when it lands after the target);
 * - it holds but the target moved: "forecast holds", or "now N BD past target", where N is the
 *   preview's `pastTargetBd` (the server counts the business days);
 * - otherwise no chip. Projects without a forecast never get one.
 */
export function effectChip(preview: ProjectPreviewOut | undefined, targetMoved: boolean): EffectChip | null {
  if (!preview?.from || !preview.to) return null;
  if (preview.deltaBd !== 0) {
    return { text: `${dm(preview.from)} → ${dm(preview.to)} · ${preview.label}`, late: preview.late };
  }
  if (!targetMoved) return null;
  if (!preview.late) return { text: 'forecast holds', late: false };
  const n = preview.pastTargetBd;
  return { text: n != null ? `now ${String(n)} BD past target` : 'now past target', late: false };
}
