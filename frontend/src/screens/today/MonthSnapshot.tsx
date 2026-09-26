import clsx from 'clsx';
import { Fragment, useState } from 'react';
import type { CSSProperties } from 'react';

import { Checkbox, Roll } from '../../components';
import type { CalendarIndex } from '../../lib/calendar';
import { dm, monL } from '../../lib/format';
import { hoverHandlers, isDimmed } from '../../stores/hover';
import { dueLabel, monthBars, monthGroups, overlayRows, rowHoverKey, rowText } from './model';
import type { GroupKey } from './model';
import type { MonthSnapshotOut, MonthSnapshotRowOut } from './types';
import s from './Today.module.css';
import { useScreenHoverKey } from '../linkedHover';

export interface MonthSnapshotProps {
  snapshot: MonthSnapshotOut;
  arrived: boolean;
  /** Covers the month and any overdue due dates before it (for 'overdue N BD'). */
  calendar: CalendarIndex | undefined;
  /** The shown done state of a row (server value, or an optimistic tick in flight). */
  done: (key: string, server: boolean) => boolean;
  onToggle: (row: MonthSnapshotRowOut, next: boolean) => void;
  style?: CSSProperties;
}

/**
 * Today.dc.html:180-218, "October so far": the cumulative bars (done, overdue, due by then),
 * then the BAU (4) and Projects (5) groups with 'Show N more and N done'. Always today's
 * month; the counts are the server's.
 */
export function MonthSnapshot({ snapshot, arrived, calendar, done, onToggle, style }: MonthSnapshotProps) {
  const [open, setOpen] = useState<Partial<Record<GroupKey, boolean>>>({});
  const hovered = useScreenHoverKey();
  const { today, totals } = snapshot;
  const { rows, done: doneN, late: lateN } = overlayRows(snapshot.rows, totals, today, done);
  const bars = monthBars(snapshot.bars, totals.total, today, arrived);
  const groups = monthGroups(rows, open);
  // Start-empty: no chart of zeros and no count, just the groups' own "Nothing due this
  // month." (the design's empty line), said once per group rather than again in the header.
  const nothingDue = totals.total === 0 && rows.length === 0;

  return (
    <div className={s.arrive} style={style}>
      <div className={s.sectionHead}>
        <span className={s.sectionTitle}>{monL(today)} so far</span>
        {nothingDue ? null : (
          <span className={s.monthCount}>
            <span className={s.monthDone}>
              <Roll value={String(doneN)} />
            </span>
            <span>of {totals.total} done</span>
            {lateN > 0 && <span className={s.monthLate}>· {lateN} overdue</span>}
          </span>
        )}
      </div>
      {!nothingDue && (
        <>
          <div className={s.bars}>
            {bars.map((b) => (
              <div key={b.iso} className={s.bar} title={b.title}>
                <div className={s.barPlan} data-past={b.past ? '' : undefined} style={{ height: b.plan }} />
                <div className={s.barLate} style={{ height: b.late, '--d': b.delay } as CSSProperties} />
                <div className={s.barDone} style={{ height: b.done, '--d': b.delay } as CSSProperties} />
                {b.today && <div className={s.barToday} />}
              </div>
            ))}
          </div>
          <div className={s.axis}>
            <span>{dm(snapshot.from)}</span>
            <span>{dm(snapshot.to)}</span>
          </div>
          <div className={s.monthLegend}>
            <span className={s.monthKey}>
              <span className={clsx(s.swatch, s.swatchDone)} />
              Done
            </span>
            <span className={s.monthKey}>
              <span className={clsx(s.swatch, s.swatchLate)} />
              Overdue
            </span>
            <span className={s.monthKey}>
              <span className={clsx(s.swatch, s.swatchDue)} />
              Due by then
            </span>
          </div>
        </>
      )}
      {groups.map((g) => (
        <Fragment key={g.key}>
          <div className={s.groupHead}>
            <span className={s.eyebrow}>{g.label}</span>
            <span className={s.spacer} />
            <span className={s.groupTrack}>
              <span className={s.groupFill} style={{ width: g.pct }} />
            </span>
            <span className={s.groupCount}>{g.count}</span>
          </div>
          {g.rows.map((row) => {
            const own = rowHoverKey(row);
            const due = dueLabel(row, today, row.late ? (calendar?.bdDiff(row.due, today) ?? null) : null, snapshot.from);
            const text = rowText(row);
            return (
              <div
                key={row.key}
                className={s.monthRow}
                data-dim={own && isDimmed(hovered, own) ? 'true' : undefined}
                {...(own ? hoverHandlers(own) : {})}
              >
                <Checkbox
                  checked={row.done}
                  size={16}
                  aria-label={`${text} · ${row.sub}`}
                  onChange={(next) => {
                    onToggle(row, next);
                  }}
                />
                <span className={s.monthText}>
                  <span className={s.monthItem} data-done={row.done ? '' : undefined}>
                    {text}
                  </span>
                  <span className={s.monthSub}>{` · ${row.sub}`}</span>
                </span>
                <span className={s.due} data-tone={due.tone}>
                  {due.text}
                </span>
              </div>
            );
          })}
          {g.empty && <div className={s.groupEmpty}>{g.empty}</div>}
          {g.more && (
            <button
              type="button"
              className={s.showMore}
              aria-expanded={!!open[g.key]}
              onClick={() => {
                setOpen((o) => ({ ...o, [g.key]: !o[g.key] }));
              }}
            >
              {g.more}
            </button>
          )}
        </Fragment>
      ))}
    </div>
  );
}
