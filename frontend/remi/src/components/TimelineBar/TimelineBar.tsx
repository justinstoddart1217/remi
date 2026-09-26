import clsx from 'clsx';
import type { CSSProperties, HTMLAttributes } from 'react';

import type { Domain } from '../shared/domain';
import s from './TimelineBar.module.css';

/**
 * - `on`: solid accent.
 * - `risk`: solid accent up to the target plus a `--risk` overrun flush against it.
 * - `done`: `--done` grey.
 * - `ghost`: the previous plan, a 1.5px dashed accent outline.
 * - `define`: no plan yet, a 135° soft hatch with a 1px accent outline.
 */
export type TimelineBarState = 'on' | 'risk' | 'done' | 'ghost' | 'define';

type Length = number | string;

/**
 * Any other HTML attribute (`data-parity`, `aria-hidden`, handlers …) lands on the bar itself,
 * so a screen can anchor or label the bar without a stand-in element.
 */
export interface TimelineBarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'style' | 'className' | 'title'> {
  state: TimelineBarState;
  domain?: Domain;
  /** Numbers are px; strings are any CSS length (Foundations uses %). */
  left?: Length;
  width: Length;
  /** Risk overrun past the target (0 hides it). */
  overrun?: Length;
  /** 3px in a 16px specimen track; 26px on a 64px Timeline row (ghost track: 41, height 7). */
  top?: number;
  height?: number;
  /** Width transition delay in ms (Timeline arrival: i × 30 + 60). */
  delay?: number;
  /** Glide left and width on --spring-soft (on by default). */
  glide?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

const px = (v: Length) => (typeof v === 'number' ? `${String(v)}px` : v);

/** A project bar and its risk overrun, absolutely placed in a `position: relative` track. */
export function TimelineBar({
  state,
  domain = 'pc',
  left = 0,
  width,
  overrun = 0,
  top = 3,
  height = 10,
  delay,
  glide = true,
  className,
  style,
  title,
  ...rest
}: TimelineBarProps) {
  const overLeft =
    typeof left === 'number' && typeof width === 'number' ? left + width : `calc(${px(left)} + ${px(width)})`;
  const trans =
    delay !== undefined ? { transitionDelay: state === 'ghost' ? `0ms, ${String(delay)}ms, 0ms` : `0ms, ${String(delay)}ms` } : undefined;
  return (
    <>
      <div
        {...rest}
        className={clsx(s.bar, s[domain], s[state], glide && s.glide, className)}
        style={{ left: px(left), width: px(width), top, height, ...trans, ...style }}
        title={title}
      />
      {state === 'risk' && (
        <div
          className={clsx(s.overrun, glide && s.glide)}
          style={{ left: px(overLeft), width: px(overrun), top, height, ...trans }}
        />
      )}
    </>
  );
}
