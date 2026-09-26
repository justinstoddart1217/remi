/**
 * The first-run wizard's draft (ADR-0010): what the four steps collect, how complete each step
 * is, and the `POST /setup` body. Pure functions only; the server owns every business number
 * (the countdown comes from `GET /setup/countdown`, holidays from `GET /calendar`).
 */

import type { Schemas, SetupStatusOut } from '../../api';
import { isIsoDate } from '../../lib/calendar';
import { count } from '../../lib/format';
import { rotationSummary, segmentsIn, segmentsValid } from './rotation/model';
import type { SegmentDraft } from './rotation/model';

export type HolidayRegion = Schemas['SetupIn']['holidayRegion'];
export type AiProvider = NonNullable<Schemas['SetupIn']['aiProvider']>;

export interface SetupDraft {
  /** The move date the picker chose (already snapped forward to a business day), or null. */
  moveDate: string | null;
  hoursPerDay: number;
  region: HolidayRegion;
  timezone: string;
  segments: readonly SegmentDraft[];
  rotationHoursPerDay: number;
  provider: AiProvider;
}

/** The defaults the backend sends before setup, or these when it has not answered in full. */
export const FALLBACK_DEFAULTS: SetupStatusOut['defaults'] = {
  timezone: 'Europe/London',
  holidayRegion: 'GB-ENG',
  capacityHoursPerDay: 8,
  aiProvider: 'none',
  rotationHoursPerDay: 4,
};

export function initialDraft(defaults: SetupStatusOut['defaults'] | null | undefined): SetupDraft {
  const d = defaults ?? FALLBACK_DEFAULTS;
  return {
    moveDate: null,
    hoursPerDay: d.capacityHoursPerDay,
    region: d.holidayRegion,
    timezone: d.timezone,
    segments: [],
    rotationHoursPerDay: d.rotationHoursPerDay,
    provider: d.aiProvider,
  };
}

/** The four steps, in order. */
export const STEPS = [
  { id: 'move', number: '01', title: 'The move' },
  { id: 'day', number: '02', title: 'Your working day' },
  { id: 'rotation', number: '03', title: 'Fixed Income rotation' },
  { id: 'ai', number: '04', title: 'Tell Remi' },
] as const;

export type StepId = (typeof STEPS)[number]['id'];

/**
 * - `done`: the step has what it needs;
 * - `todo`: it still needs something before Remi can start (only the move date is required);
 * - `optional`: nothing entered and nothing required (the rotation, skipped for now);
 * - `invalid`: something entered that the server would refuse (an unfinished country).
 */
export type StepState = 'done' | 'todo' | 'optional' | 'invalid';

export function stepStates(draft: SetupDraft): Record<StepId, StepState> {
  const rotation: StepState =
    draft.segments.length === 0 ? 'optional' : segmentsValid(draft.segments) ? 'done' : 'invalid';
  return {
    move: draft.moveDate && isIsoDate(draft.moveDate) ? 'done' : 'todo',
    day: draft.timezone.trim() ? 'done' : 'todo',
    rotation,
    ai: 'done',
  };
}

/** Why the start button is not ready yet, or null when it is. */
export function blockingReason(draft: SetupDraft): string | null {
  const states = stepStates(draft);
  if (states.move !== 'done') return 'Choose your move date to start.';
  if (states.day !== 'done') return 'Choose your time zone to start.';
  if (states.rotation === 'invalid') return 'Finish or remove the unfinished country in the rotation.';
  return null;
}

export const PROVIDER_LABELS: Readonly<Record<AiProvider, string>> = {
  none: 'None',
  anthropic: 'Anthropic',
  ollama: 'Ollama',
};

/** What each provider means, in the rail and under the provider control. */
export const PROVIDER_SUMMARY: Readonly<Record<AiProvider, string>> = {
  none: 'Simple reading, offline',
  anthropic: 'Anthropic, with your key',
  ollama: 'Ollama, on this computer',
};

export interface RegionOption {
  code: HolidayRegion;
  label: string;
}

/** The backend's regions when it has not said (HolidayRegion's enum). */
export const DEFAULT_REGIONS: readonly RegionOption[] = [
  { code: 'GB-ENG', label: 'England and Wales' },
  { code: 'ZA', label: 'South Africa' },
];

/**
 * The privacy note under the provider (ADR-0004, decision 3): what leaves this computer with
 * each choice. Only Anthropic sends anything off it, and never goals, charters or risks
 * (services/ai/context.py); recent notes go only when the user turns that on. Remi runs on a
 * Mac or a Windows PC, so the copy says "this computer".
 */
export const PROVIDER_NOTE: Readonly<Record<AiProvider, string>> = {
  none: 'Simple reading works offline. Nothing leaves this computer unless you choose a provider.',
  anthropic:
    'Each check-in, with the plan it reads, goes to Anthropic. Goals, charters and risks never do, and recent notes only if you choose to send them.',
  ollama: 'Ollama reads your check-ins on this computer, so nothing leaves it.',
};

/** 'England and Wales' → 'England & Wales' (the segmented control's short form). */
export function regionLabel(label: string): string {
  return label.replace(/\s+and\s+/i, ' & ');
}

/** The rail's one-line summary of each step. */
export function stepSummaries(
  draft: SetupDraft,
  opts: { countdownBd: number | null; moveLabel: string | null; regionName: string },
): Record<StepId, string> {
  const move =
    draft.moveDate && opts.moveLabel
      ? opts.countdownBd != null
        ? `${opts.moveLabel} · ${count(opts.countdownBd, 'business day')}`
        : opts.moveLabel
      : 'Not chosen yet';
  const segs = draft.segments;
  return {
    move,
    day: `${formatHoursShort(draft.hoursPerDay)} a day · ${opts.regionName} · ${draft.timezone}`,
    rotation: segs.length === 0 ? 'Skipped for now' : rotationSummary(segs),
    ai: PROVIDER_SUMMARY[draft.provider],
  };
}

/** '8h', '7.5h'. */
export function formatHoursShort(h: number): string {
  return `${String(Math.round(h * 100) / 100)}h`;
}

/** The `POST /setup` body. The rotation is left out (null) when no country was added. */
export function toSetupIn(draft: SetupDraft): Schemas['SetupIn'] {
  if (!draft.moveDate) throw new Error('A move date is required');
  const segments = segmentsIn(draft.segments);
  return {
    moveDate: draft.moveDate,
    timezone: draft.timezone.trim(),
    holidayRegion: draft.region,
    capacityHoursPerDay: draft.hoursPerDay,
    aiProvider: draft.provider,
    aiModel: null,
    motionPreference: 'system',
    rotation: segments.length > 0 ? { hoursPerDay: draft.rotationHoursPerDay, segments } : null,
  };
}
