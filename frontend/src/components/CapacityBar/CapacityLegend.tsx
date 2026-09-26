import clsx from 'clsx';

import { formatHours } from '../shared/domain';
import type { Domain } from '../shared/domain';
import s from './CapacityLegend.module.css';

export interface CapacityLegendProps {
  /** Hours (formatted with the prototype's `hrs`) or a preformatted string. */
  bau: number | string;
  proj: number | string;
  free: number | string;
  domain?: Domain;
  className?: string;
}

const fmt = (v: number | string) => (typeof v === 'number' ? formatHours(v) : v);

/** Today.dc.html:43-47: BAU (three 5×10 notches), Project (soft 19×10), Free (outlined 19×10). */
export function CapacityLegend({ bau, proj, free, domain = 'pc', className }: CapacityLegendProps) {
  return (
    <div className={clsx(s.legend, s[domain], className)}>
      <span className={s.entry}>
        <span className={s.notches} aria-hidden="true">
          <span className={s.notch} />
          <span className={s.notch} />
          <span className={s.notch} />
        </span>
        BAU <span className={s.value}>{fmt(bau)}</span>
      </span>
      <span className={s.entry}>
        <span className={clsx(s.swatch, s.proj)} aria-hidden="true" />
        Project <span className={s.value}>{fmt(proj)}</span>
      </span>
      <span className={s.entry}>
        <span className={clsx(s.swatch, s.free)} aria-hidden="true" />
        Free <span className={s.value}>{fmt(free)}</span>
      </span>
    </div>
  );
}
