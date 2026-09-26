import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { paths } from '../../app/screens';
import { isRemiApiError, useCalendarIndex, useLoadsRange, usePlan } from '../../api';
import type { PlanOut } from '../../api';
import { Button, EmptyState, IconButton } from '../../components';
import { addMonths, monthOf } from '../../lib/calendar';
import type { IsoDate, IsoMonth } from '../../lib/calendar';
import * as F from '../../lib/format';
import { useReducedMotion } from '../../lib/reducedMotion';
import s from './Calendar.module.css';
import { DayPanel } from './DayPanel';
import { buildCells, monthBounds, monthDiff, monthSubline, neededRange } from './model';
import type { Loads } from './model';
import { MonthGrid, WeekdayHeads } from './MonthGrid';
import type { NavBounds } from './nav';
import { useCalendarNav } from './useCalendarNav';

/**
 * The Calendar screen (Calendar.dc.html): a Monday-first month grid with business-day
 * numbers, BAU chips, milestones, forecast ends, project hours and load meters, and the 440px
 * day panel. Everything it shows comes from the plan (`GET /plan`), `GET /calendar` and
 * `GET /loads` for months past the plan window, and `GET /day/{iso}` for the panel's tasks.
 */
export default function CalendarScreen() {
  const plan = usePlan();
  if (plan.data) return <Calendar plan={plan.data} />;
  if (plan.isError && plan.error.code !== 'SETUP_REQUIRED') {
    return (
      <div className={s.root}>
        <TitleOnly />
        <div className={s.status}>
          <EmptyState>The plan could not be loaded. {plan.error.message}</EmptyState>
          <Button
            variant="raised"
            size="s"
            onClick={() => {
              void plan.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className={s.root} aria-busy="true">
      <TitleOnly />
    </div>
  );
}

/** The screen's kicker while the plan loads (or cannot be read). */
function TitleOnly() {
  return (
    <div className={s.head}>
      <div>
        <div className={s.kicker}>Calendar</div>
        <div className={s.titleRow}>
          <h1 className={s.title} tabIndex={-1}>
            {' '}
          </h1>
        </div>
      </div>
    </div>
  );
}

/** One month's calendar days and loads. Called for the month on screen and the one it fades to. */
function useMonthData(plan: PlanOut, month: IsoMonth, minMonth: IsoMonth, sel: IsoDate | null) {
  const range = neededRange(month, { isFirstMonth: month === minMonth, sel });
  const index = useCalendarIndex(range);
  const weeks = useMemo(() => index?.monthGrid(month)?.weeks ?? null, [index, month]);

  const { first, last } = monthBounds(month);
  const covered = plan.calendar.from <= first && last <= plan.calendar.to;
  const read = useLoadsRange({ from: first, to: last }, { enabled: !covered });
  const loads: Loads | undefined = covered ? plan.loads : read.data?.loads;
  return { index, weeks, loads, loadsError: covered ? null : read.error, retryLoads: read.refetch };
}

function Calendar({ plan }: { plan: PlanOut }) {
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const today = plan.today.iso;
  const minMonth = monthOf(today);

  // The months are open-ended; the end is learnt when the server says a month is out of range.
  const [maxMonth, setMaxMonth] = useState<IsoMonth | null>(null);
  const bounds = useMemo<NavBounds>(() => ({ min: minMonth, max: maxMonth }), [minMonth, maxMonth]);
  const nav = useCalendarNav(bounds);

  const shown = useMonthData(plan, nav.shown, minMonth, nav.sel);
  // Warm the month being faded to, so it is ready when the swap lands.
  const target = useMonthData(plan, nav.target, minMonth, null);

  // The furthest month that has loaded (render-phase updates here and below, no effects).
  const [loaded, setLoaded] = useState<IsoMonth>(minMonth);
  const good = monthDiff(loaded, minMonth) > 0 ? minMonth : loaded;
  if (shown.weeks && shown.loads && monthDiff(good, nav.shown) > 0) setLoaded(nav.shown);

  // A month the server cannot answer (past its read horizon). Next to a month that loaded, it
  // ends the range: remembered, so the next arrow dims and stays dimmed. Further out (a link to
  // 2099) the screen lands on the furthest month known to load, in one step, instead of
  // walking back a month at a time.
  const outOfRange = [nav.shown, nav.target].find(
    (month, k) => isRemiApiError(k === 0 ? shown.loadsError : target.loadsError, 'OUT_OF_RANGE') && monthDiff(minMonth, month) > 0,
  );
  if (outOfRange !== undefined) {
    if (monthDiff(good, outOfRange) <= 1) {
      const last = addMonths(outOfRange, -1);
      if (maxMonth === null || monthDiff(last, maxMonth) > 0) setMaxMonth(last);
    } else {
      nav.land(good);
    }
  }

  const cells = useMemo(
    () => (shown.weeks ? buildCells(shown.weeks, { today, projects: plan.projects, loads: shown.loads }) : []),
    [shown.weeks, shown.loads, today, plan.projects],
  );
  const sub = shown.weeks ? monthSubline(shown.weeks, shown.loads) : '';

  const onOpenDay = useCallback(
    (iso: IsoDate) => {
      void navigate(paths.today(iso === today ? null : iso));
    },
    [navigate, today],
  );
  const onOpenProject = useCallback(
    (projectId: string) => {
      void navigate(paths.project(projectId));
    },
    [navigate],
  );

  const atStart = nav.shown === minMonth;
  const atEnd = maxMonth !== null && monthDiff(nav.shown, maxMonth) <= 0;
  const shift = nav.fading && !reduced ? `translateX(${String(nav.dir * -10)}px)` : 'none';
  const loadsFailed = shown.loadsError !== null && !isRemiApiError(shown.loadsError, 'OUT_OF_RANGE');

  return (
    <div className={s.root} aria-busy={shown.weeks === null || (shown.loads === undefined && shown.loadsError === null)}>
      <div className={s.head}>
        <div>
          <div className={s.kicker}>Calendar</div>
          <div className={s.titleRow}>
            <h1 className={s.title} tabIndex={-1}>
              {F.monthYear(nav.shown)}
            </h1>
            <span className={s.sub}>
              {sub}
              {loadsFailed && (
                <>
                  {' · hours unavailable'}
                  <button
                    type="button"
                    className={s.retry}
                    onClick={() => {
                      void shown.retryLoads();
                    }}
                  >
                    Try again
                  </button>
                </>
              )}
            </span>
          </div>
        </div>
        <div className={s.spacer} />
        <Legend />
        <div className={s.nav}>
          <IconButton
            icon="chevron_left"
            label="Previous month"
            variant="raised"
            size={32}
            iconSize={18}
            className={s.navArrow}
            data-end={atStart}
            onClick={() => {
              nav.go(-1);
            }}
          />
          <Button variant="raised" size="s" onClick={nav.thisMonth}>
            This month
          </Button>
          <IconButton
            icon="chevron_right"
            label="Next month"
            variant="raised"
            size={32}
            iconSize={18}
            className={s.navArrow}
            data-end={atEnd}
            onClick={() => {
              nav.go(1);
            }}
          />
        </div>
      </div>

      <WeekdayHeads />
      <MonthGrid cells={cells} sel={nav.sel} fading={nav.fading} shift={shift} onPick={nav.toggle} />

      <DayPanel
        sel={nav.sel}
        plan={plan}
        index={shown.index}
        loads={shown.loads}
        onClose={nav.close}
        onStep={nav.step}
        onOpenDay={onOpenDay}
        onOpenProject={onOpenProject}
      />
    </div>
  );
}

/** 'BAU chip', 'project hours', 'milestone' (Calendar.dc.html:20-24). */
function Legend() {
  return (
    <div className={s.legend}>
      <span className={s.legendItem}>
        <span className={s.legendChip}>
          <span className={s.legendTick} />
          BAU
        </span>
        chip
      </span>
      <span className={s.legendItem}>
        <span className={s.legendBar} />
        project hours
      </span>
      <span className={s.legendItem}>
        <span className={s.legendDiamond} />
        milestone
      </span>
    </div>
  );
}
