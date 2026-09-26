/**
 * Settings (ADR-0010): the pure pieces. The accent pairs, what each section's rail line says,
 * the key project and routine choices, and how a saved rotation hands its new ids back to the
 * draft. The server owns every business number; these only pick and format.
 */

import type { AiStatusOut, Movement, ProjectOut, RoutineOut, SettingsOut } from '../../api';
import { count, s as shortDate } from '../../lib/format';
import type { MotionSetting } from '../../lib/reducedMotion';
import { accentFor } from '../../app/appearance';
import { formatHoursShort, PROVIDER_SUMMARY, regionLabel } from '../setup/model';
import type { StepState } from '../setup/model';
import { rotationSummary } from '../setup/rotation/model';
import type { SegmentDraft } from '../setup/rotation/model';

// ------------------------------------------------------------------------------ appearance

/*
 * The Ninety One accent pairs (Remi.dc.html `accents`, three, the default first) and their
 * names live in app/appearance, which the app root hydrates :root from; the ids are the
 * `:root[data-accent]` values in styles/derived.css.
 */
export { ACCENT_PAIRS, accentById, accentFor, appearanceFromSettings } from '../../app/appearance';
export type { AccentPair } from '../../app/appearance';

export const MOTION_LABELS: Readonly<Record<MotionSetting, string>> = {
  system: 'System',
  full: 'Full',
  reduced: 'Reduced',
};

// ------------------------------------------------------------------------------ key choices

export interface Choice {
  /** null is the "none" choice. */
  value: string | null;
  label: string;
  /** A muted word after the label ('Fixed Income', 'Define'). */
  hint?: string;
  /** Domain dot colour. */
  dot?: string;
}

const DOMAIN_DOT = { pc: 'var(--pc-accent)', fi: 'var(--fi-accent)' } as const;

function byOrder<T extends { sortOrder: number; name: string }>(a: T, b: T): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

/**
 * The key project: Private Credit projects in their order (the verdict is about the move out
 * of Private Credit). A key project in another domain, set elsewhere, stays listed after them.
 */
export function keyProjectChoices(projects: readonly ProjectOut[], currentId: string | null): Choice[] {
  const pcs = projects.filter((p) => p.domain === 'pc').sort(byOrder);
  const current = currentId ? projects.find((p) => p.id === currentId && p.domain !== 'pc') : undefined;
  const list = current ? [...pcs, current] : pcs;
  return [
    ...list.map((p) => ({
      value: p.id,
      label: p.name,
      dot: DOMAIN_DOT[p.domain],
      ...(p.domain === 'pc' ? {} : { hint: 'Fixed Income' }),
    })),
    { value: null, label: 'None' },
  ];
}

/** The key routine: Private Credit routines first, then the rest, each in their order. */
export function keyRoutineChoices(routines: readonly RoutineOut[]): Choice[] {
  const rank = (r: RoutineOut) => (r.domain === 'pc' ? 0 : 1);
  const sorted = [...routines].sort((a, b) => rank(a) - rank(b) || byOrder(a, b));
  return [
    ...sorted.map((r) => ({
      value: r.id,
      label: r.name,
      dot: DOMAIN_DOT[r.domain],
      ...(r.domain === 'fi' ? { hint: 'Fixed Income' } : {}),
    })),
    { value: null, label: 'None' },
  ];
}

// ------------------------------------------------------------------------------ feedback

/** What a plan-shaping save did, for the save note: '2 forecasts moved' or null. */
export function movedNote(out: { movements: readonly Movement[] }): string | null {
  const moved = new Set(out.movements.filter((m) => m.deltaBd !== 0).map((m) => m.projectId)).size;
  return moved > 0 ? `${count(moved, 'forecast')} moved` : null;
}

// ------------------------------------------------------------------------------ AI status

export interface ProviderLine {
  tone: 'ok' | 'wait' | 'off';
  text: string;
}

/** The Anthropic line while no key is set: the key field is the next rows down this page. */
export const NO_KEY_LINE = 'No key yet. Add it below. Until then Remi reads simply.';

/**
 * The Anthropic line when the key is set but this copy of Remi lacks the Anthropic package (the
 * server's reason names an install command, which is for a developer, not this page).
 */
export const NO_SDK_LINE = 'Anthropic reading is not installed in this copy of Remi. Until then Remi reads simply.';

/**
 * One calm line about whether the provider can read a check-in right now. A missing Anthropic
 * key points at the key field below; any other reason is the server's own.
 */
export function aiStatusLine(status: AiStatusOut | undefined, provider: SettingsOut['aiProvider']): ProviderLine | null {
  if (provider === 'none') return null;
  if (status?.provider !== provider) return { tone: 'off', text: 'Checking…' };
  const model = status.model ? ` with ${status.model}` : '';
  const why = (fallback: string) => `${(status.reason ?? fallback).trim().replace(/\.+$/, '')}. Until then Remi reads simply.`;
  if (provider === 'anthropic') {
    if (status.available) return { tone: 'ok', text: `Ready${model}. Check-ins you send go to Anthropic to be read.` };
    if (!status.keySet) return { tone: 'wait', text: NO_KEY_LINE };
    return { tone: 'wait', text: status.sdkInstalled ? why('Not ready') : NO_SDK_LINE };
  }
  const where = status.ollamaBaseUrl.replace(/^https?:\/\//, '');
  return status.available
    ? { tone: 'ok', text: `Ready${model}. Remi asks the Ollama model on this computer at ${where}.` }
    : { tone: 'wait', text: why('Ollama is not answering') };
}

// ------------------------------------------------------------------------------ rail

export type SettingsSectionId = 'move' | 'day' | 'rotation' | 'ai' | 'appearance';

export const SETTINGS_SECTIONS: readonly { id: SettingsSectionId; number: string; title: string }[] = [
  { id: 'move', number: '01', title: 'The move' },
  { id: 'day', number: '02', title: 'Your working day' },
  { id: 'rotation', number: '03', title: 'Fixed Income rotation' },
  { id: 'ai', number: '04', title: 'Tell Remi' },
  { id: 'appearance', number: '05', title: 'Appearance' },
];

export interface RailInput {
  settings: SettingsOut;
  regionName: string;
  countdownBd: number | null;
  segments: readonly SegmentDraft[];
}

/** Each section's one-line summary and state for the rail. */
export function settingsRail(input: RailInput): Record<SettingsSectionId, { summary: string; state: StepState }> {
  const { settings, regionName, countdownBd, segments } = input;
  const move = settings.moveDate;
  const moveLine = move
    ? `${shortDate(move)} ${move.slice(0, 4)}${countdownBd != null ? ` · ${count(countdownBd, 'business day')}` : ''}`
    : 'Not chosen yet';
  const accent = accentFor(settings.accentPc, settings.accentFi);
  const needsKey = settings.aiProvider === 'anthropic' && !settings.aiKeyConfigured;
  return {
    move: { summary: moveLine, state: move ? 'done' : 'todo' },
    day: {
      summary: `${formatHoursShort(settings.capacityHoursPerDay)} a day · ${regionLabel(regionName)} · ${settings.timezone}`,
      state: 'done',
    },
    rotation: {
      summary: segments.length === 0 ? 'Not set up yet' : rotationSummary(segments),
      state: segments.length === 0 ? 'optional' : 'done',
    },
    ai: {
      summary: needsKey ? 'Anthropic, waiting for a key' : PROVIDER_SUMMARY[settings.aiProvider],
      state: needsKey ? 'todo' : 'done',
    },
    appearance: {
      summary: `${accent.name} · display face ${settings.serifDisplay ? 'on' : 'off'} · ${MOTION_LABELS[settings.motionPreference].toLowerCase()} motion`,
      state: 'done',
    },
  };
}

// ------------------------------------------------------------------------------ rotation

/**
 * After `PUT /rotation/segments`, gives each draft entry that was sent without an id the id
 * the server created for it, matched by position in what was sent. The draft keeps its own
 * keys (tiles do not remount) and any edits made while the save was in flight. Returns the
 * same list when nothing changes.
 */
export function assignSavedIds(
  draft: readonly SegmentDraft[],
  sent: readonly SegmentDraft[],
  saved: readonly { id: string }[],
): readonly SegmentDraft[] {
  if (sent.length !== saved.length) return draft;
  const idByKey = new Map<string, string>();
  sent.forEach((seg, i) => {
    const id = saved[i]?.id;
    if (id && seg.id === null) idByKey.set(seg.key, id);
  });
  if (idByKey.size === 0) return draft;
  const next = draft.map((seg) => {
    const id = seg.id === null ? idByKey.get(seg.key) : undefined;
    return id === undefined ? seg : { ...seg, id };
  });
  return next.some((seg, i) => seg !== draft[i]) ? next : draft;
}

/** '4 Jan – 11 Jan' per segment key, from the server's laid-out segments (matched by id). */
export function segmentDates(
  draft: readonly SegmentDraft[],
  laidOut: readonly { id: string; start: string; end: string }[],
  format: (iso: string) => string,
): Record<string, string> {
  const byId = new Map(laidOut.map((s) => [s.id, s]));
  const out: Record<string, string> = {};
  for (const seg of draft) {
    const s = seg.id ? byId.get(seg.id) : undefined;
    if (s) out[seg.key] = `${format(s.start)} – ${format(s.end)}`;
  }
  return out;
}
