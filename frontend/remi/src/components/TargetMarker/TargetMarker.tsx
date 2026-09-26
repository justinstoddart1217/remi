import clsx from 'clsx';
import type { CSSProperties } from 'react';

import s from './TargetMarker.module.css';

export interface TargetMarkerProps {
  /** 32px on a 64px Timeline row and in the signature demo; 20px as a specimen; 14px in legends. */
  height?: number;
  className?: string;
  style?: CSSProperties;
}

/** The target flag, a Γ: a 1px --brand-deep upright with a 7×1 bar across its top. */
export function TargetMarker({ height = 32, className, style }: TargetMarkerProps) {
  return (
    <span className={clsx(s.marker, className)} style={{ height, ...style }} aria-hidden="true">
      <span className={s.upright} />
      <span className={s.bar} />
    </span>
  );
}
