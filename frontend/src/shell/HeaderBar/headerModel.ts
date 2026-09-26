/**
 * What the top bar's status cluster shows (Remi.dc.html <header>), derived from `GET /plan`:
 * - `today`: 'Mon 5 Oct' (format.s of `plan.today.iso`);
 * - `bd`: 'BD3' (`plan.today.bdm`), empty on a non-business day;
 * - `countdown`: '61', business days strictly between today and the move (ADR-0009);
 * - `verdict`: the word, short form and dot colour for `plan.verdict.state`;
 * - `pinned`: `plan.today.overridden`, the business date moved by `REMI_TODAY`;
 * - `tz`: `plan.today.tz`, the business timezone the live clock reads (clock.ts).
 *
 * The server owns every number; this only formats. Before setup, while the plan loads, or when
 * it cannot be read, the header shows calm placeholders: no date, a dash for the countdown and
 * no verdict. Never sample numbers.
 */

import { planStatusOf, usePlanSelect } from '../../api/queries/plan';
import type { PlanStatus } from '../../api/queries/plan';
import type { PlanOut, VerdictState } from '../../api/types';
import { bd as formatBd, s as formatShortDate } from '../../lib/format';

export type { VerdictState };

export interface VerdictChrome {
  /** The header's phrase: 'Move on track, narrowly'. */
  word: string;
  /** Transition's hero answer: 'Yes, narrowly'. */
  short: string;
  /** CSS colour of the verdict dot (8px, with its ping ring, in the top bar). */
  dot: string;
}

/**
 * Remi.dc.html buildModel's verdict words, short forms and dots. `no_pc` (no Private Credit
 * projects yet, start-empty) is new copy: short 'Not yet' from arch-frontend-screens'
 * empty-state catalogue, with a faint dot because there is nothing to judge.
 */
export const VERDICT_CHROME: Readonly<Record<VerdictState, VerdictChrome>> = {
  off_track: { word: 'Off track for the move', short: 'Not yet', dot: 'var(--overload)' },
  at_risk: { word: 'Move at risk', short: 'At risk', dot: 'var(--risk)' },
  on_track_narrowly: { word: 'Move on track, narrowly', short: 'Yes, narrowly', dot: 'var(--ink)' },
  on_track: { word: 'Move on track', short: 'Yes', dot: 'var(--ink)' },
  no_pc: { word: 'Move not planned yet', short: 'Not yet', dot: 'var(--ink-faint)' },
};

/** The verdict sentence while there are no Private Credit projects (empty-state catalogue). */
export const NO_PC_SENTENCE =
  'Add your Private Credit projects and routines, and Remi works out whether you can move cleanly.';

export type HeaderStatus = PlanStatus;

export interface HeaderModel {
  status: HeaderStatus;
  /** 'Mon 5 Oct' (format.s); '' until the plan is read. */
  today: string;
  /** 'BD3' (format.bd); '' on a non-business day or until the plan is read. */
  bd: string;
  /** '61'; the placeholder dash until the plan is read. */
  countdown: string;
  /** The countdown as a number, or null until the plan is read. */
  countdownBd: number | null;
  verdict: VerdictChrome;
  verdictState: VerdictState | null;
  /** True when `REMI_TODAY` pins the business date (`plan.today.overridden`). */
  pinned: boolean;
  /** The plan's business timezone ('Europe/London'); null until the plan is read. */
  tz: string | null;
}

/** The countdown's placeholder: an em dash, as the design uses for missing values. */
export const COUNTDOWN_PLACEHOLDER = '—';

const QUIET_VERDICT: VerdictChrome = { word: '', short: '', dot: 'transparent' };

/** Calm placeholders: nothing that reads as a real date or number. */
export function placeholderHeader(status: Exclude<HeaderStatus, 'ready'> = 'loading'): HeaderModel {
  return {
    status,
    today: '',
    bd: '',
    countdown: COUNTDOWN_PLACEHOLDER,
    countdownBd: null,
    verdict: QUIET_VERDICT,
    verdictState: null,
    pinned: false,
    tz: null,
  };
}

export const PLACEHOLDER_HEADER: HeaderModel = placeholderHeader('loading');

/** Formats the header from the plan. Pure; the plan's numbers are used as they are. */
export function headerModelFromPlan(plan: Pick<PlanOut, 'today' | 'move' | 'verdict'>): HeaderModel {
  const { today, move, verdict } = plan;
  return {
    status: 'ready',
    today: formatShortDate(today.iso),
    bd: today.isBd && today.bdm != null ? formatBd(today.bdm) : '',
    countdown: String(move.countdownBd),
    countdownBd: move.countdownBd,
    verdict: VERDICT_CHROME[verdict.state],
    verdictState: verdict.state,
    pinned: today.overridden,
    tz: today.tz,
  };
}

export interface DateLineParts {
  /** 'Mon 5 Oct · BD3 ·': the date and BD, with the separator before the verdict. */
  date: string;
  /** 'Move on track, narrowly'; '' before the plan is read. */
  verdict: string;
}

/**
 * The top bar's small-caps line, in the design's two pieces (`Mon 5 Oct · BD3 · {{ verdict.word }}`
 * lays out as two flex items, 8px apart). Only the parts there are: no BD on a weekend or
 * holiday, no verdict before the plan is read, so no stray separator.
 */
export function dateLineParts(model: Pick<HeaderModel, 'status' | 'today' | 'bd' | 'verdict'>): DateLineParts {
  const verdict = model.status === 'ready' ? model.verdict.word : '';
  const date = [model.today, model.bd].filter((part) => part !== '').join(' · ');
  return { date: verdict !== '' && date !== '' ? `${date} ·` : date, verdict };
}

/** The same line as one string: 'Mon 5 Oct · BD3 · Move on track, narrowly'. */
export function dateLine(model: Pick<HeaderModel, 'status' | 'today' | 'bd' | 'verdict'>): string {
  const { date, verdict } = dateLineParts(model);
  return [date, verdict].filter((part) => part !== '').join(' ');
}

/** The header's flag for a pinned date, and its tooltip. */
export const PINNED_DATE_TEXT = 'Pinned date';

export function pinnedDateTitle(today: string): string {
  return `REMI_TODAY is set, so Remi is treating ${today} as today: every count and date follows it. Unset REMI_TODAY and restart Remi to use the real date.`;
}

/**
 * Whether the header flags a pinned date. `REMI_TODAY` moves the business date for tests and
 * demos (ADR-0006). A built app is how Remi runs for real, and there a REMI_TODAY left over from
 * a test session would shift every business-day count, forecast, note and check-in without a
 * word, so the header says so. The Vite dev server (`make dev`, the parity and behaviour runs)
 * pins the date on purpose and keeps the prototype's header.
 */
export function flagsPinnedDate(model: Pick<HeaderModel, 'status' | 'pinned'>, devServer: boolean = import.meta.env.DEV): boolean {
  return model.status === 'ready' && model.pinned && !devServer;
}

const selectHeader = (plan: PlanOut): HeaderModel => headerModelFromPlan(plan);

/** The header's data from the plan query, or placeholders. */
export function useHeaderModel(): HeaderModel {
  const query = usePlanSelect(selectHeader);
  if (query.data) return query.data;
  const status = planStatusOf(query);
  return status === 'ready' || status === 'loading' ? PLACEHOLDER_HEADER : placeholderHeader(status);
}
