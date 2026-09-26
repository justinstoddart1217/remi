import clsx from 'clsx';
import { memo, useId } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import {
  BauTick,
  DeltaChip,
  ForecastEndDiamond,
  MilestoneDiamond,
  Roll,
  RotationSegment,
  TargetMarker,
  TimelineBar,
} from '../../components';
import type { ProjectOut, RotationOut, RoutineOut } from '../../api';
import * as F from '../../lib/format';
import { hoverKey, ROTATION_KEY, sameHoverKey, useHover } from '../../stores/hover';
import type { HoverKey } from '../../stores/hover';
import { useFlash, useMoved } from '../../stores/planMoves';
import { useScreenDimmed, useScreenIsHovered } from '../linkedHover';
import type { Layout } from './geometry';
import {
  forecastText,
  milestoneTip,
  projectShortTip,
  projectTip,
  rotationNote,
  rotationSub,
  rotationTip,
  routineRowLabel,
  routineRowSub,
  routineTip,
  rowChipText,
  targetText,
  tickText,
} from './model';
import s from './Timeline.module.css';
import type { Tip } from './model';
import type { TipController } from './tip';

/** Business-day lookups the rows need (bdm of the next business day, offset from today). */
export interface BdLookups {
  todayN: number;
  moveN: number;
  bdOfNext: (iso: string) => number | null;
  bdAway: (iso: string) => number | null;
  dn: (iso: string) => number;
}

interface Common {
  layout: Layout;
  arrived: boolean;
  settled: boolean;
  tips: TipController;
  lookups: BdLookups;
}

// ---------------------------------------------------------------------------------------------
// Hover wiring shared by every lane row

/**
 * Mouse: enter sets the linked highlight and shows the row's tip at the cursor; leave clears
 * both (Timeline.dc.html:310-311, 342-345). Keyboard focus does the same, with the tip placed
 * beside the row; a focus that comes from a click leaves the cursor in charge.
 */
function laneHandlers(key: HoverKey, tip: () => Tip, tips: TipController) {
  return {
    onMouseEnter: (e: { clientX: number; clientY: number }) => {
      useHover.getState().set(key);
      tips.show(tip(), e);
    },
    onMouseMove: tips.move,
    onMouseLeave: () => {
      useHover.getState().clear();
      tips.hide();
    },
    onFocus: (e: { currentTarget: Element }) => {
      if (!e.currentTarget.matches(':focus-visible')) return;
      useHover.getState().set(key);
      tips.placeAt(e.currentTarget);
      tips.show(tip());
    },
    onBlur: (e: { currentTarget: Element }) => {
      if (e.currentTarget.matches(':hover') || !sameHoverKey(useHover.getState().key, key)) return;
      useHover.getState().clear();
      tips.hide();
    },
  };
}

/**
 * What a lane row's tip says, for assistive tech: the row's aria-describedby points here. It is
 * `hidden` (the description is still read; the page's text, and the parity capture, are not
 * changed), so the rule, stage and status note are not left to the hover tip alone.
 */
function TipText({ id, tip }: { id: string; tip: Tip }) {
  return (
    <span id={id} hidden>
      {tip.lines.join(' ')}
    </span>
  );
}

export function GroupHead({ label, domain }: { label: string; domain: 'pc' | 'fi' }) {
  return (
    <div className={clsx(s.row, s.groupHead)}>
      <h2 className={s.groupLabel} data-domain={domain}>
        {label}
      </h2>
      <div />
    </div>
  );
}

export function EmptyLane({ children }: { children: ReactNode }) {
  return (
    <div className={clsx(s.row, s.emptyRow)}>
      <div className={s.emptyText}>{children}</div>
      <div />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Private Credit · BAU (Timeline.dc.html:96-110, 308-316)

export const RoutineRow = memo(function RoutineRow({ routine: r, layout, tips, lookups }: Common & { routine: RoutineOut }) {
  const key = hoverKey('routine', r.id);
  const dim = useScreenDimmed(key);
  const tipId = useId();
  const wide = layout.zoom === '2w';
  const ticks = r.derived.occurrences.map((iso) => ({ iso, n: lookups.dn(iso) })).filter(({ n }) => n >= layout.t0 && n <= layout.t1);
  // A focus stop that shows a tip: a named group (ARIA gives no name to a plain div), described
  // by the tip's text.
  return (
    <div
      className={clsx(s.row, s.lane, s.routineRow)}
      data-dim={dim}
      role="group"
      tabIndex={0}
      aria-label={`${routineRowLabel(r)}, ${routineRowSub(r)}`}
      aria-describedby={tipId}
      {...laneHandlers(key, () => routineTip(r), tips)}
    >
      <div className={s.laneLabel}>
        <span className={s.laneName}>{routineRowLabel(r)}</span>
        <span className={s.laneSub}>{routineRowSub(r)}</span>
      </div>
      <div className={s.track}>
        {ticks.map(({ iso, n }) => {
          const after = n >= lookups.moveN || r.stage >= 3;
          const cx = layout.cx(n);
          const tw = wide ? Math.max(4, layout.rx(n) - layout.lx(n) - 10) : 4;
          return (
            <BauTick
              key={iso}
              className={s.tick}
              handedOver={after}
              width={tw}
              height={18}
              style={{ left: cx - tw / 2, paddingLeft: wide ? 8 : 0 }}
            >
              {wide ? tickText(r, after) : ''}
            </BauTick>
          );
        })}
      </div>
      <TipText id={tipId} tip={routineTip(r)} />
    </div>
  );
});

// ---------------------------------------------------------------------------------------------
// Fixed Income · BAU (Timeline.dc.html:112-125, 355-359)

export const RotationRow = memo(function RotationRow({
  rotation: rot,
  layout,
  arrived,
  settled,
  tips,
  lookups,
}: Common & { rotation: RotationOut }) {
  const dim = useScreenDimmed(ROTATION_KEY);
  const tipId = useId();
  const wide = layout.zoom === '2w';
  const note = rot.current.status === 'waiting' || rot.current.status === 'none' ? rotationNote(rot) : null;
  const startX = rot.startDate ? layout.lx(lookups.dn(rot.startDate)) : 0;
  return (
    <div
      className={clsx(s.row, s.lane, s.rotationRow)}
      data-dim={dim}
      role="group"
      tabIndex={0}
      aria-label={`${rot.title}, ${rotationSub(rot)}`}
      aria-describedby={tipId}
      {...laneHandlers(ROTATION_KEY, () => rotationTip(rot), tips)}
    >
      <div className={s.laneLabel}>
        <span className={s.laneName}>{rot.title}</span>
        <span className={s.laneSub}>{rotationSub(rot)}</span>
      </div>
      <div className={s.track} data-parity="timeline-rotation">
        {note && (
          <div className={s.rotationNote} style={{ right: Math.max(-400, layout.width - startX + 14) }}>
            {note}
          </div>
        )}
        {rot.segments.map((sg, i) => {
          const x0 = layout.lx(lookups.dn(sg.start));
          const x1 = layout.rx(lookups.dn(sg.end));
          const text = x1 - x0 > 26 ? (wide ? `${sg.country} · ${sg.pass}` : sg.code) : '';
          return (
            <RotationSegment
              key={sg.id}
              className={s.segment}
              data-parity="timeline-rotation-segment"
              pass={sg.pass === 'Refresh' ? 'Refresh' : 'Build'}
              width={arrived ? Math.max(0, x1 - x0 - 2) : 0}
              title={`${sg.country} · ${sg.pass} · ${F.s(sg.start)} – ${F.s(sg.end)}`}
              style={{
                left: x0 + 1,
                transition: `left var(--dur-slow) var(--spring-soft), width var(--dur-slow) var(--spring-soft) ${settled ? '0ms' : `${String(200 + i * 20)}ms`}`,
              }}
            >
              {text}
            </RotationSegment>
          );
        })}
      </div>
      <TipText id={tipId} tip={rotationTip(rot)} />
    </div>
  );
});

// ---------------------------------------------------------------------------------------------
// Projects (Timeline.dc.html:127-156, 318-347)

interface ProjectRowProps extends Common {
  project: ProjectOut;
  /** Running index for the arrival stagger (FI rows continue after the PC rows). */
  index: number;
  onOpen: (projectId: string) => void;
}

export const ProjectRow = memo(function ProjectRow({
  project: p,
  index,
  layout,
  arrived,
  settled,
  tips,
  lookups,
  onOpen,
}: ProjectRowProps) {
  const key = hoverKey('project', p.id);
  const dim = useScreenDimmed(key);
  const hovered = useScreenIsHovered(key);
  const flash = useFlash(p.id);
  const moved = useMoved(p.id);

  const status = p.derived.status;
  const def = status === 'define';
  const risk = status === 'risk';
  const startN = lookups.dn(p.startDate);
  const targetN = lookups.dn(p.targetDate);
  const forecastN = p.forecastDate ? lookups.dn(p.forecastDate) : null;
  const prevN = p.prevForecastDate ? lookups.dn(p.prevForecastDate) : null;
  const endN = forecastN ?? targetN;

  const a = layout.lx(startN);
  const fEnd = layout.rx(endN);
  const tEnd = layout.rx(targetN);
  const baseEnd = risk ? tEnd : fEnd;
  const delay = settled ? 0 : index * 30 + 60;
  const barWidth = arrived ? Math.max(0, baseEnd - a) : 0;
  const offRange = endN > layout.t1;
  const domain = p.domain;

  const rowTip = () => projectTip(p);
  const handlers = laneHandlers(key, rowTip, tips);
  const open = () => {
    tips.hide();
    onOpen(p.id);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  };

  return (
    <div
      className={clsx(s.row, s.lane, s.projectRow)}
      data-dim={dim}
      data-hovered={hovered}
      data-project={p.id}
      data-parity={`timeline-row:${p.id}`}
      role="button"
      tabIndex={0}
      aria-label={`${p.name}: ${forecastText(p)}, ${rowChipText(p)}. Open details`}
      onClick={open}
      onKeyDown={onKeyDown}
      {...handlers}
    >
      <div className={s.projectLabel}>
        <span className={s.projectName}>{p.name}</span>
        <span className={s.projectMeta}>
          <span className={s.rollBox}>
            <Roll value={forecastText(p)} />
          </span>
          <DeltaChip tone={risk ? 'risk' : 'neutral'} size="m" weight={500} label={rowChipText(p)} />
        </span>
      </div>
      <div className={s.track}>
        <TimelineBar
          state="ghost"
          domain={domain}
          top={41}
          height={7}
          left={a}
          width={prevN !== null ? Math.max(0, layout.rx(prevN) - a) : 0}
          style={{ opacity: prevN === null ? 0 : flash ? 1 : 0.55 }}
        />
        <TimelineBar
          state={def ? 'define' : 'on'}
          domain={domain}
          top={26}
          height={10}
          left={a}
          width={barWidth}
          delay={delay}
          data-parity={`timeline-bar:${p.id}`}
        />
        <div
          className={s.overrun}
          style={{ left: tEnd, width: arrived && risk ? Math.max(0, fEnd - tEnd) : 0, transitionDelay: `0ms, ${String(delay)}ms` }}
        />
        {p.derived.milestones.map((m) => {
          const n = lookups.dn(m.date);
          return (
            <MilestoneDiamond
              key={`${m.name}:${m.date}`}
              className={s.milestone}
              size={10}
              color={domain}
              passed={m.passed}
              scale={arrived ? 1 : 0}
              style={{ left: layout.cx(n) - 5, transitionDelay: `0ms, ${String(delay)}ms` }}
              onMouseEnter={(e) => {
                tips.show(milestoneTip(p, m, lookups.bdOfNext(m.date), lookups.bdAway(m.date)), e);
              }}
              onMouseLeave={(e) => {
                tips.show(projectShortTip(p), e);
              }}
            />
          );
        })}
        <ForecastEndDiamond
          className={s.endDiamond}
          variant="bar"
          color={domain}
          late={risk}
          scale={arrived ? 1 : 0}
          style={{ left: layout.rx(endN) - 7, opacity: def ? 0 : 1 }}
        />
        <div className={s.target} style={{ left: tEnd, opacity: def || targetN > layout.t1 ? 0 : 1 }}>
          <TargetMarker height={32} />
        </div>
        <div className={s.ghostEnd} data-flash={prevN !== null && flash} style={{ left: prevN !== null ? layout.cx(prevN) - 9 : 0 }}>
          <ForecastEndDiamond variant="ghost" color={domain} />
        </div>
        <div
          className={s.ghostLabel}
          data-flash={prevN !== null && flash}
          style={{ left: prevN !== null ? layout.cx(prevN) - 20 : 0 }}
        >
          {p.prevForecastDate ? `was ${F.dm(p.prevForecastDate)}` : ''}
        </div>
        <div className={s.moved} style={{ left: fEnd + 10 }}>
          <DeltaChip tone="risk" size="s" weight={600} show={moved !== null} label={moved?.label ?? ''} />
        </div>
        <div className={s.offRange} data-shown={offRange}>
          {offRange ? `Target ${targetText(p)} →` : ''}
        </div>
      </div>
    </div>
  );
});
