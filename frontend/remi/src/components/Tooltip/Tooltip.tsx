import clsx from 'clsx';
import { useState } from 'react';
import type { CSSProperties, Ref } from 'react';

import s from './Tooltip.module.css';

export interface TooltipContent {
  /** Identity of the hovered thing; the prototype only re-renders when it changes. */
  key?: string;
  title: string;
  /** Right-hand status ('Overload', '6h of 8h', 'BAU', 'Milestone'). */
  chip?: string;
  /** Chip colour (CSS colour); ink-muted by default. */
  chipColor?: string;
  lines: readonly string[];
}

export interface TooltipProps {
  /** null fades the tooltip out, keeping its last content so it never blanks mid-fade. */
  tip: TooltipContent | null;
  /** 300px on Timeline, 280px in Foundations. */
  width?: number;
  /**
   * `floating` (default): absolute at 0,0 in a positioned container, pointer-events none; move
   * it with `placeTooltip`. `static`: in flow (the Foundations specimen spacing).
   */
  variant?: 'floating' | 'static';
  ref?: Ref<HTMLDivElement>;
  className?: string;
  style?: CSSProperties;
}

/** The hover card: paper-raised, hairline, radius 6, the one soft tooltip shadow. */
export function Tooltip({ tip, width = 300, variant = 'floating', ref, className, style }: TooltipProps) {
  const [shown, setShown] = useState<TooltipContent | null>(tip);
  if (tip !== null && tip !== shown) setShown(tip);
  const content = tip ?? shown;
  return (
    <div
      ref={ref}
      role="tooltip"
      aria-hidden={tip === null}
      data-visible={tip !== null}
      className={clsx(s.tip, s[variant], className)}
      style={{ width, ...style }}
    >
      {content && (
        <>
          <div className={s.head}>
            <span className={s.title}>{content.title}</span>
            {content.chip !== undefined && (
              <span className={s.chip} style={content.chipColor ? { color: content.chipColor } : undefined}>
                {content.chip}
              </span>
            )}
          </div>
          {content.lines.map((line, i) => (
            <div key={i} className={s.line}>
              {line}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
