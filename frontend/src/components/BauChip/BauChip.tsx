import clsx from 'clsx';
import type { ReactNode } from 'react';

import type { Domain } from '../shared/domain';
import s from './BauChip.module.css';

export interface BauChipProps {
  domain?: Domain;
  children: ReactNode;
  /** Week-card chip: 6px padding, truncates with an ellipsis inside its column. */
  compact?: boolean;
  /** No fill (Today's milestone chips, '◆ name'). */
  plain?: boolean;
  /** A CSS colour for the tick (e.g. a project's accent) instead of the domain accent. */
  accent?: string;
  className?: string;
  title?: string;
  /**
   * The linked highlight: another item is hovered, so this chip fades to `--linked-dim` (0.28)
   * over --dur-fast. Styled by `[data-dim]`; prefer it to `opacity`.
   */
  dimmed?: boolean;
  /** An explicit opacity (a screen with its own dim value). Overrides `dimmed`. */
  opacity?: number;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

/** 20px soft chip led by a 3×10 accent tick, 11/500: 'Returns · 6h'. */
export function BauChip({
  domain = 'pc',
  children,
  compact,
  plain,
  accent,
  className,
  title,
  dimmed = false,
  opacity,
  onMouseEnter,
  onMouseLeave,
}: BauChipProps) {
  return (
    <span
      className={clsx(s.chip, s[domain], compact && s.compact, plain && s.plain, className)}
      title={title}
      data-dim={dimmed ? '' : undefined}
      style={opacity === undefined ? undefined : { opacity }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <span className={s.tick} style={accent ? { background: accent } : undefined} aria-hidden="true" />
      {compact ? <span className={s.text}>{children}</span> : children}
    </span>
  );
}
