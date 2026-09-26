import clsx from 'clsx';
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import s from './DeltaChip.module.css';

/**
 * - `risk`: a slip ('+3 BD'), risk 22% into paper with risk 40% into ink text.
 * - `neutral`: a gain ('−1 BD'), 'On target', 'no plan': hairline outline, ink-muted text.
 * - `overload`: overload 14% into paper with overload 75% into ink text.
 * Only a slip gets colour; on track is the neutral default.
 */
export type DeltaTone = 'risk' | 'neutral' | 'overload';

export interface DeltaChipProps {
  tone: DeltaTone;
  /** 'l' 22px (Foundations, Workspace header) · 'm' 20px (Projects, Timeline) · 's' 18px (moved chip). */
  size?: 'l' | 'm' | 's';
  weight?: 400 | 500 | 600;
  /** The label. A string is latched while `show` fades the chip out, so the text survives. */
  label?: string;
  /** Custom content (e.g. a Roll) instead of `label`. */
  children?: ReactNode;
  /**
   * Fade-and-scale presence for the "moved" chip: opacity 180ms and scale 0.9 → 1 from the left
   * edge. Omit for an always-visible chip.
   */
  show?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

/** The delta chip, one recipe across Projects, Timeline, Workspace, Transition and Home. */
export function DeltaChip({
  tone,
  size = 'l',
  weight = 500,
  label,
  children,
  show,
  className,
  style,
  title,
}: DeltaChipProps) {
  const [kept, setKept] = useState(label);
  if (label !== undefined && label !== kept && show !== false) setKept(label);
  const text = show === false ? kept : label;
  return (
    <span
      className={clsx(s.chip, s[tone], s[size], s[`w${String(weight)}`], show !== undefined && s.presence, className)}
      data-show={show}
      style={style}
      title={title}
      aria-hidden={show === false ? true : undefined}
    >
      {children ?? text}
    </span>
  );
}
