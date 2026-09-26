import clsx from 'clsx';

import s from './BdStepper.module.css';

export interface BdStepperProps {
  /** Business day of the month. */
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Accessible name for the group ('Business day of the month'). */
  label?: string;
  className?: string;
}

/** − BDn + (Routines monthly rule): 28px, hairline border, paper-raised. */
export function BdStepper({ value, onChange, min = 1, max = 20, label = 'Business day of the month', className }: BdStepperProps) {
  return (
    <div className={clsx(s.stepper, className)} role="group" aria-label={label}>
      <button
        type="button"
        className={s.step}
        aria-label="Earlier business day"
        disabled={value <= min}
        onClick={() => {
          onChange(Math.max(min, value - 1));
        }}
      >
        −
      </button>
      <span className={s.value} aria-live="polite">
        BD{value}
      </span>
      <button
        type="button"
        className={s.step}
        aria-label="Later business day"
        disabled={value >= max}
        onClick={() => {
          onChange(Math.min(max, value + 1));
        }}
      >
        +
      </button>
    </div>
  );
}
