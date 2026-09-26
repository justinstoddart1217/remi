import clsx from 'clsx';
import type { CSSProperties } from 'react';

import s from './ForecastEndDiamond.module.css';

export interface ForecastEndDiamondProps {
  /**
   * - `bar` (default): 14px on a bar with a 2px knockout ring (`knockout` colour).
   * - `plain`: the 13px solid specimen (Foundations legend).
   * - `ghost`: the 18px dashed "was" diamond that flashes where the old plan ended.
   */
  variant?: 'bar' | 'plain' | 'ghost';
  /** Past target: risk-coloured. */
  late?: boolean;
  color?: 'pc' | 'fi' | (string & {});
  /** The ring colour: the surface behind the bar (paper on Timeline, paper-raised in panels). */
  knockout?: 'paper' | 'paper-raised';
  scale?: number;
  className?: string;
  style?: CSSProperties;
}

const COLOR: Record<string, string> = { pc: 'var(--pc-accent)', fi: 'var(--fi-accent)' };

/** Where the forecast lands (Timeline, Workspace scrubber, the signature demo). */
export function ForecastEndDiamond({
  variant = 'bar',
  late = false,
  color = 'pc',
  knockout = 'paper',
  scale,
  className,
  style,
}: ForecastEndDiamondProps) {
  const c = COLOR[color] ?? color;
  const vars: CSSProperties =
    variant === 'ghost'
      ? { borderColor: c }
      : variant === 'bar'
        ? { background: late ? 'var(--risk)' : c, borderColor: `var(--${knockout})` }
        : { background: late ? 'var(--risk)' : c };
  return (
    <span
      className={clsx(s.diamond, s[variant], className)}
      aria-hidden="true"
      style={{
        ...vars,
        transform: scale === undefined ? undefined : `rotate(45deg) scale(${String(scale)})`,
        ...style,
      }}
    />
  );
}
