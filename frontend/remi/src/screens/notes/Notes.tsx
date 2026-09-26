/**
 * Notes (Notes.dc.html): the notebook rail, the day page and "Remi reads these".
 *
 * - Either rail folds away to a 52px strip (its toggle, or the strip's); the day page widens
 *   from 820px to 940px, or 1080px with both folded. Like the prototype, this is the screen's
 *   own state: kept while the app is open (every screen stays mounted), not saved.
 * - A note's expand button opens it in the expanded view (ExpandedNote) over the screen.
 * - `/app/notes` shows today; `/app/notes/<iso>` any other day (a malformed day falls back to
 *   today). Picking a day fades the page out and back (useDayFade) and refocuses the composer.
 * - Reads: `GET /notes/days` (the rail and totals), `GET /notes?day=` (the day's notes, their
 *   tags and mentions, all tagged on the server), `GET /notes/recent` (what Tell Remi may send),
 *   `POST /notes/tags` (the draft's live chips) and `GET /ai/status` (whether notes are sent).
 * - Writes: `POST /notes`, `PATCH /notes/{id}`, `DELETE /notes/{id}` (a blanked note). The day's
 *   cache is updated at once, so a jot or an edit never flickers; a failure restores it and
 *   shows a toast.
 * - The CTA hands the day's text (`GET /notes/day-text`) to Tell Remi, where every change is
 *   reviewed before anything moves.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router';

import {
  fetchNoteDayText,
  keys,
  planStatusOf,
  useAiStatus,
  useCalendarIndex,
  useCreateNote,
  useDeleteNote,
  useNoteDays,
  useNotes,
  useNoteTagPreview,
  usePlan,
  useRecentNotes,
  useUpdateNote,
} from '../../api';
import type { NoteListOut } from '../../api';
import { paths } from '../../app/screens';
import { useScreenRoute } from '../../app/screenLocation';
import { Toast, useToast } from '../../components/Toast';
import { useIsActiveScreen } from '../../lib/arrival';
import { isIsoDate } from '../../lib/calendar';
import { FOCUS_DELAY } from '../../lib/focus';
import { l, s as shortDay } from '../../lib/format';
import { useReducedMotion } from '../../lib/reducedMotion';
import { afterTwoFrames } from '../../lib/timers';
import { openProject } from '../../lib/viewTransition';
import { useOverlays } from '../../stores/overlays';
import { DayPage } from './DayPage';
import type { EntryView } from './DayPage';
import { ExpandedNote } from './ExpandedNote';
import {
  clockText,
  columnsFor,
  ctaNote,
  dayFacts,
  EMPTY_OTHER_DAY,
  EMPTY_TODAY,
  kickerFor,
  localDayText,
  newestFirst,
  NO_CLOCK,
  pageWidth,
  placeholderFor,
  railRows,
  readsNote,
  resolveNotesDay,
  SAVE_FAILED,
  subLine,
  totalLine,
  weekSpark,
} from './model';
import type { NoteMentionOut, NoteTagOut } from './model';
import s from './Notes.module.css';
import { Rail } from './Rail';
import { ReadsPanel } from './ReadsPanel';
import { useDayFade } from './useDayFade';

/** Tell Remi reads the last five business days of notes (crit :76). */
const RECENT_BDS = 5;
/** The composer's clock refreshes every 20s (crit :114). */
const CLOCK_MS = 20_000;
/** A fresh note is tinted for 1.4s. */
const FRESH_MS = 1400;
/** Focus the composer this long after Notes becomes the active screen. */
const ARRIVE_FOCUS_MS = 320;
/** The expanded note unmounts this long after it starts to close (the prototype's `exT`). */
const EXPANDED_LEAVE_MS = 300;

/** The expanded note: which one, on which day, and where it is in its open / close. */
interface Expanded {
  id: string;
  day: string;
  /** enter: mounted, closed, for two frames; open; leave: fading out. */
  phase: 'enter' | 'open' | 'leave';
  /** The note as it was opened, shown while it fades out if it is gone by then. */
  entry: EntryView;
}

function QuietHeading() {
  return (
    <h1 className={s.srOnly} tabIndex={-1}>
      Notes
    </h1>
  );
}

export default function NotesScreen() {
  const plan = usePlan();
  const status = planStatusOf(plan);
  if (!plan.data) {
    if (status === 'error') {
      return (
        <div className={s.status}>
          <QuietHeading />
          Remi couldn’t read your plan.
          <button type="button" className={s.retry} onClick={() => void plan.refetch()}>
            Try again
          </button>
        </div>
      );
    }
    return <QuietHeading />;
  }
  return <NotesView today={plan.data.today.iso} />;
}

/** The HH:MM clock, refreshed every 20s. */
function useClock(): string {
  const [now, setNow] = useState(() => clockText(new Date()));
  useEffect(() => {
    const id = setInterval(() => {
      setNow(clockText(new Date()));
    }, CLOCK_MS);
    return () => {
      clearInterval(id);
    };
  }, []);
  return now;
}

function NotesView({ today }: { today: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const route = useScreenRoute();
  const isActive = useIsActiveScreen();
  const reduced = useReducedMotion();
  const toast = useToast();
  const clock = useClock();
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const target = resolveNotesDay(route.params.day, today, isIsoDate);
  const targetQuery = useNotes(target);
  const targetReady = targetQuery.data?.day === target || targetQuery.isError;
  const { shown, fading, dir } = useDayFade(target, targetReady);

  const days = useNoteDays();
  const dayQuery = useNotes(shown);
  const day: NoteListOut | undefined = dayQuery.data?.day === shown ? dayQuery.data : undefined;
  const recent = useRecentNotes(RECENT_BDS);
  const ai = useAiStatus();
  const [draft, setDraft] = useState('');
  const draftTags = useNoteTagPreview(draft);
  const [fresh, setFresh] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [expanded, setExpanded] = useState<Expanded | null>(null);
  const expandTrigger = useRef<HTMLButtonElement | null>(null);

  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();

  // Calendar facts from today back to the earliest day on screen (kicker, BD numbers, holidays).
  const rail = useMemo(() => days.data?.rail ?? [], [days.data]);
  const earliest = [shown, today, ...rail.map((r) => r.day)].reduce((a, b) => (b < a ? b : a));
  const latest = shown > today ? shown : today;
  const calendar = useCalendarIndex({ from: earliest, to: latest });

  const isToday = shown === today;
  const facts = dayFacts(shown, calendar, rail);
  const notes = useMemo(() => day?.notes ?? [], [day]);
  const mentions: readonly NoteMentionOut[] = day?.mentions ?? [];

  // ------------------------------------------------------------------ focus
  // Arriving on Notes focuses the composer (Notes.dc.html componentDidUpdate, 320ms), unless an
  // overlay is open or something in the screen already has focus.
  useEffect(() => {
    if (!isActive) return;
    const id = setTimeout(() => {
      const el = composerRef.current;
      const overlays = useOverlays.getState();
      if (!el || overlays.drawer.open || overlays.palette.open) return;
      const section = el.closest('section');
      if (section?.contains(document.activeElement) && document.activeElement?.tagName !== 'H1') return;
      el.focus({ preventScroll: true });
    }, ARRIVE_FOCUS_MS);
    return () => {
      clearTimeout(id);
    };
  }, [isActive]);

  // After a day swap, back to the composer (40ms, as the prototype's pick).
  const lastShown = useRef(shown);
  useEffect(() => {
    if (lastShown.current === shown) return;
    lastShown.current = shown;
    if (!isActive) return;
    const id = setTimeout(() => composerRef.current?.focus({ preventScroll: true }), FOCUS_DELAY.notesComposer);
    return () => {
      clearTimeout(id);
    };
  }, [shown, isActive]);

  useEffect(() => {
    if (!fresh) return;
    const id = setTimeout(() => {
      setFresh(null);
    }, FRESH_MS);
    return () => {
      clearTimeout(id);
    };
  }, [fresh]);

  // ------------------------------------------------------------------ actions
  const pick = useCallback(
    (next: string) => {
      if (next === target) return;
      void navigate(paths.notes(next === today ? null : next));
    },
    [navigate, target, today],
  );

  const patchDay = useCallback(
    (iso: string, fn: (list: NoteListOut) => NoteListOut) => {
      queryClient.setQueryData<NoteListOut>(keys.notes.day(iso), (old) => (old ? fn(old) : old));
    },
    [queryClient],
  );

  const refreshDay = useCallback(
    (iso: string) => {
      void queryClient.invalidateQueries({ queryKey: keys.notes.day(iso) });
    },
    [queryClient],
  );

  const jot = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    const iso = shown;
    setDraft('');
    createNote.mutate(
      { day: iso, text },
      {
        onSuccess: (out) => {
          const note = out.entity;
          patchDay(iso, (list) => (list.notes.some((n) => n.id === note.id) ? list : { ...list, notes: [...list.notes, note] }));
          setFresh(note.id);
        },
        onError: () => {
          setDraft((current) => (current.trim() ? current : text));
          toast.show(SAVE_FAILED);
        },
      },
    );
  }, [createNote, draft, patchDay, shown, toast]);

  const save = useCallback(
    (noteId: string, text: string) => {
      const iso = shown;
      const original = notes.find((n) => n.id === noteId);
      if (!original) return;
      if (!text) {
        patchDay(iso, (list) => ({ ...list, notes: list.notes.filter((n) => n.id !== noteId) }));
        deleteNote.mutate(
          { noteId },
          {
            onError: () => {
              refreshDay(iso);
              toast.show(SAVE_FAILED);
            },
          },
        );
        return;
      }
      if (text === original.text) return;
      patchDay(iso, (list) => ({ ...list, notes: list.notes.map((n) => (n.id === noteId ? { ...n, text } : n)) }));
      updateNote.mutate(
        { noteId, text },
        {
          onError: () => {
            refreshDay(iso);
            toast.show(SAVE_FAILED);
          },
        },
      );
    },
    [deleteNote, notes, patchDay, refreshDay, shown, toast, updateNote],
  );

  const openTarget = useCallback(
    (tag: Pick<NoteTagOut, 'targetType' | 'targetId'>) => {
      if (tag.targetType === 'routine') void navigate(paths.routines({ focus: tag.targetId }));
      else openProject(tag.targetId, navigate);
    },
    [navigate],
  );

  const sendDay = useCallback(() => {
    if (!notes.length) return;
    const iso = shown;
    const fallback = localDayText(notes);
    fetchNoteDayText(queryClient, iso)
      .then((out) => out.text || fallback)
      .catch(() => fallback)
      .then((text) => {
        useOverlays.getState().openDrawer(null, { text });
      })
      .catch(() => undefined);
  }, [notes, queryClient, shown]);

  // ------------------------------------------------------------------ view
  const counts = useMemo(() => new Map(rail.map((r) => [r.day, r.count])), [rail]);
  const spark = useMemo(
    () => weekSpark(today, shown, counts, (iso) => calendar?.holiday(iso) ?? rail.find((r) => r.day === iso)?.hol ?? null),
    [today, shown, counts, calendar, rail],
  );
  const rows = useMemo(() => railRows(rail, today), [rail, today]);
  const entries: EntryView[] = useMemo(
    () => newestFirst(notes).map((n) => ({ id: n.id, time: n.timeLabel, text: n.text, tags: n.tags })),
    [notes],
  );

  // ------------------------------------------------------------------ expanded note
  const openExpanded = useCallback(
    (entry: EntryView, trigger: HTMLButtonElement) => {
      expandTrigger.current = trigger;
      setExpanded({ id: entry.id, day: shown, phase: 'enter', entry });
    },
    [shown],
  );
  const closeExpanded = useCallback(() => {
    setExpanded((x) => (x && x.phase !== 'leave' ? { ...x, phase: 'leave' } : x));
  }, []);

  const phase = expanded?.phase;
  useEffect(() => {
    if (phase === 'enter') {
      return afterTwoFrames(() => {
        setExpanded((x) => (x?.phase === 'enter' ? { ...x, phase: 'open' } : x));
      });
    }
    if (phase !== 'leave') return;
    // Back to the note's expand button (the page is no longer inert by now).
    const trigger = expandTrigger.current;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    const id = setTimeout(() => {
      setExpanded((x) => (x?.phase === 'leave' ? null : x));
    }, EXPANDED_LEAVE_MS);
    return () => {
      clearTimeout(id);
    };
  }, [phase]);

  // A note deleted elsewhere, or a different day on the page, closes the expanded view.
  const liveExpanded = expanded ? entries.find((e) => e.id === expanded.id) : undefined;
  if (expanded && expanded.phase !== 'leave' && (expanded.day !== shown || (day !== undefined && !liveExpanded))) {
    setExpanded({ ...expanded, phase: 'leave' });
  }
  const modal = expanded !== null && expanded.phase !== 'leave';

  const sendsNotes = ai.data?.sendsNotes === true;
  const status = dayQuery.isError && !day ? (
    <div className={s.empty}>
      Remi couldn’t read this day’s notes.
      <button type="button" className={s.retry} onClick={() => void dayQuery.refetch()}>
        Try again
      </button>
    </div>
  ) : !day ? (
    <div className={s.empty} aria-busy="true" />
  ) : undefined;

  const rootStyle: CSSProperties = { gridTemplateColumns: columnsFor(leftOpen, rightOpen) };

  return (
    <div className={s.root} style={rootStyle}>
      <Rail
        rows={rows}
        totalLine={days.data ? totalLine(days.data.total, days.data.dayCount) : ''}
        selected={target}
        onPick={pick}
        open={leftOpen}
        onToggle={() => {
          setLeftOpen((v) => !v);
        }}
        inert={modal}
      />
      <DayPage
        kicker={kickerFor(shown, today, facts, calendar)}
        isToday={isToday}
        title={l(shown)}
        sub={subLine(facts, notes.length, mentions)}
        nowTime={isToday ? clock : NO_CLOCK}
        draft={draft}
        placeholder={placeholderFor(shown, isToday)}
        draftTags={draftTags.data?.tags ?? []}
        entries={entries}
        fresh={fresh}
        empty={day && notes.length === 0 ? (isToday ? EMPTY_TODAY : EMPTY_OTHER_DAY) : null}
        fading={fading}
        shift={reduced ? 0 : dir * 6}
        width={pageWidth(leftOpen, rightOpen)}
        inert={modal}
        composerRef={composerRef}
        onDraft={setDraft}
        onJot={jot}
        onToday={() => {
          pick(today);
        }}
        onSave={save}
        onOpenTag={openTarget}
        onExpand={openExpanded}
        status={status}
      />
      <ReadsPanel
        note={readsNote(ai.data)}
        canSend={notes.length > 0}
        ctaNote={ctaNote(sendsNotes, recent.data?.count ?? 0)}
        onSend={sendDay}
        mentions={mentions}
        onOpen={openTarget}
        spark={spark}
        onPick={pick}
        open={rightOpen}
        onToggle={() => {
          setRightOpen((v) => !v);
        }}
        inert={modal}
      />
      {expanded ? (
        <ExpandedNote
          key={expanded.id}
          entry={liveExpanded ?? expanded.entry}
          day={shortDay(expanded.day)}
          open={expanded.phase === 'open'}
          onSave={save}
          onClose={closeExpanded}
        />
      ) : null}
      <Toast message={toast.message} />
    </div>
  );
}
