import type { CSSProperties } from 'react';
import { useMemo } from 'react';

import { useCalendarIndex, useLoads, useMove, usePlanSettings, useProjects, useReplanPreview, useToday } from '../../api';
import type { HomeOut } from '../../api';
import { DeltaChip, Roll } from '../../components';
import { useArrival } from '../../lib/arrival';
import s from './Home.module.css';
import {
  capacityBars,
  ganttRows,
  HOVER_EXTRA_HOURS,
  keyFooter,
  makeAxis,
  MOVE_X,
  pct,
  planMeta,
  ROW_STEP,
  ROW_TOP,
  TODAY_X,
} from './model';
import type { HoverLoad } from './model';

interface Props {
  home: HomeOut | undefined;
  hover: boolean;
  /** The page's arrival (the card fading in). The preview grows once this and its data are in. */
  arrived: boolean;
}

const vars = (v: Record<string, string>) => v as CSSProperties;

/**
 * The Control Panel card's preview (Remi Home.dc.html:80-105): capacity strip, mini Gantt,
 * today and move lines, and the key project's forecast with its delta. Hovering plays the
 * prototype's demo with the server's numbers: the key project with six more hours of work.
 *
 * Arrival: the prototype's data is static, so its bars (height, i×12ms), rows (width,
 * i×50+80ms) and diamonds (scale) always grow in with the card. Here the plan can land after
 * the card has arrived, and elements that mount at their final size never transition, so the
 * preview has its own arrival that waits for both the card and its data (as Today waits for
 * its day). Under reduced motion it has arrived from the start, so nothing grows or pops.
 */
export function ControlPanelPreview({ home, hover, arrived: cardArrived }: Props) {
  const projects = useProjects();
  const loads = useLoads();
  const move = useMove();
  const settings = usePlanSettings();
  const today = useToday();
  const index = useCalendarIndex();

  const key = home?.keyProject ?? null;
  const keyPlan = projects?.find((p) => p.id === key?.id);
  const workLeft = keyPlan?.forecastDate ? keyPlan.derived.workLeft : null;
  // Asked for as soon as Home shows, so the hover has its numbers ready.
  const demo = useReplanPreview(workLeft !== null ? key?.id : null, workLeft !== null ? { workLeft: workLeft + HOVER_EXTRA_HOURS } : null);
  const demoOut = demo.data && demo.data.projectId === key?.id ? demo.data : null;

  const axis = useMemo(
    () => (index && today ? makeAxis(index, today.iso, move?.date ?? null) : null),
    [index, today, move?.date],
  );

  const hoverLoad = useMemo<HoverLoad | null>(
    () => (hover && demoOut ? { projectId: demoOut.projectId, planFrom: demoOut.derived.planFrom, dayHours: demoOut.derived.dayHours, overDays: demoOut.derived.overDays } : null),
    [hover, demoOut],
  );

  const bars = useMemo(
    () =>
      axis && index && loads && today
        ? capacityBars(index, loads, axis, today.iso, settings?.capacityHoursPerDay ?? 8, hoverLoad)
        : [],
    [axis, index, loads, today, settings?.capacityHoursPerDay, hoverLoad],
  );

  const rows = useMemo(
    () =>
      axis && projects
        ? ganttRows(projects, axis, hover, demoOut ? { projectId: demoOut.projectId, forecast: demoOut.toForecast } : null)
        : [],
    [axis, projects, hover, demoOut],
  );

  const ready = axis !== null && loads !== undefined && projects !== undefined;
  const { arrived } = useArrival(cardArrived && ready);

  const foot = keyFooter(key, hover && demoOut ? { forecast: demoOut.toForecast, deltaBd: demoOut.derived.deltaBd } : null);
  const showMove = axis?.moveOff != null;

  return (
    <div className={s.preview}>
      <div className={s.strip}>
        {bars.map((b, i) => (
          <div
            key={i}
            className={s.bar}
            data-tone={b.tone}
            data-empty={b.h === 0 ? '' : undefined}
            style={{ height: arrived ? `${String(b.h * 100)}%` : '0%', ...vars({ '--d': `${String(i * 12)}ms` }) }}
          />
        ))}
      </div>
      <div className={s.stripRule} />
      {rows.map((r, i) => (
        <div key={r.id} className={s.row} data-domain={r.domain} style={{ top: ROW_TOP + i * ROW_STEP, ...vars({ '--d': `${String(i * 50 + 80)}ms` }) }}>
          <div className={s.ghost} style={{ left: pct(r.gx), width: pct(r.gw), opacity: r.go }} />
          <div className={s.rowBar} data-hatch={r.hatch} style={{ left: pct(r.x), width: pct(arrived ? r.w : 0) }} />
          <div className={s.overrun} style={{ left: pct(r.ox), width: pct(arrived ? r.ow : 0) }} />
          {r.ms.map((m, k) => (
            <div key={k} className={s.diamond} style={{ left: pct(m), transform: `rotate(45deg) scale(${arrived ? '1' : '0'})` }} />
          ))}
        </div>
      ))}
      <div className={s.todayLine} style={{ left: pct(TODAY_X) }} />
      {showMove ? <div className={s.moveLine} style={{ left: pct(MOVE_X) }} /> : null}

      <div className={s.cardFoot}>
        <span className={s.keyName}>{foot.name}</span>
        <span className={s.keyDate}>
          <Roll value={foot.forecast} />
        </span>
        <DeltaChip tone={foot.tone} size="l" weight={600}>
          <span className={s.pillRoll}>
            <Roll value={foot.delta} />
          </span>
        </DeltaChip>
        <span className={s.spacer} />
        <span className={s.meta}>{home ? planMeta(home.projectCount, home.routineCount, home.notesToday) : ''}</span>
      </div>
    </div>
  );
}
