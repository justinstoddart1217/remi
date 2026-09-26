import clsx from 'clsx';
import type { CSSProperties } from 'react';

import { CapacityBar, CapacityLegend } from '../../components';
import type { LoadItem } from '../../components';
import { isDimmed, useHover } from '../../stores/hover';
import { capacityLabel, loadItemKey, toDayLoad } from './model';
import type { DayLoadOut } from './types';
import s from './Today.module.css';
import { useScreenHoverKey } from '../linkedHover';

export interface CapacityProps {
  title: string;
  load: DayLoadOut;
  arrived: boolean;
  /** Replays the overload pulse per day. */
  iso: string;
  style?: CSSProperties;
}

const enter = (item: LoadItem) => {
  useHover.getState().set(loadItemKey(item));
};
const leave = () => {
  useHover.getState().clear();
};

/**
 * Today.dc.html:31-52: the capacity card under the hero (a teal rule draws across its top edge),
 * with the 14px day bar (grows in after arrival) and its legend with hours.
 */
export function Capacity({ title, load, arrived, iso, style }: CapacityProps) {
  const hovered = useScreenHoverKey();
  const dayLoad = toDayLoad(load);
  return (
    <div className={clsx(s.panel, s.arrive)} style={style}>
      <span className={s.draw} aria-hidden="true" />
      <div className={s.capHead}>
        <span className={s.eyebrow}>{title}</span>
        <span className={s.capLabel} data-over={load.over ? '' : undefined}>
          {capacityLabel(load)}
        </span>
      </div>
      <CapacityBar
        variant="day"
        load={dayLoad}
        arrived={arrived}
        pulseKey={iso}
        itemDimmed={(item) => isDimmed(hovered, loadItemKey(item))}
        onItemEnter={enter}
        onItemLeave={leave}
      />
      {/* The prototype's legend swatches are always Private Credit (today.json risks). */}
      <CapacityLegend className={s.legend} bau={load.bau} proj={load.proj} free={load.free} />
    </div>
  );
}
