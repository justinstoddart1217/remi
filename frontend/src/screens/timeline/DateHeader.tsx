import clsx from 'clsx';
import { memo } from 'react';
import type { Ref } from 'react';

import type { DayLabel, MonthLabel, WeekLabel } from './geometry';
import s from './Timeline.module.css';

interface Props {
  areaRef: Ref<HTMLDivElement>;
  months: readonly MonthLabel[];
  weeks: readonly WeekLabel[];
  days: readonly DayLabel[];
}

/**
 * The four header tiers (Timeline.dc.html:49-67): months (pinned at the left edge while
 * clipped, hidden under 70px), ISO weeks, day pills (today inverted) and business-day numbers
 * (BD1 in ink). The chart cell is also what the screen measures for the chart width.
 */
export const DateHeader = memo(function DateHeader({ areaRef, months, weeks, days }: Props) {
  return (
    <div className={clsx(s.row, s.dateHeader)}>
      <div className={s.dateHeaderLabel}>
        <span>Day</span>
        <span>Business day</span>
      </div>
      <div ref={areaRef} className={s.area}>
        {months.map((mo) => (
          <div key={mo.key} className={s.month} data-shown={mo.visible} data-border={mo.border} style={{ left: mo.x, width: mo.w }}>
            {mo.label}
          </div>
        ))}
        {weeks.map((wk) => (
          <div key={wk.n} className={s.week} style={{ left: wk.x }}>
            {wk.label}
          </div>
        ))}
        {days.map((d) => (
          <DayCells key={d.n} d={d} />
        ))}
      </div>
    </div>
  );
});

function DayCells({ d }: { d: DayLabel }) {
  return (
    <>
      <div className={s.day} style={{ left: d.x, width: d.w }}>
        <span className={s.dayPill} data-today={d.today}>
          {d.label}
        </span>
      </div>
      <div className={s.bd} data-first={d.first} style={{ left: d.x, width: d.w }}>
        {d.bd}
      </div>
    </>
  );
}
