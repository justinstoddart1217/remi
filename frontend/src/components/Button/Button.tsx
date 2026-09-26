import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { Icon } from '../Icon';
import type { IconName } from '../Icon';
import s from './Button.module.css';

type NativeButton = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  type?: 'button' | 'submit' | 'reset';
};

export interface ButtonProps extends NativeButton {
  /**
   * - `primary`: --brand-deep fill, paper text; hover --brand-deeper; press scale(0.98).
   * - `outline`: 1px --brand-deep border, ink text; fills --brand-deep on hover (Workspace "Tell Remi").
   * - `raised`: paper-raised with a hairline border (Timeline "This week").
   * - `ghost`: no border; hover ink 5% (Textbook "Replay", "Delete").
   */
  variant?: 'primary' | 'outline' | 'raised' | 'ghost';
  /** 's' 32px/13px · 'm' 36px/14px · 'l' 40px/14px. */
  size?: 's' | 'm' | 'l';
  /** Leading Material Symbol (18px). */
  icon?: IconName;
  /** Trailing keyboard hint, e.g. '⌘↵' (numeric 11px at 0.7). */
  kbd?: string;
  children?: ReactNode;
}

/** The app's buttons. Primary is the only filled one: one per view. */
export function Button({ variant = 'primary', size = 'm', icon, kbd, children, className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button {...rest} type={type} className={clsx(s.button, s[variant], s[size], icon && s.withIcon, className)}>
      {icon && <Icon name={icon} className={s.icon} />}
      {children}
      {kbd && <span className={s.kbd}>{kbd}</span>}
    </button>
  );
}

export interface IconButtonProps extends NativeButton {
  icon: IconName;
  /** Accessible name (also the tooltip). */
  label: string;
  /** `raised`: hairline border on paper-raised (panel steppers); `plain`: bare, ink-muted (close). */
  variant?: 'raised' | 'plain';
  /** Square size in px (28, 30 or 32). */
  size?: 28 | 30 | 32;
  /** Glyph size in px (18 or 20). */
  iconSize?: 18 | 20;
}

/** Square icon button: chevrons and close in panels, pickers and the palette. */
export function IconButton({
  icon,
  label,
  variant = 'plain',
  size = 32,
  iconSize = variant === 'plain' ? 20 : 18,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={rest.title ?? label}
      className={clsx(s.iconButton, s[`ib_${variant}`], className)}
      style={{ width: size, height: size, ...rest.style }}
    >
      <Icon name={icon} style={{ fontSize: iconSize }} />
    </button>
  );
}

export interface TextLinkProps extends NativeButton {
  children: ReactNode;
  /** `strong`: 13/600 ink ('Via … ↗', 'Whole rotation ↗'). `muted`: 14px ink-muted → ink ('Routine ↗'). */
  tone?: 'strong' | 'muted';
  /** Show the north_east arrow (default on). */
  arrow?: boolean;
}

/** An inline text action with a trailing north_east arrow. */
export function TextLink({ children, tone = 'strong', arrow = true, className, type = 'button', ...rest }: TextLinkProps) {
  return (
    <button {...rest} type={type} className={clsx(s.textLink, s[`tl_${tone}`], className)}>
      {children}
      {arrow && (
        <>
          {' '}
          <Icon name="north_east" className={s.arrow} />
        </>
      )}
    </button>
  );
}

export interface AddButtonProps extends NativeButton {
  children: ReactNode;
  /**
   * - `s`: 12px, 15px glyph, gap 2 (Charter "Add").
   * - `m`: 13px, 16px glyph, gap 4 ("Add milestone").
   * - `bordered`: 28px hairline box ("New project", "Add BAU routine").
   */
  size?: 's' | 'm' | 'bordered';
}

/** '+ Add' actions: quiet, ink-muted, ink on hover. */
export function AddButton({ children, size = 'm', className, type = 'button', ...rest }: AddButtonProps) {
  return (
    <button {...rest} type={type} className={clsx(s.add, s[`add_${size}`], className)}>
      <Icon name="add" className={s.addIcon} />
      {children}
    </button>
  );
}
