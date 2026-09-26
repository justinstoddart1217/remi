import { useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { matchTimezones, resolveTimezone, zoneOffset } from '../timezones';
import f from './Fields.module.css';

export interface TimezoneFieldProps {
  id?: string;
  value: string;
  /** Called with a known IANA zone. Return a promise to revert if it rejects. */
  onCommit: (zone: string) => unknown;
  label?: string;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

interface Held {
  text: string;
  base: string;
}

/**
 * The business time zone: an inline field with a suggestion list (city first: 'london' →
 * Europe/London). Arrow keys move, Enter or a click picks, Escape reverts without closing an
 * overlay. Leaving the field settles on the zone the entry names (its city, or the only
 * match); an entry that names none stays in the field, unsaved, with 'Pick a zone from the
 * list' under it.
 */
export function TimezoneField({ id, value, onCommit, label = 'Time zone' }: TimezoneFieldProps) {
  const listId = useId();
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState<Held | null>(null);
  const [focused, setFocused] = useState(false);
  // Set when Enter or a click has already committed, so the blur that follows does not.
  const committed = useRef(false);
  if (held && held.base !== value) setHeld(null);
  const shownValue = held?.base === value ? held.text : value;
  const text = draft ?? shownValue;
  const matches = useMemo(() => (draft === undefined ? [] : matchTimezones(draft)), [draft]);
  const open = focused && draft !== undefined && draft.trim() !== '';
  // Left with an entry that names no single zone: the saved zone stays until one is picked.
  const unresolved = !focused && draft !== undefined && draft.trim() !== '';
  const offset = unresolved ? '' : zoneOffset(shownValue);
  const hintId = `${listId}-hint`;

  const commit = (zone: string | null) => {
    committed.current = true;
    setDraft(undefined);
    setActive(0);
    if (!zone || zone === shownValue) return;
    const h: Held = { text: zone, base: value };
    setHeld(h);
    const result = onCommit(zone);
    if (result === false) setHeld(null);
    else if (isThenable(result)) {
      result.then(undefined, () => {
        setHeld((cur) => (cur === h ? null : cur));
      });
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!open || matches.length === 0) return;
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => Math.max(0, Math.min(matches.length - 1, i + step)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (draft === undefined) {
        e.currentTarget.blur();
        return;
      }
      if (!draft.trim()) {
        commit(null);
        e.currentTarget.blur();
        return;
      }
      // Nothing to pick (the list says so): the entry stays for another try.
      const zone = matches[active] ?? resolveTimezone(draft);
      if (!zone) return;
      commit(zone);
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

  return (
    <>
      <span className={f.tz}>
        <input
          id={id}
          type="text"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[active] ? `${listId}-${String(active)}` : undefined}
          aria-invalid={unresolved || undefined}
          aria-describedby={unresolved ? hintId : undefined}
          autoComplete="off"
          spellCheck={false}
          className={f.tzInput}
          value={text}
          onFocus={(e) => {
            committed.current = false;
            setFocused(true);
            e.currentTarget.select();
          }}
          onChange={(e) => {
            setDraft(e.currentTarget.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setFocused(false);
            if (committed.current || draft === undefined) return;
            if (!draft.trim()) {
              commit(null);
              return;
            }
            const zone = resolveTimezone(draft);
            if (zone) commit(zone);
          }}
        />
        {offset && <span className={f.tzOffset}>{offset}</span>}
        {open && (
          <ul id={listId} role="listbox" aria-label="Time zones" className={f.listbox}>
            {matches.length === 0 ? (
              <li className={f.optionEmpty}>No time zone matches that. Try a city, like London.</li>
            ) : (
              matches.map((zone, k) => (
                <li
                  key={zone}
                  id={`${listId}-${String(k)}`}
                  role="option"
                  aria-selected={k === active}
                  className={f.option}
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  onMouseEnter={() => {
                    setActive(k);
                  }}
                  onClick={() => {
                    commit(zone);
                    (document.activeElement as HTMLElement | null)?.blur();
                  }}
                >
                  <span className={f.optionMain}>{zone.replace(/_/g, ' ')}</span>
                  <span className={f.optionHint}>{zoneOffset(zone)}</span>
                </li>
              ))
            )}
          </ul>
        )}
      </span>
      {unresolved && (
        <span id={hintId} className={f.tzHint}>
          Pick a zone from the list. It stays {shownValue.replace(/_/g, ' ')} until you do.
        </span>
      )}
    </>
  );
}
