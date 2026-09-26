import clsx from 'clsx';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { AddButton } from '../Button';
import { Checkbox, CheckboxMark } from '../Checkbox';
import { Eyebrow } from '../Eyebrow';
import type { EyebrowProps } from '../Eyebrow';
import { InlineField } from '../InlineField';
import type { InlineCommitResult } from '../InlineField';
import { isThenable } from '../shared/thenable';
import s from './InlineList.module.css';

export interface InlineListItem {
  id: string;
  text: string;
  /** Checkable lists only. */
  done?: boolean;
  /**
   * A trailing mono note (a due date, 'done'). Pass a function to derive it from the row's
   * displayed tick: it is called with the pending-aware `done`, so a note such as
   * `(done) => dueLabel(done, dueDate)` flips the moment a box is ticked, not when the save
   * settles.
   */
  meta?: string | ((done: boolean) => string);
}

/** The note a row shows, from its displayed (pending-aware) tick. */
const metaOf = (item: InlineListItem): string | undefined =>
  typeof item.meta === 'function' ? item.meta(item.done ?? false) : item.meta;

/**
 * How a line is drawn.
 * - `field` (default): the Charter lists (Workspace.dc.html:147-160). Every line is an
 *   auto-growing textarea on a grid, with an optional index column.
 * - `line`: the Transition onboarding rows (Transition.dc.html:98-109). 42px rows with a
 *   hairline under each: the text reads as text (a button) and turns into a one-line field when
 *   clicked; a trailing 12px mono note (always laid out, blank when there is none).
 */
export type InlineListRow = 'field' | 'line';

export interface InlineListProps {
  /** Eyebrow label ('Success measures', 'Checklist', 'Onboarding readiness'). */
  label: string;
  /** The eyebrow's colour (default ink-muted; 'fi' for the Transition onboarding block). */
  labelTone?: EyebrowProps['tone'];
  /** The eyebrow's element: a heading where the block needs one in the outline. */
  labelAs?: 'span' | 'h2' | 'h3';
  /**
   * Content at the right of the head, e.g. the count '2 of 5 ready'. Pass a function to derive
   * it from the rows as displayed: `shown` already reflects in-flight (optimistic) ticks, edits
   * and removals, so a count updates the moment a box is ticked, not when the save settles.
   */
  headAside?: ReactNode | ((shown: readonly InlineListItem[]) => ReactNode);
  headClassName?: string;
  /**
   * Where '+ Add' sits and when it shows.
   * - `always` (default): at the right of the head, always visible (the Charter lists).
   * - `hover`: just after the label, without moving it; visible while the list is hovered or
   *   holds focus, and always while it is empty. It is fully transparent otherwise.
   */
  addVisibility?: 'always' | 'hover';
  row?: InlineListRow;
  items: readonly InlineListItem[];
  placeholder: string;
  /** Muted copy shown while the list is empty. */
  emptyText: string;
  emptyClassName?: string;
  /** Two-digit index column (Success measures). `field` rows only. */
  numbered?: boolean;
  /** 15px rows (Success measures) or 14px (default). `field` rows only; `line` rows are 15px. */
  size?: 'l' | 'm';
  /** ink-muted rows that turn ink while editing (Out of scope). `field` rows only. */
  muted?: boolean;
  /** Characters per line for textarea sizing (40 numbered, 44 otherwise). */
  cpl?: number;
  /**
   * The callbacks may return a promise (an async save). A `field` line keeps showing the
   * committed text until `items` changes; a `line` row shows the new text (or hides a removed
   * row) until the promise settles. An added line stays, read-only, until the new item arrives
   * or the promise settles. See InlineCommitResult.
   *
   * Without `onAdd` there is no '+ Add' (nothing can hold a new item yet).
   */
  onAdd?: (text: string) => InlineCommitResult;
  onChange: (id: string, text: string) => InlineCommitResult;
  onRemove: (id: string) => InlineCommitResult;
  /**
   * Makes rows checkable (routine checklists, onboarding items). When it returns a promise the
   * box shows the new state until the promise settles.
   */
  onToggle?: (id: string, done: boolean) => unknown;
  addLabel?: string;
  /** Content after the rows, inside the list (a note under the Transition onboarding rows). */
  footer?: ReactNode;
  className?: string;
}

/**
 * The add line. Each line gets a fresh `key`, so a new line never inherits the last one's text.
 * While an async add is saving the line shows its text read-only until the item lands (`items`
 * grows past `base`) or the save settles. '+ Add' pressed meanwhile is `queued`: a fresh blank
 * line opens once the saving one closes.
 */
interface AddLine {
  key: number;
  open: boolean;
  saving: boolean;
  /** items.length when the save started. */
  base: number;
  queued: boolean;
  /** The text being saved (shown by `line` rows). */
  text: string;
}

const CLOSED: AddLine = { key: 0, open: false, saving: false, base: 0, queued: false, text: '' };

/** Closes the add line (a saving one, once it lands or fails), opening a fresh one if queued. */
const settle = (line: AddLine): AddLine => ({
  key: line.key + 1,
  open: line.queued,
  saving: false,
  base: 0,
  queued: false,
  text: '',
});

/** What a row shows while its save is in flight. */
interface Pending {
  text?: string;
  done?: boolean;
  removed?: boolean;
}

/**
 * The Charter list pattern (Workspace.dc.html:147-160): an eyebrow with a quiet '+ Add', then
 * one inline field per line. Add opens a blank line that is committed with Enter or blur, or
 * disappears if left blank; clearing a line removes it. Reused for the new inline lists
 * (routine checklists, Fixed Income onboarding), which can also be checkable, and in the
 * `line` form for the Transition onboarding block.
 */
export function InlineList({
  label,
  labelTone = 'muted',
  labelAs = 'span',
  headAside,
  headClassName,
  addVisibility = 'always',
  row = 'field',
  items,
  placeholder,
  emptyText,
  emptyClassName,
  numbered = false,
  size = 'm',
  muted = false,
  cpl = numbered ? 40 : 44,
  onAdd,
  onChange,
  onRemove,
  onToggle,
  addLabel = 'Add',
  footer,
  className,
}: InlineListProps) {
  const [add, setAdd] = useState<AddLine>(CLOSED);
  const [pending, setPending] = useState<Readonly<Record<string, Pending>>>({});
  const [editing, setEditing] = useState<string | null>(null);
  // The async add landed: its item is in `items` now. Only growth counts: a row removed while
  // the add saves must not close the saving line early. If the count nets out, the save's
  // promise settling closes it instead.
  if (add.saving && items.length > add.base) setAdd(settle(add));

  const line = row === 'line';
  const checkable = onToggle !== undefined;

  /** Shows `patch` on row `id` until `result` settles (only for an async save). */
  const hold = (id: string, patch: Pending, result: unknown): unknown => {
    if (!isThenable(result)) return result;
    setPending((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }));
    const clear = () => {
      setPending((cur) => Object.fromEntries(Object.entries(cur).filter(([k]) => k !== id)));
    };
    result.then(clear, clear);
    return result;
  };

  const shown = items
    .filter((x) => !pending[x.id]?.removed)
    .map((x) => {
      const p = pending[x.id];
      return p ? { ...x, text: p.text ?? x.text, done: p.done ?? x.done } : x;
    });

  const commitAdd = (text: string): InlineCommitResult => {
    if (add.saving || !onAdd) return undefined; // one save per line: never a duplicate onAdd
    const result = onAdd(text);
    if (!isThenable(result)) {
      setAdd(settle);
      return result;
    }
    const key = add.key;
    setAdd((cur) => ({ ...cur, saving: true, base: items.length, text }));
    const done = () => {
      // Only if this line is still the one saving (it may have landed via `items`).
      setAdd((cur) => (cur.key === key && cur.saving ? settle(cur) : cur));
    };
    result.then(done, done);
    // A `line` row shows the saving text as a ghost row; its field closes at once.
    return line ? false : result;
  };
  const dropAdd = () => {
    if (!add.saving) setAdd(settle);
  };

  const toggle = (id: string, next: boolean) => {
    if (onToggle) hold(id, { done: next }, onToggle(id, next));
  };

  const empty = shown.length === 0 && !add.open && !add.saving;

  const eyebrow = (
    <Eyebrow as={labelAs} tone={labelTone}>
      {label}
    </Eyebrow>
  );
  // 'hover': '+ Add' hangs off the label's box (absolutely placed), so the label never moves.
  const head = (
    <div className={clsx(line ? s.lineHead : s.head, headClassName)}>
      {addVisibility === 'hover' ? (
        <div className={s.headLabel}>
          {eyebrow}
          {onAdd ? addButton() : null}
        </div>
      ) : (
        eyebrow
      )}
      {typeof headAside === 'function' ? headAside(shown) : headAside}
      {addVisibility === 'always' && onAdd ? addButton() : null}
    </div>
  );

  function addButton() {
    return (
      <AddButton
        size="s"
        className={clsx(addVisibility === 'hover' && s.headAdd)}
        onClick={() => {
          setEditing(null);
          setAdd((cur) => {
            if (cur.saving) return cur.queued ? cur : { ...cur, queued: true };
            return cur.open ? cur : { ...cur, open: true };
          });
        }}
      >
        {addLabel}
      </AddButton>
    );
  }

  if (line) {
    // The add line's saving text, until the new item arrives.
    const ghost = add.saving && items.length <= add.base ? add.text : null;
    const box = () => (checkable ? <CheckboxMark checked={false} size={16} pop={false} /> : null);
    return (
      <div className={className} data-add={addVisibility} data-empty={empty ? '' : undefined}>
        {head}
        {shown.map((x) => (
          <div key={x.id} className={s.line} data-done={x.done ? '' : undefined}>
            {checkable ? (
              <Checkbox
                size={16}
                checked={x.done ?? false}
                aria-label={x.text || placeholder}
                onChange={(next) => {
                  toggle(x.id, next);
                }}
              />
            ) : null}
            {editing === x.id ? (
              <span
                className={s.lineEdit}
                onBlur={() => {
                  setEditing(null);
                }}
              >
                <InlineField
                  autoFocus
                  value={x.text}
                  placeholder={placeholder}
                  aria-label={`${label}: ${x.text}`}
                  className={s.lineField}
                  onCommit={(text) => hold(x.id, { text }, onChange(x.id, text))}
                  onRemove={() => hold(x.id, { removed: true }, onRemove(x.id))}
                />
              </span>
            ) : (
              <button
                type="button"
                className={s.lineText}
                onClick={() => {
                  setEditing(x.id);
                }}
              >
                {x.text}
              </button>
            )}
            <span className={s.lineMeta}>{metaOf(x) ?? ''}</span>
          </div>
        ))}

        {ghost !== null && (
          <div className={s.line} aria-busy="true">
            {box()}
            <span className={s.lineGhost}>{ghost}</span>
            <span className={s.lineMeta} />
          </div>
        )}

        {add.open && !add.saving && (
          <div key={add.key} className={s.line}>
            {box()}
            <span className={s.lineEdit}>
              <InlineField
                autoFocus
                value=""
                placeholder={placeholder}
                aria-label={`New ${label.toLowerCase()} item`}
                className={s.lineField}
                onCommit={commitAdd}
                onRemove={dropAdd}
              />
            </span>
            <span className={s.lineMeta} />
          </div>
        )}

        {empty && <div className={clsx(s.lineEmpty, emptyClassName)}>{emptyText}</div>}
        {footer}
      </div>
    );
  }

  const columns = (meta: boolean) =>
    [numbered ? '28px' : '0px', checkable ? '26px' : null, 'minmax(0,1fr)', meta ? 'auto' : null]
      .filter(Boolean)
      .join(' ');
  const fieldClass = clsx(s.field, s[size], muted && s.muted);

  return (
    <div className={clsx(s.list, className)} data-add={addVisibility} data-empty={empty ? '' : undefined}>
      {head}
      {shown.map((item, i) => {
        const meta = metaOf(item);
        return (
          <div key={item.id} className={s.row} style={{ gridTemplateColumns: columns(meta !== undefined) }}>
            {numbered ? <span className={s.index}>{String(i + 1).padStart(2, '0')}</span> : <span />}
            {checkable ? (
              <Checkbox
                size={16}
                checked={item.done ?? false}
                aria-label={item.text || placeholder}
                className={s.check}
                onChange={(next) => {
                  toggle(item.id, next);
                }}
              />
            ) : null}
            <InlineField
              multiline
              cpl={cpl}
              value={item.text}
              placeholder={placeholder}
              aria-label={`${label} ${String(i + 1)}`}
              className={clsx(fieldClass, item.done && s.done)}
              onCommit={(text) => onChange(item.id, text)}
              onRemove={() => onRemove(item.id)}
            />
            {meta !== undefined && <span className={s.meta}>{meta}</span>}
          </div>
        );
      })}
      {add.open && (
        <div key={add.key} className={s.row} style={{ gridTemplateColumns: columns(false) }}>
          {numbered ? <span className={s.index}>{String(shown.length + 1).padStart(2, '0')}</span> : <span />}
          {checkable ? <Checkbox size={16} checked={false} disabled aria-label={placeholder} className={s.check} /> : null}
          <InlineField
            multiline
            autoFocus
            readOnly={add.saving}
            cpl={cpl}
            value=""
            placeholder={placeholder}
            aria-label={`New ${label.toLowerCase()} item`}
            className={fieldClass}
            onCommit={commitAdd}
            onRemove={dropAdd}
          />
        </div>
      )}
      {shown.length === 0 && !add.open && <div className={clsx(s.empty, emptyClassName)}>{emptyText}</div>}
      {footer}
    </div>
  );
}
