import clsx from 'clsx';
import { memo, useMemo } from 'react';

import { CapacityBar } from '../../components';
import type { LoadItem } from '../../components';
import type { DayLoadOut } from '../../api';
import type { CalendarDay } from '../../lib/calendar';
import { useScreenDimMask } from '../linkedHover';
import type { Layout } from './geometry';
import { capacityCaption, dayTip, loadItemKey } from './model';
import type { Tip } from './model';
import s from './Timeline.module.css';
import type { TipController } from './tip';

function emptyLoad(capacity: number): DayLoadOut {
  return { items: [], bau: 0, proj: 0, total: 0, free: capacity, capacity, over: false };
}

interface Props {
  layout: Layout;
  days: ReadonlyMap<number, CalendarDay>;
  loads: Readonly<Record<string, DayLoadOut>>;
  capacity: number;
  moveX: number;
  moveLabel: string;
  arrived: boolean;
  settled: boolean;
  tips: TipController;
}

interface ColumnProps {
  left: number;
  width: number;
  load: DayLoadOut;
  tip: Tip | null;
  arrived: boolean;
  delay: number;
  tips: TipController;
}

/**
 * One day's column. It subscribes to the linked highlight itself, as a mask of which of its
 * own items are dimmed, so a lane hover re-renders only the columns whose segments change, and
 * each segment dims by `[data-dim]` to --linked-dim (never an inline opacity per segment).
 */
const CapacityColumn = memo(function CapacityColumn({ left, width, load, tip, arrived, delay, tips }: ColumnProps) {
  const keys = useMemo(() => load.items.map(loadItemKey), [load.items]);
  const mask = useScreenDimMask(keys);
  const itemDimmed = useMemo(() => {
    const dimmed = new Set(keys.filter((_, i) => mask[i] === '1').map((k) => `${k.type}:${k.id}`));
    return (item: LoadItem) => {
      const k = loadItemKey(item);
      return dimmed.has(`${k.type}:${k.id}`);
    };
  }, [keys, mask]);
  return (
    <div
      className={s.capCol}
      style={{ left, width }}
      onMouseEnter={(e) => {
        if (tip) tips.show(tip, e);
      }}
      onMouseMove={tips.move}
      onMouseLeave={tips.hide}
    >
      <CapacityBar
        load={load}
        variant="strip"
        arrived={arrived}
        delay={delay}
        width={Math.max(3, Math.min(width - 5, 30))}
        itemDimmed={itemDimmed}
        label={tip ? `${tip.title}: ${tip.chip}` : undefined}
      />
    </div>
  );
});

/**
 * One stacked bar per business day at 5px an hour, BAU notched at the bottom, projects soft
 * with an accent outline; overloaded days turn red and pulse once (Timeline.dc.html:69-87,
 * 296-306). Hovering a column shows the day tip; hovering a lane dims the other segments.
 */
export const CapacityStrip = memo(function CapacityStrip({
  layout,
  days,
  loads,
  capacity,
  moveX,
  moveLabel,
  arrived,
  settled,
  tips,
}: Props) {
  const empty = useMemo(() => emptyLoad(capacity), [capacity]);

  return (
    <div className={clsx(s.row, s.capacity)}>
      <div className={s.capacityLabel}>
        <div className={s.eyebrow}>Capacity</div>
        <div className={s.capacityCaption}>
          {capacityCaption(capacity)}
          <br />
          Notched = BAU, solid = project.
        </div>
      </div>
      <div className={s.area}>
        {/* The capacity line: 10px padding + 5px an hour + 1 (bottom 51px for the design's 8h). */}
        <div className={s.capacityLine} style={{ bottom: 11 + capacity * 5 }} />
        {layout.bdSlots.map((sl, i) => {
          const day = days.get(sl.a);
          const load = (day && loads[day.iso]) ?? empty;
          return (
            <CapacityColumn
              key={sl.a}
              left={sl.x - layout.off}
              width={sl.w}
              load={load}
              tip={day ? dayTip(day, load) : null}
              arrived={arrived}
              delay={settled ? 0 : Math.round(i * 2.5)}
              tips={tips}
            />
          );
        })}
        <div className={s.moveTag} style={{ left: moveX + 6 }}>
          {moveLabel}
        </div>
      </div>
    </div>
  );
});
