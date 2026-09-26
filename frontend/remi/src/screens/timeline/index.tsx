import clsx from 'clsx';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useStore } from 'zustand';

import { paths } from '../../app/screens';
import { Button, EmptyState, Tooltip } from '../../components';
import { useCalendarIndex, usePlan } from '../../api';
import type { PlanOut, ProjectOut } from '../../api';
import { useArrival, useIsActiveScreen } from '../../lib/arrival';
import { dayNumber, isoFromDayNumber } from '../../lib/calendar';
import { useOverlays } from '../../stores/overlays';
import { useUi } from '../../stores/ui';
import { CapacityStrip } from './CapacityStrip';
import { DateHeader } from './DateHeader';
import {
  bands as bandsOf,
  dayLabels,
  DEFAULT_CHART_W,
  indexDays,
  layoutTimeline,
  monthLabels,
  timelineWindow,
  weekLabels,
  windowTitle,
} from './geometry';
import type { Zoom } from './geometry';
import { EmptyLane, GroupHead, ProjectRow, RotationRow, RoutineRow } from './Lanes';
import type { BdLookups } from './Lanes';
import { footnote, moveTag } from './model';
import { ProjectPanel } from './ProjectPanel';
import s from './Timeline.module.css';
import { createTipController } from './tip';
import type { TipController } from './tip';
import { TopBar } from './TopBar';

/**
 * The Timeline screen (Timeline.dc.html): a Gantt with one column per business day, the
 * capacity strip, four lanes and the project panel. Everything it shows comes from `GET /plan`;
 * the screen only lays it out.
 */
export default function TimelineScreen() {
  const plan = usePlan();
  if (plan.data) return <Timeline plan={plan.data} />;
  if (plan.isError && plan.error.code !== 'SETUP_REQUIRED') {
    return (
      <div className={s.wrap}>
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
    <div className={s.wrap} aria-busy="true">
      <TitleOnly />
    </div>
  );
}

/** The screen's title while the plan loads (or cannot be read). */
function TitleOnly() {
  const zoom = useUi((st) => st.zoom);
  return (
    <div className={s.top}>
      <div className={s.titleBlock}>
        <div className={s.eyebrow}>Timeline</div>
        <div className={s.titleRow}>
          <h1 className={s.title} tabIndex={-1}>
            {zoom === '2w' ? 'Two weeks' : 'Three months'}
          </h1>
        </div>
      </div>
    </div>
  );
}

/** Measures the chart column (the header's right cell), as the prototype's ResizeObserver. */
function useChartWidth(ref: RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(DEFAULT_CHART_W);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w) setWidth((prev) => (Math.abs(w - prev) > 1 ? w : prev));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [ref]);
  return width;
}

/**
 * Deep links (`?panel=<projectId>`, `?zoom=2w&week=<n>`), consumed once and removed from the
 * URL so the rail's "return to where you were" does not reopen them.
 */
function useDeepLinks(onPanel: (id: string) => void): void {
  const active = useIsActiveScreen();
  const { pathname, search, key } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (!active || !search) return;
    const params = new URLSearchParams(search);
    const panel = params.get('panel');
    const zoom = params.get('zoom');
    const week = params.get('week');
    if (panel === null && zoom === null && week === null) return;
    if (zoom === '2w' || zoom === '3m') useUi.getState().setZoom(zoom, zoom === '2w' ? Number(week ?? 0) || 0 : 0);
    if (panel) onPanel(panel);
    params.delete('panel');
    params.delete('zoom');
    params.delete('week');
    const rest = params.toString();
    void navigate({ pathname, search: rest ? `?${rest}` : '' }, { replace: true });
  }, [active, pathname, search, key, navigate, onPanel]);
}

function Timeline({ plan }: { plan: PlanOut }) {
  const navigate = useNavigate();
  const areaRef = useRef<HTMLDivElement>(null);
  const [tips] = useState<TipController>(createTipController);
  const attachWrap = useCallback(
    (el: HTMLDivElement | null) => {
      tips.setElements({ wrap: el });
    },
    [tips],
  );
  const width = useChartWidth(areaRef);
  const { arrived, settled, attrs } = useArrival();

  const zoom = useUi((st) => st.zoom);
  const zoomWeek = useUi((st) => st.zoomWeek);
  const setZoom = useUi((st) => st.setZoom);

  const [panelId, setPanelId] = useState<string | null>(null);
  const closePanel = useCallback(() => {
    setPanelId(null);
  }, []);
  useDeepLinks(setPanelId);

  // ---- window and calendar
  const todayIso = plan.today.iso;
  const moveIso = plan.settings.moveDate ?? plan.move.date;
  const wanted = useMemo(() => timelineWindow(todayIso, moveIso), [todayIso, moveIso]);
  const index = useCalendarIndex({ from: isoFromDayNumber(wanted.t0), to: isoFromDayNumber(wanted.t1) });
  const days = useMemo(() => indexDays(index?.days ?? plan.calendar.days), [index, plan.calendar.days]);
  const win = useMemo(
    () => timelineWindow(todayIso, moveIso, { first: index?.first ?? plan.calendar.from, last: index?.last ?? plan.calendar.to }),
    [todayIso, moveIso, index, plan.calendar.from, plan.calendar.to],
  );
  const week = Math.max(win.wkMin, Math.min(win.wkMax, zoomWeek));

  const layout = useMemo(
    () => layoutTimeline({ days, t0: win.t0, t1: win.t1, zoom, week, anchor: win.anchor, width }),
    [days, win, zoom, week, width],
  );
  const todayN = dayNumber(todayIso);
  const moveN = dayNumber(moveIso);
  const header = useMemo(
    () => ({ months: monthLabels(layout, days), weeks: weekLabels(layout, days), days: dayLabels(layout, days, todayN) }),
    [layout, days, todayN],
  );
  const bands = useMemo(() => bandsOf(layout, days), [layout, days]);
  const { title, subtitle } = windowTitle(layout);

  const lookups = useMemo<BdLookups>(() => {
    const bdOfNext = (iso: string) => {
      const next = index?.nextBD(iso);
      return next ? (index?.bdOfMonth(next) ?? null) : null;
    };
    const bdAway = (iso: string) => index?.bdDiff(todayIso, iso) ?? null;
    return { todayN, moveN, bdOfNext, bdAway, dn: dayNumber };
  }, [index, todayIso, todayN, moveN]);

  // ---- zoom and pan
  const onZoom = useCallback(
    (z: Zoom) => {
      setZoom(z, z === '2w' ? week : 0);
    },
    [setZoom, week],
  );
  const onPrev = useCallback(() => {
    setZoom('2w', Math.max(win.wkMin, week - 1));
  }, [setZoom, win.wkMin, week]);
  const onNext = useCallback(() => {
    setZoom('2w', Math.min(win.wkMax, week + 1));
  }, [setZoom, win.wkMax, week]);
  const onThisWeek = useCallback(() => {
    setZoom('2w', 0);
  }, [setZoom]);

  // ---- panel
  const onOpenRow = useCallback((id: string) => {
    setPanelId(id);
  }, []);
  const onOpenWorkspace = useCallback(
    (id: string) => {
      setPanelId(null);
      void navigate(paths.project(id));
    },
    [navigate],
  );
  const onTellRemi = useCallback((id: string) => {
    useOverlays.getState().openDrawer(id);
  }, []);
  const panelProject: ProjectOut | null = panelId ? (plan.projects.find((p) => p.id === panelId) ?? null) : null;

  // Hide the tip when the screen goes idle (the section is hidden, not unmounted).
  const active = useIsActiveScreen();
  useEffect(() => {
    if (!active) tips.hide();
  }, [active, tips]);

  const pc = plan.projects.filter((p) => p.domain === 'pc');
  const fi = plan.projects.filter((p) => p.domain === 'fi');
  const rotation = plan.rotation;
  const moveX = layout.lx(moveN);
  const common = { layout, arrived, settled, tips, lookups };
  // An empty plan has no lanes over the slivers, so the footnote is the first text they would
  // cross: there the slivers stop above it, where the today and move lines already end.
  const empty = plan.routines.length === 0 && plan.projects.length === 0 && rotation.segments.length === 0;

  return (
    <div ref={attachWrap} className={s.wrap} {...attrs}>
      <TopBar
        title={title}
        subtitle={subtitle}
        zoom={zoom}
        onZoom={onZoom}
        onPrev={onPrev}
        onThisWeek={onThisWeek}
        onNext={onNext}
        canPrev={week > win.wkMin}
        canNext={week < win.wkMax}
      />

      <div className={s.chart} data-empty={empty || undefined}>
        <div className={s.layer} aria-hidden="true">
          {bands.map((b) => (
            <div key={b.a} className={s.band} data-holiday={b.holiday} style={{ left: b.x, width: b.w }} />
          ))}
        </div>

        <DateHeader areaRef={areaRef} months={header.months} weeks={header.weeks} days={header.days} />

        <CapacityStrip
          layout={layout}
          days={days}
          loads={plan.loads}
          capacity={plan.settings.capacityHoursPerDay}
          moveX={moveX}
          moveLabel={moveTag(moveIso)}
          arrived={arrived}
          settled={settled}
          tips={tips}
        />

        <div className={s.lanes}>
          <GroupHead label="Private Credit · BAU" domain="pc" />
          {plan.routines.length === 0 ? (
            <EmptyLane>No routines yet.</EmptyLane>
          ) : (
            plan.routines.map((r) => <RoutineRow key={r.id} routine={r} {...common} />)
          )}

          <GroupHead label="Private Credit · Projects" domain="pc" />
          {pc.length === 0 ? (
            <EmptyLane>No Private Credit projects yet.</EmptyLane>
          ) : (
            pc.map((p, i) => <ProjectRow key={p.id} project={p} index={i} onOpen={onOpenRow} {...common} />)
          )}

          <GroupHead label="Fixed Income · BAU" domain="fi" />
          {rotation.segments.length === 0 ? (
            <EmptyLane>No rotation set up.</EmptyLane>
          ) : (
            <RotationRow rotation={rotation} {...common} />
          )}

          <GroupHead label="Fixed Income · Projects" domain="fi" />
          {fi.length === 0 ? (
            <EmptyLane>No Fixed Income projects yet.</EmptyLane>
          ) : (
            fi.map((p, i) => <ProjectRow key={p.id} project={p} index={pc.length + i} onOpen={onOpenRow} {...common} />)
          )}
          <div className={s.lanesEnd} />
        </div>

        <div className={s.footnote}>{footnote(plan.calendar.region, empty)}</div>

        <div className={clsx(s.layer, s.lines)} aria-hidden="true">
          <div className={s.todayLine} style={{ left: layout.cx(todayN) }} />
          <div className={s.moveLine} style={{ left: moveX }} />
        </div>
      </div>

      <TipLayer tips={tips} />

      <ProjectPanel project={panelProject} onClose={closePanel} onOpenWorkspace={onOpenWorkspace} onTellRemi={onTellRemi} />
    </div>
  );
}

/** The one tooltip; only it re-renders when the tip changes. */
function TipLayer({ tips }: { tips: TipController }) {
  const tip = useStore(tips.store, (st) => st.tip);
  const attachTip = useCallback(
    (el: HTMLDivElement | null) => {
      tips.setElements({ tip: el });
    },
    [tips],
  );
  return <Tooltip ref={attachTip} tip={tip} width={300} />;
}
