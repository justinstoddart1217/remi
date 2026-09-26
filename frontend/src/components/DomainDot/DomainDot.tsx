import clsx from 'clsx';
import type { CSSProperties } from 'react';

import s from './DomainDot.module.css';

export interface DomainDotProps {
  /** A domain, or any CSS colour (e.g. a project's accent). */
  color: 'pc' | 'fi' | (string & {});
  /** 7px in section headers (default); 6, 7 or 8 elsewhere. */
  size?: number;
  className?: string;
  style?: CSSProperties;
}

const COLOR: Record<string, string> = { pc: 'var(--pc-accent)', fi: 'var(--fi-accent)' };

/** A filled accent dot; centred on its row's cross axis (the prototype's align-self:center). */
export function DomainDot({ color, size = 7, className, style }: DomainDotProps) {
  return (
    <span
      className={clsx(s.dot, className)}
      style={{ width: size, height: size, background: COLOR[color] ?? color, ...style }}
      aria-hidden="true"
    />
  );
}
