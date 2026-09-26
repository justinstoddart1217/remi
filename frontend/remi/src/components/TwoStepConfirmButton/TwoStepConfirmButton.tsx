import clsx from 'clsx';
import { useEffect, useState } from 'react';

import s from './TwoStepConfirmButton.module.css';

export interface TwoStepConfirmButtonProps {
  /** Idle label ('Remove project', 'Remove', 'Delete'). */
  label: string;
  /** Armed label ('Click again to remove …'). */
  armedLabel: string;
  onConfirm: () => void;
  /** Disarm after this many ms (Workspace and Routines 4000, Textbook 3500). */
  timeout?: number;
  /** `text`: bare, underline on hover. `ghost`: 32px, hover ink 5% (Textbook). */
  variant?: 'text' | 'ghost';
  /** Idle colour: ink-muted or ink-faint (Routines). Armed is always --overload. */
  tone?: 'muted' | 'faint';
  /** Font size in px: 13 (Workspace, Textbook) or 12 (Routines). */
  size?: 12 | 13;
  className?: string;
  title?: string;
}

/**
 * A destructive action that needs two clicks: the first arms it (overload colour, new label),
 * the second confirms. It disarms by itself after `timeout`. Remount it (key) to reset.
 */
export function TwoStepConfirmButton({
  label,
  armedLabel,
  onConfirm,
  timeout = 4000,
  variant = 'text',
  tone = 'muted',
  size = 13,
  className,
  title,
}: TwoStepConfirmButtonProps) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => {
      setArmed(false);
    }, timeout);
    return () => {
      clearTimeout(t);
    };
  }, [armed, timeout]);

  return (
    <button
      type="button"
      className={clsx(s.button, s[variant], s[tone], size === 12 ? s.f12 : s.f13, className)}
      data-armed={armed}
      title={title}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? armedLabel : label}
    </button>
  );
}
