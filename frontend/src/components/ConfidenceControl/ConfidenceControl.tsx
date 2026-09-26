import clsx from 'clsx';

import s from './ConfidenceControl.module.css';

export interface ConfidenceControlProps {
  value: number | null;
  onChange: (value: number) => void;
  label?: string;
  className?: string;
}

/** The 1–5 confidence picker (Foundations): five 52×40 buttons, the selected one inked. */
export function ConfidenceControl({ value, onChange, label = 'Confidence', className }: ConfidenceControlProps) {
  return (
    <div className={clsx(s.group, className)} role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          className={s.option}
          onClick={() => {
            onChange(k);
          }}
        >
          {k}
        </button>
      ))}
    </div>
  );
}
