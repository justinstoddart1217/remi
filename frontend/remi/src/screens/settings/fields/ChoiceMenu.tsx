import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { Icon } from '../../../components';
import type { Choice } from '../model';
import m from './SettingsFields.module.css';

export interface ChoiceMenuProps {
  id?: string;
  label: string;
  value: string | null;
  choices: readonly Choice[];
  /** Return a promise; the menu shows the choice at once and falls back if it rejects. */
  onChoose: (value: string | null) => unknown;
  /** Shown instead of the button when there is nothing to choose from. */
  emptyText?: string;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

/**
 * A single choice in the setup fields' language: the value at 17/500 with a quiet
 * `unfold_more`, opening the time-zone field's listbox (paper-raised, hairline, radius-m).
 * Arrow keys move, Enter or a click picks, Escape closes and returns focus to the button.
 */
export function ChoiceMenu({ id, label, value, choices, onChoose, emptyText }: ChoiceMenuProps) {
  const listId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open) listRef.current?.focus({ preventScroll: true });
  }, [open]);
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState<{ value: string | null; base: string | null } | null>(null);
  if (held && held.base !== value) setHeld(null);
  const shown = held ? held.value : value;
  const current = choices.find((c) => c.value === shown) ?? choices.find((c) => c.value === null);
  const selectedIndex = Math.max(
    0,
    choices.findIndex((c) => c.value === shown),
  );

  if (choices.every((c) => c.value === null) && emptyText) {
    return <span className={m.choiceEmpty}>{emptyText}</span>;
  }

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus({ preventScroll: true });
  };
  const pick = (choice: Choice | undefined) => {
    close(true);
    if (!choice || choice.value === shown) return;
    const h = { value: choice.value, base: value };
    setHeld(h);
    const result = onChoose(choice.value);
    if (isThenable(result)) {
      result.then(undefined, () => {
        setHeld((cur) => (cur === h ? null : cur));
      });
    }
  };

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(selectedIndex);
      setOpen(true);
    }
  };
  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => Math.max(0, Math.min(choices.length - 1, i + step)));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActive(e.key === 'Home' ? 0 : choices.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(choices[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  return (
    <span className={m.choice}>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        className={m.choiceButton}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${label}: ${current?.label ?? 'None'}`}
        onClick={() => {
          setActive(selectedIndex);
          setOpen((o) => !o);
        }}
        onKeyDown={onButtonKey}
      >
        {current?.dot && <span className={m.choiceDot} style={{ background: current.dot }} aria-hidden="true" />}
        <span className={current?.value === null ? m.choiceNone : undefined}>{current?.label ?? 'None'}</span>
        <Icon name="unfold_more" className={m.choiceIcon} />
      </button>
      {open && (
        <>
          <span
            className={m.backdrop}
            aria-hidden="true"
            onClick={() => {
              close(false);
            }}
          />
          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            className={m.listbox}
            aria-activedescendant={`${listId}-${String(active)}`}
            onKeyDown={onListKey}
            ref={listRef}
          >
            {choices.map((c, k) => (
              <li
                key={c.value ?? '__none'}
                id={`${listId}-${String(k)}`}
                role="option"
                aria-selected={c.value === shown}
                data-active={k === active}
                className={m.option}
                onMouseEnter={() => {
                  setActive(k);
                }}
                onClick={() => {
                  pick(c);
                }}
              >
                <span className={m.optionDot} style={c.dot ? { background: c.dot } : undefined} aria-hidden="true" />
                <span className={c.value === null ? m.optionNone : m.optionMain}>{c.label}</span>
                {c.hint && <span className={m.optionHint}>{c.hint}</span>}
                {c.value === shown && <Icon name="check" className={m.optionCheck} />}
              </li>
            ))}
          </ul>
        </>
      )}
    </span>
  );
}
