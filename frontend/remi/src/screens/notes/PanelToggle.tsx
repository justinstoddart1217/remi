/**
 * The square 28px toggle that folds a Notes rail away or brings it back (Notes.dc.html
 * `sb.lToggle` / `sb.rToggle`). Each rail has two: "Hide …" in the open panel's header and
 * "Show …" at the top of the 52px strip left behind (see useToggleFocus).
 */

import type { RefObject } from 'react';

import { Icon } from '../../components/Icon';
import type { IconName } from '../../components/Icon';
import s from './Notes.module.css';

export interface PanelToggleProps {
  icon: IconName;
  label: string;
  expanded: boolean;
  controls: string;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onToggle: (button: HTMLButtonElement) => void;
}

export function PanelToggle({ icon, label, expanded, controls, buttonRef, onToggle }: PanelToggleProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={s.panelToggle}
      title={label}
      aria-label={label}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={(e) => {
        onToggle(e.currentTarget);
      }}
    >
      <Icon name={icon} className={s.panelToggleIcon} />
    </button>
  );
}
