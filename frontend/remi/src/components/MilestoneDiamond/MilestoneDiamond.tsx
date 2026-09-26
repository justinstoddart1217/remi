import clsx from 'clsx';
import type { CSSProperties, MouseEventHandler } from 'react';

import s from './MilestoneDiamond.module.css';

export interface MilestoneDiamondProps {
  /** Filled once passed; hollow (paper) while upcoming. */
  passed?: boolean;
  /** 10px on bars and in Foundations; 9px in Workspace lists; 8px in legends and panels; 7px min. */
  size?: number;
  /** Border and fill colour: a domain accent by default. */
  color?: 'pc' | 'fi' | (string & {});
  /** Arrival scale (Timeline diamonds grow 0 → 1). */
  scale?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
  onMouseEnter?: MouseEventHandler<HTMLSpanElement>;
  onMouseLeave?: MouseEventHandler<HTMLSpanElement>;
}

const COLOR: Record<string, string> = { pc: 'var(--pc-accent)', fi: 'var(--fi-accent)' };

/** A milestone: a square rotated 45° with a 1.5px accent border. */
export function MilestoneDiamond({
  passed = false,
  size = 10,
  color = 'pc',
  scale,
  className,
  style,
  title,
  onMouseEnter,
  onMouseLeave,
}: MilestoneDiamondProps) {
  const c = COLOR[color] ?? color;
  return (
    <span
      className={clsx(s.diamond, className)}
      title={title}
      aria-hidden={title ? undefined : true}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        width: size,
        height: size,
        borderColor: c,
        background: passed ? c : 'var(--paper)',
        transform: scale === undefined ? undefined : `rotate(45deg) scale(${String(scale)})`,
        ...style,
      }}
    />
  );
}
