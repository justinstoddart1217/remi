import type { ReactNode } from 'react';

import { Eyebrow } from '../../../components';
import s from './Frame.module.css';

export type RailState = 'done' | 'todo' | 'optional' | 'invalid';

export interface RailStep {
  id: string;
  number: string;
  title: string;
  summary: string;
  state: RailState;
}

export interface StepRailProps {
  title: string;
  steps: readonly RailStep[];
  /** The step in view (its dot grows and its title turns ink). */
  current: string | null;
  onJump: (id: string) => void;
  /** Below the steps (the setup's start button). */
  footer?: ReactNode;
}

/**
 * The wizard's stepper and Settings' index, as a white card with Today's drawn brand rule on
 * top: square markers on a vertical hairline, each with its title and a one-line summary of
 * what is set. Brand green when done (the line between done steps turns green too), a faint
 * outline while it is still to do, a risk outline when something needs fixing.
 */
export function StepRail({ title, steps, current, onJump, footer }: StepRailProps) {
  return (
    <nav aria-label={title} className={s.railCard}>
      <span className={s.railRule} aria-hidden="true" />
      <Eyebrow className={s.railEyebrow}>{title}</Eyebrow>
      <ol className={s.railList}>
        {steps.map((step) => (
          <li key={step.id} className={s.railItem} data-state={step.state} data-current={step.id === current}>
            <button
              type="button"
              className={s.railButton}
              aria-current={step.id === current ? 'step' : undefined}
              onClick={() => {
                onJump(step.id);
              }}
            >
              <span className={s.railDot} aria-hidden="true" />
              <span>
                <span className={s.railHead}>
                  <span className={s.railNum}>{step.number}</span>
                  <span className={s.railTitle}>{step.title}</span>
                </span>
                <span className={s.railSummary}>{step.summary}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      {footer && <div className={s.railFoot}>{footer}</div>}
    </nav>
  );
}
