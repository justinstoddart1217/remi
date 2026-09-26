import clsx from 'clsx';
import { useRef } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';

import s from './SegmentedControl.module.css';

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
}

export interface SegmentedControlProps<V extends string> {
  options: readonly SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /**
   * - `pill`: Timeline zoom. Fixed-width 28px options with a --brand-deep pill that slides between them
   *   (left over 240ms --spring-soft).
   * - `compact`: Routines kind (Monthly · Weekly · Daily), 24px options, ink when selected.
   * - `mini`: Textbook chart size (S · M · L), 22px options.
   */
  variant?: 'pill' | 'compact' | 'mini';
  /** `pill` option width in px (96 on Timeline). */
  itemWidth?: number;
  /** Accessible name for the group. */
  label: string;
  className?: string;
}

/** A single-choice segmented control (a radio group with arrow-key navigation). */
export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  variant = 'pill',
  itemWidth = 96,
  label,
  className,
}: SegmentedControlProps<V>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(options.length - 1, index + step));
    const opt = options[next];
    if (opt && next !== index) {
      onChange(opt.value);
      refs.current[next]?.focus();
    }
  };

  const vars = variant === 'pill' ? ({ '--w': `${String(itemWidth)}px`, '--i': index } as CSSProperties) : undefined;
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={clsx(s.group, s[variant], className)}
      style={vars}
      onKeyDown={onKeyDown}
    >
      {variant === 'pill' && <div className={s.indicator} aria-hidden="true" />}
      {options.map((o, k) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[k] = el;
          }}
          type="button"
          role="radio"
          aria-checked={k === index}
          tabIndex={k === index ? 0 : -1}
          className={s.option}
          onClick={() => {
            if (o.value !== value) onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
