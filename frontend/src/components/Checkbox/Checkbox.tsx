import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { Icon } from '../Icon';
import s from './Checkbox.module.css';

/** 18px: Today funds and tasks. 16px: month rows, onboarding, drawer review. 15px: Workspace tasks. */
export type CheckboxSize = 18 | 16 | 15;

const SIZE_CLASS: Record<CheckboxSize, string | undefined> = { 18: s.s18, 16: s.s16, 15: s.s15 };

export interface CheckboxMarkProps {
  checked: boolean;
  size?: CheckboxSize;
  /** The check glyph pops 0.4 → 1 (180ms overshoot). Off for the drawer's review rows. */
  pop?: boolean;
  className?: string;
}

/**
 * The visual box only (aria-hidden), for rows whose whole surface is the control. Idle is a
 * 1.5px ink-faint outline; done is an ink fill with a paper check.
 */
export function CheckboxMark({ checked, size = 18, pop = true, className }: CheckboxMarkProps) {
  return (
    <span
      className={clsx(s.box, SIZE_CLASS[size], pop && s.pop, className)}
      data-checked={checked}
      aria-hidden="true"
    >
      <Icon name="check" className={s.glyph} />
    </span>
  );
}

export interface CheckboxProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role' | 'type' | 'children'> {
  checked: boolean;
  onChange?: (next: boolean) => void;
  size?: CheckboxSize;
  pop?: boolean;
  /**
   * Visible label. With a label the whole row is the control and the label turns ink-muted
   * with a `--done` strike-through when checked. Style the row with `className`.
   */
  children?: ReactNode;
  /** Strike colour for the checked label (the drawer's review rows use ink-faint). */
  strike?: 'done' | 'faint' | 'none';
  /** Class for the label span. */
  labelClassName?: string;
  /** Extra content after the label (e.g. an hours figure). Not struck through. */
  trailing?: ReactNode;
}

/** A `role="checkbox"` button. Without children it is just the box. */
export function Checkbox({
  checked,
  onChange,
  size = 18,
  pop = true,
  children,
  strike = 'done',
  className,
  labelClassName,
  trailing,
  onClick,
  ...rest
}: CheckboxProps) {
  const row = children !== undefined;
  return (
    <button
      {...rest}
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={clsx(row ? s.row : clsx(s.solo, SIZE_CLASS[size]), className)}
      data-checked={checked}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) onChange?.(!checked);
      }}
    >
      <CheckboxMark checked={checked} size={size} pop={pop} />
      {row && (
        <span className={clsx(s.label, strike !== 'none' && s[strike], labelClassName)}>{children}</span>
      )}
      {trailing}
    </button>
  );
}
