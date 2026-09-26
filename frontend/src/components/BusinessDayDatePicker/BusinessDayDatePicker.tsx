import clsx from 'clsx';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { IconButton } from '../Button';
import s from './BusinessDayDatePicker.module.css';
import { MONTH_LONG, dnToIso, firstOfMonth, formatShort, isoToDn, parts } from './dates';

/**
 * The small calendar interface the picker needs. The app's CalendarIndex (built from the
 * server's calendar days) satisfies it; the picker never computes business days itself.
 */
export interface PickerCalendar {
  /** The date is inside the server calendar's range. */
  inRange(iso: string): boolean;
  isBd(iso: string): boolean;
  /** Business day of the month (BD1…), or null on a non-business day. */
  bdm(iso: string): number | null;
  /** Holiday name, or null. */
  holiday(iso: string): string | null;
  /** The date itself if it is a business day, else the next one. */
  nextBD(iso: string): string;
}

export interface BusinessDayDatePickerProps {
  /** Selected ISO date (null: none yet). */
  value: string | null;
  /** Today's ISO date (ringed; the "Today" button picks it). */
  today: string;
  calendar: PickerCalendar;
  /** Top-left position in px inside the positioned container (see `anchorPicker`). */
  x: number;
  y: number;
  /** Footer note. Defaults to 'Weekends and holidays move to the next business day'. */
  note?: string;
  /** Called with the picked date, already snapped forward to a business day. */
  onPick: (iso: string) => void;
  onClose: () => void;
  /** Accessible name ('Target date'). */
  label?: string;
  className?: string;
}

const HEADS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
const DEFAULT_NOTE = 'Weekends and holidays move to the next business day';

/**
 * A 292px business-day date picker (Workspace.dc.html:222-243, :264-297). Monday-first month
 * grid with 'BD{n}' sub-labels; weekend and holiday cells are ink-faint with a title; days
 * outside the calendar's range are disabled; month arrows stop at the range. Picks snap forward
 * to the next business day. A fixed backdrop and Escape (capture phase, stopped) close it.
 */
export function BusinessDayDatePicker({
  value,
  today,
  calendar,
  x,
  y,
  note,
  onPick,
  onClose,
  label = 'Choose a date',
  className,
}: BusinessDayDatePickerProps) {
  const start = parts(isoToDn(value ?? today));
  const [ym, setYm] = useState<readonly [number, number]>([start.y, start.m]);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useEffectEvent(() => {
    onClose();
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  const [year, month] = ym;
  const first = firstOfMonth(year, month);
  const lead = (parts(first).wd + 6) % 7;
  const gridStart = first - lead;
  const sel = value ? isoToDn(value) : null;
  const todayDn = isoToDn(today);

  const days: { n: number; iso: string; inMonth: boolean }[] = [];
  for (let n = gridStart; n < gridStart + 42; n++) {
    const inMonth = parts(n).m === month;
    if (!inMonth && n > first && days.length % 7 === 0) break;
    days.push({ n, iso: dnToIso(n), inMonth });
  }

  const canPrev = calendar.inRange(dnToIso(first - 1));
  const canNext = calendar.inRange(dnToIso(firstOfMonth(year, month + 1)));
  const step = (k: 1 | -1) => {
    const f = parts(firstOfMonth(year, month + k));
    setYm([f.y, f.m]);
  };
  const pick = (iso: string) => {
    onPick(calendar.nextBD(iso));
    onClose();
  };

  return (
    <>
      <div className={s.backdrop} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        className={clsx(s.panel, className)}
        style={{ left: x, top: y }}
      >
        <div className={s.head}>
          <span className={s.title} aria-live="polite">
            {MONTH_LONG[month]} {year}
          </span>
          <IconButton
            icon="chevron_left"
            label="Previous month"
            size={28}
            iconSize={18}
            className={s.nav}
            style={{ opacity: canPrev ? 1 : 0.3 }}
            disabled={!canPrev}
            onClick={() => {
              step(-1);
            }}
          />
          <IconButton
            icon="chevron_right"
            label="Next month"
            size={28}
            iconSize={18}
            className={s.nav}
            style={{ opacity: canNext ? 1 : 0.3 }}
            disabled={!canNext}
            onClick={() => {
              step(1);
            }}
          />
        </div>
        <div className={s.grid}>
          {HEADS.map((h, i) => (
            <span key={i} className={clsx(s.headCell, i > 4 && s.weekendHead)} aria-hidden="true">
              {h}
            </span>
          ))}
          {days.map(({ n, iso, inMonth }) => {
            const ok = calendar.inRange(iso);
            const bd = ok && calendar.isBd(iso);
            const bdm = bd ? calendar.bdm(iso) : null;
            const hol = ok ? calendar.holiday(iso) : null;
            const on = n === sel;
            const isToday = n === todayDn;
            const title = ok ? formatShort(n) + (hol ? ` · ${hol}` : !bd ? ' · weekend' : '') : undefined;
            const style: CSSProperties = { opacity: inMonth && ok ? 1 : 0.3 };
            return (
              <button
                key={n}
                type="button"
                className={s.day}
                data-selected={on}
                data-today={isToday && !on}
                data-bd={bd}
                title={title}
                aria-label={title ?? formatShort(n)}
                aria-pressed={on}
                aria-current={isToday ? 'date' : undefined}
                disabled={!ok}
                style={style}
                onClick={() => {
                  pick(iso);
                }}
              >
                <span className={s.num}>{parts(n).d}</span>
                <span className={s.bd}>{bdm != null ? `BD${String(bdm)}` : ''}</span>
              </button>
            );
          })}
        </div>
        <div className={s.foot}>
          <button
            type="button"
            className={s.todayButton}
            onClick={() => {
              onPick(today);
              onClose();
            }}
          >
            Today
          </button>
          <span className={s.note}>{note ?? DEFAULT_NOTE}</span>
        </div>
      </div>
    </>
  );
}
