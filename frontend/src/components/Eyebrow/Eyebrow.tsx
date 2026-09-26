import clsx from 'clsx';
import type { CSSProperties, ReactNode } from 'react';

import s from './Eyebrow.module.css';

export interface EyebrowProps {
  children: ReactNode;
  /**
   * Text colour.
   * - `muted` (default) or `brand`: the quiet label, 11px/500 at 0.09em in --brand-dark.
   *   (`muted` keeps its name for existing callers; it no longer renders ink-muted.)
   * - `ink`, `pc`, `fi`: 11px/600 at 0.08em in ink or a domain accent.
   * - `mint`: --brand-mint-2, for labels on the deep brand panels (pair with `variant="mono"`).
   */
  tone?: 'muted' | 'brand' | 'ink' | 'pc' | 'fi' | 'mint';
  /** `mono`: numeric 12px at 0.1em, regular (the hero labels on Today and Home). */
  variant?: 'label' | 'mono';
  as?: 'div' | 'span' | 'p' | 'h2' | 'h3';
  className?: string;
  style?: CSSProperties;
  id?: string;
}

/** The quiet section label: uppercase 11px, --brand-dark at 0.09em by default. */
export function Eyebrow({ children, tone = 'muted', variant = 'label', as: Tag = 'div', className, style, id }: EyebrowProps) {
  return (
    <Tag id={id} className={clsx(s.eyebrow, s[tone], variant === 'mono' && s.mono, className)} style={style}>
      {children}
    </Tag>
  );
}
