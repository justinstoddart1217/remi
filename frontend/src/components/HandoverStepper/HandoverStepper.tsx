import clsx from 'clsx';
import { Fragment } from 'react';

import s from './HandoverStepper.module.css';

export interface HandoverStepperProps {
  /** Stage names, in order (the routine handover stages). */
  steps: readonly string[];
  /** Index of the current stage. */
  current: number;
  /** Pick a stage; the stepper is read-only without it. */
  onPick?: (index: number) => void;
  label?: string;
  className?: string;
}

/**
 * Dots joined by 10px connectors: past stages filled ink, the current one a hollow ink ring
 * with a 600 label, future stages ink-faint (Routines "Handover").
 */
export function HandoverStepper({ steps, current, onPick, label = 'Handover status', className }: HandoverStepperProps) {
  return (
    <div className={clsx(s.stepper, className)} role="group" aria-label={label}>
      {steps.map((name, k) => {
        const state = k < current ? 'past' : k === current ? 'current' : 'future';
        return (
          <Fragment key={name}>
            <span className={clsx(s.connector, k === 0 && s.first)} data-done={k <= current} aria-hidden="true" />
            <button
              type="button"
              className={s.step}
              data-state={state}
              title={`Set to ${name}`}
              aria-current={k === current ? 'step' : undefined}
              disabled={!onPick}
              onClick={() => {
                if (k !== current) onPick?.(k);
              }}
            >
              <span className={s.dot} aria-hidden="true" />
              <span className={s.name}>{name}</span>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
