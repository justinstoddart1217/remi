import clsx from 'clsx';
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

import s from './RotationSegment.module.css';

export type RotationPass = 'Build' | 'Refresh';

/** Any other HTML attribute (`data-parity`, handlers …) lands on the stop's own element. */
export interface RotationSegmentProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'style' | 'className' | 'title'> {
  pass: RotationPass;
  /** 'DE · Build' in Foundations and the two-week view; the country code in three months. */
  children?: ReactNode;
  /** Width in px (proportional to business days). */
  width?: number | string;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

/** A rotation stop: Build is a solid outline with a soft fill; Refresh is dashed and unfilled. */
export function RotationSegment({ pass, children, width, className, style, title, ...rest }: RotationSegmentProps) {
  return (
    <span
      {...rest}
      className={clsx(s.seg, pass === 'Build' ? s.build : s.refresh, className)}
      style={{ width, ...style }}
      title={title}
    >
      {children}
    </span>
  );
}
