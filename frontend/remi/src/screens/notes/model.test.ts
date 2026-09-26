import { describe, expect, it } from 'vitest';

import { CalendarIndex } from '../../lib/calendar';
import { fixturePlan } from '../../test/msw';
import {
  clockText,
  columnsFor,
  ctaNote,
  dayFacts,
  kickerFor,
  localDayText,
  mondayOf,
  newestFirst,
  pageWidth,
  placeholderFor,
  railRows,
  READS_OFF,
  READS_SENT,
  READS_SIMPLE,
  readsNote,
  resolveNotesDay,
  subLine,
  tagHover,
  totalLine,
  weekSpark,
  wordCount,
} from './model';
import type { NoteDayOut } from './model';

const TODAY = '2026-10-05';
const calendar = new CalendarIndex(fixturePlan().calendar.days);

function row(day: string, count: number, preview = '', extra: Partial<NoteDayOut> = {}): NoteDayOut {
  return {
    day,
    count,
    latestPreview: preview,
    w: new Date(`${day}T12:00:00Z`).getUTCDay(),
    bd: true,
    bdm: null,
    hol: null,
    weekOf: mondayOf(day),
    today: day === TODAY,
    ...extra,
  };
}

describe('railRows', () => {
  const rows = railRows(
    [row('2026-10-05', 3, 'Finance happy'), row('2026-10-02', 2, 'FI desk'), row('2026-10-01', 1, 'Chased'), row('2026-09-30', 0), row('2026-09-25', 0)],
    TODAY,
  );

  it('heads each Monday-based week once', () => {
    expect(rows.map((r) => r.weekHead)).toEqual(['This week', 'Week of 28 Sep', null, null, 'Week of 21 Sep']);
  });

  it('labels today and counts', () => {
    expect(rows[0]).toMatchObject({ label: 'Today · Mon 5 Oct', count: '3', preview: 'Finance happy', hasNotes: true });
    expect(rows[3]).toMatchObject({ label: 'Wed 30 Sep', count: '', preview: 'No notes', hasNotes: false });
  });

  it('says "Nothing yet today" for an empty today', () => {
    expect(railRows([row(TODAY, 0)], TODAY)[0]?.preview).toBe('Nothing yet today');
  });
});

describe('kickerFor', () => {
  const facts = (day: string) => dayFacts(day, calendar, []);

  it('reads today, the last business day and further back', () => {
    expect(kickerFor(TODAY, TODAY, facts(TODAY), calendar)).toBe('Today');
    expect(kickerFor('2026-10-02', TODAY, facts('2026-10-02'), calendar)).toBe('Last business day');
    expect(kickerFor('2026-09-30', TODAY, facts('2026-09-30'), calendar)).toBe('3 business days ago');
  });

  it('labels future days instead of "-N business days ago"', () => {
    expect(kickerFor('2026-10-06', TODAY, facts('2026-10-06'), calendar)).toBe('Next business day');
    expect(kickerFor('2026-10-07', TODAY, facts('2026-10-07'), calendar)).toBe('In 2 business days');
  });

  it('names weekends and holidays', () => {
    expect(kickerFor('2026-10-03', TODAY, facts('2026-10-03'), calendar)).toBe('Weekend');
    const hol = calendar.days.find((d) => d.hol && d.iso < '2027-01-31');
    if (hol) expect(kickerFor(hol.iso, TODAY, facts(hol.iso), calendar)).toBe(hol.hol);
  });

  it('falls back to the rail row outside the calendar', () => {
    const f = dayFacts('2026-09-01', undefined, [row('2026-09-01', 1, 'x', { bdm: 1 })]);
    expect(f).toEqual({ bd: true, bdm: 1, hol: null });
  });
});

describe('subLine', () => {
  it('joins BD, notes and the first three mentions', () => {
    const mentions = [{ label: 'Returns · BAU' }, { label: 'Returns pipeline' }, { label: 'ManCo automation' }, { label: 'Alpha' }];
    expect(subLine({ bd: true, bdm: 3, hol: null }, 3, mentions)).toBe('BD3 · 3 notes · Returns · BAU, Returns pipeline, ManCo automation');
  });

  it('says "no notes yet" and drops BD on a weekend', () => {
    expect(subLine({ bd: false, bdm: null, hol: null }, 0, [])).toBe('no notes yet');
    expect(subLine({ bd: true, bdm: 1, hol: null }, 1, [])).toBe('BD1 · 1 note');
  });
});

describe('weekSpark', () => {
  const counts = new Map([
    ['2026-10-05', 3],
    ['2026-10-06', 1],
  ]);
  const bars = weekSpark(TODAY, '2026-10-06', counts, () => null);

  it('shows Monday to Friday of this week', () => {
    expect(bars.map((b) => b.label)).toEqual(['M 5', 'T 6', 'W 7', 'T 8', 'F 9']);
  });

  it('scales to max(3, busiest day) and tones selected, notes, empty', () => {
    expect(bars.map((b) => Math.round(b.heightPct * 100) / 100)).toEqual([100, 33.33, 0, 0, 0]);
    expect(bars.map((b) => b.tone)).toEqual(['notes', 'selected', 'empty', 'empty', 'empty']);
  });

  it('titles each bar', () => {
    expect(bars[0]?.title).toBe('Mon 5 Oct · 3 notes');
    expect(bars[1]?.title).toBe('Tue 6 Oct · 1 note');
  });

  it('skips bank holidays (Christmas week has no Friday bar)', () => {
    const holidays = new Map([['2026-12-25', 'Christmas Day']]);
    const christmas = weekSpark('2026-12-21', '2026-12-21', new Map([['2026-12-25', 9]]), (day) => holidays.get(day) ?? null);
    expect(christmas.map((b) => b.label)).toEqual(['M 21', 'T 22', 'W 23', 'T 24']);
    // A holiday's notes do not set the scale either.
    expect(christmas.every((b) => b.heightPct === 0)).toBe(true);
  });
});

describe('copy', () => {
  it('pluralises the total line', () => {
    expect(totalLine(6, 3)).toBe('6 notes across 3 days');
    expect(totalLine(1, 1)).toBe('1 note across 1 day');
    expect(totalLine(0, 0)).toBe('No notes yet');
  });

  it('keeps the rail note true to the AI setting', () => {
    expect(readsNote({ provider: 'anthropic', sendsNotes: true })).toBe(READS_SENT);
    expect(readsNote({ provider: 'none', sendsNotes: false })).toBe(READS_SIMPLE);
    expect(readsNote(undefined)).toBe(READS_SIMPLE);
    expect(readsNote({ provider: 'ollama', sendsNotes: false })).toBe(READS_OFF);
    // Choosing a reader sends nothing by itself: sending notes is a separate opt-in.
    expect(READS_SIMPLE).toMatch(/choose in Settings to send notes/);
    expect(READS_SIMPLE).not.toMatch(/Turn on an AI reader in Settings and notes/);
  });

  it('counts background notes only when they are sent', () => {
    expect(ctaNote(true, 6)).toBe(
      'Opens Tell Remi with these notes filled in, so you can review the changes before anything moves. Remi currently has 6 recent notes as background.',
    );
    expect(ctaNote(true, 1)).toMatch(/has 1 recent note as background\.$/);
    expect(ctaNote(false, 6)).toBe('Opens Tell Remi with these notes filled in, so you can review the changes before anything moves.');
  });

  it('has a placeholder per day', () => {
    expect(placeholderFor(TODAY, true)).toBe('Jot something down…');
    expect(placeholderFor('2026-10-02', false)).toBe('Add a note to Fri 2 Oct…');
  });
});

describe('entries', () => {
  it('resolves the route day', () => {
    const iso = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
    expect(resolveNotesDay(undefined, TODAY, iso)).toBe(TODAY);
    expect(resolveNotesDay('nope', TODAY, iso)).toBe(TODAY);
    expect(resolveNotesDay('2026-10-02', TODAY, iso)).toBe('2026-10-02');
  });

  it('lists newest first and builds the prefill lines oldest first', () => {
    const notes = [
      { timeLabel: '08:41', text: 'a' },
      { timeLabel: '09:55', text: 'b' },
    ];
    expect(newestFirst(notes).map((n) => n.text)).toEqual(['b', 'a']);
    expect(localDayText(notes)).toBe('08:41 a\n09:55 b');
  });

  it('keys the hover by target type', () => {
    expect(tagHover({ targetType: 'routine', targetId: 'r-ret' })).toEqual({ type: 'routine', id: 'r-ret' });
    expect(tagHover({ targetType: 'project', targetId: 'ret' })).toEqual({ type: 'project', id: 'ret' });
  });

  it('formats the clock', () => {
    expect(clockText(new Date(2026, 9, 5, 9, 5))).toBe('09:05');
  });
});

describe('folding rails', () => {
  it('narrows a folded rail to its 52px strip', () => {
    expect(columnsFor(true, true)).toBe('300px minmax(0, 1fr) 340px');
    expect(columnsFor(false, true)).toBe('52px minmax(0, 1fr) 340px');
    expect(columnsFor(true, false)).toBe('300px minmax(0, 1fr) 52px');
    expect(columnsFor(false, false)).toBe('52px minmax(0, 1fr) 52px');
  });

  it('widens the day page as rails fold (sb.mainW)', () => {
    expect(pageWidth(true, true)).toBe(820);
    expect(pageWidth(false, true)).toBe(940);
    expect(pageWidth(true, false)).toBe(940);
    expect(pageWidth(false, false)).toBe(1080);
  });
});

describe('wordCount', () => {
  it('counts whitespace-separated words of the trimmed text', () => {
    expect(wordCount('')).toBe('0 words');
    expect(wordCount('   ')).toBe('0 words');
    expect(wordCount('Done')).toBe('1 word');
    expect(wordCount('  Should it be\n slightly   bigger?? ')).toBe('5 words');
  });
});
