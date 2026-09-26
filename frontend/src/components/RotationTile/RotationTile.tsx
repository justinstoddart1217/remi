import clsx from 'clsx';
import type { CSSProperties } from 'react';

import type { RotationPass } from '../RotationSegment';
import s from './RotationTile.module.css';

export interface RotationTileProps {
  /** Two-digit position ('01'); omitted on Transition's first-rotation tiles. */
  index?: string;
  code: string;
  country: string;
  pass: RotationPass;
  /** '4 Jan – 11 Jan · 6 BD' (en dash). */
  dates: string;
  /** A second mono line ('Refresh 9 Mar – 11 Mar'). */
  extra?: string;
  /** The current stop: a 1.5px border (ink, or --brand-deep with `currentTone="brand"`). */
  current?: boolean;
  /** The current border's colour: `ink` (default: Routines, Transition) or `brand` (Foundations). */
  currentTone?: 'ink' | 'brand';
  /** --brand-deep flag over the top edge ('First up · Mon 4 Jan'). */
  flag?: string;
  /**
   * `m`: Foundations and Transition (16px name, 18px pill). `l`: the Routines track
   * (112px tall, 18px name, 20px pill).
   */
  size?: 'm' | 'l';
  /** Always use the soft pill fill (Transition draws Refresh pills filled too). */
  filledPill?: boolean;
  /** Top row cross-axis alignment: centred (Routines, Transition) or stretched (Foundations). */
  topAlign?: 'center' | 'stretch';
  className?: string;
  style?: CSSProperties;
}

/** A country on the Fixed Income rotation. */
export function RotationTile({
  index,
  code,
  country,
  pass,
  dates,
  extra,
  current = false,
  currentTone = 'ink',
  flag,
  size = 'm',
  filledPill = false,
  topAlign = 'center',
  className,
  style,
}: RotationTileProps) {
  return (
    <div className={clsx(s.tile, s[size], current && s.current, current && currentTone === 'brand' && s.brand, className)} style={style}>
      <div className={clsx(s.top, topAlign === 'stretch' && s.stretch)}>
        <span className={s.code}>{index ? `${index} · ${code}` : code}</span>
        <span className={clsx(s.pill, (pass === 'Build' || filledPill) && s.filled)}>{pass}</span>
      </div>
      <span className={s.country}>{country}</span>
      <span className={s.mono}>{dates}</span>
      {extra && <span className={s.mono}>{extra}</span>}
      {flag && <span className={s.flag}>{flag}</span>}
    </div>
  );
}
