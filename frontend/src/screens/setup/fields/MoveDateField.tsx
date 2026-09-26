import { useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { anchorPicker, BusinessDayDatePicker, Icon, Roll } from '../../../components';
import type { PickerCalendar } from '../../../components';
import { plural, s as shortDate } from '../../../lib/format';
import f from './Fields.module.css';

export interface MoveDateFieldProps {
  id?: string;
  /** The chosen move date, or null. */
  value: string | null;
  today: string;
  /** Null while the calendar loads (the button waits). */
  calendar: PickerCalendar | null;
  onPick: (iso: string) => void;
  /** Business days to the move (from the server), or null. */
  countdownBd: number | null;
  sub?: ReactNode;
  /** Label for the picker dialog. */
  label?: string;
}

/**
 * The move: a 26px date (Roll) with Workspace's calendar square, opening the business-day
 * picker, and the live countdown beside it: '61 business days to Fixed Income'.
 */
export function MoveDateField({
  id,
  value,
  today,
  calendar,
  onPick,
  countdownBd,
  sub,
  label = 'Move date',
}: MoveDateFieldProps) {
  const lineRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);

  const open = () => {
    const line = lineRef.current;
    const trigger = triggerRef.current;
    if (!line || !trigger || !calendar) return;
    const pos = anchorPicker(line, trigger);
    setAt({ x: Math.max(-6, pos.x), y: pos.y });
  };
  const close = () => {
    setAt(null);
    triggerRef.current?.focus({ preventScroll: true });
  };

  return (
    <>
      <div ref={lineRef} className={f.moveLine}>
        <button
          ref={triggerRef}
          id={id}
          type="button"
          className={f.dateButton}
          title="Change the move date"
          aria-label={`${label}: ${value ? shortDate(value) : 'not chosen yet'}`}
          aria-haspopup="dialog"
          aria-expanded={at !== null}
          disabled={!calendar}
          onClick={open}
        >
          {value ? <Roll value={shortDate(value)} /> : <span className={f.dateEmpty}>Pick a date</span>}
          <span className={f.calSquare}>
            <Icon name="calendar_month" />
          </span>
        </button>
        <span className={f.vrule} aria-hidden="true" />
        <span className={f.countdown} aria-live="polite">
          <span className={f.countNum}>
            <Roll value={countdownBd == null ? '—' : String(countdownBd)} />
          </span>
          <span className={f.countText}>{plural(countdownBd ?? 0, 'business day')} to Fixed Income</span>
        </span>
        {at && calendar && (
          <BusinessDayDatePicker
            value={value}
            today={today}
            calendar={calendar}
            x={at.x}
            y={at.y}
            label={label}
            className={f.picker}
            onPick={onPick}
            onClose={close}
          />
        )}
      </div>
      {sub && <div className={f.sub}>{sub}</div>}
    </>
  );
}
