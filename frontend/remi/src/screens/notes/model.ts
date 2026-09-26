/**
 * Pure Notes logic (Notes.dc.html renderVals): the rail rows and week headers, the day page's
 * kicker and sub line, the week spark, and the copy that depends on the AI setting. Counts,
 * tags, mentions and previews come from the server (`GET /notes/days`, `GET /notes?day=`); the
 * calendar lookups only read the server's calendar days.
 */

import type { AiStatusOut, NoteDaysOut, NoteListOut, NoteOut } from '../../api';
import { addDays, weekdayOf } from '../../lib/calendar';
import type { CalendarIndex } from '../../lib/calendar';
import { count, d, dm, s, wd } from '../../lib/format';

export type NoteDayOut = NoteDaysOut['rail'][number];
export type NoteMentionOut = NoteListOut['mentions'][number];
export type NoteTagOut = NoteOut['tags'][number];

// ------------------------------------------------------------------------------------ copy

export const NOTEBOOK = 'Notebook';
export const NO_NOTES_YET = 'No notes yet';
export const EMPTY_TODAY = 'A blank page. Jot anything: a number that looked off, who you are waiting on, what you finished.';
export const EMPTY_OTHER_DAY = 'Nothing was jotted on this day.';
export const NO_MENTIONS = 'No projects or routines named yet. Mention one and it is linked here.';
export const ENTER_HINT = 'Enter to jot · Shift+Enter for a new line';
export const PLACEHOLDER_TODAY = 'Jot something down…';
export const READS_LABEL = 'Remi reads these';
export const MENTIONED_LABEL = 'Mentioned on this day';
export const WEEK_LABEL = 'This week';
export const CTA_LABEL = 'Turn this day into an update';
export const CTA_EMPTY = 'Nothing to send yet';
export const TO_TODAY = 'Today';
export const SAVE_FAILED = 'Couldn’t save that. Try again.';
export const NO_CLOCK = '—:—';

// The collapsible rails and the expanded note (Notes.dc.html, the Ninety One redesign).
export const SHOW_NOTEBOOK = 'Show notebook';
export const HIDE_NOTEBOOK = 'Hide notebook';
export const SHOW_SIDE_PANEL = 'Show side panel';
export const HIDE_SIDE_PANEL = 'Hide side panel';
export const EXPAND_NOTE = 'Expand note';
export const COLLAPSE = 'Collapse';
export const COLLAPSE_TITLE = 'Collapse (Esc)';
export const EXPANDED_PLACEHOLDER = 'Write as much as you like.';
export const EXPANDED_HINT = 'Enter for a new line · Esc or ⌘↵ to collapse · saves as you go';

/** Rail widths open and folded to their 52px strips (the prototype's `sb.cols`). */
export const RAIL_WIDTH = { notebook: 300, reads: 340, strip: 52 } as const;

/** The screen's three columns: notebook, day page, "Remi reads these". */
export function columnsFor(leftOpen: boolean, rightOpen: boolean): string {
  const left = leftOpen ? RAIL_WIDTH.notebook : RAIL_WIDTH.strip;
  const right = rightOpen ? RAIL_WIDTH.reads : RAIL_WIDTH.strip;
  return `${String(left)}px minmax(0, 1fr) ${String(right)}px`;
}

/**
 * The day page's width (the prototype's `sb.mainW`): 820px with both rails open, 940px with
 * one folded away, 1080px with both.
 */
export function pageWidth(leftOpen: boolean, rightOpen: boolean): number {
  if (!leftOpen && !rightOpen) return 1080;
  return leftOpen && rightOpen ? 820 : 940;
}

/** "12 words" under the expanded note (whitespace-separated words of the trimmed text). */
export function wordCount(text: string): string {
  const trimmed = text.trim();
  return count(trimmed ? trimmed.split(/\s+/).length : 0, 'word');
}

/** The rail note (crit :76), verbatim, when recent notes go along with Tell Remi updates. */
export const READS_SENT =
  'Notes from your last five business days go along with every Tell Remi update, so it knows what you have been doing. Notes never change the plan by themselves.';
/**
 * The same note when Tell Remi uses the simple reading (AI provider `none`, the default).
 * Turning on an AI reader alone sends no notes: "Send my notes…" is its own setting, off by
 * default (settings.ai_send_recent_notes), so the note names both steps.
 */
export const READS_SIMPLE =
  'Notes stay on this computer: the simple reading doesn’t use them. With an AI reader on, you can choose in Settings to send notes from your last five business days with every Tell Remi update. Notes never change the plan by themselves.';
/** The same note when an AI reader is on but sending recent notes is off. */
export const READS_OFF =
  'Notes stay on this computer: sending recent notes with Tell Remi updates is turned off in Settings. Notes never change the plan by themselves.';

/** The rail note, true to the AI setting (`GET /ai/status` `sendsNotes`). */
export function readsNote(ai: Pick<AiStatusOut, 'provider' | 'sendsNotes'> | undefined): string {
  if (ai?.sendsNotes) return READS_SENT;
  return !ai || ai.provider === 'none' ? READS_SIMPLE : READS_OFF;
}

const CTA_NOTE = 'Opens Tell Remi with these notes filled in, so you can review the changes before anything moves.';

/** The note under the CTA (crit :215); the background count only when notes are sent. */
export function ctaNote(sendsNotes: boolean, recentNotes: number): string {
  return sendsNotes ? `${CTA_NOTE} Remi currently has ${count(recentNotes, 'recent note')} as background.` : CTA_NOTE;
}

/** "6 notes across 3 days", or "No notes yet". */
export function totalLine(total: number, dayCount: number): string {
  if (total === 0) return NO_NOTES_YET;
  return `${count(total, 'note')} across ${count(dayCount, 'day')}`;
}

export function placeholderFor(day: string, isToday: boolean): string {
  return isToday ? PLACEHOLDER_TODAY : `Add a note to ${s(day)}…`;
}

/** HH:MM of a local clock reading. */
export function clockText(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// ------------------------------------------------------------------------------------ rail

/** Monday of the week that `iso` falls in. */
export function mondayOf(iso: string): string {
  return addDays(iso, -((weekdayOf(iso) + 6) % 7));
}

export interface RailRow {
  day: string;
  /** "This week" / "Week of 28 Sep" on the first row of each Monday-based week. */
  weekHead: string | null;
  /** "Today · Mon 5 Oct" / "Fri 2 Oct". */
  label: string;
  /** The note count, or '' for none. */
  count: string;
  /** The latest note, or "Nothing yet today" / "No notes". */
  preview: string;
  hasNotes: boolean;
}

export function railRows(rail: readonly NoteDayOut[], today: string): RailRow[] {
  const thisWeek = mondayOf(today);
  let lastWeek: string | null = null;
  return rail.map((row) => {
    const isToday = row.day === today;
    const weekHead = row.weekOf !== lastWeek ? (row.weekOf === thisWeek ? 'This week' : `Week of ${dm(row.weekOf)}`) : null;
    lastWeek = row.weekOf;
    return {
      day: row.day,
      weekHead,
      label: `${isToday ? 'Today · ' : ''}${s(row.day)}`,
      count: row.count ? String(row.count) : '',
      preview: row.count ? row.latestPreview : isToday ? 'Nothing yet today' : 'No notes',
      hasNotes: row.count > 0,
    };
  });
}

// ------------------------------------------------------------------------------ day page

/** What the calendar says about a day (from the index, else the rail row). */
export interface DayFacts {
  bd: boolean;
  bdm: number | null;
  hol: string | null;
}

export function dayFacts(day: string, calendar: CalendarIndex | undefined, rail: readonly NoteDayOut[]): DayFacts | null {
  const known = calendar?.day(day);
  if (known) return { bd: known.bd, bdm: known.bdm, hol: known.hol };
  const row = rail.find((r) => r.day === day);
  return row ? { bd: row.bd, bdm: row.bdm, hol: row.hol } : null;
}

/**
 * The kicker: "Today", "Last business day", "3 business days ago", the holiday's name or
 * "Weekend". A future business day reads "Next business day" / "In 3 business days" (the
 * prototype printed "-3 business days ago").
 */
export function kickerFor(day: string, today: string, facts: DayFacts | null, calendar: CalendarIndex | undefined): string {
  if (day === today) return 'Today';
  const weekend = weekdayOf(day) === 0 || weekdayOf(day) === 6;
  if (facts && !facts.bd) return facts.hol ?? (weekend ? 'Weekend' : '');
  if (!facts && weekend) return 'Weekend';
  const ago = calendar?.bdDiff(day, today) ?? null;
  if (ago === null || ago === 0) return '';
  if (ago === 1) return 'Last business day';
  if (ago > 1) return `${String(ago)} business days ago`;
  if (ago === -1) return 'Next business day';
  return `In ${String(-ago)} business days`;
}

/** "BD3 · 3 notes · Returns · BAU, Returns pipeline, ManCo automation". */
export function subLine(facts: DayFacts | null, notes: number, mentions: readonly Pick<NoteMentionOut, 'label'>[]): string {
  return [
    facts?.bd && facts.bdm != null ? `BD${String(facts.bdm)}` : null,
    notes ? count(notes, 'note') : 'no notes yet',
    mentions.length ? mentions.slice(0, 3).map((m) => m.label).join(', ') : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

// ------------------------------------------------------------------------------ week spark

export interface SparkBar {
  day: string;
  count: number;
  /** Bar height as a percentage of the 56px area (a 2px floor is CSS). */
  heightPct: number;
  tone: 'selected' | 'notes' | 'empty';
  /** "M 5". */
  label: string;
  /** "Mon 5 Oct · 3 notes". */
  title: string;
}

/**
 * The business days of today's week, Monday to Friday: bank holidays are skipped (arch §2
 * notes/), so a holiday week has fewer, wider bars. Heights are the count over max(3, busiest
 * day shown), so one note is never a full bar.
 */
export function weekSpark(
  today: string,
  selected: string,
  counts: ReadonlyMap<string, number>,
  holidayOf: (day: string) => string | null,
): SparkBar[] {
  const monday = mondayOf(today);
  const days = [0, 1, 2, 3, 4].map((k) => addDays(monday, k)).filter((day) => !holidayOf(day));
  const max = Math.max(3, ...days.map((day) => counts.get(day) ?? 0));
  return days.map((day) => {
    const c = counts.get(day) ?? 0;
    return {
      day,
      count: c,
      heightPct: (c / max) * 100,
      tone: day === selected ? 'selected' : c ? 'notes' : 'empty',
      label: `${wd(day).slice(0, 1)} ${String(d(day))}`,
      title: `${s(day)} · ${count(c, 'note')}`,
    };
  });
}

// ------------------------------------------------------------------------------ entries

/** The day the page shows: the route's day when it is a real date, else today. */
export function resolveNotesDay(routeDay: string | null | undefined, today: string, isIso: (v: string) => boolean): string {
  return routeDay && isIso(routeDay) ? routeDay : today;
}

/** Newest first, as the prototype's page (`[...list].reverse()`); the server sends oldest first. */
export function newestFirst<T>(notes: readonly T[]): T[] {
  return [...notes].reverse();
}

/**
 * The drawer prefill when `GET /notes/day-text` cannot be read: the same "HH:MM text" lines,
 * oldest first (Notes.dc.html `dayText`).
 */
export function localDayText(notes: readonly Pick<NoteOut, 'timeLabel' | 'text'>[]): string {
  return notes.map((n) => `${n.timeLabel} ${n.text}`).join('\n');
}

/** The key a tag or mention sets for the linked highlight. */
export function tagHover(tag: Pick<NoteTagOut, 'targetType' | 'targetId'>): { type: 'project' | 'routine'; id: string } {
  return { type: tag.targetType === 'routine' ? 'routine' : 'project', id: tag.targetId };
}

/** A tag's or mention's key in a list. */
export function tagKey(tag: Pick<NoteTagOut, 'targetType' | 'targetId'>): string {
  return `${tag.targetType}:${tag.targetId}`;
}
