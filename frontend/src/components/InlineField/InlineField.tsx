import clsx from 'clsx';
import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, FocusEvent, KeyboardEvent, Ref } from 'react';

import { isThenable } from '../shared/thenable';
import s from './InlineField.module.css';
import { parseNumericDraft } from './parse';

interface InlineFieldBase {
  /** The committed value. `null`/`undefined` shows as blank. */
  value: string | number | null | undefined;
  placeholder?: string;
  /** Render an auto-growing textarea instead of an input. */
  multiline?: boolean;
  /** Enter inserts a newline instead of committing (Workspace "Why now"). Implies `multiline`. */
  multi?: boolean;
  /** Characters per line for the textarea's initial row count (the prototype's `cpl`, 48). */
  cpl?: number;
  /** A blank commit reverts instead of saving ''. */
  required?: boolean;
  /** Shows the value but takes no edits and never commits (a line whose save is in flight). */
  readOnly?: boolean;
  /**
   * Makes the field a list item: committing blank removes it, and blurring an untouched blank
   * item (a freshly added line, or a server-created item whose text is '') removes it too. Both
   * results are handled like `onCommit`'s, so the item shows blank until `value` changes. While
   * that removal is held the field is read-only: blur never calls `onRemove` again and edits
   * never call `onCommit` on an item being deleted. A rejected removal unlocks it.
   */
  onRemove?: () => unknown;
  /** Called on every keystroke with the draft (undefined once the draft is dropped). */
  onDraftChange?: (draft: string | undefined) => void;
  onFocus?: (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  autoFocus?: boolean;
  inputMode?: 'text' | 'decimal' | 'numeric';
  id?: string;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** Extra attribute for focus management by the caller (the prototype's data-fk). */
  'data-fk'?: string;
  ref?: Ref<HTMLInputElement | HTMLTextAreaElement>;
}

/**
 * What a commit callback returns. The committed text stays on screen until `value` changes, so an
 * async save (commit, then replan) never flashes the old value back. Return a promise to revert
 * if it rejects, or `false` to revert at once (the caller refused or normalised the value back
 * to the current one). Anything else (void) holds the text until `value` changes.
 */
export type InlineCommitResult = unknown;

interface InlineTextFieldProps extends InlineFieldBase {
  numeric?: undefined;
  onCommit: (value: string) => InlineCommitResult;
}

interface InlineNumberFieldProps extends InlineFieldBase {
  /** Parse the draft as a number: a comma counts as the decimal point, NaN becomes 0, clamped. */
  numeric: { max: number; min?: number };
  onCommit: (value: number) => InlineCommitResult;
}

export type InlineFieldProps = InlineTextFieldProps | InlineNumberFieldProps;

interface Pending {
  text: string;
  base: string;
}

let fieldSizingSupport: boolean | undefined;
function supportsFieldSizing(): boolean {
  fieldSizingSupport ??=
    typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('field-sizing', 'content');
  return fieldSizingSupport;
}

/**
 * An in-place editable field using the prototype's draft/commit pattern:
 * - typing keeps a local draft; the committed value is untouched until blur;
 * - Enter commits (blurs) unless `multi`; Shift+Enter always inserts a newline in a textarea;
 * - Escape drops the draft and blurs, and stops propagation so it never closes an overlay;
 * - on blur a changed draft commits (trimmed text, or a parsed number); blank removes the
 *   item (`onRemove`) or reverts (`required`); an unchanged value does nothing;
 * - a committed value is held on screen until the `value` prop changes (see InlineCommitResult);
 * - `readOnly` shows the value but ignores edits and never commits; so does a list item while
 *   its removal is held.
 */
export function InlineField(props: InlineFieldProps) {
  const {
    value,
    placeholder,
    multi = false,
    multiline = multi,
    cpl = 48,
    required = false,
    readOnly = false,
    onRemove,
    onDraftChange,
    onFocus,
    autoFocus,
    inputMode,
    id,
    className,
    style,
    ref,
  } = props;
  const orig = value == null ? '' : String(value);
  const [draft, setDraftState] = useState<string | undefined>(undefined);
  // The last committed text and the `value` it was committed over. Shown until `value` changes.
  const [pending, setPending] = useState<Pending | null>(null);
  // Mirrors `draft` for handlers that run after a state update (Escape → blur on a timer).
  const draftRef = useRef<string | undefined>(undefined);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  if (pending && pending.base !== orig) setPending(null); // the new value arrived
  const held = pending !== null && pending.base === orig;
  const committed = held ? pending.text : orig;
  // A cleared list item whose removal has not landed yet (an async onRemove, or a void one
  // whose item is still in `value`). It is read-only, so it never calls onRemove a second time
  // nor onCommit on an item being deleted.
  const removing = held && onRemove !== undefined && committed === '';
  const locked = readOnly || removing;
  const shown = draft ?? committed;

  const setDraft = (next: string | undefined) => {
    draftRef.current = next;
    setDraftState(next);
    onDraftChange?.(next);
  };

  // JS autosize where CSS `field-sizing: content` is unavailable (it is Chromium-only).
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el || supportsFieldSizing()) return;
    el.style.height = 'auto';
    el.style.height = `${String(el.scrollHeight)}px`;
  }, [shown]);

  /** Shows `text` until `value` changes, unless the callback refused it or its promise rejects. */
  const hold = (text: string, result: InlineCommitResult) => {
    if (result === false) {
      setPending(null);
      return;
    }
    const p: Pending = { text, base: orig };
    setPending(p);
    if (isThenable(result)) {
      result.then(undefined, () => {
        setPending((cur) => (cur === p ? null : cur));
      });
    }
  };

  const commit = () => {
    const d = draftRef.current;
    if (locked) {
      if (d !== undefined) setDraft(undefined);
      return;
    }
    if (d === undefined) {
      // An untouched blank item (a freshly added line) removes itself. The removal is held like
      // a blank commit's, so a refocus and blur while it is in flight cannot remove it twice.
      if (onRemove && !committed.trim()) hold('', onRemove());
      return;
    }
    setDraft(undefined);
    if (props.numeric) {
      const n = parseNumericDraft(d, props.numeric.max, props.numeric.min);
      if (n !== Number(committed)) hold(String(n), props.onCommit(n));
      return;
    }
    const val = d.trim();
    if (!val && onRemove) {
      hold('', onRemove());
      return;
    }
    if (!val && required) return;
    if (val === committed) return;
    hold(val, props.onCommit(val));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey && !multi) {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setDraft(undefined);
      const el = e.currentTarget;
      setTimeout(() => {
        el.blur();
      }, 0);
    }
  };

  const shared = {
    id,
    value: shown,
    placeholder,
    autoFocus,
    inputMode,
    readOnly: locked,
    style,
    'aria-label': props['aria-label'],
    'aria-labelledby': props['aria-labelledby'],
    'data-fk': props['data-fk'],
    onChange: (e: { currentTarget: { value: string } }) => {
      if (!locked) setDraft(e.currentTarget.value);
    },
    onBlur: commit,
    onFocus,
    onKeyDown,
  };

  const setRef = (el: HTMLInputElement | HTMLTextAreaElement | null) => {
    areaRef.current = el instanceof HTMLTextAreaElement ? el : null;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  };

  if (multiline) {
    return (
      <textarea
        {...shared}
        ref={setRef}
        rows={Math.max(1, Math.ceil((shown.length || 1) / cpl))}
        className={clsx(s.field, s.area, className)}
      />
    );
  }
  return <input {...shared} ref={setRef} type="text" className={clsx(s.field, className)} />;
}
