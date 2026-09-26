import clsx from 'clsx';
import type { ReactNode, Ref } from 'react';

import { Icon } from '../../../components';
import { arriveStyle } from './arrive';
import s from './Frame.module.css';
import type { SaveFeedback } from './useSaveFeedback';

export interface SectionProps {
  id: string;
  /** '01' */
  number: string;
  title: string;
  note?: ReactNode;
  /** Right end of the title row (the save note). */
  status?: ReactNode;
  /** Place in the arrival stagger. */
  index: number;
  headingRef?: Ref<HTMLHeadingElement>;
  children: ReactNode;
}

/**
 * A numbered step as a white card (Today's cards): the section heading with its 3px brand
 * bar in the display face (Today.dc.html 'Today's plan'), then label rows on hairlines.
 */
export function Section({ id, number, title, note, status, index, headingRef, children }: SectionProps) {
  const headingId = `${id}-title`;
  return (
    <section id={id} className={clsx(s.section, s.arrive)} style={arriveStyle(index)} aria-labelledby={headingId}>
      <div className={s.sectionHead}>
        <span className={s.sectionNum}>{number}</span>
        <span className={s.sectionBar} aria-hidden="true" />
        <h2 id={headingId} ref={headingRef} className={s.sectionTitle} tabIndex={-1}>
          {title}
        </h2>
        {note && <span className={s.sectionNote}>{note}</span>}
        {status && <span className={s.sectionStatus}>{status}</span>}
      </div>
      {children}
    </section>
  );
}

export interface FieldRowProps {
  label: ReactNode;
  note?: ReactNode;
  /** id of the control the label names. */
  htmlFor?: string;
  labelId?: string;
  children: ReactNode;
}

/**
 * A label column (200px: Workspace's brand-dark caps label and a 13px note) beside its
 * control.
 */
export function FieldRow({ label, note, htmlFor, labelId, children }: FieldRowProps) {
  return (
    <div className={s.row}>
      <div>
        {htmlFor ? (
          <label className={s.rowLabel} htmlFor={htmlFor} id={labelId}>
            {label}
          </label>
        ) : (
          <div className={s.rowLabel} id={labelId}>
            {label}
          </div>
        )}
        {note && <div className={s.rowNote}>{note}</div>}
      </div>
      <div className={s.rowBody}>{children}</div>
    </div>
  );
}

/** A full-width row (the rotation tiles). */
export function WideRow({ children }: { children: ReactNode }) {
  return <div className={s.rowWide}>{children}</div>;
}

/**
 * 'Saving…', '✓ Saved' or '✓ Saved · 2 forecasts moved' (fades after 2.4s), or 'Not saved · …'.
 * The note keeps to one line in the title row (the full words are its title attribute); a
 * failure that belongs to a field says only 'Not saved' here, and FieldError gives the reason.
 */
export function SaveNote({ state }: { state: SaveFeedback }) {
  const inField = state.phase === 'error' && state.field !== null;
  const text =
    state.phase === 'saving'
      ? 'Saving…'
      : state.phase === 'saved'
        ? state.message
          ? `Saved · ${state.message}`
          : 'Saved'
        : state.phase === 'error'
          ? inField || !state.message
            ? 'Not saved'
            : `Not saved · ${state.message}`
          : '';
  return (
    <span
      className={s.save}
      role="status"
      aria-live="polite"
      data-phase={state.phase}
      data-visible={state.visible}
      title={text || undefined}
    >
      {state.phase === 'saved' && <Icon name="check" className={s.saveIcon} />}
      <span className={s.saveText}>{text}</span>
    </span>
  );
}

/** Why a field's save failed, under the field (the section header says 'Not saved'). */
export function FieldError({ state, field }: { state: SaveFeedback; field: string }) {
  if (state.phase !== 'error' || state.field !== field || !state.message) return null;
  return (
    <span className={s.fieldError} role="alert" title={state.detail ?? undefined}>
      {state.message}
    </span>
  );
}
