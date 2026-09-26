import clsx from 'clsx';

import s from './WeekdayPicker.module.css';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;

export interface WeekdayPickerProps {
  /** ISO weekday, 1 (Mon) to 5 (Fri). */
  value: number;
  onChange: (weekday: number) => void;
  label?: string;
  className?: string;
}

/** Mon–Fri single choice (Routines weekly rule): 30×28 buttons, the chosen one inked. */
export function WeekdayPicker({ value, onChange, label = 'Weekday', className }: WeekdayPickerProps) {
  return (
    <div className={clsx(s.days, className)} role="radiogroup" aria-label={label}>
      {DAYS.map((d, k) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={value === k + 1}
          className={s.day}
          onClick={() => {
            onChange(k + 1);
          }}
        >
          {d}
        </button>
      ))}
    </div>
  );
}
