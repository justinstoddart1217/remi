/**
 * Today (Today.dc.html): one business day in detail on the left (the dark-teal hero, the
 * capacity card, the plan), the week card and the month-to-date snapshot on the right. The two
 * columns share two rows, so the hero and capacity sit level with the week card.
 *
 * - `/app/today` shows today; `/app/today/<iso>` previews another business day. A malformed or
 *   non-business day falls back to today (:301), and the URL is replaced with `/app/today` so
 *   the week strip and the address agree.
 * - Picking a day fades the left column out and back (useDaySwitch); the right column only
 *   moves its selection.
 * - Every number comes from the API: `GET /plan` (loads, calendar, projects, routines,
 *   verdict), `GET /day/{iso}` (BAU rows and the checklist run, focus blocks and their task
 *   slice, the next run) and `GET /month-snapshot` (rows and cumulative bars).
 * - The feed, attention list and check-in prompt that the prototype computes are not built
 *   (decision 8).
 */

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router';

import {
  isRemiApiError,
  keys,
  planStatusOf,
  useCalendarIndex,
  useDay,
  useLoadsRange,
  useMonthSnapshot,
  usePlan,
  usePutRoutineRun,
  usePutRunTick,
  usePutRunTicks,
  useUpdateMilestone,
  useUpdateTask,
} from '../../api';
import type { PlanOut } from '../../api';
import { paths } from '../../app/screens';
import { useScreenRoute } from '../../app/screenLocation';
import { Toast, useToast } from '../../components';
import { useArrival, useIsActiveScreen } from '../../lib/arrival';
import { addDays, isIsoDate } from '../../lib/calendar';
import { num } from '../../lib/format';
import { useReducedMotion } from '../../lib/reducedMotion';
import { VERDICT_CHROME } from '../../shell/HeaderBar/headerModel';
import { Capacity } from './Capacity';
import { DayHeader } from './DayHeader';
import {
  dayCopy,
  dayOffText,
  mondayOf,
  NO_FOCUS_BLOCKS,
  noBauText,
  resolveDay,
  runKey,
  taskKey,
  tickKey,
  weekModel,
} from './model';
import { MonthSnapshot } from './MonthSnapshot';
import { PlanList } from './PlanList';
import type { PlanActions } from './PlanList';
import s from './Today.module.css';
import type { BauRowOut, DayOut, MonthSnapshotRowOut } from './types';
import { useDaySwitch } from './useDaySwitch';
import { useOptimisticDone } from './useOptimisticDone';
import { WeekStrip } from './WeekStrip';

const SAVE_FAILED = 'Couldn’t save that. Try again.';
const NOT_EDITABLE = 'Ticking opens on the day of the run.';

/** Arrival stagger per block (Today.dc.html: 0, 40, 80, 120, 160ms). */
const delay = (ms: number): CSSProperties => ({ '--d': `${String(ms)}ms` }) as CSSProperties;

/** The screen's heading while there is no day to show yet (screen readers, heading focus). */
function QuietHeading() {
  return (
    <h1 className={s.srOnly} tabIndex={-1}>
      Today
    </h1>
  );
}

export default function TodayScreen() {
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
    return (
      <div data-today-loading="">
        <QuietHeading />
      </div>
    );
  }
  return <TodayView plan={plan.data} />;
}

function TodayView({ plan }: { plan: PlanOut }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const route = useScreenRoute();
  const reduced = useReducedMotion();
  const isActive = useIsActiveScreen();
  const toast = useToast();

  const today = plan.today.iso;
  const routeDay = route.params.day ?? null;
  const candidate = routeDay && isIsoDate(routeDay) ? routeDay : today;

  // The candidate's week (for the strip, and to know whether the day is a business day).
  const weekFrom = mondayOf(candidate);
  const weekTo = addDays(weekFrom, 4);
  const calendar = useCalendarIndex({ from: weekFrom, to: weekTo });
  const candidateQuery = useDay(candidate);
  const candidateDay = candidateQuery.data?.day === candidate ? candidateQuery.data : undefined;
  const isBd =
    calendar?.isBD(candidate) ?? (candidateDay ? candidateDay.bdm != null : candidateQuery.isError ? false : null);
  const target = resolveDay(candidate, today, isBd);
  // A rejected route day (malformed, a weekend or holiday, or today spelled out) leaves the
  // address: without this, picking today's card would do nothing (the target is already today).
  const rejected = routeDay != null && target === today;
  useEffect(() => {
    if (isActive && rejected) void navigate(paths.today(), { replace: true });
  }, [isActive, rejected, navigate]);

  const targetQuery = useDay(target);
  const targetReady = targetQuery.data?.day === target || targetQuery.isError;
  const { shown, fading, dir } = useDaySwitch(target, targetReady);
  const dayQuery = useDay(shown);
  const day: DayOut | undefined = dayQuery.data?.day === shown ? dayQuery.data : undefined;
  const month = useMonthSnapshot();
  // The arrival stagger plays once, when the screen is first shown with its day.
  const arrival = useArrival(isActive && day !== undefined);

  // Loads for the shown week: the plan's, or a range read outside the plan window.
  const shownMonday = mondayOf(shown);
  const shownFriday = addDays(shownMonday, 4);
  const planCovers = plan.calendar.from <= shownMonday && plan.calendar.to >= shownFriday;
  const extraLoads = useLoadsRange({ from: shownMonday, to: shownFriday }, { enabled: !planCovers });
  const extra = extraLoads.data?.loads;
  const weekLoads = useMemo(() => (planCovers || !extra ? plan.loads : { ...extra, ...plan.loads }), [planCovers, extra, plan.loads]);

  // ------------------------------------------------------------------ ticks
  const onError = useCallback(
    (error: unknown) => {
      toast.show(isRemiApiError(error, 'RUN_NOT_EDITABLE') ? NOT_EDITABLE : SAVE_FAILED);
    },
    [toast],
  );
  // Fetch counts of the reads the ticks live in. `isFetching` is read so this view re-renders
  // when a refetch lands, even when the data is unchanged.
  const dayFetching = dayQuery.isFetching;
  const monthFetching = month.isFetching;
  const versions = useMemo(
    () => [
      queryClient.getQueryState(keys.day.detail(shown))?.dataUpdateCount ?? 0,
      queryClient.getQueryState(keys.monthSnapshot.detail(null))?.dataUpdateCount ?? 0,
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the fetch flags mark new counts
    [queryClient, shown, dayFetching, monthFetching, dayQuery.dataUpdatedAt, month.dataUpdatedAt],
  );
  const optimistic = useOptimisticDone(versions, onError);

  const putTick = usePutRunTick();
  const putTicks = usePutRunTicks();
  const putRun = usePutRoutineRun();
  const updateTask = useUpdateTask();
  const updateMilestone = useUpdateMilestone();

  const tick = useCallback(
    (row: BauRowOut, itemId: string, next: boolean) => {
      const routineId = row.routineId;
      const iso = row.run?.occurrenceDate;
      if (!routineId || !iso) return;
      const values: Record<string, boolean> = { [tickKey(routineId, iso, itemId)]: next };
      if (row.run && !row.run.completed) {
        values[runKey(routineId, iso)] = row.checklist.every((i) =>
          i.id === itemId ? next : optimistic.get(tickKey(routineId, iso, i.id), i.done),
        );
      }
      optimistic.run(values, () => putTick.mutateAsync({ routineId, iso, itemId, done: next }));
    },
    [optimistic, putTick],
  );

  const toggleTask = useCallback(
    (taskId: string, next: boolean) => {
      optimistic.run({ [taskKey(taskId)]: next }, () => updateTask.mutateAsync({ taskId, patch: { done: next } }));
    },
    [optimistic, updateTask],
  );

  const toggleMonthRow = useCallback(
    (row: MonthSnapshotRowOut, next: boolean) => {
      if (row.kind === 'bau' && row.routineId && row.occurrenceDate) {
        const routineId = row.routineId;
        const iso = row.occurrenceDate;
        if (row.hasChecklist && iso === today) {
          // Today's checklist run: tick or untick every item (the prototype's setAllFunds).
          const values: Record<string, boolean> = { [row.key]: next };
          const run = day?.bauRows.find((b) => b.routineId === routineId && b.run?.occurrenceDate === iso);
          for (const i of run?.checklist ?? []) values[tickKey(routineId, iso, i.id)] = next;
          optimistic.run(values, () => putTicks.mutateAsync({ routineId, iso, done: next }));
        } else {
          optimistic.run({ [row.key]: next }, () => putRun.mutateAsync({ routineId, iso, completed: next }));
        }
      } else if (row.kind === 'task' && row.taskId) {
        const taskId = row.taskId;
        optimistic.run({ [row.key]: next }, () => updateTask.mutateAsync({ taskId, patch: { done: next } }));
      } else if (row.kind === 'milestone' && row.milestoneId) {
        const milestoneId = row.milestoneId;
        optimistic.run({ [row.key]: next }, () => updateMilestone.mutateAsync({ milestoneId, patch: { done: next } }));
      }
    },
    [today, day, optimistic, putTicks, putRun, updateTask, updateMilestone],
  );

  // ------------------------------------------------------------------ navigation
  const pick = useCallback(
    (iso: string) => {
      if (iso === target) return;
      void navigate(paths.today(iso === today ? null : iso));
    },
    [navigate, target, today],
  );
  const backToday = useCallback(() => {
    void navigate(paths.today());
  }, [navigate]);

  const actions = useMemo<PlanActions>(
    () => ({
      done: optimistic.get,
      tick,
      toggleTask,
      openRoutine: (row) => {
        void navigate(row.kind === 'rotation' ? paths.routines({ rotation: true }) : paths.routines({ focus: row.routineId ?? undefined }));
      },
      openProject: (projectId) => {
        void navigate(paths.project(projectId));
      },
    }),
    [optimistic.get, tick, toggleTask, navigate],
  );

  // ------------------------------------------------------------------ view
  const week = useMemo(
    () => weekModel({ selected: shown, today, calendar, loads: weekLoads, projects: plan.projects }),
    [shown, today, calendar, weekLoads, plan.projects],
  );
  // Overdue rows can be due before the plan's calendar starts.
  const earliestLate = month.data?.rows.reduce<string>((min, r) => (r.late && r.due < min ? r.due : min), today) ?? today;
  const lateCalendar = useCalendarIndex({ from: earliestLate, to: today });

  if (!day) {
    if (dayQuery.isError) {
      return (
        <div className={s.status}>
          <QuietHeading />
          Remi couldn’t read this day.
          <button type="button" className={s.retry} onClick={() => void dayQuery.refetch()}>
            Try again
          </button>
        </div>
      );
    }
    // First load of the day (during a switch the previous day stays on screen instead).
    return (
      <div className={s.root} {...arrival.attrs} data-today-loading="">
        <QuietHeading />
        <div className={s.left} />
        <div className={s.right} />
      </div>
    );
  }

  const isToday = day.isToday;
  const copy = dayCopy(day.day, day.aheadBd, isToday, plan.today);
  const capacity = plan.settings.capacityHoursPerDay;
  const bdLine = day.bdm != null ? `BD${String(day.bdm)} of ${String(day.monthBds)}` : null;
  const dayOff = day.bdm == null ? dayOffText(day.holiday, day.nextRunAfter) : null;

  return (
    <div className={s.root} {...arrival.attrs} data-reduced={reduced ? '' : undefined}>
      <div
        className={s.left}
        data-fading={fading ? '' : undefined}
        style={{ transform: fading && !reduced ? `translateX(${String(dir * -8)}px)` : 'none' }}
      >
        <div className={s.top}>
          <DayHeader
            kicker={copy.kicker}
            title={copy.title}
            bdLine={bdLine}
            dayOff={day.holiday ?? 'Weekend'}
            workingDay={`${num(capacity)}h working day`}
            verdict={VERDICT_CHROME[plan.verdict.state].word}
            onBack={isToday ? null : backToday}
            style={delay(0)}
          />
          {day.load && <Capacity title={copy.capTitle} load={day.load} arrived={arrival.arrived} iso={day.day} style={delay(40)} />}
        </div>
        <PlanList
          title={copy.planTitle}
          note={copy.planNote}
          bauRows={day.bauRows}
          focusBlocks={day.focusBlocks}
          dayOff={dayOff}
          noBau={noBauText(day.nextRunAfter, plan.routines.length > 0)}
          noFocus={NO_FOCUS_BLOCKS}
          isToday={isToday}
          aheadBd={day.aheadBd}
          routines={plan.routines}
          projects={plan.projects}
          actions={actions}
          style={delay(80)}
        />
      </div>
      <div className={s.right}>
        <WeekStrip model={week} arrived={arrival.arrived} onPick={pick} style={delay(120)} />
        {month.data ? (
          <MonthSnapshot
            snapshot={month.data}
            arrived={arrival.arrived}
            calendar={lateCalendar}
            done={optimistic.get}
            onToggle={toggleMonthRow}
            style={delay(160)}
          />
        ) : null}
      </div>
      <div className={s.toastLayer}>
        <Toast message={toast.message} />
      </div>
    </div>
  );
}
