import { useState } from 'react';

import { InlineField } from '../../../components';
import f from './Fields.module.css';

export interface HoursFieldProps {
  id?: string;
  value: number;
  onCommit: (hours: number) => unknown;
  /** 13px muted words after the 'h' ('a working day'). */
  unit: string;
  min?: number;
  max?: number;
  label: string;
}

/**
 * Hours in Workspace's 'Hours a day' style: a 26/500 inline number, a 26px 'h' and a muted
 * unit. Commits on Enter or blur; the draft is clamped to [min, max] (a comma is a decimal).
 */
export function HoursField({ id, value, onCommit, unit, min = 1, max = 24, label }: HoursFieldProps) {
  // Sized to its text as Workspace sizes its rate field (0.62em a character + 8px).
  const [draftChars, setDraftChars] = useState<number | null>(null);
  const chars = Math.max(1, draftChars ?? String(value).length);
  return (
    <span className={f.hours}>
      <InlineField
        id={id}
        numeric={{ min, max }}
        value={value}
        onCommit={onCommit}
        inputMode="decimal"
        className={f.hoursInput}
        style={{ width: `calc(${String(chars * 0.62)}em + 8px)` }}
        onDraftChange={(d) => {
          setDraftChars(d === undefined ? null : d.length);
        }}
        aria-label={label}
      />
      <span className={f.hoursH}>h</span>
      <span className={f.hoursUnit}>{unit}</span>
    </span>
  );
}
