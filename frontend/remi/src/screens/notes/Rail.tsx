/**
 * The notebook rail (Notes.dc.html lines 12-34): "Notebook" and its fold-away toggle, the total
 * line, then every business day from today back four weeks plus any day with notes, newest
 * first, under week headers. Folded, the column narrows to a 52px strip holding the "Show
 * notebook" toggle and a vertical "Notebook" label; the hidden side is inert.
 */

import clsx from 'clsx';
import { Fragment, useId } from 'react';

import s from './Notes.module.css';
import { HIDE_NOTEBOOK, NOTEBOOK, SHOW_NOTEBOOK } from './model';
import type { RailRow } from './model';
import { PanelToggle } from './PanelToggle';
import { useToggleFocus } from './useToggleFocus';

export interface RailProps {
  rows: readonly RailRow[];
  totalLine: string;
  selected: string;
  onPick: (day: string) => void;
  open: boolean;
  onToggle: () => void;
  /** True while the expanded note is open over the screen. */
  inert?: boolean;
}

export function Rail({ rows, totalLine, selected, onPick, open, onToggle, inert = false }: RailProps) {
  const id = useId();
  const focus = useToggleFocus(open);
  const toggle = (button: HTMLButtonElement) => {
    focus.toggled(button);
    onToggle();
  };

  return (
    <div className={clsx(s.column, s.railColumn)} data-open={open ? '' : undefined} inert={inert}>
      <div className={clsx(s.strip, s.stripLeft)} inert={open}>
        <PanelToggle icon="left_panel_open" label={SHOW_NOTEBOOK} expanded={false} controls={id} buttonRef={focus.showRef} onToggle={toggle} />
        <span className={clsx(s.stripLabel, s.stripLabelUp)} aria-hidden="true">
          {NOTEBOOK}
        </span>
      </div>
      <nav id={id} className={s.rail} aria-label="Notebook" inert={!open}>
        <div className={s.railHead}>
          <div className={s.panelHead}>
            <span className={clsx(s.kicker, s.grow)}>{NOTEBOOK}</span>
            <PanelToggle icon="left_panel_close" label={HIDE_NOTEBOOK} expanded controls={id} buttonRef={focus.hideRef} onToggle={toggle} />
          </div>
          <div className={s.totalLine}>{totalLine}</div>
        </div>
        <div className={s.railList}>
          {rows.map((row) => (
            <Fragment key={row.day}>
              {row.weekHead ? <div className={s.weekHead}>{row.weekHead}</div> : null}
              <button
                type="button"
                className={s.dayRow}
                aria-current={row.day === selected ? 'date' : undefined}
                data-has={row.hasNotes ? '' : undefined}
                onClick={() => {
                  onPick(row.day);
                }}
              >
                <span className={s.dayLabel}>{row.label}</span>
                <span className={s.dayCount}>{row.count}</span>
                <span className={s.dayPreview}>{row.preview}</span>
              </button>
            </Fragment>
          ))}
        </div>
      </nav>
    </div>
  );
}
