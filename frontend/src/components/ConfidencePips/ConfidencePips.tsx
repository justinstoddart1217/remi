import clsx from 'clsx';

import s from './ConfidencePips.module.css';

export interface ConfidencePipsProps {
  /** 1–5, or null when not set ('—'). */
  value: number | null;
  /** 's' 10×8 pips (Projects), 'm' 12×8 (Workspace header). */
  size?: 's' | 'm';
  /** 'N/5' after the pips (default on). */
  showLabel?: boolean;
  /** Label colour: ink-muted (Projects) or ink (Workspace). */
  labelTone?: 'muted' | 'ink';
  className?: string;
}

/** A read-only 5-pip confidence meter: filled pips are ink, the rest hairline. */
export function ConfidencePips({ value, size = 's', showLabel = true, labelTone = 'muted', className }: ConfidencePipsProps) {
  const label = value != null ? `${String(value)}/5` : '—';
  return (
    <span
      className={clsx(s.meter, className)}
      role="img"
      aria-label={value != null ? `Confidence ${String(value)} of 5` : 'Confidence not set'}
    >
      <span className={clsx(s.pips, s[size])} aria-hidden="true">
        {[1, 2, 3, 4, 5].map((k) => (
          <span key={k} className={s.pip} data-on={value != null && k <= value} />
        ))}
      </span>
      {showLabel && (
        <span className={clsx(s.label, s[labelTone])} aria-hidden="true">
          {label}
        </span>
      )}
    </span>
  );
}
