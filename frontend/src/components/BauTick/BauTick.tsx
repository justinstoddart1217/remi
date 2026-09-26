import clsx from 'clsx';
import type { CSSProperties, ReactNode } from 'react';

import s from './BauTick.module.css';

export interface BauTickProps {
  /** Outlined once handed over or after the move; filled while it is still yours. */
  handedOver?: boolean;
  color?: 'pc' | 'fi' | (string & {});
  /** 4px wide by default; Timeline's two-week view widens ticks to carry a label. */
  width?: number;
  /** 18px on Timeline and in Foundations; 34px in the Routines "next three" list. */
  height?: number;
  /** Corner radius: 2px (Timeline, Foundations) or 1px (Routines). */
  radius?: 1 | 2;
  /** Label inside a widened tick ('Returns · 6h', 'Handed over'). */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

const COLOR: Record<string, string> = { pc: 'var(--pc-accent)', fi: 'var(--fi-accent)' };

/** BAU is a tick; a project is a bar. */
export function BauTick({
  handedOver = false,
  color = 'pc',
  width = 4,
  height = 18,
  radius = 2,
  children,
  className,
  style,
  title,
}: BauTickProps) {
  const c = COLOR[color] ?? color;
  return (
    <span
      className={clsx(s.tick, handedOver && s.handed, className)}
      title={title}
      aria-hidden={children || title ? undefined : true}
      style={{
        width,
        height,
        borderRadius: radius,
        background: handedOver ? 'transparent' : c,
        boxShadow: `inset 0 0 0 1px ${handedOver ? c : 'transparent'}`,
        ...style,
      }}
    >
      {children}
    </span>
  );
}
